#![deny(clippy::undocumented_unsafe_blocks)]
#![deny(unsafe_op_in_unsafe_fn)]

#[macro_use]
extern crate ganbaru_db;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod benchmark_seed;
mod calendar_description;
mod calendar_events;
mod calendar_import;
mod calendar_reads;
mod calendars;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[allow(dead_code)]
mod chat;
#[cfg(any(target_os = "android", target_os = "ios"))]
#[path = "chat_mobile.rs"]
mod chat;
#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod db;
mod db_path;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod doomscrolling;
mod doomscrolling_linked;
#[cfg(any(target_os = "android", all(test, not(target_os = "ios"))))]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
mod doomscrolling_mobile;
#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod first_use_contracts;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod media_controls;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod media_player;
#[cfg(target_os = "android")]
#[path = "media_player_mobile.rs"]
mod media_player;
#[cfg(any(test, target_os = "android", target_os = "ios"))]
mod mobile_notification_capabilities;
#[cfg(not(target_os = "ios"))]
mod music;
mod music_context;
mod music_error;
mod notes;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod notification;
mod pomodoro;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod pomodoro_enforcement;
mod profile_images;
mod project_icons;
mod projects;
mod quick_notes;
mod recurrence;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod soundscape;
mod themes;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tray;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod updates;
mod vault;

fn install_default_tls_crypto_provider() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("the default TLS crypto provider must be installed only once during startup");
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop_runtime;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod mobile_runtime;
#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
#[path = "mobile_runtime.rs"]
#[allow(dead_code)]
mod mobile_runtime_typecheck;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use desktop_runtime::run;
#[cfg(any(target_os = "android", target_os = "ios"))]
pub use mobile_runtime::run;

#[cfg(test)]
mod composition_tests {
    const MOBILE_RUNTIME: &str = include_str!("mobile_runtime.rs");

    #[test]
    fn mobile_runtime_registers_portable_core_commands() {
        for command in [
            "vault::vault_use_default_folder",
            "vault::vault_pick_open",
            "calendar_reads::calendar_load_window",
            "calendar_reads::calendar_load_notification_scheduler_window",
            "projects::workspace::projects_load_workspace",
            "notes::notes_load_workspace_shell",
            "pomodoro::pomodoro_start_run",
            "pomodoro::pomodoro_recover_mobile_run",
            "crate::doomscrolling_mobile::doomscrolling_mobile_sync_events",
            "crate::doomscrolling_mobile::doomscrolling_mobile_list_usage_samples",
            "quick_notes::quick_notes_list",
            "themes::theme_load_all",
            "media_player::media_player_load",
            "music::music_get_playback_state",
            "music::library::commands::music_library_playlist_summaries",
            "music::root_bindings::music_get_local_root_bindings",
            "profile_images::profile_image_asset_data_url",
            "profile_images::profile_image_save_data_url",
            "project_icons::project_icon_asset_data_url",
            "vault::vault_pick_and_read_theme_json",
            "vault::vault_pick_and_write_theme_json",
            "vault::backup::vault_backup_to_downloads",
            "vault::backup::vault_pick_and_restore_backup",
            "chat::channel_commands::chat_list_navigation_channels",
            "chat::coordination_commands::chat_post_message",
            "chat::coordination_commands::chat_read_channel_page",
            "chat::coordination_commands::chat_read_reply_thread_page",
            "chat::settings_commands::chat_read_settings",
        ] {
            assert!(
                MOBILE_RUNTIME.contains(command),
                "missing mobile command {command}"
            );
        }
    }

    #[test]
    fn mobile_runtime_excludes_desktop_only_commands() {
        for command in [
            "chat::send_commands::",
            "chat::terminal_commands::",
            "chat::git_commands::",
            "chat::workspace_commands::",
            "chat::interaction_commands::",
            "chat::preview::",
            "doomscrolling::commands::",
            "doomscrolling::state::",
            "doomscrolling::usage::",
            "doomscrolling::catalog::",
            "notification::show_event_notification",
            "soundscape::",
            "tray::",
            "updates::",
            "benchmark_seed::",
            "vault::vault_pick_create",
            "notes::notes_pick_",
            "notes::working_markdown::",
            "notes::notes_import_notion_export_folder",
            "notes::notes_prepare_import_file_reference",
            "profile_images::profile_image_pick_file",
            "project_icons::project_icon_pick_image_file",
            "project_icons::project_icon_download_image_url",
            "project_icons::project_icon_asset_path",
            "pomodoro::pomodoro_recover_open_runs",
            "music::music_pick_soundscape_file",
            "music::music_reveal_local_file",
            "music::library::commands::music_library_create_relink_plan",
            "music::library::commands::music_library_preview_item_repair",
            "music::library::commands::music_library_soundscapes",
        ] {
            assert!(
                !MOBILE_RUNTIME.contains(command),
                "mobile runtime must exclude {command}"
            );
        }
    }
}
