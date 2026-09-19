//! Narrow Android notification capability bridge for Ganbaru AI.

#[cfg(target_os = "android")]
mod mobile;

#[cfg(target_os = "android")]
pub use mobile::{
    BackgroundExecutionStatus, ExactAlarmStatus, MobileNotifications, MobileNotificationsExt,
};

#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{Runtime, plugin::TauriPlugin};

const PLUGIN_NAME: &str = "ganbaru-mobile-notifications";

/// Initialize Ganbaru AI's Android notification capability bridge.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new(PLUGIN_NAME);

    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let notifications = mobile::init(app, api)?;
        app.manage(notifications);
        Ok(())
    });

    builder.build()
}
