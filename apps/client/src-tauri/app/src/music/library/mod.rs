pub(crate) mod commands;
pub(crate) mod contexts;
mod defaults;
mod error;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod fixtures;
mod interchange;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod item_repair;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod local_refresh;
#[cfg(target_os = "android")]
mod mobile_refresh;
mod models;
mod playback;
mod playlist_edits;
mod queries;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod relink;
mod rows;
mod search;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod soundscape_groups;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod soundscapes;
mod source_lifecycle;
mod validation;
mod writes;
mod youtube;

#[cfg(test)]
pub use error::MusicLibraryErrorCode;
pub use error::{MusicLibraryError, MusicLibraryResult};
pub use models::*;
pub(crate) use rows::*;
pub(crate) use validation::*;

#[cfg(test)]
mod contexts_tests;
#[cfg(test)]
mod interchange_tests;
#[cfg(test)]
mod playback_tests;
#[cfg(test)]
mod query_tests;
#[cfg(test)]
mod relink_tests;
#[cfg(test)]
mod source_lifecycle_tests;
#[cfg(test)]
mod tests;
