//! Shared plumbing for the log scanners: find recently written `.jsonl` files,
//! bucket token events into the windows the UI shows, and talk to `curl`.

use crate::UsageWindow;
use crate::timeutil::local_midnight;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// How far back logs are read. Everything shown is at most this old.
pub const HISTORY_SECS: i64 = 7 * 86_400;

pub struct LogFile {
    pub path: PathBuf,
    pub mtime: SystemTime,
    pub len: u64,
}

/// Every `.jsonl` under `root` written since `since_unix_s`, recursively.
pub fn recent_jsonl(root: &Path, since_unix_s: i64) -> Vec<LogFile> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "jsonl")
                && let Ok(mtime) = meta.modified()
                && mtime
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .is_ok_and(|d| d.as_secs() as i64 >= since_unix_s)
            {
                out.push(LogFile {
                    path,
                    mtime,
                    len: meta.len(),
                });
            }
        }
    }
    out
}

/// The windows every agent reports: last 5 hours, since local midnight, 7 days.
pub fn empty_windows(now: i64, tz_offset_minutes: i32) -> Vec<(UsageWindow, i64)> {
    let w = |label: &str, since: i64| {
        (
            UsageWindow {
                label: label.into(),
                ..Default::default()
            },
            since,
        )
    };
    vec![
        w("Last 5 hours", now - 5 * 3600),
        w("Today", local_midnight(now, tz_offset_minutes)),
        w("Last 7 days", now - HISTORY_SECS),
    ]
}

pub fn add_event(
    windows: &mut [(UsageWindow, i64)],
    ts: i64,
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
) {
    for (w, since) in windows.iter_mut() {
        if ts >= *since {
            w.input += input;
            w.output += output;
            w.cache_write += cache_write;
            w.cache_read += cache_read;
            w.requests += 1;
        }
    }
}

/// GET with request headers fed to curl on stdin (`-K -`), so a bearer token is
/// never on the command line where other processes could read it. Returns the
/// status and body.
pub fn curl_get(url: &str, headers: &[String], timeout_secs: u32) -> Result<(u16, String), String> {
    let mut config = String::from("user-agent = \"Look-Launcher\"\n");
    for header in headers {
        if header.contains(['"', '\\', '\n', '\r']) {
            return Err("invalid header value".into());
        }
        config.push_str(&format!("header = \"{header}\"\n"));
    }
    let mut command = Command::new("curl");
    command
        .args([
            "-s",
            "-m",
            &timeout_secs.to_string(),
            "--tlsv1.2",
            "-K",
            "-",
            "-w",
            "\n%{http_code}",
            url,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "linux")]
    command.env_remove("LD_LIBRARY_PATH");
    #[cfg(target_os = "windows")]
    command.creation_flags(crate::detect::CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|e| format!("curl not available: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(config.as_bytes());
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("network request failed".into());
    }
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let (body, status) = text.rsplit_once('\n').ok_or("unreadable response")?;
    let status = status.trim().parse().map_err(|_| "unreadable response")?;
    Ok((status, body.to_string()))
}
