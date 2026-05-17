const COMMANDS: &[&str] = &[
    "probe",
    "load",
    "play",
    "pause",
    "stop",
    "seek",
    "set_volume",
    "set_muted",
    "set_rate",
    "set_surface_rect",
    "clear_surface",
    "snapshot",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
