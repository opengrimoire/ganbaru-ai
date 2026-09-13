//! Android Media3 adapter behind the shared desktop playback command contract.

use ganbaru_mobile_media::{
    MobileMediaExt, MobileMediaLoadRequest, MobileMediaProbe, MobileMediaSource,
    MobilePlayerSnapshot,
};
use serde::Deserialize;
use tauri::Runtime;

#[allow(dead_code)] // Used by the H04 source-freeze flow.
pub(crate) async fn stop_for_vault_handoff<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    app.mobile_media().stop().await.map(|_| ())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMediaSource {
    kind: String,
    path: String,
    identity: String,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadRequest {
    source: LocalMediaSource,
    start_ms: Option<u64>,
    volume: Option<f64>,
    rate: Option<f64>,
}

impl From<LoadRequest> for MobileMediaLoadRequest {
    fn from(request: LoadRequest) -> Self {
        Self {
            source: MobileMediaSource {
                kind: request.source.kind,
                path: request.source.path,
                identity: request.source.identity,
                title: request.source.title,
            },
            start_ms: request.start_ms,
            volume: request.volume,
            rate: request.rate,
        }
    }
}

#[tauri::command]
pub(crate) async fn media_player_probe(
    app: tauri::AppHandle,
    path: String,
) -> Result<MobileMediaProbe, String> {
    app.mobile_media().probe(&path).await
}

#[tauri::command]
pub(crate) async fn media_player_load(
    app: tauri::AppHandle,
    request: LoadRequest,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().load(request.into()).await
}

#[tauri::command]
pub(crate) async fn media_player_play(
    app: tauri::AppHandle,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().play().await
}

#[tauri::command]
pub(crate) async fn media_player_pause(
    app: tauri::AppHandle,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().pause().await
}

#[tauri::command]
pub(crate) async fn media_player_stop(
    app: tauri::AppHandle,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().stop().await
}

#[tauri::command]
pub(crate) async fn media_player_seek(
    app: tauri::AppHandle,
    position_ms: u64,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().seek(position_ms).await
}

#[tauri::command]
pub(crate) async fn media_player_set_volume(
    app: tauri::AppHandle,
    volume: f64,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().set_volume(volume).await
}

#[tauri::command]
pub(crate) async fn media_player_set_muted(
    app: tauri::AppHandle,
    muted: bool,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().set_muted(muted).await
}

#[tauri::command]
pub(crate) async fn media_player_set_rate(
    app: tauri::AppHandle,
    rate: f64,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().set_rate(rate).await
}

#[tauri::command]
pub(crate) async fn media_player_snapshot(
    app: tauri::AppHandle,
) -> Result<MobilePlayerSnapshot, String> {
    app.mobile_media().snapshot().await
}
