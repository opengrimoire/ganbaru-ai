//! Native deletion review over complete metadata and execution evidence.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::recurrence::canonical::{DeletePlan, EditScope, ScopeClock};

use super::metadata::revision;
use super::scope::{ScopeRequest, ScopeSnapshot, prepare_request_with_clock};

mod undo;
mod write;
pub(crate) use undo::UndoPreimage;
pub(super) use undo::{
    PreparedUndo, UndoReferences, UndoRequest, UndoRunReference, UndoSegmentReference,
};
pub(super) use write::PreparedDeletion;

/// Semantic selection and explicit permission to stop the reviewed native run.
/// No client-authored operation list, clock or execution identity is accepted.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteRequest {
    kind: DeleteKind,
    selection: ScopeRequest,
    stop_active: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum DeleteKind {
    Delete,
}

impl DeleteRequest {
    pub(super) fn selection(&self) -> ScopeRequest {
        self.selection.clone()
    }

    pub(super) fn check_limits(&self) -> Result<(), String> {
        super::occurrence::validate_source_id(&self.selection.template_id)?;
        if self.selection.recurrence_date.len() != 10 {
            return Err("Calendar deletion requires an original YYYY-MM-DD identity".into());
        }
        crate::recurrence::canonical::parse_date(&self.selection.recurrence_date)?;
        Ok(())
    }

    pub(super) async fn prepare_commit(
        &self,
        app: tauri::AppHandle,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        command_id: String,
        review_revision: String,
        now_ms: i64,
    ) -> Result<super::commit::PreparedCommit, String> {
        self.check_limits()?;
        let permit = super::scope::SCOPE_GATE
            .clone()
            .try_acquire_owned()
            .map_err(|_| "A Calendar operation is being prepared; retry after it finishes")?;
        let snapshot = super::scope::read_snapshot(tx, &self.selection.template_id).await?;
        let selected = crate::recurrence::canonical::parse_date(&self.selection.recurrence_date)?;
        let scope = self.selection.scope;
        let stop_active = self.stop_active;
        let worker = tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let clock = ScopeClock {
                epoch_ms: now_ms,
                floating_today: if snapshot.geometry.source.all_day != 0 {
                    Some(super::scope::device_date(&app, now_ms)?)
                } else {
                    None
                },
            };
            prepare_commit(
                snapshot,
                selected,
                scope,
                clock,
                &command_id,
                &review_revision,
                stop_active,
            )
        });
        tokio::time::timeout(super::scope::SCOPE_WORKER_TIMEOUT, worker)
            .await
            .map_err(|_| "Calendar deletion preparation timed out")?
            .map_err(|error| format!("Calendar deletion worker: {error}"))?
    }
}

/// An informational review. Mutation must recapture the source and prepare the
/// same semantic selection inside the Calendar/Focus owner's transaction.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedDelete {
    pub(super) review_revision: String,
    pub(super) plan: DeletePlan,
}

/// Read-only preparation accepts neither browser clocks nor mutation operations.
/// Complete metadata contributes to the review digest even when geometry matches.
pub(super) fn prepare(
    snapshot: ScopeSnapshot,
    selected: NaiveDate,
    scope: EditScope,
    clock: ScopeClock,
) -> Result<PreparedDelete, String> {
    prepare_review(&snapshot, selected, scope, clock)
}

pub(super) fn prepare_review(
    snapshot: &ScopeSnapshot,
    selected: NaiveDate,
    scope: EditScope,
    clock: ScopeClock,
) -> Result<PreparedDelete, String> {
    let source_revision = snapshot.metadata.revision()?;
    let template = snapshot.geometry.template(true)?;
    let evidence = snapshot
        .evidence
        .resolve(&snapshot.geometry.source.id, template.anchor_date())?;
    let plan = template.plan_delete(
        selected,
        scope,
        evidence,
        clock,
        snapshot.metadata.has_durable_references(),
    )?;
    Ok(PreparedDelete {
        review_revision: revision(&(
            &source_revision,
            snapshot.evidence.revision()?,
            &plan,
            clock.floating_today,
        ))?,
        plan,
    })
}

/// Reprepare inside the shared owner transaction and bind complete write rows
/// to the native review before performing any mutation.
pub(super) fn prepare_commit(
    snapshot: ScopeSnapshot,
    selected: NaiveDate,
    scope: EditScope,
    clock: ScopeClock,
    command_id: &str,
    expected_review: &str,
    stop_active: bool,
) -> Result<super::commit::PreparedCommit, String> {
    super::commit::validate_command_id(command_id)?;
    let reviewed = prepare_review(&snapshot, selected, scope, clock)?;
    if reviewed.review_revision != expected_review {
        return Err("Calendar source or protection changed; review deletion again".into());
    }
    if reviewed.plan.active_run_to_stop.is_some() && !stop_active {
        return Err("Calendar deletion must explicitly stop its reviewed Focus run".into());
    }
    let valid_until = reviewed.plan.valid_until_ms;
    let deletion = PreparedDeletion::prepare(snapshot, reviewed.plan, command_id, clock.epoch_ms)?;
    Ok(super::commit::PreparedCommit::from_deletion(
        deletion,
        command_id,
        valid_until,
        clock.floating_today,
    ))
}

/// Review deletion with native time, original recurrence identities and complete
/// source evidence. This command never accepts a client-authored deletion plan.
#[tauri::command]
pub(crate) async fn calendar_prepare_delete(
    app: AppHandle,
    db_url: String,
    request: ScopeRequest,
) -> Result<DeleteReviewResponse, String> {
    let (vault_id, vault_generation, floor) =
        crate::pomodoro::native_runtime::calendar_review_context(&app).await?;
    let expected_vault = vault_id.clone();
    let verify_app = app.clone();
    let review = prepare_request_with_clock(
        app.clone(),
        db_url,
        request,
        floor,
        move |snapshot, selected, scope, clock| {
            let review = prepare(snapshot, selected, scope, clock)?;
            if crate::vault::active_vault_id(&verify_app)? != expected_vault {
                return Err("Calendar vault changed while reviewing deletion".into());
            }
            Ok(review)
        },
    )
    .await?;
    let (current_vault, current_generation, current_clock) =
        crate::pomodoro::native_runtime::calendar_review_context(&app).await?;
    if current_vault != vault_id
        || current_generation != vault_generation
        || review
            .plan
            .valid_until_ms
            .is_some_and(|deadline| current_clock >= deadline)
    {
        return Err("Calendar vault or protection changed while reviewing deletion".into());
    }
    Ok(DeleteReviewResponse {
        vault_id,
        vault_generation,
        review,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteReviewResponse {
    vault_id: String,
    vault_generation: u64,
    #[serde(flatten)]
    review: PreparedDelete,
}
