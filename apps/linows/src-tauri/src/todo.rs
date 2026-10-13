//! Tauri command layer over the shared `look-todo` store (core/todo).
//!
//! Same contract as the macOS FFI bridge: the frontend loads the full
//! task set, edits it in memory, and writes the whole set back on Save.
//! Tasks live in the `todo_tasks` table of the app's existing `look.db`.

use crate::state::default_db_path;
use look_todo::{TodoHit, TodoStore, TodoTask};

fn open_store() -> Result<TodoStore, String> {
    TodoStore::open(default_db_path()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn todo_list() -> Result<Vec<TodoTask>, String> {
    open_store()?.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn todo_save(tasks: Vec<TodoTask>) -> Result<(), String> {
    open_store()?.save(&tasks).map_err(|e| e.to_string())
}

/// Open tasks matching a main-search query. `since` is the earliest day still
/// worth showing, from the frontend, which owns the local calendar.
#[tauri::command]
pub fn todo_search(query: String, since: String, limit: usize) -> Result<Vec<TodoHit>, String> {
    let tasks = open_store()?
        .list_open_since(&since)
        .map_err(|e| e.to_string())?;
    Ok(look_todo::search(&tasks, &query, &since, limit))
}
