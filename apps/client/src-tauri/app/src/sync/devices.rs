//! Device names for versions and recovery offers, from the linked devices this device knows.

use crate::vault::handoff::pairing::PairingManager;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};

/// A device that wrote a version, as the frontend shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceRef {
    pub device_id: String,
    /// Label from pairing, when this device knows the writer's device.
    pub device_label: Option<String>,
    /// Whether the version was written on this device.
    pub own_device: bool,
}

/// Labels of the devices this device is linked with, and its own id.
pub(crate) struct DeviceNames {
    own: String,
    labels: HashMap<String, String>,
}

impl DeviceNames {
    /// Reads the own device id and the labels of linked peers and the pinned coordinator. A
    /// device without pairing state knows no labels.
    pub(crate) fn read<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let own = crate::vault::ensure_device_id(app)?;
        let manager = app.state::<PairingManager>();
        let mut labels: HashMap<String, String> = manager
            .linked_peers()
            .unwrap_or_default()
            .into_iter()
            .map(|peer| (peer.device_id, peer.device_label))
            .collect();
        if let Ok(Some(pin)) = manager.coordinator_pin() {
            if let Some(label) = pin.device_label {
                labels.insert(pin.device_id, label);
            }
        }
        Ok(Self { own, labels })
    }

    /// The device reference for a device id.
    pub(crate) fn describe(&self, device_id: &str) -> DeviceRef {
        DeviceRef {
            device_id: device_id.to_string(),
            device_label: self.labels.get(device_id).cloned(),
            own_device: device_id == self.own,
        }
    }
}

#[cfg(test)]
impl DeviceNames {
    /// Device names with no known labels.
    pub(crate) fn unlabeled(own: &str) -> Self {
        Self {
            own: own.to_string(),
            labels: HashMap::new(),
        }
    }
}
