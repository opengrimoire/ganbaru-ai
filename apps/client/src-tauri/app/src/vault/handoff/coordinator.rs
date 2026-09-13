//! Desktop coordinator operations behind the bounded transport protocol.

use super::protocol::{BundleMetadata, BundlePurpose, PROTOCOL_VERSION};
use super::state::{random_token, PairingManager};
use crate::vault::ownership::VaultOwnershipManager;
use crate::vault::quiescence::{
    begin_snapshot_quiescence, begin_source_quiescence, SnapshotQuiescence, SourceQuiescence,
};
use std::fs;
use tauri::{Manager, Runtime};

#[derive(Debug)]
pub(crate) enum CoordinatorOperation {
    Prepare {
        vault_id: String,
        device_id: String,
        generation: u64,
        purpose: BundlePurpose,
    },
    CommitOwnership {
        metadata: BundleMetadata,
    },
    Activated {
        vault_id: String,
        device_id: String,
        transfer_id: String,
        generation: u64,
        purpose: BundlePurpose,
    },
    Cancel {
        transfer_id: String,
    },
    Shutdown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CoordinatorResponse {
    Prepared {
        metadata: BundleMetadata,
        purpose: BundlePurpose,
    },
    OwnershipGrant {
        vault_id: String,
        transfer_id: String,
        owner_device_id: String,
        generation: u64,
    },
    ActivationAcknowledged {
        transfer_id: String,
    },
    Cancelled {
        transfer_id: String,
    },
}

pub(crate) struct CoordinatorRequest {
    pub operation: CoordinatorOperation,
    pub response: tokio::sync::oneshot::Sender<Result<CoordinatorResponse, String>>,
}

pub(crate) type CoordinatorSender = tokio::sync::mpsc::Sender<CoordinatorRequest>;

struct PreparedTransfer {
    metadata: BundleMetadata,
    purpose: BundlePurpose,
    archive_path: std::path::PathBuf,
    quiescence: Option<SourceQuiescence>,
    committed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CompletedActivation {
    vault_id: String,
    device_id: String,
    transfer_id: String,
    generation: u64,
    purpose: BundlePurpose,
}

struct CoordinatorState<R: Runtime> {
    app: tauri::AppHandle<R>,
    pairing: PairingManager,
    prepared: Option<PreparedTransfer>,
    completed: Option<CompletedActivation>,
}

pub(crate) async fn run<R: Runtime>(
    app: tauri::AppHandle<R>,
    pairing: PairingManager,
    mut receiver: tokio::sync::mpsc::Receiver<CoordinatorRequest>,
) {
    let mut state = CoordinatorState {
        app,
        pairing,
        prepared: None,
        completed: None,
    };
    while let Some(request) = receiver.recv().await {
        if matches!(request.operation, CoordinatorOperation::Shutdown) {
            state.shutdown();
            let _ = request.response.send(Ok(CoordinatorResponse::Cancelled {
                transfer_id: "shutdown".to_string(),
            }));
            break;
        }
        let response = state.handle(request.operation).await;
        let _ = request.response.send(response);
    }
    state.shutdown();
}

impl<R: Runtime> CoordinatorState<R> {
    async fn handle(
        &mut self,
        operation: CoordinatorOperation,
    ) -> Result<CoordinatorResponse, String> {
        match operation {
            CoordinatorOperation::Prepare {
                vault_id,
                device_id,
                generation,
                purpose,
            } => self.prepare(vault_id, device_id, generation, purpose).await,
            CoordinatorOperation::CommitOwnership { metadata } => self.commit_ownership(metadata),
            CoordinatorOperation::Activated {
                vault_id,
                device_id,
                transfer_id,
                generation,
                purpose,
            } => self.activated(vault_id, device_id, transfer_id, generation, purpose),
            CoordinatorOperation::Cancel { transfer_id } => self.cancel(transfer_id),
            CoordinatorOperation::Shutdown => unreachable!("shutdown is handled by the run loop"),
        }
    }

    async fn prepare(
        &mut self,
        vault_id: String,
        device_id: String,
        generation: u64,
        purpose: BundlePurpose,
    ) -> Result<CoordinatorResponse, String> {
        if let Some(prepared) = self.prepared.as_ref() {
            if prepared.metadata.vault_id == vault_id
                && prepared.metadata.device_id == device_id
                && prepared.purpose == purpose
                && generation
                    == match purpose {
                        BundlePurpose::Ownership => prepared.metadata.generation.saturating_sub(1),
                        BundlePurpose::Refresh => prepared.metadata.generation,
                    }
            {
                return Ok(CoordinatorResponse::Prepared {
                    metadata: prepared.metadata.clone(),
                    purpose,
                });
            }
            return Err("another vault handoff transfer is already active".to_string());
        }
        if crate::vault::active_vault_id(&self.app)? != vault_id {
            return Err("requested vault is not active on the coordinator".to_string());
        }
        let ownership = self.app.state::<VaultOwnershipManager>();
        let status = ownership.status(&vault_id)?;
        if !status.can_write || status.generation != generation {
            return Err("coordinator is not the owner at the requested generation".to_string());
        }
        let transfer_id = random_token("transfer")?;
        let next_generation = match purpose {
            BundlePurpose::Ownership => generation
                .checked_add(1)
                .ok_or_else(|| "vault ownership generation is exhausted".to_string())?,
            BundlePurpose::Refresh => generation,
        };
        let (quiescence, snapshot_quiescence): (
            Option<SourceQuiescence>,
            Option<SnapshotQuiescence>,
        ) = match purpose {
            BundlePurpose::Ownership => (
                Some(
                    begin_source_quiescence(
                        &self.app,
                        generation,
                        transfer_id.clone(),
                        device_id.clone(),
                    )
                    .await?,
                ),
                None,
            ),
            BundlePurpose::Refresh => (None, Some(begin_snapshot_quiescence(&self.app).await?)),
        };
        let (database_snapshot, archive_path) =
            self.pairing.outgoing_snapshot_paths(&transfer_id)?;
        let vault_root = crate::vault::active_vault_path(&self.app)?;
        let snapshot_result = crate::vault::backup::create_handoff_archive(
            &vault_root,
            &database_snapshot,
            &archive_path,
        )
        .await;
        drop(snapshot_quiescence);
        let _ = fs::remove_file(&database_snapshot);
        if let Err(error) = snapshot_result {
            if let Some(quiescence) = quiescence {
                let _ = quiescence.abort(&self.app);
            }
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
        let metadata = BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            vault_id,
            device_id,
            transfer_id,
            generation: next_generation,
            archive_bytes: archive_path
                .metadata()
                .map_err(|error| format!("inspect handoff archive: {error}"))?
                .len(),
            archive_sha256: super::sha256_file(&archive_path)?,
        };
        if let Err(error) = self
            .pairing
            .register_outgoing_bundle(metadata.clone(), archive_path.clone())
        {
            if let Some(quiescence) = quiescence {
                let _ = quiescence.abort(&self.app);
            }
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
        self.prepared = Some(PreparedTransfer {
            metadata: metadata.clone(),
            purpose,
            archive_path,
            quiescence,
            committed: false,
        });
        Ok(CoordinatorResponse::Prepared { metadata, purpose })
    }

    fn commit_ownership(
        &mut self,
        metadata: BundleMetadata,
    ) -> Result<CoordinatorResponse, String> {
        let prepared = self
            .prepared
            .as_mut()
            .ok_or_else(|| "ownership transfer is no longer available".to_string())?;
        if prepared.purpose != BundlePurpose::Ownership || prepared.metadata != metadata {
            return Err("staged ownership transfer does not match the coordinator".to_string());
        }
        let generation = self
            .app
            .state::<VaultOwnershipManager>()
            .commit_outgoing(&metadata.vault_id, &metadata.transfer_id)?;
        prepared.committed = true;
        prepared.quiescence.take();
        Ok(CoordinatorResponse::OwnershipGrant {
            vault_id: metadata.vault_id,
            transfer_id: metadata.transfer_id,
            owner_device_id: metadata.device_id,
            generation,
        })
    }

    fn activated(
        &mut self,
        vault_id: String,
        device_id: String,
        transfer_id: String,
        generation: u64,
        purpose: BundlePurpose,
    ) -> Result<CoordinatorResponse, String> {
        let completed = CompletedActivation {
            vault_id,
            device_id,
            transfer_id: transfer_id.clone(),
            generation,
            purpose,
        };
        if self.completed.as_ref() == Some(&completed) {
            return Ok(CoordinatorResponse::ActivationAcknowledged { transfer_id });
        }
        let prepared = self
            .prepared
            .as_ref()
            .ok_or_else(|| "activation does not match an active transfer".to_string())?;
        if prepared.metadata.vault_id != completed.vault_id
            || prepared.metadata.device_id != completed.device_id
            || prepared.metadata.transfer_id != completed.transfer_id
            || prepared.metadata.generation != completed.generation
            || prepared.purpose != completed.purpose
            || (completed.purpose == BundlePurpose::Ownership && !prepared.committed)
        {
            return Err("activation does not match the prepared transfer".to_string());
        }
        if completed.purpose == BundlePurpose::Ownership {
            self.app
                .state::<VaultOwnershipManager>()
                .finish_outgoing_acknowledgement(
                    &completed.vault_id,
                    &completed.transfer_id,
                    completed.generation,
                )?;
        }
        self.cleanup_prepared();
        self.completed = Some(completed);
        Ok(CoordinatorResponse::ActivationAcknowledged { transfer_id })
    }

    fn cancel(&mut self, transfer_id: String) -> Result<CoordinatorResponse, String> {
        let prepared = self
            .prepared
            .as_ref()
            .ok_or_else(|| "transfer is no longer active".to_string())?;
        if prepared.metadata.transfer_id != transfer_id {
            return Err("cancelled transfer does not match the active transfer".to_string());
        }
        if prepared.committed {
            return Err("committed ownership cannot be cancelled".to_string());
        }
        if let Some(quiescence) = self
            .prepared
            .as_mut()
            .and_then(|prepared| prepared.quiescence.take())
        {
            quiescence.abort(&self.app)?;
        }
        self.cleanup_prepared();
        Ok(CoordinatorResponse::Cancelled { transfer_id })
    }

    fn cleanup_prepared(&mut self) {
        if let Some(prepared) = self.prepared.take() {
            let _ = self
                .pairing
                .unregister_outgoing_bundle(&prepared.metadata.transfer_id);
            let _ = fs::remove_file(prepared.archive_path);
        }
    }

    fn shutdown(&mut self) {
        let should_cleanup = self
            .prepared
            .as_ref()
            .is_some_and(|prepared| !prepared.committed);
        if !should_cleanup {
            return;
        }
        if let Some(quiescence) = self
            .prepared
            .as_mut()
            .and_then(|prepared| prepared.quiescence.take())
        {
            let _ = quiescence.abort(&self.app);
        }
        self.cleanup_prepared();
    }
}

pub(crate) async fn request(
    sender: &CoordinatorSender,
    operation: CoordinatorOperation,
) -> Result<CoordinatorResponse, String> {
    let (response, receiver) = tokio::sync::oneshot::channel();
    sender
        .send(CoordinatorRequest {
            operation,
            response,
        })
        .await
        .map_err(|_| "vault handoff coordinator is stopping".to_string())?;
    receiver
        .await
        .map_err(|_| "vault handoff coordinator did not return a response".to_string())?
}
