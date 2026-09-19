use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{PluginApi, PluginHandle},
};

const PLUGIN_IDENTIFIER: &str = "app.ganbaru.mobile_media";

#[derive(Debug)]
pub struct MobileMedia<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Clone for MobileMedia<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMediaSource {
    pub kind: String,
    pub path: String,
    pub identity: String,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMediaLoadRequest {
    pub source: MobileMediaSource,
    pub start_ms: Option<u64>,
    pub volume: Option<f64>,
    pub rate: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMediaProbe {
    pub path: String,
    pub title: String,
    pub file_size_bytes: u64,
    pub extension: Option<String>,
    pub media_kind: String,
    pub playable_start_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePlayerSnapshot {
    pub status: String,
    pub source_identity: Option<String>,
    pub title: Option<String>,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub volume: f64,
    pub muted: bool,
    pub rate: f64,
    pub has_video: bool,
    pub backend_kind: String,
    pub playable_start_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMediaTreeTrack {
    pub uri: String,
    pub relative_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track_number: Option<i64>,
    pub artwork_uri: Option<String>,
    pub embedded_artwork_candidate: bool,
    pub duration_ms: Option<i64>,
    pub file_size_bytes: Option<i64>,
    pub modified_at_ms: Option<i64>,
    pub media_kind: String,
    pub mime_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMediaTree {
    pub tree_uri: String,
    pub display_name: String,
    pub tracks: Vec<MobileMediaTreeTrack>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathRequest<'a> {
    path: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SeekRequest {
    position_ms: u64,
}

#[derive(Serialize)]
struct VolumeRequest {
    volume: f64,
}

#[derive(Serialize)]
struct MutedRequest {
    muted: bool,
}

#[derive(Serialize)]
struct RateRequest {
    rate: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreeScanRequest<'a> {
    tree_uri: &'a str,
    max_files: u32,
    max_depth: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreePickRequest {
    max_files: u32,
    max_depth: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickMediaFileResponse {
    uri: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtworkDataUrlResponse {
    data_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtworkRequest<'a> {
    path: &'a str,
    embedded: bool,
    max_bytes: u64,
}

#[derive(Deserialize)]
struct OptionalTreeResponse {
    tree: Option<MobileMediaTree>,
}

pub(crate) fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> tauri::Result<MobileMedia<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MobileMediaPlugin")?;
    Ok(MobileMedia(handle))
}

impl<R: Runtime> MobileMedia<R> {
    async fn command<T: serde::de::DeserializeOwned>(
        &self,
        name: &str,
        payload: impl Serialize,
    ) -> Result<T, String> {
        self.0
            .run_mobile_plugin_async(name, payload)
            .await
            .map_err(|error| format!("Android media {name}: {error}"))
    }

    pub async fn probe(&self, path: &str) -> Result<MobileMediaProbe, String> {
        self.command("probe", PathRequest { path }).await
    }

    pub async fn load(
        &self,
        request: MobileMediaLoadRequest,
    ) -> Result<MobilePlayerSnapshot, String> {
        self.command("load", request).await
    }

    pub async fn play(&self) -> Result<MobilePlayerSnapshot, String> {
        self.command("play", ()).await
    }

    pub async fn pause(&self) -> Result<MobilePlayerSnapshot, String> {
        self.command("pause", ()).await
    }

    pub async fn stop(&self) -> Result<MobilePlayerSnapshot, String> {
        self.command("stop", ()).await
    }

    pub async fn seek(&self, position_ms: u64) -> Result<MobilePlayerSnapshot, String> {
        self.command("seek", SeekRequest { position_ms }).await
    }

    pub async fn set_volume(&self, volume: f64) -> Result<MobilePlayerSnapshot, String> {
        self.command("setVolume", VolumeRequest { volume }).await
    }

    pub async fn set_muted(&self, muted: bool) -> Result<MobilePlayerSnapshot, String> {
        self.command("setMuted", MutedRequest { muted }).await
    }

    pub async fn set_rate(&self, rate: f64) -> Result<MobilePlayerSnapshot, String> {
        self.command("setRate", RateRequest { rate }).await
    }

    pub async fn snapshot(&self) -> Result<MobilePlayerSnapshot, String> {
        self.command("snapshot", ()).await
    }

    pub async fn pick_media_tree(
        &self,
        max_files: u32,
        max_depth: u32,
    ) -> Result<Option<MobileMediaTree>, String> {
        self.command::<OptionalTreeResponse>(
            "pickMediaTree",
            TreePickRequest {
                max_files,
                max_depth,
            },
        )
        .await
        .map(|response| response.tree)
    }

    pub async fn scan_media_tree(
        &self,
        tree_uri: &str,
        max_files: u32,
        max_depth: u32,
    ) -> Result<MobileMediaTree, String> {
        self.command(
            "scanMediaTree",
            TreeScanRequest {
                tree_uri,
                max_files,
                max_depth,
            },
        )
        .await
    }

    pub async fn pick_artwork_file(&self) -> Result<Option<String>, String> {
        self.command::<PickMediaFileResponse>("pickArtworkFile", ())
            .await
            .map(|response| response.uri)
    }

    pub async fn artwork_data_url(
        &self,
        path: &str,
        embedded: bool,
        max_bytes: u64,
    ) -> Result<Option<String>, String> {
        self.command::<ArtworkDataUrlResponse>(
            "artworkDataUrl",
            ArtworkRequest {
                path,
                embedded,
                max_bytes,
            },
        )
        .await
        .map(|response| response.data_url)
    }
}

/// Access Ganbaru AI's Android media adapter from managed Tauri state.
pub trait MobileMediaExt<R: Runtime> {
    fn mobile_media(&self) -> &MobileMedia<R>;
}

impl<R: Runtime, T: Manager<R>> MobileMediaExt<R> for T {
    fn mobile_media(&self) -> &MobileMedia<R> {
        self.state::<MobileMedia<R>>().inner()
    }
}
