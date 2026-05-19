//! Vault filesystem layer.
//!
//! The vault is a single folder on disk that holds all user data the app
//! produces (notes, diary, events index, settings). For now only
//! `vault/config.json` is wired; the rest of the vault layout described in
//! `AGENTS.md` will land as the matching features ship.
//!
//! Path: `app_config_dir / "vault"`. A future "vault location" setting can
//! replace [`vault_path`] without touching callers.
//!
//! Writes are atomic: serialize to `.tmp`, fsync, rename. A crash mid-write
//! leaves either the previous good file or the temp file (which is ignored
//! on next read).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

const CONFIG_FILE: &str = "config.json";

/// Resolve the vault folder path. The folder is created on demand by the
/// helpers below; callers do not need to ensure it exists.
fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("vault");
    Ok(path)
}

fn ensure_vault(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = vault_path(app)?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Read `vault/config.json` as a string. Returns `"{}"` if the file is
/// missing so the frontend can treat first-run identically to a wiped
/// config.
#[tauri::command]
pub fn vault_read_config(app: tauri::AppHandle) -> Result<String, String> {
    let mut path = ensure_vault(&app)?;
    path.push(CONFIG_FILE);
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write `vault/config.json` atomically. Validates the input parses as JSON
/// before persisting (defense in depth: the frontend is the source of truth
/// for shape but the backend refuses to write garbage).
#[tauri::command]
pub fn vault_write_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("config payload is not valid JSON: {e}"))?;

    let dir = ensure_vault(&app)?;
    let final_path = dir.join(CONFIG_FILE);
    let tmp_path = dir.join(format!("{CONFIG_FILE}.tmp"));

    {
        let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }

    fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn require_absolute_path(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err("path must be absolute".to_string())
    }
}

fn require_extension(path: &Path, allowed: &[&str], label: &str) -> Result<(), String> {
    require_absolute_path(path)?;
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if allowed
        .iter()
        .any(|allowed_ext| ext.eq_ignore_ascii_case(allowed_ext))
    {
        Ok(())
    } else {
        Err(format!(
            "{label} file must use one of: {}",
            allowed.join(", ")
        ))
    }
}

fn dialog_path(path: FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|e| format!("selected path is not a local file: {e}"))
}

fn default_file_name(input: &str, fallback_stem: &str, extension: &str) -> String {
    let trimmed = input.trim();
    let from_input = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback_stem);
    if Path::new(from_input)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
    {
        from_input.to_string()
    } else {
        format!("{from_input}.{extension}")
    }
}

fn read_text_file_capped(path: &Path, max_bytes: u64, label: &str) -> Result<String, String> {
    require_absolute_path(path)?;
    let metadata = fs::metadata(path).map_err(|e| format!("failed to inspect {label}: {e}"))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "{label} is {} bytes, exceeding the limit of {max_bytes} bytes",
            metadata.len()
        ));
    }

    let mut file = fs::File::open(path).map_err(|e| format!("failed to open {label}: {e}"))?;
    let mut contents = String::new();
    let mut limited = std::io::Read::by_ref(&mut file).take(max_bytes + 1);
    limited
        .read_to_string(&mut contents)
        .map_err(|e| format!("failed to read {label} as UTF-8: {e}"))?;
    if contents.len() as u64 > max_bytes {
        return Err(format!("{label} exceeds the limit of {max_bytes} bytes"));
    }
    Ok(contents)
}

/// Write a UTF-8 text file atomically via `.tmp` plus rename so an
/// interrupted write cannot leave the target file truncated.
fn write_text_file_atomically(path: &Path, contents: &str) -> Result<(), String> {
    require_absolute_path(path)?;
    let target = path;
    let parent = target
        .parent()
        .ok_or_else(|| "target has no parent directory".to_string())?
        .to_path_buf();
    let file_name = target
        .file_name()
        .ok_or_else(|| "target has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let tmp_path = parent.join(format!("{file_name}.tmp"));
    {
        let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp_path, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn pick_open_path(
    app: &tauri::AppHandle,
    title: &str,
    filter_name: &str,
    extensions: &[&str],
) -> Result<Option<PathBuf>, String> {
    app.dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, extensions)
        .blocking_pick_file()
        .map(dialog_path)
        .transpose()
}

fn pick_save_path(
    app: &tauri::AppHandle,
    title: &str,
    default_name: &str,
    filter_name: &str,
    extensions: &[&str],
    start_directory: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name)
        .add_filter(filter_name, extensions);
    if let Some(directory) = start_directory {
        picker = picker.set_directory(directory);
    }
    picker.blocking_save_file().map(dialog_path).transpose()
}

fn existing_downloads_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().download_dir().ok().filter(|path| path.is_dir())
}

/// Hard cap on the number of entries we will inspect inside a single zip.
/// 1024 is well above the realistic count for an export from Google
/// Calendar (one .ics per calendar a user owns or subscribes to is usually
/// < 50) and protects against pathological inputs that could DoS the read
/// loop.
const ICS_ZIP_MAX_ENTRIES: usize = 1024;

/// Hard cap on the uncompressed size of a single entry, in bytes. 25 MiB
/// is large enough for a multi-decade calendar with thousands of events
/// (text-only iCalendar averages ~1 KiB per event) while clearly rejecting
/// decompression bombs.
const ICS_ZIP_MAX_ENTRY_BYTES: u64 = 25 * 1024 * 1024;

/// Hard cap on the aggregate uncompressed size across every entry. Keeps a
/// zip with many oversized entries from defeating the per-entry guard.
const ICS_ZIP_MAX_TOTAL_BYTES: u64 = 250 * 1024 * 1024;

/// Plain `.ics` imports share the zip per-entry cap so the import flow has
/// one clear maximum payload size regardless of container.
const ICS_PLAIN_MAX_BYTES: u64 = ICS_ZIP_MAX_ENTRY_BYTES;

/// Theme JSON is small configuration data. One MiB leaves room for custom
/// comments and future tokens while rejecting accidental large-file picks.
const THEME_JSON_MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, serde::Serialize)]
pub struct IcsZipEntry {
    /// File-name-only basename (no directory components) so an entry path
    /// like `personal/work.ics` is exposed as `work.ics` to the frontend.
    pub name: String,
    /// UTF-8-decoded entry contents. RFC 5545 mandates UTF-8, so a decode
    /// failure is reported as an error rather than silently lossy-replaced.
    pub contents: String,
}

/// Read every `.ics` entry inside the zip at `path` and return their decoded
/// contents. Used by the calendar import flow so a Google or Apple export
/// (which always arrives as a `.ics.zip` bundle) can be imported in one
/// step instead of forcing the user to unzip first.
///
/// Safety contract:
///
/// - Path must be absolute (matching every other `vault_*` helper).
/// - Entry paths are validated through `enclosed_name`, which rejects any
///   entry that tries to escape (zip-slip via `..` or absolute paths).
/// - Encrypted entries are refused; we only ship the deflate feature.
/// - Per-entry and aggregate decompressed-size caps reject decompression
///   bombs even if the zip header lies about uncompressed size (the read
///   itself is wrapped in a `Take` adapter so the cap holds at I/O level).
/// - Only entries whose extension matches `.ics` are returned. Anything
///   else (`__MACOSX/`, `.DS_Store`, signature files, archived metadata)
///   is silently skipped so the importer never sees them.
fn read_ics_zip_entries_from_path(path: &Path) -> Result<Vec<IcsZipEntry>, String> {
    require_extension(path, &["zip"], "ICS zip import")?;

    let file = fs::File::open(path).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("not a valid zip archive: {e}"))?;

    if archive.len() > ICS_ZIP_MAX_ENTRIES {
        return Err(format!(
            "zip has {} entries, exceeding the limit of {ICS_ZIP_MAX_ENTRIES}",
            archive.len()
        ));
    }

    let mut entries: Vec<IcsZipEntry> = Vec::new();
    let mut total_uncompressed: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry {i}: {e}"))?;

        if entry.is_dir() {
            continue;
        }

        // `enclosed_name` returns `None` for any entry whose path escapes
        // the archive root (zip-slip protection). Treat that as fatal so we
        // never silently import from a tampered bundle.
        let enclosed = match entry.enclosed_name() {
            Some(name) => name,
            None => {
                return Err("zip contains an entry with an unsafe path".to_string());
            }
        };

        let ext_is_ics = enclosed
            .extension()
            .map(|e| e.eq_ignore_ascii_case("ics"))
            .unwrap_or(false);
        if !ext_is_ics {
            continue;
        }

        if entry.encrypted() {
            return Err(format!(
                "zip entry '{}' is encrypted; encrypted .ics imports are not supported",
                enclosed.display()
            ));
        }

        let reported_size = entry.size();
        if reported_size > ICS_ZIP_MAX_ENTRY_BYTES {
            return Err(format!(
                "zip entry '{}' uncompressed size ({reported_size} bytes) exceeds the per-entry limit of {ICS_ZIP_MAX_ENTRY_BYTES} bytes",
                enclosed.display()
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(reported_size);
        if total_uncompressed > ICS_ZIP_MAX_TOTAL_BYTES {
            return Err(format!(
                "zip total uncompressed size exceeds the limit of {ICS_ZIP_MAX_TOTAL_BYTES} bytes"
            ));
        }

        let display_name = enclosed
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("entry-{i}.ics"));

        // Capture only the basename for the frontend before borrowing the
        // entry mutably for the read.
        drop(enclosed);

        // The `Take` adapter is the real defense against a lying header:
        // even if `entry.size()` claims a small value, we still stop after
        // one byte past the cap and reject the entry.
        let mut contents = String::new();
        let mut limited = entry.by_ref().take(ICS_ZIP_MAX_ENTRY_BYTES + 1);
        limited
            .read_to_string(&mut contents)
            .map_err(|e| format!("failed to read zip entry '{display_name}' as UTF-8: {e}"))?;
        if contents.len() as u64 > ICS_ZIP_MAX_ENTRY_BYTES {
            return Err(format!(
                "zip entry '{display_name}' exceeds the per-entry size limit during decompression"
            ));
        }

        entries.push(IcsZipEntry {
            name: display_name,
            contents,
        });
    }

    Ok(entries)
}

fn read_plain_ics_entry_from_path(path: &Path) -> Result<IcsZipEntry, String> {
    require_extension(path, &["ics"], "ICS import")?;
    let contents = read_text_file_capped(path, ICS_PLAIN_MAX_BYTES, "ICS import")?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "calendar.ics".to_string());
    Ok(IcsZipEntry { name, contents })
}

/// Open a native file picker and read one `.ics` file or every `.ics` entry
/// inside one `.zip` bundle. The selected path never crosses the IPC
/// boundary, and Rust re-validates the extension before reading.
#[tauri::command]
pub async fn vault_pick_and_read_ics_import(
    app: tauri::AppHandle,
) -> Result<Option<Vec<IcsZipEntry>>, String> {
    let Some(path) = pick_open_path(
        &app,
        "Import calendar",
        "iCalendar (.ics or .zip)",
        &["ics", "zip"],
    )?
    else {
        return Ok(None);
    };

    require_extension(&path, &["ics", "zip"], "ICS import")?;
    let is_zip = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    if is_zip {
        read_ics_zip_entries_from_path(&path).map(Some)
    } else {
        read_plain_ics_entry_from_path(&path).map(|entry| Some(vec![entry]))
    }
}

/// Open a native save dialog and write a calendar `.ics` export. The
/// selected path stays in Rust and must still have a `.ics` extension.
#[tauri::command]
pub async fn vault_pick_and_write_ics_export(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<bool, String> {
    let default_name = default_file_name(&default_name, "calendar", "ics");
    let Some(path) = pick_save_path(
        &app,
        "Export calendar",
        &default_name,
        "iCalendar",
        &["ics"],
        None,
    )?
    else {
        return Ok(false);
    };
    require_extension(&path, &["ics"], "ICS export")?;
    write_text_file_atomically(&path, &contents)?;
    Ok(true)
}

/// Open a native file picker and read a theme `.json` file with a small cap.
#[tauri::command]
pub async fn vault_pick_and_read_theme_json(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let Some(path) = pick_open_path(&app, "Import theme", "Theme JSON", &["json"])? else {
        return Ok(None);
    };
    require_extension(&path, &["json"], "theme import")?;
    read_text_file_capped(&path, THEME_JSON_MAX_BYTES, "theme import").map(Some)
}

/// Open a native save dialog and write a theme `.json` export.
#[tauri::command]
pub async fn vault_pick_and_write_theme_json(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<bool, String> {
    let default_name = default_file_name(&default_name, "theme", "json");
    let Some(path) = pick_save_path(
        &app,
        "Export theme",
        &default_name,
        "Theme JSON",
        &["json"],
        existing_downloads_directory(&app),
    )?
    else {
        return Ok(false);
    };
    require_extension(&path, &["json"], "theme export")?;
    write_text_file_atomically(&path, &contents)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn unique_path(suffix: &str) -> PathBuf {
        // Avoid pulling in `tempfile` for two tests: hand-roll a unique path
        // under the system temp dir, salted with pid + time + a per-call seq
        // so parallel runs do not collide.
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let mut path = std::env::temp_dir();
        path.push(format!("ganbaruai-vault-test-{pid}-{nanos}-{seq}-{suffix}"));
        path
    }

    #[test]
    fn read_text_file_capped_rejects_relative_paths() {
        let err = read_text_file_capped(Path::new("relative/path.txt"), 1024, "test").unwrap_err();
        assert_eq!(err, "path must be absolute");
    }

    #[test]
    fn write_text_file_atomically_rejects_relative_paths() {
        let err = write_text_file_atomically(Path::new("relative/path.txt"), "data").unwrap_err();
        assert_eq!(err, "path must be absolute");
    }

    #[test]
    fn read_text_file_capped_returns_file_contents_for_absolute_path() {
        let path = unique_path("read.txt");
        fs::write(&path, "hello vault").expect("seed file");
        let result = read_text_file_capped(&path, 1024, "test");
        let _ = fs::remove_file(&path);
        assert_eq!(result.unwrap(), "hello vault");
    }

    #[test]
    fn write_text_file_atomically_writes_atomically_to_absolute_path() {
        let path = unique_path("write.txt");
        let parent = path.parent().unwrap().to_path_buf();
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        let tmp_sibling = parent.join(format!("{file_name}.tmp"));

        write_text_file_atomically(&path, "payload").expect("write should succeed");

        let on_disk = fs::read_to_string(&path).expect("file should exist");
        assert_eq!(on_disk, "payload");
        // The .tmp sibling must not survive a successful write.
        assert!(
            !tmp_sibling.exists(),
            "tmp file should have been renamed away"
        );

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_plain_ics_entry_rejects_wrong_extensions() {
        let path = unique_path("calendar.txt");
        fs::write(&path, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n").expect("seed file");
        let result = read_plain_ics_entry_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("ICS import file must use one of: ics"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn read_plain_ics_entry_rejects_oversized_files() {
        let path = unique_path("oversized.ics");
        let file = fs::File::create(&path).expect("create file");
        file.set_len(ICS_PLAIN_MAX_BYTES + 1)
            .expect("set oversized length");
        let result = read_plain_ics_entry_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("exceeding the limit"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn read_theme_json_rejects_oversized_files() {
        let path = unique_path("oversized.json");
        let file = fs::File::create(&path).expect("create file");
        file.set_len(THEME_JSON_MAX_BYTES + 1)
            .expect("set oversized length");
        let result = read_text_file_capped(&path, THEME_JSON_MAX_BYTES, "theme import");
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("exceeding the limit"),
            "unexpected error: {err}"
        );
    }

    /// Build a zip file at `path` containing the given `(name, contents)`
    /// pairs. Uses the Stored compression method so the test does not depend
    /// on the deflate path being exercised correctly.
    fn write_zip(path: &PathBuf, entries: &[(&str, &[u8])]) {
        use zip::write::SimpleFileOptions;
        use zip::write::ZipWriter;
        use zip::CompressionMethod;

        let file = fs::File::create(path).expect("create zip file");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, data) in entries {
            writer.start_file(*name, options).expect("start_file");
            writer.write_all(data).expect("write entry");
        }
        writer.finish().expect("finish zip");
    }

    #[test]
    fn read_ics_zip_entries_rejects_relative_paths() {
        let err = read_ics_zip_entries_from_path(Path::new("relative/path.zip")).unwrap_err();
        assert_eq!(err, "path must be absolute");
    }

    #[test]
    fn read_ics_zip_entries_rejects_wrong_extensions() {
        let path = unique_path("archive.txt");
        fs::write(&path, b"this is not a zip archive").expect("seed file");
        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("ICS zip import file must use one of: zip"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn read_ics_zip_entries_rejects_non_zip_files() {
        let path = unique_path("not-a-zip.zip");
        fs::write(&path, b"this is not a zip archive").expect("seed file");
        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.starts_with("not a valid zip archive"),
            "expected not-a-zip error, got: {err}"
        );
    }

    #[test]
    fn read_ics_zip_entries_returns_only_ics_entries() {
        let path = unique_path("mixed.zip");
        let ics_a = b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
        let ics_b = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
        write_zip(
            &path,
            &[
                ("calendar.ics", ics_a),
                ("readme.txt", b"ignore me"),
                ("nested/holidays.ICS", ics_b),
                ("__MACOSX/.DS_Store", b"junk"),
            ],
        );

        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        let entries = result.expect("should succeed");
        assert_eq!(entries.len(), 2, "should keep only the .ics entries");

        // Names are basenames, not full archive paths.
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"calendar.ics"), "got names: {names:?}");
        assert!(names.contains(&"holidays.ICS"), "got names: {names:?}");

        let calendar = entries.iter().find(|e| e.name == "calendar.ics").unwrap();
        assert_eq!(calendar.contents.as_bytes(), ics_a);
    }

    #[test]
    fn read_ics_zip_entries_returns_empty_when_no_ics_present() {
        let path = unique_path("no-ics.zip");
        write_zip(&path, &[("readme.txt", b"hello"), ("notes.md", b"# title")]);
        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        assert!(result.unwrap().is_empty());
    }
}
