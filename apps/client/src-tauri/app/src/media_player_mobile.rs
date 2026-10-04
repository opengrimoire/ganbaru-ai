//! Android inspection adapter. Playback belongs to the native Music session.

use ganbaru_mobile_media::{MobileMediaExt, MobileMediaProbe};

/// Inspect a selected document without mutating decoder or session state.
#[tauri::command]
pub(crate) async fn media_player_probe(
    app: tauri::AppHandle,
    path: String,
) -> Result<MobileMediaProbe, String> {
    app.mobile_media().probe(&path).await
}
