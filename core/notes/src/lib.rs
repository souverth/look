//! Shared quick-notes backend for Look.
//!
//! Persists the /note command's notes in SQLite next to everything else in
//! the app's `look.db`. Unlike `look-todo` (full-set load/save), notes are
//! written one at a time: the editor autosaves the note being typed, and a
//! whole-set replace would make every keystroke rewrite every note.
//!
//! A note is a title plus a Markdown body. Both may be empty on their own,
//! but a note with neither is dropped on save, so opening "New note" and
//! backing out leaves nothing behind.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};
use std::path::Path;

/// Upper bound on a note body, in bytes. A brain-dump is text; this is far
/// past anything typed by hand and keeps a stray paste from bloating look.db.
pub const MAX_BODY_BYTES: usize = 256 * 1024;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_TAGS: usize = 8;
pub const MAX_TAG_CHARS: usize = 24;
/// Number of colours the client's tag palette offers; picks outside it are
/// ignored rather than stored.
pub const TAG_PALETTE_SIZE: i64 = 10;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagColor {
    pub tag: String,
    pub color: i64,
}

#[derive(Debug)]
pub enum NoteError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    TooLarge,
}

impl Display for NoteError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            NoteError::Io(err) => write!(f, "io error: {err}"),
            NoteError::Sql(err) => write!(f, "sqlite error: {err}"),
            NoteError::TooLarge => {
                write!(f, "note is too large (limit {} KB)", MAX_BODY_BYTES / 1024)
            }
        }
    }
}

impl std::error::Error for NoteError {}

impl From<std::io::Error> for NoteError {
    fn from(value: std::io::Error) -> Self {
        NoteError::Io(value)
    }
}

impl From<rusqlite::Error> for NoteError {
    fn from(value: rusqlite::Error) -> Self {
        NoteError::Sql(value)
    }
}

pub type NoteResult<T> = Result<T, NoteError>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    /// Free-form labels, normalized by [`normalize_tags`] on save.
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at_unix_s: i64,
    pub updated_at_unix_s: i64,
}

/// Trims, lowercases, drops commas/blanks and duplicates, and caps the count
/// and length, so "Dev", " dev " and "dev," are one tag and filtering by tag
/// never has to guess at spelling.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in tags {
        let tag: String = raw
            .replace([',', '#'], "")
            .trim()
            .to_lowercase()
            .chars()
            .take(MAX_TAG_CHARS)
            .collect();
        if !tag.is_empty() && !out.contains(&tag) {
            out.push(tag);
        }
        if out.len() == MAX_TAGS {
            break;
        }
    }
    out
}

// Tags are stored as one newline-joined column; a tag never contains one.
fn encode_tags(tags: &[String]) -> String {
    tags.join("\n")
}

fn decode_tags(raw: &str) -> Vec<String> {
    raw.split('\n')
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect()
}

pub struct NoteStore {
    conn: Connection,
}

impl NoteStore {
    pub fn open(path: impl AsRef<Path>) -> NoteResult<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let store = Self {
            conn: Connection::open(path)?,
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> NoteResult<Self> {
        let store = Self {
            conn: Connection::open_in_memory()?,
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> NoteResult<()> {
        self.conn.execute_batch(
            // Shares look.db with the engine's connection; see look-todo.
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 2000;

             CREATE TABLE IF NOT EXISTS notes (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 body TEXT NOT NULL,
                 tags TEXT NOT NULL DEFAULT '',
                 created_at_unix_s INTEGER NOT NULL,
                 updated_at_unix_s INTEGER NOT NULL
             );

             CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at_unix_s);

             CREATE TABLE IF NOT EXISTS note_tag_colors (
                 tag TEXT PRIMARY KEY,
                 color INTEGER NOT NULL
             );",
        )?;

        // Notes created before tags existed lack the column.
        let has_tags = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'tags'",
            [],
            |row| row.get::<_, i64>(0).map(|n| n > 0),
        )?;
        if !has_tags {
            self.conn
                .execute_batch("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '';")?;
        }
        Ok(())
    }

    /// Every note, most recently edited first.
    pub fn list(&self) -> NoteResult<Vec<Note>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, body, tags, created_at_unix_s, updated_at_unix_s
             FROM notes
             ORDER BY updated_at_unix_s DESC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                body: row.get(2)?,
                tags: decode_tags(&row.get::<_, String>(3)?),
                created_at_unix_s: row.get(4)?,
                updated_at_unix_s: row.get(5)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Inserts or updates one note and returns it as stored. `created_at` is
    /// kept from the existing row when there is one, so a client that lost
    /// track of it cannot rewrite history. A note with a blank title and a
    /// blank body is deleted instead (returns `None`).
    pub fn save(&self, note: &Note, now_unix_s: i64) -> NoteResult<Option<Note>> {
        let title: String = note.title.trim().chars().take(MAX_TITLE_CHARS).collect();
        if note.body.len() > MAX_BODY_BYTES {
            return Err(NoteError::TooLarge);
        }
        if title.is_empty() && note.body.trim().is_empty() {
            self.delete(&note.id)?;
            return Ok(None);
        }

        let tags = normalize_tags(&note.tags);
        let created_at: Option<i64> = self
            .conn
            .query_row(
                "SELECT created_at_unix_s FROM notes WHERE id = ?1",
                params![note.id],
                |row| row.get(0),
            )
            .optional()?;
        let created_at = created_at.unwrap_or(note.created_at_unix_s);

        self.conn.execute(
            "INSERT INTO notes (id, title, body, tags, created_at_unix_s, updated_at_unix_s)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 title = excluded.title,
                 body = excluded.body,
                 tags = excluded.tags,
                 updated_at_unix_s = excluded.updated_at_unix_s",
            params![
                note.id,
                title,
                note.body,
                encode_tags(&tags),
                created_at,
                now_unix_s
            ],
        )?;
        Ok(Some(Note {
            id: note.id.clone(),
            title,
            body: note.body.clone(),
            tags,
            created_at_unix_s: created_at,
            updated_at_unix_s: now_unix_s,
        }))
    }

    /// Colours the user picked for tags, as palette indexes. A tag with no
    /// row has no pick, and the client derives a colour from its name.
    pub fn tag_colors(&self) -> NoteResult<Vec<TagColor>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag, color FROM note_tag_colors ORDER BY tag")?;
        let rows = stmt.query_map([], |row| {
            Ok(TagColor {
                tag: row.get(0)?,
                color: row.get(1)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Sets a tag's colour (`Some(index)`, 0..TAG_PALETTE_SIZE) or clears the
    /// pick (`None`) so it falls back to the name-derived colour.
    pub fn set_tag_color(&self, tag: &str, color: Option<i64>) -> NoteResult<()> {
        let tag = normalize_tags(&[tag.to_string()]).pop().unwrap_or_default();
        if tag.is_empty() {
            return Ok(());
        }
        match color {
            Some(c) if (0..TAG_PALETTE_SIZE).contains(&c) => {
                self.conn.execute(
                    "INSERT INTO note_tag_colors (tag, color) VALUES (?1, ?2)
                     ON CONFLICT(tag) DO UPDATE SET color = excluded.color",
                    params![tag, c],
                )?;
            }
            _ => {
                self.conn
                    .execute("DELETE FROM note_tag_colors WHERE tag = ?1", params![tag])?;
            }
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> NoteResult<()> {
        self.conn
            .execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str, body: &str) -> Note {
        Note {
            id: id.into(),
            title: title.into(),
            body: body.into(),
            tags: Vec::new(),
            created_at_unix_s: 100,
            updated_at_unix_s: 100,
        }
    }

    #[test]
    fn save_then_list_round_trips_newest_first() {
        let store = NoteStore::open_in_memory().unwrap();
        store.save(&note("a", "First", "one"), 10).unwrap();
        store.save(&note("b", "Second", "two"), 20).unwrap();
        let ids: Vec<_> = store.list().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, ["b", "a"]);
    }

    #[test]
    fn editing_bumps_updated_and_keeps_created() {
        let store = NoteStore::open_in_memory().unwrap();
        store.save(&note("a", "T", "v1"), 10).unwrap();
        let mut edited = note("a", "T", "v2");
        edited.created_at_unix_s = 999;
        let saved = store.save(&edited, 50).unwrap().unwrap();
        assert_eq!(saved.created_at_unix_s, 100);
        assert_eq!(saved.updated_at_unix_s, 50);
        assert_eq!(store.list().unwrap()[0].body, "v2");
    }

    #[test]
    fn empty_note_is_removed_not_stored() {
        let store = NoteStore::open_in_memory().unwrap();
        store.save(&note("a", "T", "x"), 10).unwrap();
        assert!(store.save(&note("a", "  ", " \n "), 20).unwrap().is_none());
        assert!(store.list().unwrap().is_empty());
        assert!(store.save(&note("new", "", ""), 20).unwrap().is_none());
    }

    #[test]
    fn title_is_trimmed_and_capped() {
        let store = NoteStore::open_in_memory().unwrap();
        let long = "x".repeat(MAX_TITLE_CHARS + 50);
        let saved = store
            .save(&note("a", &format!("  {long}  "), ""), 1)
            .unwrap()
            .unwrap();
        assert_eq!(saved.title.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn oversized_body_is_rejected() {
        let store = NoteStore::open_in_memory().unwrap();
        let big = "a".repeat(MAX_BODY_BYTES + 1);
        assert!(matches!(
            store.save(&note("a", "T", &big), 1),
            Err(NoteError::TooLarge)
        ));
    }

    #[test]
    fn tags_are_normalized_and_round_trip() {
        let store = NoteStore::open_in_memory().unwrap();
        let mut n = note("a", "T", "x");
        n.tags = ["Dev", " dev ", "#idea,", "", "Idea"]
            .map(String::from)
            .to_vec();
        let saved = store.save(&n, 1).unwrap().unwrap();
        assert_eq!(saved.tags, ["dev", "idea"]);
        assert_eq!(store.list().unwrap()[0].tags, ["dev", "idea"]);
    }

    #[test]
    fn tag_color_set_update_clear() {
        let store = NoteStore::open_in_memory().unwrap();
        store.set_tag_color("Dev", Some(3)).unwrap();
        store.set_tag_color("dev", Some(5)).unwrap();
        let colors = store.tag_colors().unwrap();
        assert_eq!(
            colors,
            [TagColor {
                tag: "dev".into(),
                color: 5
            }]
        );
        store.set_tag_color("dev", Some(99)).unwrap(); // out of palette: clears
        assert!(store.tag_colors().unwrap().is_empty());
        store.set_tag_color("dev", Some(1)).unwrap();
        store.set_tag_color("dev", None).unwrap();
        assert!(store.tag_colors().unwrap().is_empty());
    }

    #[test]
    fn tags_are_capped() {
        let tags: Vec<String> = (0..20).map(|i| format!("t{i}")).collect();
        assert_eq!(normalize_tags(&tags).len(), MAX_TAGS);
    }

    #[test]
    fn database_without_tags_column_is_migrated() {
        let store = NoteStore::open_in_memory().unwrap();
        store
            .conn
            .execute_batch(
                "DROP TABLE notes;
            CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
                created_at_unix_s INTEGER NOT NULL, updated_at_unix_s INTEGER NOT NULL);
            INSERT INTO notes VALUES ('old', 'Old', 'b', 1, 2);",
            )
            .unwrap();
        store.migrate().unwrap();
        let notes = store.list().unwrap();
        assert_eq!(notes[0].id, "old");
        assert!(notes[0].tags.is_empty());
    }

    #[test]
    fn delete_removes_only_that_note() {
        let store = NoteStore::open_in_memory().unwrap();
        store.save(&note("a", "A", "1"), 1).unwrap();
        store.save(&note("b", "B", "2"), 2).unwrap();
        store.delete("a").unwrap();
        let ids: Vec<_> = store.list().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, ["b"]);
    }
}
