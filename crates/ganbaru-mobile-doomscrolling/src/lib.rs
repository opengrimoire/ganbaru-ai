//! Narrow Android Doomscrolling enforcement bridge for Ganbaru AI.

#[cfg(target_os = "android")]
mod mobile;

#[cfg(target_os = "android")]
pub use mobile::{MobileDoomscrolling, MobileDoomscrollingExt, PendingEvent};

#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{Runtime, plugin::TauriPlugin};

const PLUGIN_NAME: &str = "ganbaru-mobile-doomscrolling";

/// Initialize Ganbaru AI's Android Doomscrolling enforcement bridge.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new(PLUGIN_NAME);

    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let doomscrolling = mobile::init(app, api)?;
        app.manage(doomscrolling);
        Ok(())
    });

    builder.build()
}
