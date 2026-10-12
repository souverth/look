//! Just enough date handling for agent logs, without pulling in a date crate.

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_unix_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parses an RFC 3339 timestamp (`2026-10-12T16:25:17.213Z`, or with a
/// `+hh:mm` offset) to unix seconds. Fractions are dropped.
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || !(b[10] == b'T' || b[10] == b't' || b[10] == b' ')
    {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    let mut rest = &s[19..];
    if let Some(stripped) = rest.strip_prefix('.') {
        rest = stripped.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let offset = match rest {
        "Z" | "z" => 0,
        _ if rest.len() == 6 && (rest.starts_with('+') || rest.starts_with('-')) => {
            let sign = if rest.starts_with('-') { -1 } else { 1 };
            let oh: i64 = rest.get(1..3)?.parse().ok()?;
            let om: i64 = rest.get(4..6)?.parse().ok()?;
            sign * (oh * 3600 + om * 60)
        }
        _ => return None,
    };
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + sec - offset)
}

/// Unix second of the most recent local midnight, given the zone's offset east
/// of UTC in minutes.
pub fn local_midnight(now: i64, tz_offset_minutes: i32) -> i64 {
    let off = i64::from(tz_offset_minutes) * 60;
    (now + off).div_euclid(86_400) * 86_400 - off
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_instants() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2000-01-01T00:00:00Z"), Some(946_684_800));
        assert_eq!(
            parse_rfc3339("2000-01-01T01:00:00+01:00"),
            Some(946_684_800)
        );
        assert_eq!(parse_rfc3339("2000-01-01T00:00:00.987Z"), Some(946_684_800));
        assert_eq!(parse_rfc3339("2000-02-29T00:00:00Z"), Some(951_782_400));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_rfc3339(""), None);
        assert_eq!(parse_rfc3339("yesterday"), None);
        assert_eq!(parse_rfc3339("2000-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339("2000-01-01T00:00:00"), None);
    }

    #[test]
    fn local_midnight_follows_zone() {
        // 2000-01-01T05:00Z is still Dec 31 in UTC-8 and already Jan 1 in UTC+7.
        let now = 946_684_800 + 5 * 3600;
        assert_eq!(local_midnight(now, 0), 946_684_800);
        assert_eq!(local_midnight(now, -480), 946_684_800 - 86_400 + 8 * 3600);
        assert_eq!(local_midnight(now, 420), 946_684_800 - 7 * 3600);
    }
}
