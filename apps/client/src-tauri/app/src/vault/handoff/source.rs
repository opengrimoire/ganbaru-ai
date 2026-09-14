//! Android source workflow for resumable uploads to the desktop coordinator.
#![cfg_attr(not(target_os = "android"), allow(dead_code, unused_imports))]

use super::protocol::{BundleMetadata, BundlePurpose, PROTOCOL_VERSION};
use super::state::{PairingManager, PendingAcknowledgement, StoredOutgoingTransfer};
use crate::vault::ownership::{TransferPhase, VaultOwnershipManager};
use crate::vault::quiescence::{
    begin_snapshot_quiescence, begin_source_quiescence, SnapshotQuiescence, SourceQuiescence,
};
use std::fs;
use std::sync::Arc;
#[cfg(target_os = "android")]
use tauri::Manager;

#[derive(Default)]
pub(crate) struct SourceLifecycle {
    operation: Arc<tokio::sync::Mutex<()>>,
}

#[cfg(target_os = "android")]
pub(crate) fn trigger_requested_upload(app: tauri::AppHandle, purpose: BundlePurpose) {
    tauri::async_runtime::spawn(async move {
        let lifecycle = app.state::<SourceLifecycle>();
        let Ok(_operation) = lifecycle.operation.try_lock() else {
            return;
        };
        if let Err(error) = upload(&app, purpose).await {
            eprintln!("Android vault upload deferred: {error}");
        }
    });
}

#[cfg(target_os = "android")]
async fn upload(app: &tauri::AppHandle, purpose: BundlePurpose) -> Result<(), String> {
    let pairing = app.state::<PairingManager>().inner().clone();
    let coordinator = pairing
        .coordinator_pin()?
        .ok_or_else(|| "this device is not linked to a coordinator".to_string())?;
    let ownership = app.state::<VaultOwnershipManager>();
    let status = ownership.status(&coordinator.vault_id)?;
    let mut existing = pairing.outgoing_transfer()?;
    if let Some(transfer) = existing.as_ref().filter(|transfer| {
        transfer.purpose == BundlePurpose::Refresh && purpose == BundlePurpose::Ownership
    }) {
        let transfer_id = transfer.metadata.transfer_id.clone();
        pairing.clear_outgoing_transfer(&transfer_id)?;
        cleanup(&pairing, &transfer_id)?;
        existing = None;
    }
    let transfer = if let Some(existing) = existing {
        if existing.purpose != purpose {
            return Err("another outgoing vault transfer is already active".to_string());
        }
        existing
    } else {
        if !status.can_write {
            return Err("Android is not the stable vault owner".to_string());
        }
        prepare(
            app,
            &pairing,
            &coordinator.device_id,
            purpose,
            status.generation,
        )
        .await?
    };
    let (source_device_id, _) = pairing.identity()?;
    super::transport::upload_bundle(
        &pairing,
        transfer.metadata.clone(),
        source_device_id.clone(),
        purpose,
    )
    .await?;

    if purpose == BundlePurpose::Ownership {
        let current = ownership.status(&transfer.metadata.vault_id)?;
        if !matches!(
            current.transfer_phase,
            TransferPhase::OutgoingCommitted { .. }
        ) {
            ownership
                .commit_outgoing(&transfer.metadata.vault_id, &transfer.metadata.transfer_id)?;
            pairing.mark_outgoing_committed(&transfer.metadata.transfer_id)?;
        }
        super::transport::commit_uploaded_ownership(
            &pairing,
            transfer.metadata.clone(),
            source_device_id,
        )
        .await?;
        ownership.finish_outgoing_acknowledgement(
            &transfer.metadata.vault_id,
            &transfer.metadata.transfer_id,
            transfer.metadata.generation,
        )?;
        pairing.complete_outgoing_activation(PendingAcknowledgement {
            vault_id: transfer.metadata.vault_id.clone(),
            device_id: transfer.metadata.device_id.clone(),
            transfer_id: transfer.metadata.transfer_id.clone(),
            generation: transfer.metadata.generation,
            purpose,
        })?;
        super::receiver::reload_application_shell(app)?;
        if let Err(error) = cleanup(&pairing, &transfer.metadata.transfer_id) {
            eprintln!("failed to clean completed Android vault upload: {error}");
        }
    } else {
        pairing.clear_outgoing_transfer(&transfer.metadata.transfer_id)?;
        if let Err(error) = cleanup(&pairing, &transfer.metadata.transfer_id) {
            eprintln!("failed to clean completed Android vault upload: {error}");
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
async fn prepare(
    app: &tauri::AppHandle,
    pairing: &PairingManager,
    receiver_device_id: &str,
    purpose: BundlePurpose,
    generation: u64,
) -> Result<StoredOutgoingTransfer, String> {
    crate::doomscrolling_mobile::doomscrolling_mobile_sync_events(app.clone()).await?;
    let transfer_id = super::state::random_token("transfer")?;
    let next_generation = match purpose {
        BundlePurpose::Ownership => generation
            .checked_add(1)
            .ok_or_else(|| "vault ownership generation is exhausted".to_string())?,
        BundlePurpose::Refresh => generation,
    };
    let (ownership_quiescence, snapshot_quiescence): (
        Option<SourceQuiescence>,
        Option<SnapshotQuiescence>,
    ) = match purpose {
        BundlePurpose::Ownership => (
            Some(
                begin_source_quiescence(
                    app,
                    generation,
                    transfer_id.clone(),
                    receiver_device_id.to_string(),
                )
                .await?,
            ),
            None,
        ),
        BundlePurpose::Refresh => (None, Some(begin_snapshot_quiescence(app).await?)),
    };
    let (database_snapshot, archive_path) = match pairing.outgoing_snapshot_paths(&transfer_id) {
        Ok(paths) => paths,
        Err(error) => {
            if let Some(quiescence) = ownership_quiescence {
                let _ = quiescence.abort(app);
            }
            return Err(error);
        }
    };
    let vault_root = match crate::vault::active_vault_path(app) {
        Ok(path) => path,
        Err(error) => {
            if let Some(quiescence) = ownership_quiescence {
                let _ = quiescence.abort(app);
            }
            return Err(error);
        }
    };
    let snapshot = crate::vault::backup::create_handoff_archive(
        &vault_root,
        &database_snapshot,
        &archive_path,
    )
    .await;
    drop(snapshot_quiescence);
    let _ = fs::remove_file(&database_snapshot);
    if let Err(error) = snapshot {
        if let Some(quiescence) = ownership_quiescence {
            let _ = quiescence.abort(app);
        }
        let _ = fs::remove_file(&archive_path);
        return Err(error);
    }
    let metadata_result: Result<BundleMetadata, String> = (|| {
        Ok(BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            vault_id: crate::vault::active_vault_id(app)?,
            device_id: receiver_device_id.to_string(),
            transfer_id,
            generation: next_generation,
            archive_bytes: archive_path
                .metadata()
                .map_err(|error| format!("inspect handoff archive: {error}"))?
                .len(),
            archive_sha256: super::sha256_file(&archive_path)?,
        })
    })();
    let metadata = match metadata_result {
        Ok(metadata) => metadata,
        Err(error) => {
            if let Some(quiescence) = ownership_quiescence {
                let _ = quiescence.abort(app);
            }
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
    };
    let transfer = StoredOutgoingTransfer {
        metadata,
        purpose,
        committed: false,
    };
    if let Err(error) = pairing.store_outgoing_transfer(transfer.clone()) {
        if let Some(quiescence) = ownership_quiescence {
            let _ = quiescence.abort(app);
        }
        let _ = fs::remove_file(&archive_path);
        return Err(error);
    }
    drop(ownership_quiescence);
    Ok(transfer)
}

fn cleanup(pairing: &PairingManager, transfer_id: &str) -> Result<(), String> {
    let (database_snapshot, archive_path) = pairing.outgoing_snapshot_paths(transfer_id)?;
    for path in [database_snapshot, archive_path] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("remove completed outgoing transfer: {error}")),
        }
    }
    Ok(())
}
