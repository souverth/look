//! Finding installed agents: a CLI on PATH, or the config the agent leaves in
//! the home directory.

use crate::{AgentInfo, UsageSupport};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct AgentSpec {
    pub id: &'static str,
    pub name: &'static str,
    /// Executable names to look for on PATH.
    pub bins: &'static [&'static str],
    /// Paths under the home directory that prove the agent is set up. A bare
    /// directory is not enough for agents whose folder other tools also use.
    pub home_markers: &'static [&'static str],
    /// Same, under %APPDATA% (Windows) for GUI agents.
    pub appdata_markers: &'static [&'static str],
    /// The directory shown as "config" in the UI.
    pub config_dir: &'static str,
    pub usage: UsageSupport,
}

pub static SPECS: &[AgentSpec] = &[
    AgentSpec {
        id: "claude",
        name: "Claude Code",
        bins: &["claude"],
        home_markers: &[".claude/settings.json", ".claude/.credentials.json"],
        appdata_markers: &[],
        config_dir: ".claude",
        usage: UsageSupport::Quota,
    },
    AgentSpec {
        id: "codex",
        name: "Codex CLI",
        bins: &["codex"],
        home_markers: &[".codex/config.toml", ".codex/auth.json"],
        appdata_markers: &[],
        config_dir: ".codex",
        usage: UsageSupport::Quota,
    },
    AgentSpec {
        id: "gemini",
        name: "Gemini CLI",
        bins: &["gemini"],
        home_markers: &[".gemini/settings.json", ".gemini/oauth_creds.json"],
        appdata_markers: &[],
        config_dir: ".gemini",
        usage: UsageSupport::None,
    },
    AgentSpec {
        id: "cursor",
        name: "Cursor",
        bins: &["cursor", "cursor-agent"],
        home_markers: &[".cursor"],
        appdata_markers: &["Cursor"],
        config_dir: ".cursor",
        usage: UsageSupport::None,
    },
    AgentSpec {
        id: "copilot",
        name: "GitHub Copilot",
        bins: &["copilot"],
        home_markers: &[".config/github-copilot", ".copilot"],
        appdata_markers: &["GitHub Copilot"],
        config_dir: ".config/github-copilot",
        usage: UsageSupport::None,
    },
    AgentSpec {
        id: "opencode",
        name: "OpenCode",
        bins: &["opencode"],
        home_markers: &[".config/opencode", ".local/share/opencode"],
        appdata_markers: &[],
        config_dir: ".config/opencode",
        usage: UsageSupport::None,
    },
    AgentSpec {
        id: "aider",
        name: "Aider",
        bins: &["aider"],
        home_markers: &[".aider.conf.yml"],
        appdata_markers: &[],
        config_dir: ".aider.conf.yml",
        usage: UsageSupport::None,
    },
];

pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn appdata_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

/// PATH plus the places agent installers drop binaries that a GUI-launched
/// process (whose PATH is shorter than a shell's) would miss.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = home_dir() {
        for extra in [
            ".local/bin",
            ".npm-global/bin",
            ".cargo/bin",
            ".bun/bin",
            ".claude/local",
        ] {
            dirs.push(home.join(extra));
        }
    }
    if let Some(appdata) = appdata_dir() {
        dirs.push(appdata.join("npm"));
    }
    #[cfg(unix)]
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs
}

#[cfg(target_os = "windows")]
const EXTENSIONS: &[&str] = &["exe", "cmd", "bat", "com"];
#[cfg(not(target_os = "windows"))]
const EXTENSIONS: &[&str] = &[""];

pub(crate) fn find_on_path(name: &str) -> Option<PathBuf> {
    for dir in search_dirs() {
        for ext in EXTENSIONS {
            let file = if ext.is_empty() {
                dir.join(name)
            } else {
                dir.join(format!("{name}.{ext}"))
            };
            if file.is_file() {
                return Some(file);
            }
        }
    }
    None
}

static VERSIONS: Mutex<Option<HashMap<PathBuf, Option<String>>>> = Mutex::new(None);

/// `<cli> --version`, first line, cached per path. Bounded so a CLI that opens
/// an interactive prompt cannot hang detection.
fn cli_version(path: &Path) -> Option<String> {
    if let Some(cached) = VERSIONS.lock().ok()?.as_ref().and_then(|m| m.get(path)) {
        return cached.clone();
    }
    let version = run_version(path);
    if let Ok(mut guard) = VERSIONS.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(path.to_path_buf(), version.clone());
    }
    version
}

fn run_version(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(_) => break,
            None if start.elapsed() > Duration::from_secs(3) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    let out = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.chars().take(60).collect())
}

pub(crate) fn detect_all() -> Vec<AgentInfo> {
    let home = home_dir();
    let appdata = appdata_dir();
    SPECS
        .iter()
        .map(|spec| {
            let cli = spec.bins.iter().find_map(|b| find_on_path(b));
            let marker = home
                .as_ref()
                .map(|h| spec.home_markers.iter().any(|m| h.join(m).exists()))
                .unwrap_or(false)
                || appdata
                    .as_ref()
                    .map(|a| spec.appdata_markers.iter().any(|m| a.join(m).exists()))
                    .unwrap_or(false);
            let config = home
                .as_ref()
                .map(|h| h.join(spec.config_dir))
                .filter(|p| p.exists());
            AgentInfo {
                id: spec.id,
                name: spec.name,
                installed: cli.is_some() || marker,
                version: cli.as_deref().and_then(cli_version),
                cli_path: cli.map(|p| p.to_string_lossy().into_owned()),
                config_dir: config.map(|p| p.to_string_lossy().into_owned()),
                usage: spec.usage,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<_> = SPECS.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), SPECS.len());
    }

    #[test]
    fn missing_binary_is_not_found() {
        assert!(find_on_path("definitely-not-a-real-agent-binary").is_none());
    }
}
