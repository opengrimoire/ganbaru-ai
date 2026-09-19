//! Validated Doomscrolling configuration and embedded category definitions.

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuiltInCategory {
    pub(super) id: String,
    pub(super) label: String,
    #[serde(default)]
    pub(super) hosts: Vec<String>,
    #[serde(default)]
    pub(super) domain_keywords: Vec<String>,
    #[serde(default)]
    pub(super) reddit_subreddit_keywords: Vec<String>,
}

pub(super) const BUILT_IN_CATEGORIES_JSON: &str =
    include_str!("../../../apps/client/src/lib/doomscrolling/categories.json");

fn built_in_categories() -> &'static [BuiltInCategory] {
    static CATEGORIES: OnceLock<Vec<BuiltInCategory>> = OnceLock::new();
    CATEGORIES
        .get_or_init(|| parse_built_in_categories(BUILT_IN_CATEGORIES_JSON))
        .as_slice()
}

fn parse_built_in_categories(json: &str) -> Vec<BuiltInCategory> {
    let categories: Vec<BuiltInCategory> =
        serde_json::from_str(json).expect("embedded doomscrolling categories must be valid JSON");
    let mut seen_ids = HashSet::new();
    for category in &categories {
        assert!(
            !category.id.trim().is_empty(),
            "embedded doomscrolling category id must not be empty"
        );
        assert!(
            !category.label.trim().is_empty(),
            "embedded doomscrolling category label must not be empty"
        );
        assert!(
            seen_ids.insert(category.id.as_str()),
            "embedded doomscrolling category ids must be unique"
        );
    }
    categories
}

#[derive(Debug, Clone)]
pub(super) enum DoomscrollingMode {
    Blacklist,
    Whitelist,
}

#[derive(Debug, Clone)]
pub(super) struct CustomCategoryStack {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) hosts: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct UsageLimitEntry {
    pub(super) id: String,
    pub(super) name: Option<String>,
    pub(super) website_host: Option<String>,
    pub(super) mobile_app_name: Option<String>,
    pub(super) desktop_app_name: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct UsageLimit {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) enabled: bool,
    pub(super) minutes_per_day: Option<i64>,
    pub(super) minutes_per_week: Option<i64>,
    pub(super) entries: Vec<UsageLimitEntry>,
}

#[derive(Debug, Clone)]
pub(super) struct UsageLimitsConfig {
    pub(super) enabled: bool,
    pub(super) items: Vec<UsageLimit>,
}

#[derive(Debug, Clone)]
pub(super) struct DoomscrollingConfig {
    pub(super) mode: DoomscrollingMode,
    pub(super) enabled: bool,
    pub(super) block_during_focus: bool,
    pub(super) block_during_short_breaks: bool,
    pub(super) block_during_long_breaks: bool,
    pub(super) pause_during_focus_pause: bool,
    pub(super) blocked_category_ids: Vec<String>,
    pub(super) custom_category_stacks: Vec<CustomCategoryStack>,
    pub(super) blocked_hosts: Vec<String>,
    pub(super) exception_hosts: Vec<String>,
    pub(super) allowed_hosts: Vec<String>,
    pub(super) limits: UsageLimitsConfig,
}

pub(super) fn read_config(path: &std::path::Path) -> Option<DoomscrollingConfig> {
    let contents = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&contents).ok()?;
    let doomscrolling = value.get("doomscrolling")?;
    let mode = read_mode(doomscrolling)?;
    Some(DoomscrollingConfig {
        mode,
        enabled: doomscrolling
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_focus: doomscrolling
            .get("blockDuringFocus")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_short_breaks: doomscrolling
            .get("blockDuringShortBreaks")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_long_breaks: doomscrolling
            .get("blockDuringLongBreaks")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        pause_during_focus_pause: doomscrolling
            .get("pauseDuringFocusPause")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        blocked_category_ids: read_category_array(doomscrolling.get("blockedCategories")),
        custom_category_stacks: read_custom_category_stacks(
            doomscrolling.get("customCategoryStacks"),
        ),
        blocked_hosts: read_host_array(doomscrolling.get("blockedHosts")),
        exception_hosts: read_host_array(doomscrolling.get("exceptionHosts")),
        allowed_hosts: read_host_array(doomscrolling.get("allowedHosts")),
        limits: read_usage_limits_config(doomscrolling.get("limits")),
    })
}

pub(super) fn read_mode(doomscrolling: &Value) -> Option<DoomscrollingMode> {
    match doomscrolling.get("mode").and_then(Value::as_str) {
        Some("blacklist") => Some(DoomscrollingMode::Blacklist),
        Some("whitelist") => Some(DoomscrollingMode::Whitelist),
        _ => None,
    }
}

pub(super) fn built_in_category(id: &str) -> Option<&'static BuiltInCategory> {
    built_in_categories()
        .iter()
        .find(|category| category.id == id)
}

fn default_built_in_category_ids() -> Vec<String> {
    built_in_categories()
        .iter()
        .filter(|category| category.id != "news")
        .map(|category| category.id.to_string())
        .collect()
}

pub(super) fn read_category_array(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return default_built_in_category_ids();
    };
    let mut categories = Vec::new();
    for item in items {
        let Some(id) = read_category_rule(item) else {
            continue;
        };
        if !categories.contains(&id) {
            categories.push(id);
        }
    }
    categories
}

fn read_category_rule(item: &Value) -> Option<String> {
    match item {
        Value::Object(record) => {
            if record.get("enabled").and_then(Value::as_bool) != Some(true) {
                return None;
            }
            let id = record.get("id").and_then(Value::as_str)?;
            built_in_category(id).map(|category| category.id.to_string())
        }
        _ => None,
    }
}

pub(super) fn read_custom_category_stacks(value: Option<&Value>) -> Vec<CustomCategoryStack> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut stacks = Vec::new();
    for item in items {
        let Some(stack) = read_custom_category_stack(item) else {
            continue;
        };
        if !stacks
            .iter()
            .any(|existing: &CustomCategoryStack| existing.id == stack.id)
        {
            stacks.push(stack);
        }
    }
    stacks
}

pub(super) fn read_custom_category_stack(item: &Value) -> Option<CustomCategoryStack> {
    let Value::Object(record) = item else {
        return None;
    };
    if record.get("enabled").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let id = record.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() || id.len() > 80 {
        return None;
    }
    let name = record
        .get("name")
        .and_then(Value::as_str)
        .map(normalize_custom_category_stack_name)?;
    if name.is_empty() {
        return None;
    }
    let hosts = read_host_array(record.get("hosts"));
    if hosts.is_empty() {
        return None;
    }
    Some(CustomCategoryStack {
        id: id.to_string(),
        name,
        hosts,
    })
}

fn read_usage_limits_config(value: Option<&Value>) -> UsageLimitsConfig {
    let Some(Value::Object(record)) = value else {
        return UsageLimitsConfig {
            enabled: true,
            items: Vec::new(),
        };
    };
    let mut limits = Vec::new();
    let mut seen_ids = HashSet::new();
    if let Some(Value::Array(items)) = record.get("items") {
        for item in items {
            let Some(limit) = read_usage_limit(item) else {
                continue;
            };
            if seen_ids.insert(limit.id.clone()) {
                limits.push(limit);
            }
        }
    }
    UsageLimitsConfig {
        enabled: record.get("enabled").and_then(Value::as_bool) != Some(false),
        items: limits,
    }
}

fn read_usage_limit(item: &Value) -> Option<UsageLimit> {
    let Value::Object(record) = item else {
        return None;
    };
    let id = normalize_limit_id(record.get("id").and_then(Value::as_str)?)?;
    let name = normalize_usage_limit_name(record.get("name").and_then(Value::as_str)?)?;
    let minutes_per_day = read_optional_limit_minutes(record.get("minutesPerDay"), 1440)?;
    let minutes_per_week = read_optional_limit_minutes(record.get("minutesPerWeek"), 7 * 24 * 60)?;
    if minutes_per_day.is_none() && minutes_per_week.is_none() {
        return None;
    }
    let entries = read_usage_limit_entries(record.get("entries")?)?;
    Some(UsageLimit {
        id,
        name,
        enabled: record.get("enabled").and_then(Value::as_bool) != Some(false),
        minutes_per_day,
        minutes_per_week,
        entries,
    })
}

fn read_optional_limit_minutes(value: Option<&Value>, max_minutes: i64) -> Option<Option<i64>> {
    match value {
        None | Some(Value::Null) => Some(None),
        Some(value) => {
            let minutes = value.as_i64()?;
            (1..=max_minutes)
                .contains(&minutes)
                .then_some(Some(minutes))
        }
    }
}

fn normalize_limit_id(value: &str) -> Option<String> {
    let id = value.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }
    Some(id.to_string())
}

fn normalize_usage_limit_name(input: &str) -> Option<String> {
    let name = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect::<String>();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn read_usage_limit_entries(value: &Value) -> Option<Vec<UsageLimitEntry>> {
    let Value::Array(items) = value else {
        return None;
    };
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_ids = HashSet::new();
    for item in items {
        let Some(entry) = read_usage_limit_entry(item) else {
            continue;
        };
        if !seen_ids.insert(entry.id.clone()) {
            return None;
        }
        for key in usage_limit_entry_source_keys(&entry) {
            if !seen.insert(key) {
                return None;
            }
        }
        entries.push(entry);
    }
    (!entries.is_empty()).then_some(entries)
}

fn read_usage_limit_entry(item: &Value) -> Option<UsageLimitEntry> {
    let Value::Object(record) = item else {
        return None;
    };
    let id = normalize_limit_id(record.get("id").and_then(Value::as_str)?)?;
    let name = record
        .get("name")
        .and_then(Value::as_str)
        .and_then(normalize_usage_limit_name);
    let website_host = record
        .get("websiteHost")
        .and_then(Value::as_str)
        .and_then(normalize_host_rule);
    let mobile_app_name = record
        .get("mobileAppName")
        .and_then(Value::as_str)
        .and_then(normalize_app_name);
    let desktop_app_name = record
        .get("desktopAppName")
        .and_then(Value::as_str)
        .and_then(normalize_app_name);
    if website_host.is_none() && mobile_app_name.is_none() && desktop_app_name.is_none() {
        return None;
    }
    if desktop_app_name
        .as_deref()
        .is_some_and(is_protected_app_name)
    {
        return None;
    }
    Some(UsageLimitEntry {
        id,
        name,
        website_host,
        mobile_app_name,
        desktop_app_name,
    })
}

pub(super) fn normalize_app_name(input: &str) -> Option<String> {
    let name = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect::<String>();
    if name.is_empty() || name.chars().any(char::is_control) {
        None
    } else {
        Some(name)
    }
}

pub(super) fn is_protected_app_name(name: &str) -> bool {
    let key = name.trim().to_lowercase();
    let protected = [
        "ganbaru-ai",
        "ganbaru-ai-dev",
        "terminal",
        "gnome-terminal",
        "system monitor",
        "gnome-shell",
        "explorer.exe",
        "taskmgr.exe",
        "python",
        "python3",
        "python3.12",
        "sh",
        "bash",
        "zsh",
    ];
    protected.iter().any(|name| *name == key)
}

pub(super) fn usage_limit_entry_source_keys(entry: &UsageLimitEntry) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(host) = &entry.website_host {
        keys.push(format!("website:{host}"));
    }
    if let Some(name) = &entry.mobile_app_name {
        keys.push(format!("mobile-app:{}", name.to_lowercase()));
    }
    if let Some(name) = &entry.desktop_app_name {
        keys.push(format!("desktop-app:{}", name.to_lowercase()));
    }
    keys
}

fn normalize_custom_category_stack_name(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(60)
        .collect()
}

pub(super) fn read_host_array(value: Option<&Value>) -> Vec<String> {
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

pub(super) fn read_host_rule(item: &Value) -> Option<String> {
    match item {
        Value::Object(record) => {
            if record.get("enabled").and_then(Value::as_bool) != Some(true) {
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

pub(super) fn default_config() -> DoomscrollingConfig {
    DoomscrollingConfig {
        mode: DoomscrollingMode::Blacklist,
        enabled: true,
        block_during_focus: true,
        block_during_short_breaks: true,
        block_during_long_breaks: true,
        pause_during_focus_pause: true,
        blocked_category_ids: default_built_in_category_ids(),
        custom_category_stacks: Vec::new(),
        blocked_hosts: Vec::new(),
        exception_hosts: Vec::new(),
        allowed_hosts: Vec::new(),
        limits: UsageLimitsConfig {
            enabled: true,
            items: Vec::new(),
        },
    }
}

impl DoomscrollingMode {
    pub(super) fn as_str(&self) -> &'static str {
        match self {
            DoomscrollingMode::Blacklist => "blacklist",
            DoomscrollingMode::Whitelist => "whitelist",
        }
    }
}

pub(super) fn normalize_host_rule(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = trimmed.strip_prefix("*.").unwrap_or(&trimmed);
    if host.is_empty() || host.contains('*') || host.contains(' ') || host.contains('@') {
        return None;
    }
    Some(host.to_string())
}
