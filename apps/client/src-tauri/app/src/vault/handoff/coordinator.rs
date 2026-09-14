//! Desktop coordinator operations behind the bounded transport protocol.

use super::protocol::{
    BundleMetadata, BundlePurpose, DoomscrollingSampleMessage, PROTOCOL_VERSION,
};
use super::state::{random_token, PairingManager, PendingAcknowledgement, StoredOutgoingTransfer};
use crate::vault::ownership::VaultOwnershipManager;
use crate::vault::quiescence::{
    begin_snapshot_quiescence, begin_source_quiescence, SnapshotQuiescence, SourceQuiescence,
};
use std::fs;
use std::time::{Duration, Instant};
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
    PollUpload {
        vault_id: String,
        device_id: String,
        generation: u64,
    },
    RequestUpload {
        purpose: BundlePurpose,
    },
    DoomscrollingExchange {
        vault_id: String,
        device_id: String,
        samples: Vec<DoomscrollingSampleMessage>,
        acknowledged_peer_sample_ids: Vec<String>,
        owner_snapshot: Vec<DoomscrollingSampleMessage>,
    },
    Uploaded {
        metadata: BundleMetadata,
        source_device_id: String,
        purpose: BundlePurpose,
    },
    AuthorizeUpload {
        metadata: BundleMetadata,
        source_device_id: String,
        purpose: BundlePurpose,
    },
    CommitUploadedOwnership {
        metadata: BundleMetadata,
        source_device_id: String,
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
    UploadStatus {
        generation: u64,
        requested_upload: Option<BundlePurpose>,
    },
    UploadRequested {
        purpose: BundlePurpose,
    },
    IncomingStaged {
        transfer_id: String,
    },
    UploadAuthorized {
        transfer_id: String,
        already_received: bool,
    },
    DoomscrollingAcknowledged {
        acknowledged_sample_ids: Vec<String>,
        peer_samples: Vec<DoomscrollingSampleMessage>,
        combined_samples: Vec<DoomscrollingSampleMessage>,
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
    last_peer_activity: Instant,
}

const PEER_RECONNECT_GAP: Duration = Duration::from_secs(75);

pub(crate) async fn run<R: Runtime>(
    app: tauri::AppHandle<R>,
    pairing: PairingManager,
    mut receiver: tokio::sync::mpsc::Receiver<CoordinatorRequest>,
) {
    if pairing.requested_upload().ok().flatten().is_none() {
        if let (Ok(status), Ok(Some(peer))) = (
            crate::vault::ownership::active_status(&app),
            pairing.linked_peer(),
        ) {
            if !status.can_write && status.owner_device_id == peer.device_id {
                let _ = pairing.request_upload(BundlePurpose::Refresh);
            }
        }
    }
    let prepared = restore_prepared(&pairing).ok().flatten();
    let completed = pairing
        .completed_activation()
        .ok()
        .flatten()
        .map(|activation| CompletedActivation {
            vault_id: activation.vault_id,
            device_id: activation.device_id,
            transfer_id: activation.transfer_id,
            generation: activation.generation,
            purpose: activation.purpose,
        });
    let mut state = CoordinatorState {
        app,
        pairing,
        prepared,
        completed,
        last_peer_activity: Instant::now(),
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
            CoordinatorOperation::PollUpload {
                vault_id,
                device_id,
                generation,
            } => self.poll_upload(vault_id, device_id, generation),
            CoordinatorOperation::RequestUpload { purpose } => self.request_upload(purpose),
            CoordinatorOperation::DoomscrollingExchange {
                vault_id,
                device_id,
                samples,
                acknowledged_peer_sample_ids,
                owner_snapshot,
            } => {
                self.doomscrolling_exchange(
                    vault_id,
                    device_id,
                    samples,
                    acknowledged_peer_sample_ids,
                    owner_snapshot,
                )
                .await
            }
            CoordinatorOperation::Uploaded {
                metadata,
                source_device_id,
                purpose,
            } => self.uploaded(metadata, source_device_id, purpose).await,
            CoordinatorOperation::AuthorizeUpload {
                metadata,
                source_device_id,
                purpose,
            } => self.authorize_upload(&metadata, &source_device_id, purpose),
            CoordinatorOperation::CommitUploadedOwnership {
                metadata,
                source_device_id,
            } => {
                self.commit_uploaded_ownership(metadata, source_device_id)
                    .await
            }
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
        let pool = crate::db_path::connect_sqlite(
            self.app.clone(),
            format!("sqlite:{}", crate::vault::APP_SQLITE_FILE),
        )
        .await?;
        crate::doomscrolling_linked::drain_local_spool(
            &self.app,
            &pool,
            &vault_id,
            &status.device_id,
        )
        .await?;
        drop(pool);
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
            match self.pairing.outgoing_snapshot_paths(&transfer_id) {
                Ok(paths) => paths,
                Err(error) => {
                    if let Some(quiescence) = quiescence {
                        let _ = quiescence.abort(&self.app);
                    }
                    return Err(error);
                }
            };
        let vault_root = match crate::vault::active_vault_path(&self.app) {
            Ok(path) => path,
            Err(error) => {
                if let Some(quiescence) = quiescence {
                    let _ = quiescence.abort(&self.app);
                }
                return Err(error);
            }
        };
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
        let metadata_result: Result<BundleMetadata, String> = (|| {
            Ok(BundleMetadata {
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
            })
        })();
        let metadata = match metadata_result {
            Ok(metadata) => metadata,
            Err(error) => {
                if let Some(quiescence) = quiescence {
                    let _ = quiescence.abort(&self.app);
                }
                let _ = fs::remove_file(&archive_path);
                return Err(error);
            }
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
        if let Err(error) = self
            .pairing
            .store_outgoing_transfer(StoredOutgoingTransfer {
                metadata: metadata.clone(),
                purpose,
                committed: false,
            })
        {
            let _ = self
                .pairing
                .unregister_outgoing_bundle(&metadata.transfer_id);
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
        self.pairing
            .mark_outgoing_committed(&metadata.transfer_id)?;
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
        self.pairing
            .complete_outgoing_activation(PendingAcknowledgement {
                vault_id: completed.vault_id.clone(),
                device_id: completed.device_id.clone(),
                transfer_id: completed.transfer_id.clone(),
                generation: completed.generation,
                purpose: completed.purpose,
            })?;
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

    fn poll_upload(
        &mut self,
        vault_id: String,
        device_id: String,
        generation: u64,
    ) -> Result<CoordinatorResponse, String> {
        if crate::vault::active_vault_id(&self.app)? != vault_id {
            return Err("requested vault is not active on the coordinator".to_string());
        }
        let status = self
            .app
            .state::<VaultOwnershipManager>()
            .status(&vault_id)?;
        if status.owner_device_id != device_id || status.generation != generation {
            return Err("polling device is not the owner at the requested generation".to_string());
        }
        let reconnected = self.last_peer_activity.elapsed() >= PEER_RECONNECT_GAP;
        self.last_peer_activity = Instant::now();
        if reconnected
            && self.pairing.requested_upload()?.is_none()
            && self.pairing.incoming_transfer()?.is_none()
        {
            self.pairing.request_upload(BundlePurpose::Refresh)?;
        }
        Ok(CoordinatorResponse::UploadStatus {
            generation,
            requested_upload: self.pairing.requested_upload()?,
        })
    }

    fn request_upload(&self, purpose: BundlePurpose) -> Result<CoordinatorResponse, String> {
        let status = crate::vault::ownership::active_status(&self.app)?;
        let peer = self
            .pairing
            .linked_peer()?
            .ok_or_else(|| "no phone is linked".to_string())?;
        if status.can_write || status.owner_device_id != peer.device_id {
            return Err("the linked phone is not the current vault owner".to_string());
        }
        if let Some(incoming) = self.pairing.incoming_transfer()? {
            if incoming.purpose != purpose {
                return Err("another uploaded vault transfer requires recovery".to_string());
            }
        }
        self.pairing.request_upload(purpose)?;
        Ok(CoordinatorResponse::UploadRequested { purpose })
    }

    async fn doomscrolling_exchange(
        &mut self,
        vault_id: String,
        device_id: String,
        samples: Vec<DoomscrollingSampleMessage>,
        acknowledged_peer_sample_ids: Vec<String>,
        owner_snapshot: Vec<DoomscrollingSampleMessage>,
    ) -> Result<CoordinatorResponse, String> {
        self.last_peer_activity = Instant::now();
        let status = self
            .app
            .state::<VaultOwnershipManager>()
            .status(&vault_id)?;
        if status.can_write {
            if !owner_snapshot.is_empty() || !acknowledged_peer_sample_ids.is_empty() {
                return Err(
                    "the non-owner cannot publish authoritative Doomscrolling state".to_string(),
                );
            }
            let pool = crate::db_path::connect_sqlite(
                self.app.clone(),
                format!("sqlite:{}", crate::vault::APP_SQLITE_FILE),
            )
            .await?;
            crate::doomscrolling_linked::drain_local_spool(
                &self.app,
                &pool,
                &vault_id,
                &status.device_id,
            )
            .await?;
            let acknowledged_sample_ids =
                crate::doomscrolling_linked::import_linked_samples(&pool, &samples).await?;
            let combined_samples =
                crate::doomscrolling_linked::aggregate_owner_samples(&pool).await?;
            return Ok(CoordinatorResponse::DoomscrollingAcknowledged {
                acknowledged_sample_ids,
                peer_samples: Vec::new(),
                combined_samples,
            });
        }
        if status.owner_device_id != device_id || !samples.is_empty() {
            return Err(
                "Doomscrolling exchange does not match the current vault owner".to_string(),
            );
        }
        crate::doomscrolling_linked::acknowledge(
            &self.app,
            &vault_id,
            &status.device_id,
            &acknowledged_peer_sample_ids,
        )
        .await?;
        if !owner_snapshot.is_empty() {
            crate::doomscrolling_linked::replace_accepted(&self.app, &vault_id, &owner_snapshot)
                .await?;
        }
        let peer_samples =
            crate::doomscrolling_linked::pending(&self.app, &vault_id, &status.device_id).await?;
        let combined_samples = if peer_samples.is_empty() {
            crate::doomscrolling_linked::accepted(&self.app, &vault_id).await?
        } else {
            Vec::new()
        };
        Ok(CoordinatorResponse::DoomscrollingAcknowledged {
            acknowledged_sample_ids: Vec::new(),
            peer_samples,
            combined_samples,
        })
    }

    async fn uploaded(
        &mut self,
        metadata: BundleMetadata,
        source_device_id: String,
        purpose: BundlePurpose,
    ) -> Result<CoordinatorResponse, String> {
        self.last_peer_activity = Instant::now();
        self.authorize_upload(&metadata, &source_device_id, purpose)?;
        if let Some(completed) = self.pairing.completed_activation()? {
            if completed.transfer_id == metadata.transfer_id
                && completed.purpose == purpose
                && completed.generation == metadata.generation
            {
                return Ok(CoordinatorResponse::IncomingStaged {
                    transfer_id: metadata.transfer_id,
                });
            }
        }
        if let Some(incoming) = self.pairing.incoming_transfer()? {
            if incoming.metadata == metadata
                && incoming.source_device_id == source_device_id
                && incoming.purpose == purpose
            {
                if purpose == BundlePurpose::Refresh {
                    let staging = crate::vault::backup::active_handoff_staging_path(
                        &self.app,
                        &metadata.transfer_id,
                    )?;
                    crate::vault::backup::activate_active_handoff(
                        &self.app,
                        &staging,
                        &metadata.transfer_id,
                        &metadata.vault_id,
                        false,
                    )
                    .await?;
                    let (device_id, _) = self.pairing.identity()?;
                    self.pairing
                        .complete_incoming_activation(PendingAcknowledgement {
                            vault_id: metadata.vault_id.clone(),
                            device_id,
                            transfer_id: metadata.transfer_id.clone(),
                            generation: metadata.generation,
                            purpose,
                        })?;
                    self.reload_shell()?;
                    if let Err(error) = self.pairing.remove_staging(&metadata.transfer_id) {
                        eprintln!("failed to clean completed vault upload: {error}");
                    }
                }
                return Ok(CoordinatorResponse::IncomingStaged {
                    transfer_id: metadata.transfer_id,
                });
            }
            return Err("another uploaded vault transfer is pending".to_string());
        }
        let (local_device_id, _) = self.pairing.identity()?;
        let status = self
            .app
            .state::<VaultOwnershipManager>()
            .status(&metadata.vault_id)?;
        let expected_generation = match purpose {
            BundlePurpose::Ownership => status
                .generation
                .checked_add(1)
                .ok_or_else(|| "vault ownership generation is exhausted".to_string())?,
            BundlePurpose::Refresh => status.generation,
        };
        if metadata.device_id != local_device_id
            || status.can_write
            || status.owner_device_id != source_device_id
            || metadata.generation != expected_generation
            || self.pairing.requested_upload()? != Some(purpose)
        {
            return Err("uploaded bundle does not match the requested owner state".to_string());
        }
        let (_, _, archive) = self.pairing.staging_paths(&metadata.transfer_id)?;
        let staging =
            crate::vault::backup::active_handoff_staging_path(&self.app, &metadata.transfer_id)?;
        crate::vault::backup::stage_handoff_archive(&archive, &staging, &metadata.vault_id).await?;
        self.pairing
            .store_incoming_transfer(super::state::StoredIncomingTransfer {
                metadata: metadata.clone(),
                source_device_id,
                purpose,
            })?;
        if purpose == BundlePurpose::Refresh {
            crate::vault::backup::activate_active_handoff(
                &self.app,
                &staging,
                &metadata.transfer_id,
                &metadata.vault_id,
                false,
            )
            .await?;
            let (device_id, _) = self.pairing.identity()?;
            self.pairing
                .complete_incoming_activation(PendingAcknowledgement {
                    vault_id: metadata.vault_id.clone(),
                    device_id,
                    transfer_id: metadata.transfer_id.clone(),
                    generation: metadata.generation,
                    purpose,
                })?;
            self.reload_shell()?;
            if let Err(error) = self.pairing.remove_staging(&metadata.transfer_id) {
                eprintln!("failed to clean completed vault upload: {error}");
            }
        }
        Ok(CoordinatorResponse::IncomingStaged {
            transfer_id: metadata.transfer_id,
        })
    }

    fn authorize_upload(
        &mut self,
        metadata: &BundleMetadata,
        source_device_id: &str,
        purpose: BundlePurpose,
    ) -> Result<CoordinatorResponse, String> {
        self.last_peer_activity = Instant::now();
        if let Some(completed) = self.pairing.completed_activation()? {
            if completed.vault_id == metadata.vault_id
                && completed.device_id == metadata.device_id
                && completed.transfer_id == metadata.transfer_id
                && completed.purpose == purpose
                && completed.generation == metadata.generation
            {
                return Ok(CoordinatorResponse::UploadAuthorized {
                    transfer_id: metadata.transfer_id.clone(),
                    already_received: true,
                });
            }
        }
        if let Some(incoming) = self.pairing.incoming_transfer()? {
            if incoming.metadata == *metadata
                && incoming.source_device_id == source_device_id
                && incoming.purpose == purpose
            {
                return Ok(CoordinatorResponse::UploadAuthorized {
                    transfer_id: metadata.transfer_id.clone(),
                    already_received: true,
                });
            }
            return Err("another uploaded vault transfer is pending".to_string());
        }
        let (local_device_id, _) = self.pairing.identity()?;
        let status = self
            .app
            .state::<VaultOwnershipManager>()
            .status(&metadata.vault_id)?;
        let expected_generation = match purpose {
            BundlePurpose::Ownership => status
                .generation
                .checked_add(1)
                .ok_or_else(|| "vault ownership generation is exhausted".to_string())?,
            BundlePurpose::Refresh => status.generation,
        };
        if metadata.device_id != local_device_id
            || status.can_write
            || status.owner_device_id != source_device_id
            || metadata.generation != expected_generation
            || self.pairing.requested_upload()? != Some(purpose)
        {
            return Err("uploaded bundle does not match the requested owner state".to_string());
        }
        Ok(CoordinatorResponse::UploadAuthorized {
            transfer_id: metadata.transfer_id.clone(),
            already_received: false,
        })
    }

    async fn commit_uploaded_ownership(
        &mut self,
        metadata: BundleMetadata,
        source_device_id: String,
    ) -> Result<CoordinatorResponse, String> {
        self.last_peer_activity = Instant::now();
        if let Some(completed) = self.pairing.completed_activation()? {
            if completed.vault_id == metadata.vault_id
                && completed.transfer_id == metadata.transfer_id
                && completed.generation == metadata.generation
                && completed.purpose == BundlePurpose::Ownership
            {
                return Ok(CoordinatorResponse::ActivationAcknowledged {
                    transfer_id: metadata.transfer_id,
                });
            }
        }
        let incoming = self
            .pairing
            .incoming_transfer()?
            .ok_or_else(|| "uploaded ownership transfer is not staged".to_string())?;
        if incoming.metadata != metadata
            || incoming.source_device_id != source_device_id
            || incoming.purpose != BundlePurpose::Ownership
        {
            return Err("uploaded ownership grant does not match staged data".to_string());
        }
        let ownership = self.app.state::<VaultOwnershipManager>();
        let status = ownership.status(&metadata.vault_id)?;
        let needs_finalize = match status.transfer_phase {
            crate::vault::ownership::TransferPhase::IncomingCommitted {
                ref transfer_id,
                ref source_device_id,
                committed_generation,
            } if transfer_id == &metadata.transfer_id
                && source_device_id == &incoming.source_device_id
                && committed_generation == metadata.generation =>
            {
                true
            }
            crate::vault::ownership::TransferPhase::Stable
                if status.can_write && status.generation == metadata.generation =>
            {
                false
            }
            crate::vault::ownership::TransferPhase::Stable => {
                ownership.accept_incoming_grant(
                    &metadata.vault_id,
                    metadata.transfer_id.clone(),
                    source_device_id,
                    metadata.generation,
                )?;
                true
            }
            _ => return Err("desktop ownership state conflicts with uploaded grant".to_string()),
        };
        let staging =
            crate::vault::backup::active_handoff_staging_path(&self.app, &metadata.transfer_id)?;
        crate::vault::backup::activate_active_handoff(
            &self.app,
            &staging,
            &metadata.transfer_id,
            &metadata.vault_id,
            true,
        )
        .await?;
        if needs_finalize {
            ownership.finalize_incoming(
                &metadata.vault_id,
                &metadata.transfer_id,
                metadata.generation,
            )?;
        }
        let (device_id, _) = self.pairing.identity()?;
        self.pairing
            .complete_incoming_activation(PendingAcknowledgement {
                vault_id: metadata.vault_id,
                device_id,
                transfer_id: metadata.transfer_id.clone(),
                generation: metadata.generation,
                purpose: BundlePurpose::Ownership,
            })?;
        self.reload_shell()?;
        if let Err(error) = self.pairing.remove_staging(&metadata.transfer_id) {
            eprintln!("failed to clean completed vault upload: {error}");
        }
        Ok(CoordinatorResponse::ActivationAcknowledged {
            transfer_id: metadata.transfer_id,
        })
    }

    fn cleanup_prepared(&mut self) {
        if let Some(prepared) = self.prepared.take() {
            let _ = self
                .pairing
                .unregister_outgoing_bundle(&prepared.metadata.transfer_id);
            let _ = self
                .pairing
                .clear_outgoing_transfer(&prepared.metadata.transfer_id);
            let _ = fs::remove_file(prepared.archive_path);
        }
    }

    fn shutdown(&mut self) {
        self.prepared
            .as_mut()
            .and_then(|prepared| prepared.quiescence.take());
    }

    fn reload_shell(&self) -> Result<(), String> {
        let window = self
            .app
            .get_webview_window("main")
            .ok_or_else(|| "main application window is unavailable".to_string())?;
        window
            .eval("window.location.reload()")
            .map_err(|error| format!("reload application after vault activation: {error}"))
    }
}

fn restore_prepared(pairing: &PairingManager) -> Result<Option<PreparedTransfer>, String> {
    let Some(transfer) = pairing.outgoing_transfer()? else {
        return Ok(None);
    };
    let (_, archive_path) = pairing.outgoing_snapshot_paths(&transfer.metadata.transfer_id)?;
    super::protocol::validate_staging_file(&archive_path, &transfer.metadata)?;
    pairing.register_outgoing_bundle(transfer.metadata.clone(), archive_path.clone())?;
    Ok(Some(PreparedTransfer {
        metadata: transfer.metadata,
        purpose: transfer.purpose,
        archive_path,
        quiescence: None,
        committed: transfer.committed,
    }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn prepared_download_is_restored_from_private_state() {
        let root = std::env::temp_dir().join(format!(
            "ganbaru-coordinator-restart-{}",
            random_token("test").unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        let manager = PairingManager::default();
        manager
            .initialize(root.clone(), "desktop".to_string())
            .unwrap();
        let transfer_id = "restart-transfer";
        let (_, archive_path) = manager.outgoing_snapshot_paths(transfer_id).unwrap();
        fs::write(&archive_path, b"durable prepared archive").unwrap();
        let metadata = BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            vault_id: "vault".to_string(),
            device_id: "phone".to_string(),
            transfer_id: transfer_id.to_string(),
            generation: 1,
            archive_bytes: archive_path.metadata().unwrap().len(),
            archive_sha256: super::super::sha256_file(&archive_path).unwrap(),
        };
        manager
            .store_outgoing_transfer(StoredOutgoingTransfer {
                metadata: metadata.clone(),
                purpose: BundlePurpose::Ownership,
                committed: false,
            })
            .unwrap();
        drop(manager);

        let restarted = PairingManager::default();
        restarted
            .initialize(root.clone(), "desktop".to_string())
            .unwrap();
        let prepared = restore_prepared(&restarted).unwrap().unwrap();
        assert_eq!(prepared.metadata, metadata);
        assert_eq!(prepared.archive_path, PathBuf::from(archive_path));
        assert!(!prepared.committed);
        assert_eq!(
            restarted.outgoing_bundle(transfer_id).unwrap().metadata,
            prepared.metadata
        );
        fs::remove_dir_all(root).unwrap();
    }
}
