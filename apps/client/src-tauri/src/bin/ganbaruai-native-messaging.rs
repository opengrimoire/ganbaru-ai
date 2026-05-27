use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const HOST_NAME: &str = "org.opengrimoire.ganbaruai.stopper";
const STATE_FILE: &str = "procrastination-stopper-state.json";
const EXTENSION_CONNECTION_FILE: &str = "procrastination-stopper-extension-status.json";
const EVENTS_FILE: &str = "procrastination-stopper-events.jsonl";
const CONFIG_FILE: &str = "vault/config.json";
const STALE_STATE_SECONDS: i64 = 180;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeRequest {
    #[serde(rename = "type")]
    message_type: String,
    url: Option<String>,
    host: Option<String>,
    log_event: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeResponse {
    #[serde(rename = "type")]
    message_type: &'static str,
    host_name: &'static str,
    connected: bool,
    active: bool,
    phase: String,
    remaining_seconds: Option<i64>,
    rules_fingerprint: String,
    blocked: bool,
    host: Option<String>,
    matched_rule_name: Option<String>,
    reason: Option<String>,
    environment_name: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
    active: bool,
    phase: String,
    remaining_seconds: Option<i64>,
    updated_at: String,
}

#[derive(Debug, Clone)]
enum StopperMode {
    Blacklist,
    Whitelist,
}

#[derive(Debug, Clone)]
struct StopperConfig {
    mode: StopperMode,
    enabled: bool,
    block_during_short_breaks: bool,
    block_during_long_breaks: bool,
    blocked_hosts: Vec<String>,
    exception_hosts: Vec<String>,
    allowed_hosts: Vec<String>,
}

#[derive(Debug)]
struct StateSnapshot {
    config_dir: Option<PathBuf>,
    config: StopperConfig,
    runtime: Option<RuntimeState>,
}

fn main() {
    let response = match run() {
        Ok(response) => response,
        Err(reason) => NativeResponse {
            message_type: "error",
            host_name: HOST_NAME,
            connected: false,
            active: false,
            phase: "inactive".to_string(),
            remaining_seconds: None,
            rules_fingerprint: "unavailable".to_string(),
            blocked: false,
            host: None,
            matched_rule_name: None,
            reason: Some(reason),
            environment_name: "GanbaruAI",
        },
    };

    if let Err(err) = write_native_message(&response) {
        eprintln!("failed to write native messaging response: {err}");
    }
}

fn run() -> Result<NativeResponse, String> {
    let request = read_native_message()?;
    let snapshot = load_snapshot();
    if let Err(err) =
        record_extension_connection(snapshot.config_dir.as_deref(), &request.message_type)
    {
        eprintln!("failed to record extension connection: {err}");
    }
    let mut response = response_from_snapshot(&snapshot);

    if request.message_type == "decide_url" {
        if let Some(host) = normalized_request_host(&request) {
            response.host = Some(host.clone());
            if should_enforce(&snapshot, &mut response) {
                let decision = decide_host(&host, &snapshot.config);
                response.blocked = decision.blocked;
                response.matched_rule_name = decision.matched_rule_name;
                if response.blocked && request.log_event.unwrap_or(true) {
                    log_block_event(&snapshot, &host, response.matched_rule_name.as_deref());
                }
            }
        } else {
            response.reason = Some("unsupported or invalid URL".to_string());
        }
    } else if request.message_type != "get_state" {
        response.reason = Some(format!(
            "unsupported message type '{}'",
            request.message_type
        ));
    }

    Ok(response)
}

fn write_text_file_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "connection status path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "connection status path has no file name".to_string())?
        .to_string_lossy();
    let tmp_path = parent.join(format!("{file_name}.tmp"));
    {
        let mut file = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

fn extension_connection_dir(config_dir: Option<&Path>) -> Option<PathBuf> {
    config_dir
        .map(Path::to_path_buf)
        .or_else(|| config_dir_candidates().into_iter().next())
}

fn record_extension_connection(
    config_dir: Option<&Path>,
    message_type: &str,
) -> Result<(), String> {
    let dir = extension_connection_dir(config_dir)
        .ok_or_else(|| "app config directory is unavailable".to_string())?;
    let payload = serde_json::json!({
        "lastSeenAt": now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
        "lastMessageType": message_type,
    });
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    write_text_file_atomically(&dir.join(EXTENSION_CONNECTION_FILE), &json)
}

fn read_native_message() -> Result<NativeRequest, String> {
    let mut stdin = std::io::stdin().lock();
    let mut length_bytes = [0_u8; 4];
    stdin
        .read_exact(&mut length_bytes)
        .map_err(|e| format!("read message length: {e}"))?;
    let length = u32::from_ne_bytes(length_bytes) as usize;
    if length > 1024 * 1024 {
        return Err("native message exceeds 1 MiB".to_string());
    }
    let mut buffer = vec![0_u8; length];
    stdin
        .read_exact(&mut buffer)
        .map_err(|e| format!("read message body: {e}"))?;
    serde_json::from_slice(&buffer).map_err(|e| format!("parse native message: {e}"))
}

fn write_native_message(response: &NativeResponse) -> Result<(), String> {
    let bytes = serde_json::to_vec(response).map_err(|e| e.to_string())?;
    let length = u32::try_from(bytes.len())
        .map_err(|_| "native response exceeds u32 length".to_string())?
        .to_ne_bytes();
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(&length).map_err(|e| e.to_string())?;
    stdout.write_all(&bytes).map_err(|e| e.to_string())?;
    stdout.flush().map_err(|e| e.to_string())
}

fn load_snapshot() -> StateSnapshot {
    let config_dir = config_dir_candidates()
        .into_iter()
        .find(|dir| dir.join(STATE_FILE).exists() || dir.join(CONFIG_FILE).exists());
    let config = config_dir
        .as_ref()
        .and_then(|dir| read_config(&dir.join(CONFIG_FILE)))
        .unwrap_or_else(default_config);
    let runtime = config_dir
        .as_ref()
        .and_then(|dir| read_runtime_state(&dir.join(STATE_FILE)));
    StateSnapshot {
        config_dir,
        config,
        runtime,
    }
}

fn config_dir_candidates() -> Vec<PathBuf> {
    if let Ok(dir) = std::env::var("GANBARUAI_CONFIG_DIR") {
        return vec![PathBuf::from(dir)];
    }

    let ids = [
        "org.opengrimoire.ganbaruai.dev",
        "org.opengrimoire.ganbaruai",
    ];
    let mut candidates = Vec::new();

    #[cfg(target_os = "linux")]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
        if let Some(base) = base {
            for id in ids {
                candidates.push(base.join(id));
            }
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let base = home.join("Library").join("Application Support");
        for id in ids {
            candidates.push(base.join(id));
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        for id in ids {
            candidates.push(appdata.join(id));
        }
    }

    candidates
}

fn read_runtime_state(path: &std::path::Path) -> Option<RuntimeState> {
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn read_config(path: &std::path::Path) -> Option<StopperConfig> {
    let contents = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&contents).ok()?;
    let stopper = value.get("procrastinationStopper")?;
    let (mode, has_mode) = read_mode(stopper);
    let has_exception_hosts = matches!(stopper.get("exceptionHosts"), Some(Value::Array(_)));
    let legacy_allowed_hosts = read_host_array(stopper.get("allowedHosts"));
    let legacy_block_during_breaks = stopper.get("blockDuringBreaks").and_then(Value::as_bool);
    Some(StopperConfig {
        mode,
        enabled: stopper
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_short_breaks: stopper
            .get("blockDuringShortBreaks")
            .and_then(Value::as_bool)
            .or(legacy_block_during_breaks)
            .unwrap_or(true),
        block_during_long_breaks: stopper
            .get("blockDuringLongBreaks")
            .and_then(Value::as_bool)
            .or(legacy_block_during_breaks)
            .unwrap_or(true),
        blocked_hosts: read_host_array(stopper.get("blockedHosts")),
        exception_hosts: if has_exception_hosts {
            read_host_array(stopper.get("exceptionHosts"))
        } else if has_mode {
            Vec::new()
        } else {
            legacy_allowed_hosts.clone()
        },
        allowed_hosts: if has_mode {
            legacy_allowed_hosts
        } else {
            Vec::new()
        },
    })
}

fn read_mode(stopper: &Value) -> (StopperMode, bool) {
    match stopper.get("mode").and_then(Value::as_str) {
        Some("whitelist") => (StopperMode::Whitelist, true),
        Some("blacklist") => (StopperMode::Blacklist, true),
        _ => (StopperMode::Blacklist, false),
    }
}

fn read_host_array(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut hosts = Vec::new();
    for item in items {
        let Some(host) = read_host_rule(item) else {
            continue;
        };
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    hosts
}

fn read_host_rule(item: &Value) -> Option<String> {
    match item {
        Value::String(host) => normalize_host_rule(host),
        Value::Object(record) => {
            if record.get("enabled").and_then(Value::as_bool) == Some(false) {
                return None;
            }
            record
                .get("host")
                .and_then(Value::as_str)
                .and_then(normalize_host_rule)
        }
        _ => None,
    }
}

fn default_config() -> StopperConfig {
    StopperConfig {
        mode: StopperMode::Blacklist,
        enabled: true,
        block_during_short_breaks: true,
        block_during_long_breaks: true,
        blocked_hosts: Vec::new(),
        exception_hosts: Vec::new(),
        allowed_hosts: Vec::new(),
    }
}

fn response_from_snapshot(snapshot: &StateSnapshot) -> NativeResponse {
    let (active, phase, remaining_seconds, reason) = runtime_status(snapshot);
    NativeResponse {
        message_type: "decision",
        host_name: HOST_NAME,
        connected: snapshot.config_dir.is_some(),
        active,
        phase,
        remaining_seconds,
        rules_fingerprint: rules_fingerprint(&snapshot.config),
        blocked: false,
        host: None,
        matched_rule_name: None,
        reason,
        environment_name: "GanbaruAI",
    }
}

fn runtime_status(snapshot: &StateSnapshot) -> (bool, String, Option<i64>, Option<String>) {
    if !snapshot.config.enabled {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("Doomscrolling disabled".to_string()),
        );
    }

    let Some(runtime) = &snapshot.runtime else {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("no runtime state".to_string()),
        );
    };

    let Ok(updated_at) = DateTime::parse_from_rfc3339(&runtime.updated_at) else {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("runtime state has invalid timestamp".to_string()),
        );
    };
    let age_seconds = (now_utc() - updated_at.with_timezone(&Utc))
        .num_seconds()
        .max(0);
    if age_seconds > STALE_STATE_SECONDS {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("runtime state is stale".to_string()),
        );
    }

    let remaining_seconds = runtime
        .remaining_seconds
        .map(|remaining| (remaining - age_seconds).max(0));
    (
        runtime.active,
        runtime.phase.clone(),
        remaining_seconds,
        None,
    )
}

fn should_enforce(snapshot: &StateSnapshot, response: &mut NativeResponse) -> bool {
    if !response.active {
        return false;
    }
    match response.phase.as_str() {
        "focus" => true,
        "short_break" => snapshot.config.block_during_short_breaks,
        "long_break" => snapshot.config.block_during_long_breaks,
        _ => false,
    }
}

struct HostDecision {
    blocked: bool,
    matched_rule_name: Option<String>,
}

fn decide_host(host: &str, config: &StopperConfig) -> HostDecision {
    if is_safety_allowed_host(host) {
        return HostDecision {
            blocked: false,
            matched_rule_name: Some("browser safety allowlist".to_string()),
        };
    }

    match config.mode {
        StopperMode::Whitelist => {
            for allowed_host in &config.allowed_hosts {
                if host_matches_rule(host, allowed_host) {
                    return HostDecision {
                        blocked: false,
                        matched_rule_name: Some(format!("whitelist: {allowed_host}")),
                    };
                }
            }
            HostDecision {
                blocked: true,
                matched_rule_name: Some("not in whitelist".to_string()),
            }
        }
        StopperMode::Blacklist => {
            for exception_host in &config.exception_hosts {
                if host_matches_rule(host, exception_host) {
                    return HostDecision {
                        blocked: false,
                        matched_rule_name: Some(format!("exception: {exception_host}")),
                    };
                }
            }
            for blocked_host in &config.blocked_hosts {
                if host_matches_rule(host, blocked_host) {
                    return HostDecision {
                        blocked: true,
                        matched_rule_name: Some(format!("blocked host: {blocked_host}")),
                    };
                }
            }
            HostDecision {
                blocked: false,
                matched_rule_name: None,
            }
        }
    }
}

impl StopperMode {
    fn as_str(&self) -> &'static str {
        match self {
            StopperMode::Blacklist => "blacklist",
            StopperMode::Whitelist => "whitelist",
        }
    }
}

fn feed_fingerprint(hash: &mut u64, value: &str) {
    for byte in value.as_bytes() {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(1_099_511_628_211);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(1_099_511_628_211);
}

fn feed_fingerprint_bool(hash: &mut u64, value: bool) {
    feed_fingerprint(hash, if value { "1" } else { "0" });
}

fn feed_fingerprint_hosts(hash: &mut u64, label: &str, hosts: &[String]) {
    feed_fingerprint(hash, label);
    for host in hosts {
        feed_fingerprint(hash, host);
    }
}

fn rules_fingerprint(config: &StopperConfig) -> String {
    let mut hash = 14_695_981_039_346_656_037_u64;
    feed_fingerprint(&mut hash, config.mode.as_str());
    feed_fingerprint_bool(&mut hash, config.enabled);
    feed_fingerprint_bool(&mut hash, config.block_during_short_breaks);
    feed_fingerprint_bool(&mut hash, config.block_during_long_breaks);
    feed_fingerprint_hosts(&mut hash, "blocked", &config.blocked_hosts);
    feed_fingerprint_hosts(&mut hash, "exception", &config.exception_hosts);
    feed_fingerprint_hosts(&mut hash, "allowed", &config.allowed_hosts);
    format!("{hash:016x}")
}

fn normalized_request_host(request: &NativeRequest) -> Option<String> {
    request
        .host
        .as_deref()
        .and_then(normalize_host_rule)
        .or_else(|| request.url.as_deref().and_then(host_from_url))
}

fn host_from_url(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let after_user = authority.rsplit('@').next().unwrap_or(authority);
    let host = after_user
        .strip_prefix('[')
        .and_then(|value| value.split_once(']').map(|(host, _)| host))
        .unwrap_or_else(|| after_user.split(':').next().unwrap_or_default());
    normalize_host_rule(host)
}

fn normalize_host_rule(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = trimmed.strip_prefix("*.").unwrap_or(&trimmed);
    if host.is_empty() || host.contains('*') || host.contains(' ') || host.contains('@') {
        return None;
    }
    Some(host.to_string())
}

fn host_matches_rule(host: &str, rule_host: &str) -> bool {
    host == rule_host
        || host
            .strip_suffix(rule_host)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn is_safety_allowed_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".localhost")
}

fn now_utc() -> DateTime<Utc> {
    std::time::SystemTime::now().into()
}

fn log_block_event(snapshot: &StateSnapshot, host: &str, matched_rule_name: Option<&str>) {
    let Some(config_dir) = &snapshot.config_dir else {
        return;
    };
    let event = serde_json::json!({
        "occurredAt": now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
        "urlHost": host,
        "phase": snapshot.runtime.as_ref().map(|state| state.phase.as_str()).unwrap_or("inactive"),
        "ruleNameSnapshot": matched_rule_name,
        "decision": "blocked"
    });
    if let Ok(line) = serde_json::to_string(&event) {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(config_dir.join(EVENTS_FILE))
        {
            let _ = writeln!(file, "{line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decide_host, host_from_url, host_matches_rule, should_enforce, NativeResponse,
        StateSnapshot, StopperConfig, StopperMode,
    };

    fn config() -> StopperConfig {
        StopperConfig {
            mode: StopperMode::Blacklist,
            enabled: true,
            block_during_short_breaks: true,
            block_during_long_breaks: true,
            blocked_hosts: vec!["reddit.com".to_string(), "youtube.com".to_string()],
            exception_hosts: vec!["music.youtube.com".to_string()],
            allowed_hosts: vec!["github.com".to_string()],
        }
    }

    fn response_for_phase(phase: &str) -> NativeResponse {
        NativeResponse {
            message_type: "decision",
            host_name: super::HOST_NAME,
            connected: true,
            active: true,
            phase: phase.to_string(),
            remaining_seconds: Some(60),
            rules_fingerprint: "test".to_string(),
            blocked: false,
            host: None,
            matched_rule_name: None,
            reason: None,
            environment_name: "GanbaruAI",
        }
    }

    #[test]
    fn extracts_host_from_url() {
        assert_eq!(
            host_from_url("https://old.reddit.com/r/all?x=1").as_deref(),
            Some("old.reddit.com")
        );
    }

    #[test]
    fn matches_subdomains_only_on_boundaries() {
        assert!(host_matches_rule("old.reddit.com", "reddit.com"));
        assert!(!host_matches_rule("badreddit.com", "reddit.com"));
    }

    #[test]
    fn reads_legacy_and_enabled_structured_hosts() {
        let value = serde_json::json!([
            "Reddit.com",
            { "host": "youtube.com", "enabled": false },
            { "host": "Docs.GitHub.com" },
            { "host": "reddit.com" }
        ]);
        assert_eq!(
            super::read_host_array(Some(&value)),
            vec!["reddit.com".to_string(), "docs.github.com".to_string()]
        );
    }

    #[test]
    fn lets_exceptions_override_blocked_parent_domains() {
        let decision = decide_host("music.youtube.com", &config());
        assert!(!decision.blocked);
        assert_eq!(
            decision.matched_rule_name.as_deref(),
            Some("exception: music.youtube.com")
        );
    }

    #[test]
    fn blocks_matching_parent_domain() {
        let decision = decide_host("old.reddit.com", &config());
        assert!(decision.blocked);
        assert_eq!(
            decision.matched_rule_name.as_deref(),
            Some("blocked host: reddit.com")
        );
    }

    #[test]
    fn enforces_short_and_long_break_settings_independently() {
        let mut config = config();
        config.block_during_short_breaks = true;
        config.block_during_long_breaks = false;
        let snapshot = StateSnapshot {
            config_dir: None,
            config,
            runtime: None,
        };
        let mut short_break = response_for_phase("short_break");
        let mut long_break = response_for_phase("long_break");

        assert!(should_enforce(&snapshot, &mut short_break));
        assert!(!should_enforce(&snapshot, &mut long_break));
    }

    #[test]
    fn blocks_hosts_outside_whitelist_mode() {
        let mut config = config();
        config.mode = StopperMode::Whitelist;
        let decision = decide_host("reddit.com", &config);
        assert!(decision.blocked);
        assert_eq!(
            decision.matched_rule_name.as_deref(),
            Some("not in whitelist")
        );
    }

    #[test]
    fn allows_hosts_inside_whitelist_mode() {
        let mut config = config();
        config.mode = StopperMode::Whitelist;
        let decision = decide_host("docs.github.com", &config);
        assert!(!decision.blocked);
        assert_eq!(
            decision.matched_rule_name.as_deref(),
            Some("whitelist: github.com")
        );
    }

    #[test]
    fn rules_fingerprint_changes_when_mode_or_rules_change() {
        let mut config = config();
        let base = super::rules_fingerprint(&config);

        config.mode = StopperMode::Whitelist;
        assert_ne!(super::rules_fingerprint(&config), base);

        config.mode = StopperMode::Blacklist;
        config
            .blocked_hosts
            .push("news.ycombinator.com".to_string());
        assert_ne!(super::rules_fingerprint(&config), base);
    }
}
