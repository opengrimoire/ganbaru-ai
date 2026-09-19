//! Desktop Chat command adapters, native execution, and workspace integrations.

pub(crate) use ganbaru_chat::chat::agent_runs;
pub mod channel_commands;
pub mod checkpoint_commands;
pub mod checkpoints;
pub(crate) mod command_support;
pub(crate) use ganbaru_chat::chat::composer;
pub mod config;
pub(crate) use ganbaru_chat::chat::coordination;
pub mod coordination_commands;
pub mod credentials;
pub mod device_state;
pub mod diagnostics_commands;
pub mod draft_commands;
pub(crate) use ganbaru_chat::chat::driver_operations;
pub mod events;
pub mod execution_environment;
pub mod git_commands;
pub use ganbaru_chat::chat::git_service;
pub mod ingestion;
pub(crate) mod interaction;
pub mod interaction_commands;
pub mod internal_mcp;
mod internal_mcp_tools;
pub mod models;
pub mod preview;
#[cfg(test)]
pub mod process;
pub mod provider_files;
pub mod providers;
pub use ganbaru_chat::chat::repository;
pub mod resource_commands;
pub mod restore_commands;
pub mod review_commands;
pub mod review_engine;
pub(crate) mod revocation;
pub use ganbaru_chat::chat::runtime;
pub(crate) mod scratch;
pub mod scratch_commands;
pub(crate) mod send;
pub mod send_commands;
pub(crate) mod settings;
pub mod settings_commands;
pub mod source_control;
pub mod state;
pub mod terminal;
pub mod terminal_commands;
pub mod thread_commands;
pub(crate) mod turns;
pub mod workspace;
pub mod workspace_commands;
pub mod workspace_files;
pub use ganbaru_chat::chat::workspace_mutation;
pub mod workspace_observer;

#[cfg(test)]
mod tests;
