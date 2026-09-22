use super::*;

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(in crate::doomscrolling) fn foreground_desktop_app_status()
-> DoomscrollingForegroundDesktopAppStatus {
    unavailable_foreground_desktop_app_status(
        "foreground desktop app detection is not supported on this platform",
    )
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(in crate::doomscrolling) fn close_current_foreground_desktop_app(
    _expected: DoomscrollingForegroundDesktopAppExpectation,
    _authorize: &mut dyn FnMut(&DoomscrollingForegroundDesktopAppStatus) -> Result<(), String>,
) -> Result<(), String> {
    Err("foreground desktop app closing is not supported on this platform".to_string())
}
