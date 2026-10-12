//! Tauri command layer over the shared `look-agents` crate (core/agents).
//!
//! Scanning logs and spawning `codex app-server` block, so the work runs on the
//! blocking pool and never on the UI thread.

use look_agents::{AgentStatus, Options};
use tauri::async_runtime;

/// Every known agent with detection, plus usage for the installed ones.
/// `use_api` allows the live tier (vendor limits); `tz_offset_minutes` is the
/// local zone's offset east of UTC, for the "Today" window.
#[tauri::command]
pub async fn agents_status(
    use_api: bool,
    tz_offset_minutes: i32,
) -> Result<Vec<AgentStatus>, String> {
    async_runtime::spawn_blocking(move || {
        look_agents::status_all(Options {
            use_api,
            tz_offset_minutes,
        })
    })
    .await
    .map_err(|e| e.to_string())
}
