use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs::File,
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{Manager, State};

use super::artwork::{embedded_artwork_id, extract_embedded_artwork};
use super::require_absolute_file;
use crate::music_youtube_host::youtube_host_html;

pub struct MusicHostState {
    pub youtube_url: String,
    media_base_url: String,
    token: String,
    media_files: Arc<Mutex<HashMap<String, HostedMedia>>>,
}

struct MusicHostShared {
    token: String,
    media_files: Arc<Mutex<HashMap<String, HostedMedia>>>,
}

#[derive(Clone)]
enum HostedMedia {
    File(PathBuf),
    Bytes {
        content_type: String,
        bytes: Arc<Vec<u8>>,
    },
}

struct HttpRequest {
    method: String,
    path: String,
    range: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ByteRange {
    pub(super) start: u64,
    pub(super) end: u64,
}

#[tauri::command]
pub fn music_register_media_file(
    state: State<'_, MusicHostState>,
    path: String,
) -> Result<String, String> {
    let path = PathBuf::from(path);
    require_absolute_file(&path)?;
    let id = media_file_id(&path);
    state
        .media_files
        .lock()
        .map_err(|_| "media host registry is temporarily unavailable".to_string())?
        .insert(id.clone(), HostedMedia::File(path));
    Ok(format!(
        "{}/media/{id}?token={}",
        state.media_base_url, state.token
    ))
}

#[tauri::command]
pub fn music_register_embedded_artwork(
    state: State<'_, MusicHostState>,
    path: String,
) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);
    require_absolute_file(&path)?;
    let Some(artwork) = extract_embedded_artwork(&path)? else {
        return Ok(None);
    };
    let id = embedded_artwork_id(&path, &artwork);
    state
        .media_files
        .lock()
        .map_err(|_| "media host registry is temporarily unavailable".to_string())?
        .insert(
            id.clone(),
            HostedMedia::Bytes {
                content_type: artwork.content_type,
                bytes: Arc::new(artwork.bytes),
            },
        );
    Ok(Some(format!(
        "{}/media/{id}?token={}",
        state.media_base_url, state.token
    )))
}

#[tauri::command]
pub fn music_youtube_host_url(state: State<'_, MusicHostState>) -> String {
    state.youtube_url.clone()
}

pub fn setup_youtube_host(app: &tauri::AppHandle) -> Result<(), String> {
    app.manage(spawn_music_host()?);
    Ok(())
}

fn media_file_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn spawn_music_host() -> Result<MusicHostState, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("failed to bind music player host: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("failed to inspect music player host address: {e}"))?;
    let token = make_music_host_token();
    let media_files = Arc::new(Mutex::new(HashMap::new()));
    let shared = Arc::new(MusicHostShared {
        token: token.clone(),
        media_files: Arc::clone(&media_files),
    });
    let thread_shared = Arc::clone(&shared);
    thread::Builder::new()
        .name("music-player-host".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else {
                    continue;
                };
                let connection_shared = Arc::clone(&thread_shared);
                let spawn_result = thread::Builder::new()
                    .name("music-player-host-request".to_string())
                    .spawn(move || {
                        handle_music_host_stream(stream, connection_shared);
                    });
                if spawn_result.is_err() {
                    continue;
                }
            }
        })
        .map_err(|e| format!("failed to start music player host: {e}"))?;

    let base_url = format!("http://{addr}");
    Ok(MusicHostState {
        youtube_url: format!("{base_url}/youtube-player.html?token={token}"),
        media_base_url: base_url,
        token,
        media_files,
    })
}

fn make_music_host_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{:x}{:x}", std::process::id(), nanos)
}

fn handle_music_host_stream(mut stream: TcpStream, shared: Arc<MusicHostShared>) {
    let Some(request) = read_http_request(&mut stream) else {
        return;
    };
    let authorized = request_token(&request.path).is_some_and(|token| token == shared.token);
    if request.method != "GET" && request.method != "HEAD" {
        write_http_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain; charset=utf-8",
            "Method not allowed",
        );
        return;
    }
    if request.path.starts_with("/youtube-player.html") && authorized {
        write_http_response(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            youtube_host_html(),
        );
    } else if request.path.starts_with("/media/") && authorized {
        match media_from_request(&request, &shared) {
            Ok(media) => {
                if let Err(err) = write_hosted_media_response(&mut stream, &request, &media) {
                    write_http_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        &format!("Media read failed: {err}"),
                    );
                }
            }
            Err(status) => {
                write_http_response(&mut stream, status, "text/plain; charset=utf-8", status)
            }
        }
    } else {
        write_http_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            "Not found",
        );
    }
}

fn read_http_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    let mut buffer = [0; 8192];
    let size = stream.read(&mut buffer).ok()?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.lines();
    let request_line = lines.next()?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next()?.to_string();
    let path = request_parts.next()?.to_string();
    let range = lines.find_map(|line| {
        line.split_once(':').and_then(|(name, value)| {
            if name.eq_ignore_ascii_case("range") {
                Some(value.trim().to_string())
            } else {
                None
            }
        })
    });
    Some(HttpRequest {
        method,
        path,
        range,
    })
}

fn request_token(path: &str) -> Option<&str> {
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        if name == "token" {
            Some(value)
        } else {
            None
        }
    })
}

fn media_from_request(
    request: &HttpRequest,
    shared: &MusicHostShared,
) -> Result<HostedMedia, &'static str> {
    let path_without_query = request.path.split('?').next().unwrap_or_default();
    let id = path_without_query
        .strip_prefix("/media/")
        .filter(|value| !value.is_empty())
        .ok_or("404 Not Found")?;
    shared
        .media_files
        .lock()
        .map_err(|_| "503 Service Unavailable")?
        .get(id)
        .cloned()
        .ok_or("404 Not Found")
}

fn write_media_file_response(
    stream: &mut TcpStream,
    request: &HttpRequest,
    path: &Path,
) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let content_type = media_content_type(path);
    let Some(range) = request
        .range
        .as_deref()
        .and_then(|value| parse_byte_range(value, len))
    else {
        write_media_headers(stream, "200 OK", content_type, len, None)?;
        if request.method != "HEAD" {
            copy_limited(&mut file, stream, len)?;
        }
        return Ok(());
    };

    write_media_headers(
        stream,
        "206 Partial Content",
        content_type,
        range.end - range.start + 1,
        Some((range, len)),
    )?;
    if request.method != "HEAD" {
        file.seek(SeekFrom::Start(range.start))?;
        copy_limited(&mut file, stream, range.end - range.start + 1)?;
    }
    Ok(())
}

fn write_hosted_media_response(
    stream: &mut TcpStream,
    request: &HttpRequest,
    media: &HostedMedia,
) -> std::io::Result<()> {
    match media {
        HostedMedia::File(path) => write_media_file_response(stream, request, path),
        HostedMedia::Bytes {
            content_type,
            bytes,
        } => write_media_bytes_response(stream, request, content_type, bytes.as_slice()),
    }
}

fn write_media_bytes_response(
    stream: &mut TcpStream,
    request: &HttpRequest,
    content_type: &str,
    bytes: &[u8],
) -> std::io::Result<()> {
    let len = bytes.len() as u64;
    let Some(range) = request
        .range
        .as_deref()
        .and_then(|value| parse_byte_range(value, len))
    else {
        write_media_headers(stream, "200 OK", content_type, len, None)?;
        if request.method != "HEAD" {
            stream.write_all(bytes)?;
            stream.flush()?;
        }
        return Ok(());
    };

    write_media_headers(
        stream,
        "206 Partial Content",
        content_type,
        range.end - range.start + 1,
        Some((range, len)),
    )?;
    if request.method != "HEAD" {
        let start = range.start as usize;
        let end = range.end as usize + 1;
        stream.write_all(&bytes[start..end])?;
        stream.flush()?;
    }
    Ok(())
}

fn write_media_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    content_length: u64,
    content_range: Option<(ByteRange, u64)>,
) -> std::io::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {content_length}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n"
    );
    if let Some((range, len)) = content_range {
        response.push_str(&format!(
            "Content-Range: bytes {}-{}/{}\r\n",
            range.start, range.end, len
        ));
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes())
}

fn copy_limited(
    file: &mut File,
    stream: &mut TcpStream,
    mut remaining: u64,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let read_limit =
            usize::try_from(remaining.min(buffer.len() as u64)).unwrap_or(buffer.len());
        let read = file.read(&mut buffer[..read_limit])?;
        if read == 0 {
            break;
        }
        stream.write_all(&buffer[..read])?;
        remaining = remaining.saturating_sub(read as u64);
    }
    stream.flush()
}

pub(super) fn parse_byte_range(header: &str, len: u64) -> Option<ByteRange> {
    if len == 0 {
        return None;
    }
    let range = header.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix_len = end.parse::<u64>().ok()?.min(len);
        if suffix_len == 0 {
            return None;
        }
        return Some(ByteRange {
            start: len - suffix_len,
            end: len - 1,
        });
    }
    let start = start.parse::<u64>().ok()?;
    if start >= len {
        return None;
    }
    let end = if end.is_empty() {
        len - 1
    } else {
        end.parse::<u64>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some(ByteRange { start, end })
}

pub(super) fn media_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("aac") => "audio/aac",
        Some("aif") | Some("aiff") => "audio/aiff",
        Some("flac") => "audio/flac",
        Some("m4a") | Some("alac") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("wma") => "audio/x-ms-wma",
        Some("avi") => "video/x-msvideo",
        Some("flv") => "video/x-flv",
        Some("m4v") | Some("mp4") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("mpeg") | Some("mpg") => "video/mpeg",
        Some("ogv") => "video/ogg",
        Some("webm") => "video/webm",
        Some("wmv") => "video/x-ms-wmv",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn write_http_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}
