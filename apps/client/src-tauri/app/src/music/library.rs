pub(crate) mod commands;
mod defaults;
#[cfg(desktop)]
pub(crate) mod fixtures;
mod interchange;
#[cfg(desktop)]
mod item_repair;
#[cfg(desktop)]
pub(crate) mod local_refresh;
#[cfg(target_os = "android")]
mod mobile_refresh;
mod models;
mod playback;
pub(crate) use playback::record_listening_in_transaction;
mod playlist_edits;
mod queries;
#[cfg(desktop)]
mod relink;
mod rows;
mod search;
#[cfg(desktop)]
pub(crate) mod soundscape_groups;
#[cfg(desktop)]
pub(crate) mod soundscapes;
mod source_lifecycle;
mod transfer;
mod transfer_codec;
mod transfer_export;
mod transfer_read;
mod validation;
mod writes;
mod youtube;

#[cfg(test)]
pub use ganbaru_music::error::MusicLibraryErrorCode;
pub use ganbaru_music::error::{MusicLibraryError, MusicLibraryResult};
pub use models::*;
pub(crate) use rows::*;
pub use transfer::{
    MusicTransferCommit, MusicTransferExport, MusicTransferFormat, MusicTransferPreview,
    MusicTransferSource,
};
pub(crate) use validation::*;

#[cfg(test)]
mod tests;
