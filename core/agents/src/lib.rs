//! Coding-agent detection and usage/quota for Look's /agents command.
//!
//! Two tiers, so the default never touches credentials or the network:
//!
//! * **Local** (always): detect installed agents, and read the usage state they
//!   already keep on disk (Claude Code's `projects/**/*.jsonl`, Codex's
//!   `sessions/**/rollout-*.jsonl`). This is token accounting plus whatever rate
//!   limits the agent itself recorded; it is only as fresh as the agent's last
//!   write. Same approach as Orca's usage readout.
//! * **Live** (opt-in via [`Options::use_api`]): ask the vendor for the plan's
//!   real limits. Codex via its own `codex app-server` JSON-RPC
//!   (`account/rateLimits/read`, auth handled by the CLI); Claude via the OAuth
//!   usage endpoint with the access token Claude Code already stored.

mod claude;
mod codex;
mod detect;
mod scan;
mod timeutil;

use serde::Serialize;
use std::time::Instant;

pub use detect::{AgentSpec, SPECS};

/// A live (vendor-asked) answer and when it was fetched; each agent keeps one so
/// a burst of refreshes asks the vendor once.
pub(crate) type LiveCache = Option<(Instant, Result<Vec<Meter>, String>)>;

/// How much usage data Look can show for an agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageSupport {
    /// Token history plus plan limits (local and/or live).
    Quota,
    /// Detection only; the agent exposes nothing Look can read.
    None,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub cli_path: Option<String>,
    pub version: Option<String>,
    pub config_dir: Option<String>,
    pub usage: UsageSupport,
}

/// Tokens spent in one time window.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct UsageWindow {
    pub label: String,
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub requests: u64,
}

/// A plan limit: how much of a rate-limit window is used.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Meter {
    pub label: String,
    pub used_percent: f64,
    pub resets_at_unix_s: Option<i64>,
    /// "live" (asked the vendor just now) or "log" (last value the agent recorded).
    pub source: &'static str,
    /// A "log" meter whose window already reset: the number is history.
    pub stale: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentStatus {
    #[serde(flatten)]
    pub info: AgentInfo,
    pub windows: Vec<UsageWindow>,
    pub meters: Vec<Meter>,
    pub note: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    /// Allow the live tier (network / spawning the agent's own server).
    pub use_api: bool,
    /// Local zone's offset east of UTC, in minutes, for "today".
    pub tz_offset_minutes: i32,
}

/// Every known agent with its detection result. Cheap: PATH and file checks
/// plus a cached `--version`.
pub fn detect() -> Vec<AgentInfo> {
    detect::detect_all()
}

/// Detection plus usage for every installed agent.
pub fn status_all(opts: Options) -> Vec<AgentStatus> {
    let now = timeutil::now_unix_s();
    detect::detect_all()
        .into_iter()
        .map(|info| {
            let mut status = AgentStatus {
                info,
                windows: Vec::new(),
                meters: Vec::new(),
                note: None,
            };
            if status.info.installed {
                match status.info.id {
                    "claude" => claude::fill(&mut status, opts, now),
                    "codex" => codex::fill(&mut status, opts, now),
                    _ => {
                        status.note =
                            Some("Detected. This agent keeps no usage data Look can read.".into())
                    }
                }
            }
            status
        })
        .collect()
}

pub(crate) fn window_label(minutes: i64) -> String {
    match minutes {
        300 => "5-hour limit".into(),
        10_080 => "Weekly limit".into(),
        1_440 => "Daily limit".into(),
        m if m % 1_440 == 0 => format!("{}-day limit", m / 1_440),
        m if m % 60 == 0 => format!("{}-hour limit", m / 60),
        m => format!("{m}-minute limit"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_labels() {
        assert_eq!(window_label(300), "5-hour limit");
        assert_eq!(window_label(10_080), "Weekly limit");
        assert_eq!(window_label(2_880), "2-day limit");
        assert_eq!(window_label(90), "90-minute limit");
    }
}
