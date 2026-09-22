use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{PluginApi, PluginHandle},
};

const PLUGIN_IDENTIFIER: &str = "app.ganbaru.mobile_notifications";

#[derive(Debug)]
pub struct MobileNotifications<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Clone for MobileNotifications<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

/// Android exact-alarm capability exposed without widening notification access.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExactAlarmStatus {
    pub api_level: u32,
    pub required: bool,
    pub granted: bool,
}

/// Android and OEM background-execution state that the app can observe.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundExecutionStatus {
    pub manufacturer: String,
    pub autostart_settings_available: bool,
    pub background_restricted: bool,
    pub battery_optimization_exempt: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarChannelRequest<'a> {
    name: &'a str,
    description: &'a str,
}

pub(crate) fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> tauri::Result<MobileNotifications<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MobileNotificationsPlugin")?;
    Ok(MobileNotifications(handle))
}

impl<R: Runtime> MobileNotifications<R> {
    /// Ensure Calendar reminders use Android's current default notification sound.
    pub fn ensure_calendar_channel(&self, name: &str, description: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin(
                "ensureCalendarChannel",
                CalendarChannelRequest { name, description },
            )
            .map_err(|error| format!("create Calendar notification channel: {error}"))
    }

    /// Read whether this Android install may schedule exact alarms.
    pub fn exact_alarm_status(&self) -> Result<ExactAlarmStatus, String> {
        self.0
            .run_mobile_plugin("exactAlarmStatus", ())
            .map_err(|error| format!("read exact-alarm status: {error}"))
    }

    /// Read the observable Android background-execution state.
    pub fn background_execution_status(&self) -> Result<BackgroundExecutionStatus, String> {
        self.0
            .run_mobile_plugin("backgroundExecutionStatus", ())
            .map_err(|error| format!("read background-execution status: {error}"))
    }

    /// Open an Android or OEM background-execution settings screen.
    pub fn open_background_execution_settings(&self, destination: &str) -> Result<(), String> {
        #[derive(Serialize)]
        struct Request<'a> {
            destination: &'a str,
        }

        self.0
            .run_mobile_plugin("openBackgroundExecutionSettings", Request { destination })
            .map_err(|error| format!("open background-execution settings: {error}"))
    }

    /// Open Android's app-specific Alarms and reminders access screen.
    pub fn open_exact_alarm_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("openExactAlarmSettings", ())
            .map_err(|error| format!("open exact-alarm settings: {error}"))
    }

    /// Open Android's app-specific notification settings screen.
    pub fn open_notification_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("openNotificationSettings", ())
            .map_err(|error| format!("open notification settings: {error}"))
    }
}

/// Access Ganbaru AI's Android notification capability bridge.
pub trait MobileNotificationsExt<R: Runtime> {
    fn mobile_notifications(&self) -> &MobileNotifications<R>;
}

impl<R: Runtime, T: Manager<R>> MobileNotificationsExt<R> for T {
    fn mobile_notifications(&self) -> &MobileNotifications<R> {
        self.state::<MobileNotifications<R>>().inner()
    }
}
