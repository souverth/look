//! Codex CLI: token history and the last rate limits it recorded from
//! `~/.codex/sessions/**/rollout-*.jsonl`, and (opt-in) the plan's live limits
//! from Codex's own `codex app-server` (`account/rateLimits/read`). The CLI
//! owns authentication there, so Look never reads Codex credentials.

use crate::detect::home_dir;
use crate::scan::{HISTORY_SECS, add_event, empty_windows, recent_jsonl};
use crate::timeutil::parse_rfc3339;
use crate::{AgentStatus, Meter, Options, window_label};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant, SystemTime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const LIVE_CACHE: Duration = Duration::from_secs(60);
const RPC_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Ev {
    ts: i64,
    input: u64, // uncached input
    cached: u64,
    output: u64,
}

/// One rate-limit window as the log or the RPC reports it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Limit {
    used_percent: f64,
    window_minutes: Option<i64>,
    resets_at: Option<i64>,
    key: &'static str,
}

#[derive(Clone, Debug, Default)]
struct FileData {
    events: Vec<Ev>,
    /// Newest rate-limit observation in the file: (timestamp, windows).
    limits: Option<(i64, Vec<Limit>)>,
}

type FileCache = HashMap<PathBuf, (SystemTime, u64, FileData)>;
static FILES: Mutex<Option<FileCache>> = Mutex::new(None);
static LIVE: Mutex<crate::LiveCache> = Mutex::new(None);

fn field<'a>(v: &'a Value, names: &[&str]) -> Option<&'a Value> {
    names
        .iter()
        .find_map(|n| v.get(*n))
        .filter(|x| !x.is_null())
}

/// `primary` / `secondary` of a rate-limit object, in either the log's
/// snake_case or the RPC's camelCase.
pub(crate) fn parse_limits(rl: &Value, observed_at: i64) -> Vec<Limit> {
    let mut out = Vec::new();
    for key in ["primary", "secondary"] {
        let Some(w) = rl.get(key).filter(|w| w.is_object()) else {
            continue;
        };
        let Some(used) = field(w, &["used_percent", "usedPercent"]).and_then(Value::as_f64) else {
            continue;
        };
        let resets_at = field(w, &["resets_at", "resetsAt"])
            .and_then(Value::as_i64)
            .or_else(|| {
                field(w, &["resets_in_seconds", "resetsInSeconds"])
                    .and_then(Value::as_i64)
                    .map(|s| observed_at + s)
            });
        out.push(Limit {
            used_percent: used.clamp(0.0, 100.0),
            window_minutes: field(
                w,
                &["window_minutes", "windowDurationMins", "windowMinutes"],
            )
            .and_then(Value::as_i64),
            resets_at,
            key,
        });
    }
    out
}

fn parse_file(text: &str) -> FileData {
    let mut data = FileData::default();
    let mut prev_total = None;
    for line in text.lines() {
        if !line.contains("token_count") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(ts) = v
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339)
        else {
            continue;
        };
        let Some(p) = v
            .get("payload")
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("token_count"))
        else {
            continue;
        };
        if let Some(info) = p.get("info").filter(|i| i.is_object()) {
            let total = info
                .pointer("/total_token_usage/total_tokens")
                .and_then(Value::as_u64);
            // Codex re-emits the same token_count; count each total once.
            if total.is_none() || total != prev_total {
                prev_total = total;
                let n = |k: &str| {
                    info.pointer(&format!("/last_token_usage/{k}"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                };
                let (input, cached) = (n("input_tokens"), n("cached_input_tokens"));
                data.events.push(Ev {
                    ts,
                    input: input.saturating_sub(cached),
                    cached,
                    output: n("output_tokens"),
                });
            }
        }
        if let Some(rl) = p.get("rate_limits").filter(|r| r.is_object()) {
            let limits = parse_limits(rl, ts);
            if !limits.is_empty() {
                data.limits = Some((ts, limits));
            }
        }
    }
    data
}

fn scan(now: i64) -> Vec<FileData> {
    let Some(root) = home_dir().map(|h| h.join(".codex").join("sessions")) else {
        return Vec::new();
    };
    let files = recent_jsonl(&root, now - HISTORY_SECS - 86_400);
    let mut guard = FILES.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    cache.retain(|p, _| files.iter().any(|f| &f.path == p));
    let mut out = Vec::new();
    for f in &files {
        let fresh = cache
            .get(&f.path)
            .is_some_and(|(m, l, _)| *m == f.mtime && *l == f.len);
        if !fresh {
            let data = std::fs::read_to_string(&f.path)
                .map(|t| parse_file(&t))
                .unwrap_or_default();
            cache.insert(f.path.clone(), (f.mtime, f.len, data));
        }
        out.push(cache[&f.path].2.clone());
    }
    out
}

fn meter(limit: &Limit, source: &'static str, now: i64) -> Meter {
    Meter {
        label: limit
            .window_minutes
            .map(window_label)
            .unwrap_or_else(|| limit.key.to_string()),
        used_percent: limit.used_percent,
        resets_at_unix_s: limit.resets_at,
        source,
        stale: source == "log" && limit.resets_at.is_some_and(|r| r < now),
    }
}

pub(crate) fn fill(status: &mut AgentStatus, opts: Options, now: i64) {
    let data = scan(now);
    let mut windows = empty_windows(now, opts.tz_offset_minutes);
    for ev in data.iter().flat_map(|d| &d.events) {
        add_event(&mut windows, ev.ts, ev.input, ev.output, 0, ev.cached);
    }
    status.windows = windows.into_iter().map(|(w, _)| w).collect();

    if opts.use_api {
        match status.info.cli_path.as_deref() {
            Some(cli) => match live_meters(Path::new(cli)) {
                Ok(m) => {
                    status.meters = m;
                    return;
                }
                Err(msg) => status.note = Some(msg),
            },
            None => status.note = Some("Live limits need the codex CLI on PATH.".into()),
        }
    }

    // Fall back to what Codex last wrote to its session log.
    let newest = data
        .iter()
        .filter_map(|d| d.limits.as_ref())
        .max_by_key(|(ts, _)| *ts);
    if let Some((_, limits)) = newest {
        status.meters = limits.iter().map(|l| meter(l, "log", now)).collect();
        if status.note.is_none() && status.meters.iter().all(|m| m.stale) {
            status.note = Some("Limits are from Codex's last session and have since reset.".into());
        }
    } else if status.note.is_none() {
        status.note = Some(if status.windows.iter().all(|w| w.requests == 0) {
            "No Codex sessions in the last 7 days.".into()
        } else {
            "Codex hasn't recorded plan limits. Turn on live quota to ask it directly.".into()
        });
    }
}

// --- Live: codex app-server JSON-RPC over stdio ---

fn live_meters(cli: &Path) -> Result<Vec<Meter>, String> {
    let mut guard = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, r)) = guard.as_ref()
        && at.elapsed() < LIVE_CACHE
    {
        return r.clone();
    }
    let result = rpc_limits(cli);
    *guard = Some((Instant::now(), result.clone()));
    result
}

/// Kills the server however the call ends.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait_for(rx: &mpsc::Receiver<String>, id: i64, deadline: Instant) -> Result<Value, String> {
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let line = rx
            .recv_timeout(left)
            .map_err(|_| "Codex didn't answer in time.".to_string())?;
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if v.get("id").and_then(Value::as_i64) != Some(id) {
            continue; // a notification or another reply
        }
        if let Some(err) = v.get("error") {
            let msg = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("request failed");
            return Err(format!("Codex: {msg}"));
        }
        return Ok(v);
    }
}

fn rpc_limits(cli: &Path) -> Result<Vec<Meter>, String> {
    let mut command = Command::new(cli);
    command
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    command.creation_flags(crate::detect::CREATE_NO_WINDOW);
    let mut server = Server(
        command
            .spawn()
            .map_err(|e| format!("Couldn't start codex: {e}"))?,
    );
    let mut stdin = server.0.stdin.take().ok_or("codex has no stdin")?;
    let stdout = server.0.stdout.take().ok_or("codex has no stdout")?;

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + RPC_TIMEOUT;
    let mut send = |v: Value| {
        writeln!(stdin, "{v}")
            .and_then(|_| stdin.flush())
            .map_err(|e| e.to_string())
    };
    send(json!({"id": 1, "method": "initialize",
        "params": {"clientInfo": {"name": "look", "title": "Look", "version": "0.1.0"}}}))?;
    wait_for(&rx, 1, deadline)?;
    send(json!({"method": "initialized", "params": {}}))?;
    send(json!({"id": 2, "method": "account/rateLimits/read"}))?;
    let reply = wait_for(&rx, 2, deadline)?;
    meters_from_rpc(&reply)
}

pub(crate) fn meters_from_rpc(reply: &Value) -> Result<Vec<Meter>, String> {
    let result = reply.get("result").ok_or("Unreadable Codex reply.")?;
    let rl = field(result, &["rateLimits", "rate_limits"]).unwrap_or(result);
    let limits = parse_limits(rl, 0);
    if limits.is_empty() {
        return Err("Codex reports no plan limits (signed in with an API key?).".into());
    }
    Ok(limits.iter().map(|l| meter(l, "live", 0)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_events_and_dedupes_repeats() {
        let ev = |ts: &str, total: u64| {
            format!(
                r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"total_tokens":{total}}},"last_token_usage":{{"input_tokens":100,"cached_input_tokens":40,"output_tokens":5}}}},"rate_limits":{{"primary":{{"used_percent":12.5,"window_minutes":300,"resets_at":946702800}},"secondary":null}}}}}}"#
            )
        };
        let text = format!(
            "{}\n{}\n{}\n",
            ev("2000-01-01T00:00:00Z", 10),
            ev("2000-01-01T00:00:01Z", 10),
            ev("2000-01-01T00:00:02Z", 20)
        );
        let data = parse_file(&text);
        assert_eq!(data.events.len(), 2);
        assert_eq!(
            data.events[0],
            Ev {
                ts: 946_684_800,
                input: 60,
                cached: 40,
                output: 5
            }
        );
        let (ts, limits) = data.limits.unwrap();
        assert_eq!(ts, 946_684_802);
        assert_eq!(limits[0].window_minutes, Some(300));
        assert_eq!(limits[0].used_percent, 12.5);
    }

    #[test]
    fn null_info_and_limits_are_skipped() {
        let line = r#"{"timestamp":"2000-01-01T00:00:00Z","payload":{"type":"token_count","info":null,"rate_limits":{"primary":null,"secondary":null}}}"#;
        let data = parse_file(line);
        assert!(data.events.is_empty());
        assert!(data.limits.is_none());
    }

    #[test]
    fn rpc_reply_in_camel_case() {
        let reply = json!({"id": 2, "result": {"rateLimits": {
            "primary": {"usedPercent": 37, "windowDurationMins": 300, "resetsAt": 1738425600},
            "secondary": {"usedPercent": 80.5, "windowDurationMins": 10080, "resetsAt": 1738900000}}}});
        let m = meters_from_rpc(&reply).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(
            (m[0].label.as_str(), m[0].used_percent, m[0].source),
            ("5-hour limit", 37.0, "live")
        );
        assert_eq!(m[1].label, "Weekly limit");
        assert!(!m[1].stale);
    }

    #[test]
    fn rpc_reply_without_limits_is_an_error() {
        assert!(
            meters_from_rpc(&json!({"id": 2, "result": {"rateLimits": {"primary": null}}}))
                .is_err()
        );
    }

    #[test]
    fn relative_reset_uses_observation_time() {
        let rl = json!({"primary": {"used_percent": 1.0, "resets_in_seconds": 60}});
        assert_eq!(parse_limits(&rl, 1000)[0].resets_at, Some(1060));
    }
}
