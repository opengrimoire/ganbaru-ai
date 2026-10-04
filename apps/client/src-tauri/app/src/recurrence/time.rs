//! Native civil-time conversion shared by Calendar expansion and Focus decisions.

use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
#[cfg(any(not(target_os = "android"), test))]
use ganbaru_focus::adaptive::models::{LocalTimeFact, LocalTimeFacts};
use jiff::{Timestamp, civil::DateTime, tz::TimeZone};

#[cfg(any(not(target_os = "android"), test))]
const MAX_LOCAL_TIME_FACTS: usize = 4_096;
const MAX_ZONE_NAME_BYTES: usize = 255;

/// Resolve an explicit home zone without silently substituting the device zone.
pub(crate) fn zone(name: &str) -> Result<TimeZone, String> {
    if name.is_empty() || name.len() > MAX_ZONE_NAME_BYTES {
        return Err("Calendar timezone name is empty or exceeds its size limit".into());
    }
    TimeZone::get(name).map_err(|error| format!("unsupported Calendar timezone {name}: {error}"))
}

/// Capture the native device zone once for one decision; detection failure is explicit.
pub(crate) fn system_zone() -> Result<TimeZone, String> {
    TimeZone::try_system().map_err(|error| format!("cannot resolve device timezone: {error}"))
}

fn jiff_civil(value: NaiveDateTime) -> Result<DateTime, String> {
    DateTime::new(
        i16::try_from(value.year()).map_err(|_| "Calendar year is outside the supported range")?,
        value.month() as i8,
        value.day() as i8,
        value.hour() as i8,
        value.minute() as i8,
        value.second() as i8,
        value.nanosecond() as i32,
    )
    .map_err(|error| format!("invalid Calendar civil time: {error}"))
}

/// Project an instant into a captured zone, retaining millisecond precision.
pub(crate) fn instant_to_local(epoch_ms: i64, zone: &TimeZone) -> Result<NaiveDateTime, String> {
    let instant = Timestamp::from_millisecond(epoch_ms)
        .map_err(|error| format!("Calendar instant is outside the supported range: {error}"))?;
    let value = zone.to_datetime(instant);
    NaiveDate::from_ymd_opt(
        i32::from(value.year()),
        value.month() as u32,
        value.day() as u32,
    )
    .and_then(|date| {
        date.and_hms_nano_opt(
            value.hour() as u32,
            value.minute() as u32,
            value.second() as u32,
            value.subsec_nanosecond() as u32,
        )
    })
    .ok_or_else(|| "Calendar timezone conversion produced an invalid civil time".into())
}

/// Resolve an explicit civil DTSTART/RDATE: earlier fold, pre-transition offset in a gap.
pub(crate) fn explicit_instant(value: NaiveDateTime, zone: &TimeZone) -> Result<i64, String> {
    zone.to_ambiguous_zoned(jiff_civil(value)?)
        .compatible()
        .map(|value| value.timestamp().as_millisecond())
        .map_err(|error| format!("cannot resolve explicit Calendar time: {error}"))
}

/// Resolve an RRULE candidate, skipping nonexistent wall times before COUNT is applied.
pub(crate) fn generated_instant(
    value: NaiveDateTime,
    zone: &TimeZone,
) -> Result<Option<i64>, String> {
    let local = jiff_civil(value)?;
    let resolved = zone
        .to_ambiguous_zoned(local)
        .compatible()
        .map_err(|error| format!("cannot resolve generated Calendar time: {error}"))?;
    // Compatible disambiguation preserves fold wall time but shifts gap wall time.
    // Round-trip comparison avoids treating a fall-back fold as nonexistent.
    if resolved.datetime() != local {
        return Ok(None);
    }
    Ok(Some(resolved.timestamp().as_millisecond()))
}

/// Supply the exact local date/hour and English Date.toDateString seed spelling.
#[cfg(any(not(target_os = "android"), test))]
pub(crate) fn local_time_facts(
    instants: &[i64],
    zone: &TimeZone,
) -> Result<LocalTimeFacts, String> {
    if instants.len() > MAX_LOCAL_TIME_FACTS {
        return Err("Focus local-time query exceeds 4096 instants".into());
    }
    instants
        .iter()
        .map(|&epoch_ms| {
            let local = instant_to_local(epoch_ms, zone)?;
            Ok((
                epoch_ms,
                LocalTimeFact {
                    epoch_ms,
                    date_key: local.format("%Y-%m-%d").to_string(),
                    date_string: local.format("%a %b %d %Y").to_string(),
                    hour: local.hour() as u8,
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn civil(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    fn instant(value: &str) -> i64 {
        value.parse::<Timestamp>().unwrap().as_millisecond()
    }

    #[test]
    fn generated_gaps_are_skipped_while_explicit_dates_use_the_prior_offset() {
        let zone = zone("America/New_York").unwrap();
        let missing = civil("2024-03-10 02:30:00");
        assert_eq!(generated_instant(missing, &zone).unwrap(), None);
        assert_eq!(
            explicit_instant(missing, &zone).unwrap(),
            instant("2024-03-10T07:30:00Z")
        );
        assert_eq!(
            generated_instant(civil("2024-03-11 02:30:00"), &zone).unwrap(),
            Some(instant("2024-03-11T06:30:00Z"))
        );
    }

    #[test]
    fn repeated_local_time_uses_the_first_fold_and_preserves_recurrence_identity() {
        let zone = zone("America/New_York").unwrap();
        let repeated = civil("2024-11-03 01:30:00");
        let first = instant("2024-11-03T05:30:00Z");
        assert_eq!(generated_instant(repeated, &zone).unwrap(), Some(first));
        assert_eq!(instant_to_local(first, &zone).unwrap(), repeated);
        assert_eq!(
            instant_to_local(instant("2024-11-03T06:30:00Z"), &zone).unwrap(),
            repeated
        );
    }

    #[test]
    fn midnight_skips_and_non_hour_transitions_are_not_assumed_to_be_one_hour() {
        let apia = zone("Pacific/Apia").unwrap();
        assert_eq!(
            generated_instant(civil("2011-12-30 12:00:00"), &apia).unwrap(),
            None
        );
        let lord_howe = zone("Australia/Lord_Howe").unwrap();
        let missing = civil("2024-10-06 02:15:00");
        let explicit = explicit_instant(missing, &lord_howe).unwrap();
        assert_eq!(
            instant_to_local(explicit, &lord_howe).unwrap(),
            civil("2024-10-06 02:45:00")
        );
        assert_eq!(generated_instant(missing, &lord_howe).unwrap(), None);
    }

    #[test]
    fn adaptive_seed_facts_use_the_selected_local_day_and_english_spelling() {
        let timestamp = instant("2024-03-10T04:30:00Z");
        let facts =
            local_time_facts(&[timestamp, timestamp], &zone("America/New_York").unwrap()).unwrap();
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[&timestamp].date_key, "2024-03-09");
        assert_eq!(facts[&timestamp].date_string, "Sat Mar 09 2024");
        assert_eq!(facts[&timestamp].hour, 23);
        assert!(
            local_time_facts(&vec![timestamp; MAX_LOCAL_TIME_FACTS + 1], &TimeZone::UTC).is_err()
        );
    }

    #[test]
    fn unknown_zones_and_out_of_range_instants_fail_without_a_fallback() {
        assert!(zone("Unrecognized/PrivateZone").is_err());
        assert!(zone("").is_err());
        assert!(instant_to_local(i64::MAX, &TimeZone::UTC).is_err());
    }
}
