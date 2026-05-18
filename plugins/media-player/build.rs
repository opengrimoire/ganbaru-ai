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
    "snapshot",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
