use chrono::{Datelike, Months, NaiveDate, Weekday as ChronoWeekday};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

const MAX_INSTANCES: usize = 10_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEvent {
    id: String,
    start: String,
    end: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recurrence: Option<RecurrenceConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exceptions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rdate: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    overrides: Option<Vec<EventOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recurring_parent_id: Option<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventOverride {
    #[serde(default)]
    recurrence_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recurrence_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    end: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transparency: Option<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecurrenceConfig {
    frequency: RecurrenceFrequency,
    interval: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    weekdays: Option<Vec<Weekday>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ordinal_weekdays: Option<Vec<OrdinalWeekday>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    by_month_day: Option<Vec<i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    by_month: Option<Vec<u32>>,
    end: RecurrenceEnd,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum RecurrenceFrequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
enum Weekday {
    MO,
    TU,
    WE,
    TH,
    FR,
    SA,
    SU,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrdinalWeekday {
    day: Weekday,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ordinal: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RecurrenceEnd {
    Never,
    Until { date: String },
    Count { count: i64 },
}

#[tauri::command]
pub fn calendar_expand_render_events(
    events: Vec<RenderEvent>,
    window_start_date: String,
    window_end_date: String,
) -> Result<Vec<RenderEvent>, String> {
    let window_start = parse_date(&window_start_date)?;
    let window_end = parse_date(&window_end_date)?;
    let mut result = Vec::new();
    for event in events {
        expand_template(&event, window_start, window_end, &mut result)?;
    }
    Ok(result)
}

fn expand_template(
    event: &RenderEvent,
    window_start: NaiveDate,
    window_end: NaiveDate,
    result: &mut Vec<RenderEvent>,
) -> Result<(), String> {
    let start_date_str = date_part(&event.start);
    let end_date_str = date_part(&event.end);
    let orig_start = parse_date(start_date_str)?;
    let orig_end = parse_date(end_date_str)?;
    let day_span = (orig_end - orig_start).num_days();
    let until_date = event.recurrence.as_ref().and_then(until_date);

    if let Some(until) = until_date.as_deref() {
        if is_past_until(start_date_str, until) {
            return Ok(());
        }
    }

    let exceptions: HashSet<String> = event
        .exceptions
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .cloned()
        .collect();
    let override_state = build_override_state(event.overrides.as_deref());
    let mut rdate_set = HashSet::from([start_date_str.to_string()]);

    if overlaps_window(orig_start, orig_end, window_start, window_end)
        && !exceptions.contains(start_date_str)
        && !is_cancelled_occurrence(start_date_str, &override_state)
    {
        result.push(event.clone());
    }

    if event.recurrence.is_none() && event.rdate.as_deref().unwrap_or(&[]).is_empty() {
        return Ok(());
    }

    let start_time = time_part(&event.start);
    let end_time = time_part(&event.end);

    if let Some(config) = &event.recurrence {
        let max_count = match config.end {
            RecurrenceEnd::Count { count } => count,
            _ => i64::MAX,
        };
        let mut ff = if !is_complex_config(config) {
            fast_forward_simple(orig_start, window_start, config)
        } else if matches!(config.frequency, RecurrenceFrequency::Weekly)
            && config
                .weekdays
                .as_ref()
                .is_some_and(|days| !days.is_empty())
            && config
                .ordinal_weekdays
                .as_ref()
                .is_none_or(|days| days.is_empty())
            && config
                .by_month_day
                .as_ref()
                .is_none_or(|days| days.is_empty())
            && config
                .by_month
                .as_ref()
                .is_none_or(|months| months.is_empty())
        {
            fast_forward_weekly_by_day(orig_start, window_start, config)
        } else {
            None
        };
        if ff.is_none() {
            ff = Some((advance_date(orig_start, config)?, 1));
        }
        let (mut cursor, mut generated) = ff.expect("fallback fast-forward exists");
        let mut iter = 0usize;

        while generated < max_count && iter < MAX_INSTANCES {
            iter += 1;
            let occ_start_str = fmt_date(cursor);

            if let Some(until) = until_date.as_deref() {
                if is_past_until(&occ_start_str, until) {
                    break;
                }
            }
            if override_state
                .cancel_from_date
                .as_ref()
                .is_some_and(|date| occ_start_str.as_str() >= date.as_str())
            {
                break;
            }
            if cursor > window_end {
                break;
            }

            rdate_set.insert(occ_start_str.clone());
            if exceptions.contains(&occ_start_str)
                || is_cancelled_occurrence(&occ_start_str, &override_state)
            {
                cursor = advance_date(cursor, config)?;
                continue;
            }

            let occ_end = cursor + chrono::Duration::days(day_span);
            if occ_end >= window_start {
                let occ_end_str = fmt_date(occ_end);
                let mut instance = event.clone();
                instance.id = format!("{}::{occ_start_str}", event.id);
                instance.start = format!("{occ_start_str} {start_time}");
                instance.end = format!("{occ_end_str} {end_time}");
                instance.recurring_parent_id = Some(event.id.clone());
                if let Some(override_row) = override_state.overrides.get(&occ_start_str) {
                    apply_override(&mut instance, override_row);
                }
                result.push(instance);
            }

            cursor = advance_date(cursor, config)?;
            generated += 1;
        }
    }

    for raw_rdate in event.rdate.as_deref().unwrap_or(&[]) {
        let rdate = date_part(raw_rdate);
        if rdate_set.contains(rdate) || exceptions.contains(rdate) {
            continue;
        }
        if is_cancelled_occurrence(rdate, &override_state) {
            continue;
        }
        let rdate_plain = parse_date(rdate)?;
        let rdate_end = rdate_plain + chrono::Duration::days(day_span);
        if !overlaps_window(rdate_plain, rdate_end, window_start, window_end) {
            continue;
        }
        if let Some(until) = until_date.as_deref() {
            if is_past_until(rdate, until) {
                continue;
            }
        }

        let mut instance = event.clone();
        instance.id = format!("{}::{rdate}", event.id);
        instance.start = format!("{rdate} {start_time}");
        instance.end = format!("{} {end_time}", fmt_date(rdate_end));
        instance.recurring_parent_id = Some(event.id.clone());
        if let Some(override_row) = override_state.overrides.get(rdate) {
            apply_override(&mut instance, override_row);
        }
        result.push(instance);
    }

    Ok(())
}

fn advance_date(from: NaiveDate, config: &RecurrenceConfig) -> Result<NaiveDate, String> {
    if matches!(config.frequency, RecurrenceFrequency::Weekly)
        && config
            .weekdays
            .as_ref()
            .is_some_and(|days| !days.is_empty())
    {
        let mut sorted_days: Vec<i64> = config
            .weekdays
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|day| temporal_weekday(*day))
            .collect();
        sorted_days.sort_unstable();
        sorted_days.dedup();
        let start_day = chrono_to_temporal_weekday(from.weekday());
        if let Some(next) = sorted_days.iter().find(|day| **day > start_day) {
            return Ok(from + chrono::Duration::days(next - start_day));
        }
        let days_until_end = 7 - start_day;
        let skip_weeks = (config.interval - 1) * 7;
        return Ok(from + chrono::Duration::days(days_until_end + skip_weeks + sorted_days[0]));
    }

    if matches!(config.frequency, RecurrenceFrequency::Monthly)
        && config
            .ordinal_weekdays
            .as_ref()
            .is_some_and(|days| !days.is_empty())
    {
        return advance_monthly_ordinal(
            from,
            config.interval,
            config.ordinal_weekdays.as_deref().unwrap_or(&[]),
        );
    }

    if matches!(config.frequency, RecurrenceFrequency::Monthly)
        && config
            .by_month_day
            .as_ref()
            .is_some_and(|days| !days.is_empty())
    {
        return advance_monthly_by_day(
            from,
            config.interval,
            config.by_month_day.as_deref().unwrap_or(&[]),
        );
    }

    if matches!(config.frequency, RecurrenceFrequency::Yearly)
        && config
            .ordinal_weekdays
            .as_ref()
            .is_some_and(|days| !days.is_empty())
    {
        return advance_yearly_ordinal(
            from,
            config.interval,
            config.ordinal_weekdays.as_deref().unwrap_or(&[]),
            config.by_month.as_deref(),
        );
    }

    if matches!(config.frequency, RecurrenceFrequency::Yearly)
        && config
            .by_month
            .as_ref()
            .is_some_and(|months| !months.is_empty())
        && config
            .by_month_day
            .as_ref()
            .is_some_and(|days| !days.is_empty())
    {
        return advance_yearly_by_month_day(
            from,
            config.interval,
            config.by_month.as_deref().unwrap_or(&[]),
            config.by_month_day.as_deref().unwrap_or(&[]),
        );
    }

    match config.frequency {
        RecurrenceFrequency::Daily => Ok(from + chrono::Duration::days(config.interval)),
        RecurrenceFrequency::Weekly => Ok(from + chrono::Duration::weeks(config.interval)),
        RecurrenceFrequency::Monthly => add_months(from, config.interval),
        RecurrenceFrequency::Yearly => add_months(from, config.interval * 12),
    }
}

fn advance_monthly_ordinal(
    from: NaiveDate,
    interval: i64,
    ord_weekdays: &[OrdinalWeekday],
) -> Result<NaiveDate, String> {
    let mut probe = first_of_month(add_months(from, interval)?);
    for _ in 0..120 {
        for ow in ord_weekdays {
            let ordinal = ow.ordinal.unwrap_or(1);
            if let Some(day) = find_ordinal_weekday(probe.year(), probe.month(), ow.day, ordinal) {
                let candidate = date_ymd(probe.year(), probe.month(), day)?;
                if candidate > from {
                    return Ok(candidate);
                }
            }
        }
        probe = add_months(probe, interval)?;
    }
    add_months(from, interval)
}

fn advance_monthly_by_day(
    from: NaiveDate,
    interval: i64,
    by_month_day: &[i64],
) -> Result<NaiveDate, String> {
    let mut sorted = by_month_day.to_vec();
    sorted.sort_unstable();
    let days_current = days_in_month(from.year(), from.month()) as i64;
    for day in &sorted {
        let actual = if *day > 0 {
            *day
        } else {
            days_current + *day + 1
        };
        if actual > 0 && actual <= days_current && actual > i64::from(from.day()) {
            return date_ymd(from.year(), from.month(), actual as u32);
        }
    }

    let mut probe = first_of_month(add_months(from, interval)?);
    for _ in 0..120 {
        let days = days_in_month(probe.year(), probe.month()) as i64;
        for day in &sorted {
            let actual = if *day > 0 { *day } else { days + *day + 1 };
            if actual > 0 && actual <= days {
                return date_ymd(probe.year(), probe.month(), actual as u32);
            }
        }
        probe = add_months(probe, interval)?;
    }
    add_months(from, interval)
}

fn advance_yearly_ordinal(
    from: NaiveDate,
    interval: i64,
    ord_weekdays: &[OrdinalWeekday],
    by_month: Option<&[u32]>,
) -> Result<NaiveDate, String> {
    let months: Vec<u32> = by_month.map_or_else(|| vec![from.month()], <[u32]>::to_vec);
    let mut year = from.year();
    for month in &months {
        for ow in ord_weekdays {
            let ordinal = ow.ordinal.unwrap_or(1);
            if let Some(day) = find_ordinal_weekday(year, *month, ow.day, ordinal) {
                let candidate = date_ymd(year, *month, day)?;
                if candidate > from {
                    return Ok(candidate);
                }
            }
        }
    }

    year += interval as i32;
    for _ in 0..50 {
        for month in &months {
            for ow in ord_weekdays {
                let ordinal = ow.ordinal.unwrap_or(1);
                if let Some(day) = find_ordinal_weekday(year, *month, ow.day, ordinal) {
                    return date_ymd(year, *month, day);
                }
            }
        }
        year += interval as i32;
    }
    add_months(from, interval * 12)
}

fn advance_yearly_by_month_day(
    from: NaiveDate,
    interval: i64,
    by_month: &[u32],
    by_month_day: &[i64],
) -> Result<NaiveDate, String> {
    let mut year = from.year();
    let mut sorted_months = by_month.to_vec();
    sorted_months.sort_unstable();
    let mut sorted_days = by_month_day.to_vec();
    sorted_days.sort_unstable();

    for month in &sorted_months {
        let days = days_in_month(year, *month) as i64;
        for day in &sorted_days {
            let actual = if *day > 0 { *day } else { days + *day + 1 };
            if actual > 0 && actual <= days {
                let candidate = date_ymd(year, *month, actual as u32)?;
                if candidate > from {
                    return Ok(candidate);
                }
            }
        }
    }

    year += interval as i32;
    for _ in 0..50 {
        for month in &sorted_months {
            let days = days_in_month(year, *month) as i64;
            for day in &sorted_days {
                let actual = if *day > 0 { *day } else { days + *day + 1 };
                if actual > 0 && actual <= days {
                    return date_ymd(year, *month, actual as u32);
                }
            }
        }
        year += interval as i32;
    }
    add_months(from, interval * 12)
}

fn fast_forward_simple(
    orig_start: NaiveDate,
    window_start: NaiveDate,
    config: &RecurrenceConfig,
) -> Option<(NaiveDate, i64)> {
    if orig_start >= window_start || config.interval <= 0 {
        return None;
    }
    let days_diff = (window_start - orig_start).num_days();
    match config.frequency {
        RecurrenceFrequency::Daily => {
            let skip = div_ceil(days_diff, config.interval);
            Some((
                orig_start + chrono::Duration::days(skip * config.interval),
                skip,
            ))
        }
        RecurrenceFrequency::Weekly => {
            let skip = div_ceil(days_diff, 7 * config.interval);
            Some((
                orig_start + chrono::Duration::weeks(skip * config.interval),
                skip,
            ))
        }
        RecurrenceFrequency::Monthly => {
            if orig_start.day() > 28 {
                return None;
            }
            let est_months = days_diff / 31;
            let mut skip = (est_months / config.interval).max(0);
            let mut cursor = add_months(orig_start, skip * config.interval).ok()?;
            while cursor < window_start {
                cursor = add_months(cursor, config.interval).ok()?;
                skip += 1;
            }
            Some((cursor, skip))
        }
        RecurrenceFrequency::Yearly => {
            if orig_start.month() == 2 && orig_start.day() == 29 {
                return None;
            }
            let est_years = days_diff / 366;
            let mut skip = (est_years / config.interval).max(0);
            let mut cursor = add_months(orig_start, skip * config.interval * 12).ok()?;
            while cursor < window_start {
                cursor = add_months(cursor, config.interval * 12).ok()?;
                skip += 1;
            }
            Some((cursor, skip))
        }
    }
}

fn fast_forward_weekly_by_day(
    orig_start: NaiveDate,
    window_start: NaiveDate,
    config: &RecurrenceConfig,
) -> Option<(NaiveDate, i64)> {
    if orig_start >= window_start || config.interval <= 0 {
        return None;
    }
    let mut sorted_days: Vec<i64> = config
        .weekdays
        .as_deref()?
        .iter()
        .map(|day| temporal_weekday(*day))
        .collect();
    sorted_days.sort_unstable();
    sorted_days.dedup();
    if sorted_days.is_empty() {
        return None;
    }

    let orig_dow = chrono_to_temporal_weekday(orig_start.weekday());
    let k0 = sorted_days.iter().position(|day| *day == orig_dow)? as i64;
    let base_day = orig_start - chrono::Duration::days(orig_dow - sorted_days[0]);
    let base_to_window = (window_start - base_day).num_days();
    let period_length_days = config.interval * 7;

    let mut best_n = i64::MAX;
    let mut best_cursor = None;
    for (k, day) in sorted_days.iter().enumerate() {
        let day_offset = day - sorted_days[0];
        let numerator = base_to_window - day_offset;
        let p = if numerator <= 0 {
            0
        } else {
            div_ceil(numerator, period_length_days)
        };
        let n = p * sorted_days.len() as i64 + k as i64 - k0;
        if n <= 0 || n >= best_n {
            continue;
        }
        best_n = n;
        best_cursor = Some(base_day + chrono::Duration::days(p * period_length_days + day_offset));
    }
    best_cursor.map(|cursor| (cursor, best_n))
}

fn is_complex_config(config: &RecurrenceConfig) -> bool {
    config.weekdays.as_ref().is_some_and(|v| !v.is_empty())
        || config
            .ordinal_weekdays
            .as_ref()
            .is_some_and(|v| !v.is_empty())
        || config.by_month_day.as_ref().is_some_and(|v| !v.is_empty())
        || config.by_month.as_ref().is_some_and(|v| !v.is_empty())
}

struct OverrideState {
    overrides: HashMap<String, EventOverride>,
    cancelled_dates: HashSet<String>,
    cancel_from_date: Option<String>,
}

fn build_override_state(overrides: Option<&[EventOverride]>) -> OverrideState {
    let mut state = OverrideState {
        overrides: HashMap::new(),
        cancelled_dates: HashSet::new(),
        cancel_from_date: None,
    };
    for override_row in overrides.unwrap_or(&[]) {
        let key = date_part(&override_row.recurrence_id).to_string();
        if override_row.status.as_deref() == Some("cancelled") {
            if override_row.recurrence_range.as_deref() == Some("this-and-future") {
                if state
                    .cancel_from_date
                    .as_ref()
                    .is_none_or(|current| key.as_str() < current.as_str())
                {
                    state.cancel_from_date = Some(key);
                }
            } else {
                state.cancelled_dates.insert(key);
            }
            continue;
        }
        state.overrides.insert(key, override_row.clone());
    }
    state
}

fn is_cancelled_occurrence(date: &str, override_state: &OverrideState) -> bool {
    override_state.cancelled_dates.contains(date)
        || override_state
            .cancel_from_date
            .as_ref()
            .is_some_and(|cutoff| date >= cutoff.as_str())
}

fn apply_override(instance: &mut RenderEvent, override_row: &EventOverride) {
    if let Some(title) = &override_row.title {
        instance
            .extra
            .insert("title".to_string(), Value::String(title.clone()));
    }
    if let Some(start) = &override_row.start {
        instance.start.clone_from(start);
    }
    if let Some(end) = &override_row.end {
        instance.end.clone_from(end);
    }
    if let Some(color) = override_row.color {
        instance
            .extra
            .insert("color".to_string(), Value::from(color));
    }
    if let Some(status) = &override_row.status {
        instance
            .extra
            .insert("status".to_string(), Value::String(status.clone()));
    }
    if let Some(transparency) = &override_row.transparency {
        instance.extra.insert(
            "transparency".to_string(),
            Value::String(transparency.clone()),
        );
    }
}

fn find_ordinal_weekday(year: i32, month: u32, weekday: Weekday, ordinal: i64) -> Option<u32> {
    if ordinal == 0 {
        return None;
    }
    let target = weekday_to_chrono(weekday);
    let days = days_in_month(year, month);
    if ordinal > 0 {
        let mut count = 0;
        for day in 1..=days {
            let date = date_ymd(year, month, day).ok()?;
            if date.weekday() == target {
                count += 1;
                if count == ordinal {
                    return Some(day);
                }
            }
        }
        return None;
    }

    let mut count = 0;
    for day in (1..=days).rev() {
        let date = date_ymd(year, month, day).ok()?;
        if date.weekday() == target {
            count += 1;
            if count == -ordinal {
                return Some(day);
            }
        }
    }
    None
}

fn overlaps_window(
    occ_start: NaiveDate,
    occ_end: NaiveDate,
    window_start: NaiveDate,
    window_end: NaiveDate,
) -> bool {
    occ_end >= window_start && occ_start <= window_end
}

fn is_past_until(occ_date: &str, until_date: &str) -> bool {
    let until_day = until_date.split('T').next().unwrap_or(until_date);
    occ_date > until_day
}

fn until_date(config: &RecurrenceConfig) -> Option<String> {
    match &config.end {
        RecurrenceEnd::Until { date } => Some(date.clone()),
        _ => None,
    }
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|e| format!("invalid date {value}: {e}"))
}

fn date_part(value: &str) -> &str {
    value.split([' ', 'T']).next().unwrap_or(value)
}

fn time_part(value: &str) -> &str {
    value.split(' ').nth(1).unwrap_or("00:00")
}

fn fmt_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn add_months(date: NaiveDate, months: i64) -> Result<NaiveDate, String> {
    let months = u32::try_from(months).map_err(|_| "negative month interval".to_string())?;
    date.checked_add_months(Months::new(months))
        .ok_or_else(|| "date month addition overflowed".to_string())
}

fn first_of_month(date: NaiveDate) -> NaiveDate {
    date.with_day(1).expect("day 1 exists in every month")
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = date_ymd(next_year, next_month, 1).expect("valid next month");
    (first_next - chrono::Duration::days(1)).day()
}

fn date_ymd(year: i32, month: u32, day: u32) -> Result<NaiveDate, String> {
    NaiveDate::from_ymd_opt(year, month, day)
        .ok_or_else(|| format!("invalid date components {year}-{month}-{day}"))
}

fn weekday_to_chrono(day: Weekday) -> ChronoWeekday {
    match day {
        Weekday::MO => ChronoWeekday::Mon,
        Weekday::TU => ChronoWeekday::Tue,
        Weekday::WE => ChronoWeekday::Wed,
        Weekday::TH => ChronoWeekday::Thu,
        Weekday::FR => ChronoWeekday::Fri,
        Weekday::SA => ChronoWeekday::Sat,
        Weekday::SU => ChronoWeekday::Sun,
    }
}

fn temporal_weekday(day: Weekday) -> i64 {
    match day {
        Weekday::MO => 1,
        Weekday::TU => 2,
        Weekday::WE => 3,
        Weekday::TH => 4,
        Weekday::FR => 5,
        Weekday::SA => 6,
        Weekday::SU => 7,
    }
}

fn chrono_to_temporal_weekday(day: ChronoWeekday) -> i64 {
    match day {
        ChronoWeekday::Mon => 1,
        ChronoWeekday::Tue => 2,
        ChronoWeekday::Wed => 3,
        ChronoWeekday::Thu => 4,
        ChronoWeekday::Fri => 5,
        ChronoWeekday::Sat => 6,
        ChronoWeekday::Sun => 7,
    }
}

fn div_ceil(a: i64, b: i64) -> i64 {
    if a <= 0 {
        0
    } else {
        (a + b - 1) / b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_with_recurrence(recurrence: RecurrenceConfig) -> RenderEvent {
        let mut extra = Map::new();
        extra.insert("title".to_string(), Value::String("Test".to_string()));
        extra.insert("timezone".to_string(), Value::String("UTC".to_string()));
        extra.insert("calendarId".to_string(), Value::String("local".to_string()));
        RenderEvent {
            id: "evt-1".to_string(),
            start: "2026-03-15 09:00".to_string(),
            end: "2026-03-15 10:00".to_string(),
            recurrence: Some(recurrence),
            exceptions: None,
            rdate: None,
            overrides: None,
            recurring_parent_id: None,
            extra,
        }
    }

    fn dates(events: &[RenderEvent]) -> Vec<String> {
        let mut dates = events
            .iter()
            .map(|event| date_part(&event.start).to_string())
            .collect::<Vec<_>>();
        dates.sort();
        dates
    }

    #[test]
    fn expands_daily_count() {
        let event = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: None,
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Count { count: 3 },
        });
        let expanded = calendar_expand_render_events(
            vec![event],
            "2026-03-01".to_string(),
            "2026-03-31".to_string(),
        )
        .unwrap();
        assert_eq!(dates(&expanded), ["2026-03-15", "2026-03-16", "2026-03-17"]);
    }

    #[test]
    fn expands_weekly_by_day() {
        let mut event = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Weekly,
            interval: 1,
            weekdays: Some(vec![Weekday::MO, Weekday::WE, Weekday::FR]),
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Count { count: 6 },
        });
        event.start = "2026-03-16 09:00".to_string();
        event.end = "2026-03-16 10:00".to_string();
        let expanded = calendar_expand_render_events(
            vec![event],
            "2026-03-01".to_string(),
            "2026-03-31".to_string(),
        )
        .unwrap();
        assert_eq!(
            dates(&expanded),
            [
                "2026-03-16",
                "2026-03-18",
                "2026-03-20",
                "2026-03-23",
                "2026-03-25",
                "2026-03-27"
            ]
        );
    }

    #[test]
    fn applies_exception_without_counting_it() {
        let mut event = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: None,
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Count { count: 5 },
        });
        event.exceptions = Some(vec!["2026-03-17".to_string()]);
        let expanded = calendar_expand_render_events(
            vec![event],
            "2026-03-01".to_string(),
            "2026-03-31".to_string(),
        )
        .unwrap();
        assert!(!dates(&expanded).contains(&"2026-03-17".to_string()));
        assert_eq!(expanded.len(), 5);
    }

    #[test]
    fn hides_cancelled_override_instance() {
        let mut event = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: None,
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Count { count: 3 },
        });
        event.overrides = Some(vec![EventOverride {
            recurrence_id: "2026-03-16T09:00:00Z".to_string(),
            recurrence_range: None,
            title: None,
            start: None,
            end: None,
            color: None,
            status: Some("cancelled".to_string()),
            transparency: None,
            extra: Map::new(),
        }]);
        let expanded = calendar_expand_render_events(
            vec![event],
            "2026-03-01".to_string(),
            "2026-03-31".to_string(),
        )
        .unwrap();
        assert_eq!(dates(&expanded), ["2026-03-15", "2026-03-17", "2026-03-18"]);
    }

    #[test]
    fn hides_cancelled_this_and_future_override_instances() {
        let mut event = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: None,
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Never,
        });
        event.overrides = Some(vec![EventOverride {
            recurrence_id: "2026-03-17T09:00:00Z".to_string(),
            recurrence_range: Some("this-and-future".to_string()),
            title: None,
            start: None,
            end: None,
            color: None,
            status: Some("cancelled".to_string()),
            transparency: None,
            extra: Map::new(),
        }]);
        let expanded = calendar_expand_render_events(
            vec![event],
            "2026-03-15".to_string(),
            "2026-03-20".to_string(),
        )
        .unwrap();
        assert_eq!(dates(&expanded), ["2026-03-15", "2026-03-16"]);
    }

    #[test]
    fn does_not_expand_google_until_capped_events_into_future_window() {
        let mut daily = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: None,
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Until {
                date: "2021-03-22T05:59:59Z".to_string(),
            },
        });
        daily.start = "2021-02-08 06:00".to_string();
        daily.end = "2021-02-08 06:30".to_string();

        let mut weekly = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Weekly,
            interval: 1,
            weekdays: Some(vec![Weekday::FR, Weekday::TU, Weekday::WE]),
            ordinal_weekdays: None,
            by_month_day: None,
            by_month: None,
            end: RecurrenceEnd::Until {
                date: "2021-06-12T04:59:59Z".to_string(),
            },
        });
        weekly.start = "2021-05-11 09:00".to_string();
        weekly.end = "2021-05-11 13:00".to_string();

        let expanded = calendar_expand_render_events(
            vec![daily, weekly],
            "2026-05-01".to_string(),
            "2026-05-31".to_string(),
        )
        .unwrap();
        assert!(expanded.is_empty());
    }

    #[test]
    fn expands_monthly_by_month_day() {
        let event = event_with_recurrence(RecurrenceConfig {
            frequency: RecurrenceFrequency::Monthly,
            interval: 1,
            weekdays: None,
            ordinal_weekdays: None,
            by_month_day: Some(vec![1, 15]),
            by_month: None,
            end: RecurrenceEnd::Count { count: 5 },
        });
        let expanded = calendar_expand_render_events(
            vec![event],
            "2026-03-01".to_string(),
            "2026-05-31".to_string(),
        )
        .unwrap();
        assert_eq!(
            dates(&expanded),
            [
                "2026-03-15",
                "2026-04-01",
                "2026-04-15",
                "2026-05-01",
                "2026-05-15"
            ]
        );
    }
}
