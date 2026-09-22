use super::tests::pool;
use super::*;

fn draft(
    phase: MusicActivityPhase,
    behavior: MusicAssignmentBehavior,
) -> MusicContextAssignmentDraft {
    MusicContextAssignmentDraft {
        phase,
        behavior,
        playlist_id: Some("playlist-1".to_string()),
        soundscape_id: None,
        soundscape_behavior: MusicSoundscapeBehavior::Inherit,
        provenance_kind: MusicAssignmentProvenanceKind::Explicit,
        provenance_id: None,
    }
}

#[test]
fn context_assignments_replace_all_phases_atomically_and_increment_versions() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        let initial = contexts::replace_assignments(
            &pool,
            MusicContextAssignmentSet {
                owner_kind: MusicAssignmentOwnerKind::ProjectDefault,
                owner_id: "project-1".to_string(),
                assignments: vec![
                    draft(
                        MusicActivityPhase::Focus,
                        MusicAssignmentBehavior::PlayAutomatically,
                    ),
                    draft(
                        MusicActivityPhase::ShortBreak,
                        MusicAssignmentBehavior::PauseMusic,
                    ),
                ],
                updated_at: 1_700_000_000_000,
            },
        )
        .await
        .unwrap();
        assert_eq!(initial.len(), 2);
        assert!(initial.iter().all(|assignment| assignment.version == 1));

        let replaced = contexts::replace_assignments(
            &pool,
            MusicContextAssignmentSet {
                owner_kind: MusicAssignmentOwnerKind::ProjectDefault,
                owner_id: "project-1".to_string(),
                assignments: vec![
                    draft(
                        MusicActivityPhase::Focus,
                        MusicAssignmentBehavior::PrepareSilently,
                    ),
                    draft(
                        MusicActivityPhase::LongBreak,
                        MusicAssignmentBehavior::KeepCurrentMusic,
                    ),
                ],
                updated_at: 1_700_000_000_100,
            },
        )
        .await
        .unwrap();
        assert_eq!(replaced.len(), 2);
        assert_eq!(replaced[0].phase, MusicActivityPhase::Focus);
        assert_eq!(replaced[0].version, 2);
        assert_eq!(replaced[1].phase, MusicActivityPhase::LongBreak);
        assert_eq!(replaced[1].version, 1);
    });
}

#[test]
fn context_assignments_enforce_owner_provenance_and_unique_phases() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        let mut snapshot = draft(
            MusicActivityPhase::Focus,
            MusicAssignmentBehavior::PlayAutomatically,
        );
        snapshot.provenance_id = Some("project-1".to_string());
        let invalid = contexts::replace_assignments(
            &pool,
            MusicContextAssignmentSet {
                owner_kind: MusicAssignmentOwnerKind::EventSnapshot,
                owner_id: "event-1".to_string(),
                assignments: vec![snapshot],
                updated_at: 1_700_000_000_000,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(invalid.field.as_deref(), Some("provenanceKind"));

        let duplicate = contexts::replace_assignments(
            &pool,
            MusicContextAssignmentSet {
                owner_kind: MusicAssignmentOwnerKind::ProjectDefault,
                owner_id: "project-1".to_string(),
                assignments: vec![
                    draft(
                        MusicActivityPhase::Focus,
                        MusicAssignmentBehavior::PauseMusic,
                    ),
                    draft(
                        MusicActivityPhase::Focus,
                        MusicAssignmentBehavior::KeepCurrentMusic,
                    ),
                ],
                updated_at: 1_700_000_000_000,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(duplicate.field.as_deref(), Some("assignments"));
        assert!(
            contexts::assignments(&pool, MusicAssignmentOwnerKind::ProjectDefault, "project-1",)
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn work_environment_contract_round_trips_without_a_settings_surface() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        let mut environment = draft(
            MusicActivityPhase::Focus,
            MusicAssignmentBehavior::PlayAutomatically,
        );
        environment.provenance_kind = MusicAssignmentProvenanceKind::WorkEnvironment;
        environment.provenance_id = Some("environment-1".to_string());
        let saved = contexts::replace_assignments(
            &pool,
            MusicContextAssignmentSet {
                owner_kind: MusicAssignmentOwnerKind::WorkEnvironment,
                owner_id: "environment-1".to_string(),
                assignments: vec![environment],
                updated_at: 1_700_000_000_000,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            saved[0].owner_kind,
            MusicAssignmentOwnerKind::WorkEnvironment
        );
        assert_eq!(
            saved[0].provenance_kind,
            MusicAssignmentProvenanceKind::WorkEnvironment
        );
    });
}
