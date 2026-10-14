//! Tauri command layer over the shared `look-snippets` crate (core/snippets).
//!
//! The file is read on every call: it is a few KB, and an edit then takes effect
//! on the next keystroke with nothing to reload. The first call writes the
//! documented seed, so the file exists for the user to open.

use look_snippets::{Context, Loaded, SnippetHit};
use linows_backend::look_engine;
use std::path::PathBuf;

/// Overrides the location, for dotfiles kept elsewhere and for tests.
const ENV_PATH: &str = "LOOK_SNIPPETS_PATH";
const FILE_NAME: &str = "snippets.toml";

fn path() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var(ENV_PATH) {
        let custom = custom.trim();
        if !custom.is_empty() {
            return Some(PathBuf::from(custom));
        }
    }
    look_engine::config_path::home().map(|home| PathBuf::from(home).join(".look").join(FILE_NAME))
}

/// The snippets, with the seed written first when there is no file yet.
fn load() -> Loaded {
    let Some(path) = path() else {
        return Loaded::default();
    };
    if !path.exists() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // Create-new: another Look starting at the same moment must not have its
        // file replaced by ours.
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .and_then(|mut file| {
                std::io::Write::write_all(&mut file, look_snippets::SEED.as_bytes())
            });
    }
    match std::fs::read_to_string(&path) {
        Ok(source) => look_snippets::parse(&source),
        Err(err) => Loaded {
            snippets: Vec::new(),
            warnings: vec![format!("could not read {}: {err}", path.display())],
        },
    }
}

#[tauri::command]
pub fn snippets_search(query: String, limit: usize) -> Vec<SnippetHit> {
    look_snippets::search(&load().snippets, &query, limit)
}

/// The snippet's text with its placeholders filled from `context`, which the
/// frontend builds: it owns the local clock, and the clipboard history.
#[tauri::command]
pub fn snippets_expand(id: String, context: Context) -> Result<String, String> {
    let loaded = load();
    let snippet = loaded
        .snippets
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("no snippet named \"{id}\""))?;
    Ok(look_snippets::expand(&snippet.text, &context))
}

/// What is wrong with the file, and where it is, for a user who did not launch
/// from a terminal.
#[derive(serde::Serialize)]
pub struct SnippetsInfo {
    pub path: String,
    pub count: usize,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn snippets_info() -> SnippetsInfo {
    let loaded = load();
    SnippetsInfo {
        path: path().map(|p| p.display().to_string()).unwrap_or_default(),
        count: loaded.snippets.len(),
        warnings: loaded.warnings,
    }
}
