#![deny(clippy::undocumented_unsafe_blocks)]
#![deny(unsafe_op_in_unsafe_fn)]

#[macro_use]
extern crate ganbaru_db;

#[cfg(desktop)]
mod benchmark;
mod calendar;
mod chat;
mod civil_time;
mod db;
mod distractions;
#[cfg(all(test, desktop))]
mod first_use_contracts;
mod music;
mod notes;
mod notifications;
mod people;
mod pomodoro;
mod profile_images;
mod projects;
mod quick_notes;
#[cfg(desktop)]
mod sound_effects;
#[cfg(desktop)]
mod system_command;
mod themes;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod updates;
mod vault;

fn install_default_tls_crypto_provider() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("the default TLS crypto provider must be installed only once during startup");
}

mod runtime;

pub use runtime::run;

#[cfg(target_os = "linux")]
pub fn run_privileged_helper_if_requested() -> Option<Result<(), String>> {
    vault::handoff::run_privileged_helper_if_requested()
}
