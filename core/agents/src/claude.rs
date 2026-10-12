//! Claude Code: token history from `~/.claude/projects/**/*.jsonl`, and (opt-in)
//! the plan's live limits from the OAuth usage endpoint.

use crate::detect::home_dir;
use crate::scan::{HISTORY_SECS, add_event, curl_get, empty_windows, recent_jsonl};
use crate::timeutil::parse_rfc3339;
use crate::{AgentStatus, Meter, Options};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const LIVE_CACHE: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Ev {
    ts: i64,
    /// message id + request id: Claude Code writes the same response more than
    /// once (resumed sessions), and only the first copy counts.
    key: u64,
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
}

type FileCache = HashMap<PathBuf, (SystemTime, u64, Vec<Ev>)>;
static EVENTS: Mutex<Option<FileCache>> = Mutex::new(None);
static LIVE: Mutex<crate::LiveCache> = Mutex::new(None);

fn hash_of(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

pub(crate) fn parse_line(line: &str) -> Option<Ev> {
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let msg = v.get("message")?;
    let usage = msg.get("usage").filter(|u| u.is_object())?;
    let ts = parse_rfc3339(v.get("timestamp")?.as_str()?)?;
    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
    let id = msg.get("id").and_then(Value::as_str).unwrap_or("");
    let req = v.get("requestId").and_then(Value::as_str).unwrap_or("");
    let key = if id.is_empty() && req.is_empty() {
        hash_of(line)
    } else {
        hash_of(&format!("{id}:{req}"))
    };
    Some(Ev {
        ts,
        key,
        input: n("input_tokens"),
        output: n("output_tokens"),
        cache_write: n("cache_creation_input_tokens"),
        cache_read: n("cache_read_input_tokens"),
    })
}

fn events(now: i64) -> Vec<Ev> {
    let Some(root) = home_dir().map(|h| h.join(".claude").join("projects")) else {
        return Vec::new();
    };
    let files = recent_jsonl(&root, now - HISTORY_SECS - 86_400);
    let mut guard = EVENTS.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    let live: HashSet<&PathBuf> = files.iter().map(|f| &f.path).collect();
    cache.retain(|p, _| live.contains(p));

    let mut all = Vec::new();
    for f in &files {
        let fresh = cache
            .get(&f.path)
            .is_some_and(|(m, l, _)| *m == f.mtime && *l == f.len);
        if !fresh {
            let parsed = std::fs::read_to_string(&f.path)
                .map(|text| text.lines().filter_map(parse_line).collect())
                .unwrap_or_default();
            cache.insert(f.path.clone(), (f.mtime, f.len, parsed));
        }
        all.extend(cache[&f.path].2.iter().cloned());
    }
    all
}

pub(crate) fn fill(status: &mut AgentStatus, opts: Options, now: i64) {
    let mut windows = empty_windows(now, opts.tz_offset_minutes);
    let mut seen = HashSet::new();
    for ev in events(now) {
        if seen.insert(ev.key) {
            add_event(
                &mut windows,
                ev.ts,
                ev.input,
                ev.output,
                ev.cache_write,
                ev.cache_read,
            );
        }
    }
    status.windows = windows.into_iter().map(|(w, _)| w).collect();

    if opts.use_api {
        match live_meters(now) {
            Ok(meters) => status.meters = meters,
            Err(msg) => status.note = Some(msg),
        }
    } else {
        status.note = Some("Turn on live quota to see your plan's limit usage.".into());
    }
}

fn live_meters(now: i64) -> Result<Vec<Meter>, String> {
    let mut guard = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, result)) = guard.as_ref()
        && at.elapsed() < LIVE_CACHE
    {
        return result.clone();
    }
    let result = fetch_live(now);
    *guard = Some((Instant::now(), result.clone()));
    result
}

fn fetch_live(now: i64) -> Result<Vec<Meter>, String> {
    let path = home_dir()
        .ok_or("no home directory")?
        .join(".claude")
        .join(".credentials.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|_| "Claude Code isn't signed in with a Claude account.".to_string())?;
    let creds: Value = serde_json::from_str(&text).map_err(|_| "Unreadable Claude credentials.")?;
    let oauth = creds
        .get("claudeAiOauth")
        .ok_or("Claude Code isn't signed in with a Claude account.")?;
    let token = oauth
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or("No Claude access token.")?;
    if oauth
        .get("expiresAt")
        .and_then(Value::as_i64)
        .is_some_and(|ms| ms / 1000 < now)
    {
        return Err("Claude's login expired. Open Claude Code once to refresh it.".into());
    }
    if !token
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-._~+/=".contains(c))
    {
        return Err("Unexpected Claude token format.".into());
    }
    let headers = [
        format!("Authorization: Bearer {token}"),
        "anthropic-beta: oauth-2025-04-20".to_string(),
        "Accept: application/json".to_string(),
    ];
    let (code, body) = curl_get(USAGE_URL, &headers, 8)?;
    match code {
        200..=299 => parse_usage(&body, now),
        401 | 403 => Err("Claude refused the usage request. Sign in again with /login.".into()),
        429 => Err("Claude is rate-limiting usage checks. Try again shortly.".into()),
        c => Err(format!("Claude usage request failed (HTTP {c}).")),
    }
}

fn label_for(key: &str) -> String {
    match key {
        "five_hour" => "5-hour limit".into(),
        "seven_day" => "Weekly limit".into(),
        "seven_day_opus" => "Weekly limit (Opus)".into(),
        "seven_day_sonnet" => "Weekly limit (Sonnet)".into(),
        other => {
            let mut s = other.replace('_', " ");
            if let Some(c) = s.get_mut(0..1) {
                c.make_ascii_uppercase();
            }
            s
        }
    }
}

pub(crate) fn parse_usage(body: &str, _now: i64) -> Result<Vec<Meter>, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "Unreadable usage response.")?;
    let obj = v.as_object().ok_or("Unreadable usage response.")?;
    let mut meters: Vec<(usize, Meter)> = Vec::new();
    for (key, val) in obj {
        let Some(pct) = val.get("utilization").and_then(Value::as_f64) else {
            continue;
        };
        let order = [
            "five_hour",
            "seven_day",
            "seven_day_opus",
            "seven_day_sonnet",
        ]
        .iter()
        .position(|k| k == key)
        .unwrap_or(99);
        meters.push((
            order,
            Meter {
                label: label_for(key),
                used_percent: pct.clamp(0.0, 100.0),
                resets_at_unix_s: val
                    .get("resets_at")
                    .and_then(Value::as_str)
                    .and_then(parse_rfc3339),
                source: "live",
                stale: false,
            },
        ));
    }
    if meters.is_empty() {
        return Err("Claude reported no plan limits for this account.".into());
    }
    meters.sort_by_key(|(o, m)| (*o, m.label.clone()));
    Ok(meters.into_iter().map(|(_, m)| m).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assistant_usage_line() {
        let line = r#"{"type":"assistant","timestamp":"2000-01-01T00:00:00.5Z","requestId":"req_1","message":{"id":"msg_1","usage":{"input_tokens":2,"cache_creation_input_tokens":10,"cache_read_input_tokens":100,"output_tokens":7}}}"#;
        let ev = parse_line(line).expect("event");
        assert_eq!(
            (ev.ts, ev.input, ev.output, ev.cache_write, ev.cache_read),
            (946_684_800, 2, 7, 10, 100)
        );
        assert_eq!(parse_line(line).unwrap().key, ev.key);
    }

    #[test]
    fn ignores_lines_without_usage() {
        assert!(parse_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(parse_line("not json but has \"usage\"").is_none());
    }

    #[test]
    fn parses_oauth_usage_in_display_order() {
        let body = r#"{"seven_day":{"utilization":41.2,"resets_at":"2000-01-02T00:00:00Z"},
            "five_hour":{"utilization":23.5,"resets_at":"2000-01-01T05:00:00.1+00:00"},
            "seven_day_opus":null,"extra_usage":{"is_enabled":false}}"#;
        let m = parse_usage(body, 0).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].label, "5-hour limit");
        assert_eq!(m[0].used_percent, 23.5);
        assert_eq!(m[0].resets_at_unix_s, Some(946_702_800));
        assert_eq!(m[1].label, "Weekly limit");
    }

    #[test]
    fn empty_usage_is_an_error() {
        assert!(parse_usage("{}", 0).is_err());
        assert!(parse_usage("nope", 0).is_err());
    }
}
