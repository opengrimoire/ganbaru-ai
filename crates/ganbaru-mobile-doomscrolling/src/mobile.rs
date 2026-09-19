use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{PluginApi, PluginHandle},
};

const PLUGIN_IDENTIFIER: &str = "app.ganbaru.mobile_doomscrolling";

#[derive(Debug)]
pub struct MobileDoomscrolling<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Clone for MobileDoomscrolling<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatus {
    pub usage_access: bool,
    pub accessibility: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchableApp {
    pub name: String,
    pub package_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingEvent {
    pub id: String,
    pub kind: String,
    pub package_name: String,
    pub display_name: String,
    pub started_at: i64,
    pub elapsed_seconds: i64,
    pub local_date: String,
    pub occurred_at: i64,
    pub reason: Option<String>,
    pub rule_id: Option<String>,
    pub run_id: Option<String>,
    pub phase: Option<String>,
    pub vault_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyRulesRequest<'a> {
    snapshot_json: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AcknowledgeRequest<'a> {
    ids: &'a [String],
}

pub(crate) fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> tauri::Result<MobileDoomscrolling<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MobileDoomscrollingPlugin")?;
    Ok(MobileDoomscrolling(handle))
}

impl<R: Runtime> MobileDoomscrolling<R> {
    pub fn access_status(&self) -> Result<AccessStatus, String> {
        self.0
            .run_mobile_plugin("accessStatus", ())
            .map_err(|error| format!("read Doomscrolling access status: {error}"))
    }

    pub fn open_usage_access_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("openUsageAccessSettings", ())
            .map_err(|error| format!("open Usage Access settings: {error}"))
    }

    pub fn open_accessibility_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("openAccessibilitySettings", ())
            .map_err(|error| format!("open Accessibility settings: {error}"))
    }

    pub fn list_launchable_apps(&self) -> Result<Vec<LaunchableApp>, String> {
        self.0
            .run_mobile_plugin("listLaunchableApps", ())
            .map_err(|error| format!("list launchable Android apps: {error}"))
    }

    pub fn apply_rules(&self, snapshot_json: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin("applyRules", ApplyRulesRequest { snapshot_json })
            .map_err(|error| format!("apply mobile Doomscrolling rules: {error}"))
    }

    pub fn pending_events(&self) -> Result<Vec<PendingEvent>, String> {
        self.0
            .run_mobile_plugin("pendingEvents", ())
            .map_err(|error| format!("read mobile Doomscrolling journal: {error}"))
    }

    pub fn acknowledge_events(&self, ids: &[String]) -> Result<(), String> {
        self.0
            .run_mobile_plugin("acknowledgeEvents", AcknowledgeRequest { ids })
            .map_err(|error| format!("acknowledge mobile Doomscrolling journal: {error}"))
    }

    pub fn take_notification_action(&self) -> Result<Option<String>, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Response {
            target: Option<String>,
        }
        self.0
            .run_mobile_plugin::<Response>("takeNotificationAction", ())
            .map(|response| response.target)
            .map_err(|error| format!("read mobile Doomscrolling notification action: {error}"))
    }
}

/// Access Ganbaru AI's Android Doomscrolling enforcement bridge.
pub trait MobileDoomscrollingExt<R: Runtime> {
    fn mobile_doomscrolling(&self) -> &MobileDoomscrolling<R>;
}

impl<R: Runtime, T: Manager<R>> MobileDoomscrollingExt<R> for T {
    fn mobile_doomscrolling(&self) -> &MobileDoomscrolling<R> {
        self.state::<MobileDoomscrolling<R>>().inner()
    }
}
