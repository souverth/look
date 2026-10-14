//! Tauri command layer over the shared `look-notes` store (core/notes).
//!
//! The /note editor autosaves one note at a time, so unlike /todo this is
//! per-note upsert/delete rather than a full-set save. Notes live in the
//! `notes` table of the app's existing `look.db`.

use crate::state::default_db_path;
use look_notes::{Note, NoteHit, NoteStore, TagColor};
use std::time::{SystemTime, UNIX_EPOCH};

fn open_store() -> Result<NoteStore, String> {
    NoteStore::open(default_db_path()).map_err(|e| e.to_string())
}

fn now_unix_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn notes_list() -> Result<Vec<Note>, String> {
    open_store()?.list().map_err(|e| e.to_string())
}

/// Notes matching a main-search query (or the newest, for a blank `n"`).
#[tauri::command]
pub fn notes_search(query: String, limit: usize) -> Result<Vec<NoteHit>, String> {
    let store = open_store()?;
    let notes = store.list().map_err(|e| e.to_string())?;
    let opens = store.opens().map_err(|e| e.to_string())?;
    Ok(look_notes::search_with_opens(
        &notes,
        &opens,
        now_unix_s(),
        &query,
        limit,
    ))
}

/// Counts an opening of the note in the editor, so search can rank by use.
#[tauri::command]
pub fn notes_record_open(id: String) -> Result<(), String> {
    open_store()?
        .record_open(&id, now_unix_s())
        .map_err(|e| e.to_string())
}

/// Returns the stored note, or null when the note was blank and got removed.
#[tauri::command]
pub fn notes_save(note: Note) -> Result<Option<Note>, String> {
    open_store()?
        .save(&note, now_unix_s())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notes_tag_colors() -> Result<Vec<TagColor>, String> {
    open_store()?.tag_colors().map_err(|e| e.to_string())
}

/// `color` is a palette index, or null to go back to the automatic colour.
#[tauri::command]
pub fn notes_set_tag_color(tag: String, color: Option<i64>) -> Result<(), String> {
    open_store()?
        .set_tag_color(&tag, color)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notes_delete(id: String) -> Result<(), String> {
    open_store()?.delete(&id).map_err(|e| e.to_string())
}
