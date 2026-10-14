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

use look_matching::{normalize_for_search, text_match_score_normalized};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

/// Characters of a body line kept in a search hit's snippet.
pub const SNIPPET_CHARS: usize = 80;
/// A hit in the title outranks the same hit in a tag, which outranks the body,
/// so a note named for what you typed comes before one that merely mentions it.
const TITLE_WEIGHT: i64 = 3;
const TAG_WEIGHT: i64 = 2;
const BODY_WEIGHT: i64 = 1;

/// One note matching a query typed in the launcher's main search box.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NoteHit {
    pub id: String,
    /// What the note is called on its card: [`display_title`].
    pub title: String,
    /// The body line the query was found on, or the body's first line when the
    /// match was in the title or a tag. Empty for a note with no body.
    pub snippet: String,
    /// The start of the body, up to [`PREVIEW_CHARS`], for the preview pane to
    /// render as Markdown. A titleless note's first line (its headline) is kept
    /// out. Empty for a note with no body.
    pub preview: String,
    pub tags: Vec<String>,
    pub score: i64,
    pub updated_at_unix_s: i64,
}

/// Characters of body sent along with a hit for the preview pane.
pub const PREVIEW_CHARS: usize = 1200;

/// A note's headline: its title, else its first non-blank line, else
/// "Untitled". Same rule as the /note cards.
pub fn display_title(note: &Note) -> String {
    let title = note.title.trim();
    if !title.is_empty() {
        return title.to_string();
    }
    first_line(&note.body)
        .map(|line| line.chars().take(SNIPPET_CHARS).collect())
        .unwrap_or_else(|| "Untitled".to_string())
}

fn first_line(body: &str) -> Option<&str> {
    body.lines().map(str::trim).find(|line| !line.is_empty())
}

/// The body's non-blank lines below the headline: all of them for a titled
/// note, all but the first for one headed by its first line, so a snippet never
/// repeats the title above it.
fn content_lines(note: &Note) -> impl Iterator<Item = &str> {
    let skip = usize::from(note.title.trim().is_empty());
    note.body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .skip(skip)
}

fn clip(line: &str) -> String {
    let mut out: String = line.chars().take(SNIPPET_CHARS).collect();
    if line.chars().count() > SNIPPET_CHARS {
        out.push('…');
    }
    out
}

/// How often and how lately a note was opened, for [`search_with_opens`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NoteOpens {
    pub count: i64,
    pub last_opened_unix_s: i64,
}

/// Opens counted toward the boost; past this a note is simply "used a lot".
const OPENS_COUNTED: i64 = 8;
const BOOST_PER_OPEN: i64 = 40;
/// Extra for a note opened within the last week, so what you are working on
/// now beats what you used heavily a season ago.
const RECENT_OPEN_BOOST: i64 = 180;
const RECENT_OPEN_WINDOW_S: i64 = 7 * 24 * 60 * 60;

/// At most 500, under the 1,000 between one match tier and the next (a body hit
/// scores 1,000, a tag word 2,000, a title word 3,000), so use reorders notes
/// that match about as well and never lifts a passing mention over a title.
fn open_boost(opens: Option<&NoteOpens>, now_unix_s: i64) -> i64 {
    let Some(opens) = opens else { return 0 };
    let recent = if now_unix_s - opens.last_opened_unix_s <= RECENT_OPEN_WINDOW_S {
        RECENT_OPEN_BOOST
    } else {
        0
    };
    opens.count.clamp(0, OPENS_COUNTED) * BOOST_PER_OPEN + recent
}

/// [`search_with_opens`] with no usage history.
pub fn search(notes: &[Note], query: &str, limit: usize) -> Vec<NoteHit> {
    search_with_opens(notes, &HashMap::new(), 0, query, limit)
}

/// Notes matching `query`, best first, at most `limit`. Every word of the query
/// has to appear in the title, a tag, or the body (case and diacritics folded),
/// so a short query does not drag in every long note; notes opened often or
/// lately rank first among those that match about as well (see
/// [`open_boost`]). A blank query returns the most recently edited notes, which
/// is what an empty `n"` lists.
pub fn search_with_opens(
    notes: &[Note],
    opens: &HashMap<String, NoteOpens>,
    now_unix_s: i64,
    query: &str,
    limit: usize,
) -> Vec<NoteHit> {
    // `#work` means the tag `work`: tags are stored without the `#` that
    // `:note ... #work` has the user type, so the mark is dropped from each word.
    let query = normalize_for_search(query)
        .split_whitespace()
        .map(|word| word.trim_start_matches('#'))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut hits: Vec<NoteHit> = notes
        .iter()
        .filter_map(|note| {
            let title = display_title(note);
            let score = if query.is_empty() {
                0
            } else {
                score_note(note, &title, &query)? + open_boost(opens.get(&note.id), now_unix_s)
            };
            Some(NoteHit {
                id: note.id.clone(),
                snippet: snippet_for(note, &query),
                preview: preview_for(note),
                title,
                tags: note.tags.clone(),
                score,
                updated_at_unix_s: note.updated_at_unix_s,
            })
        })
        .collect();
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.updated_at_unix_s.cmp(&a.updated_at_unix_s))
            .then_with(|| a.id.cmp(&b.id))
    });
    hits.truncate(limit);
    hits
}

/// The note's best score, or `None` when some word of `query` (already
/// normalized) appears nowhere in it. The body may hold the words spread over
/// lines, together with the title and tags.
fn score_note(note: &Note, title: &str, query: &str) -> Option<i64> {
    let title = normalize_for_search(title);
    let title_score = text_match_score_normalized(query, &title).map(|s| s * TITLE_WEIGHT);
    let tag_score = note
        .tags
        .iter()
        .filter_map(|tag| text_match_score_normalized(query, &normalize_for_search(tag)))
        .max()
        .map(|s| s * TAG_WEIGHT);
    if let Some(score) = title_score.max(tag_score) {
        return Some(score);
    }
    let everything =
        normalize_for_search(&format!("{title} {} {}", note.tags.join(" "), note.body));
    text_match_score_normalized(query, &everything).map(|s| s * BODY_WEIGHT)
}

/// The body for the preview pane: from the second non-blank line on when the
/// first one is the note's headline, whole otherwise, clipped to
/// [`PREVIEW_CHARS`]. Line breaks and indentation inside the text are kept,
/// since it is rendered as Markdown.
fn preview_for(note: &Note) -> String {
    let body = note.body.trim();
    let body = if note.title.trim().is_empty() {
        body.split_once('\n').map_or("", |(_, rest)| rest.trim())
    } else {
        body
    };
    body.chars().take(PREVIEW_CHARS).collect()
}

/// The first content line holding a word of `query`, so the row shows why the
/// note matched; else the first content line. Empty when there is none.
fn snippet_for(note: &Note, query: &str) -> String {
    let matching = (!query.is_empty())
        .then(|| {
            content_lines(note).find(|line| {
                let line = normalize_for_search(line);
                query.split_whitespace().any(|word| line.contains(word))
            })
        })
        .flatten();
    matching
        .or_else(|| content_lines(note).next())
        .map(clip)
        .unwrap_or_default()
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
             );

             CREATE TABLE IF NOT EXISTS note_opens (
                 id TEXT PRIMARY KEY,
                 count INTEGER NOT NULL,
                 last_opened_unix_s INTEGER NOT NULL
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
        self.conn
            .execute("DELETE FROM note_opens WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Counts one opening of a note in the editor, for [`search_with_opens`].
    pub fn record_open(&self, id: &str, now_unix_s: i64) -> NoteResult<()> {
        self.conn.execute(
            "INSERT INTO note_opens (id, count, last_opened_unix_s) VALUES (?1, 1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                 count = count + 1,
                 last_opened_unix_s = excluded.last_opened_unix_s",
            params![id, now_unix_s],
        )?;
        Ok(())
    }

    /// Every note's open history, keyed by note id.
    pub fn opens(&self) -> NoteResult<HashMap<String, NoteOpens>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, count, last_opened_unix_s FROM note_opens")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                NoteOpens {
                    count: row.get(1)?,
                    last_opened_unix_s: row.get(2)?,
                },
            ))
        })?;
        let mut out = HashMap::new();
        for row in rows {
            let (id, opens) = row?;
            out.insert(id, opens);
        }
        Ok(out)
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

    fn hit_ids(hits: &[NoteHit]) -> Vec<&str> {
        hits.iter().map(|h| h.id.as_str()).collect()
    }

    #[test]
    fn search_ranks_title_over_tag_over_body() {
        let mut tagged = note("tag", "Shopping", "eggs");
        tagged.tags = vec!["milk".into()];
        let notes = [
            note("body", "Groceries", "remember the milk"),
            tagged,
            note("title", "Milk", "two litres"),
        ];
        assert_eq!(
            hit_ids(&search(&notes, "milk", 10)),
            ["title", "tag", "body"]
        );
    }

    #[test]
    fn opens_reorder_equal_matches_but_never_beat_a_better_tier() {
        let now = 10_000_000;
        let notes = [
            note("used", "Plan B", ""),
            note("fresh", "Plan A", ""),
            note("body", "Misc", "the plan is here"),
        ];
        let store = NoteStore::open_in_memory().unwrap();
        for _ in 0..50 {
            store.record_open("used", now).unwrap();
            store.record_open("body", now).unwrap();
        }
        let opens = store.opens().unwrap();
        assert_eq!(opens["used"].count, 50);
        let ids = hit_ids_owned(search_with_opens(&notes, &opens, now, "plan", 10));
        // Both titles start with "plan"; the used one leads. The body mention,
        // opened just as much, stays below both titles.
        assert_eq!(ids, ["used", "fresh", "body"]);
    }

    #[test]
    fn recent_opens_count_more_than_old_ones() {
        let week = 7 * 24 * 60 * 60;
        let now = 100 * week;
        let mut opens = HashMap::new();
        opens.insert(
            "old".to_string(),
            NoteOpens {
                count: 3,
                last_opened_unix_s: now - 10 * week,
            },
        );
        opens.insert(
            "new".to_string(),
            NoteOpens {
                count: 3,
                last_opened_unix_s: now - 1,
            },
        );
        let notes = [note("old", "Plan", ""), note("new", "Plan", "")];
        let ids = hit_ids_owned(search_with_opens(&notes, &opens, now, "plan", 10));
        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn deleting_a_note_forgets_its_opens() {
        let store = NoteStore::open_in_memory().unwrap();
        store.save(&note("a", "A", "1"), 1).unwrap();
        store.record_open("a", 5).unwrap();
        store.delete("a").unwrap();
        assert!(store.opens().unwrap().is_empty());
    }

    fn hit_ids_owned(hits: Vec<NoteHit>) -> Vec<String> {
        hits.into_iter().map(|h| h.id).collect()
    }

    #[test]
    fn hash_in_the_query_finds_the_tag() {
        let mut n = note("a", "Standup", "notes");
        n.tags = vec!["work".into()];
        let notes = [n];
        assert_eq!(hit_ids(&search(&notes, "#work", 10)), ["a"]);
        assert_eq!(hit_ids(&search(&notes, "#work standup", 10)), ["a"]);
        // A lone `#` is no query at all: everything, newest first.
        assert_eq!(hit_ids(&search(&notes, "#", 10)), ["a"]);
    }

    #[test]
    fn search_needs_every_word_somewhere_in_the_note() {
        let notes = [note("a", "Trip", "book the train\npack a bag")];
        assert_eq!(hit_ids(&search(&notes, "train bag", 10)), ["a"]);
        assert!(search(&notes, "train plane", 10).is_empty());
        // A subsequence is not a match: "tb" is in "Trip ... book".
        assert!(search(&notes, "tb", 10).is_empty());
    }

    #[test]
    fn search_folds_vietnamese_diacritics() {
        let notes = [note("a", "Họp nhóm", "thứ hai")];
        assert_eq!(hit_ids(&search(&notes, "hop nhom", 10)), ["a"]);
        assert_eq!(hit_ids(&search(&notes, "thu hai", 10)), ["a"]);
    }

    #[test]
    fn snippet_shows_the_line_that_matched() {
        let notes = [note(
            "a",
            "Ideas",
            "first thought\nlauncher plugin idea\nlast",
        )];
        assert_eq!(
            search(&notes, "plugin", 10)[0].snippet,
            "launcher plugin idea"
        );
        // A title hit shows the body's opening line instead.
        assert_eq!(search(&notes, "ideas", 10)[0].snippet, "first thought");
    }

    #[test]
    fn untitled_note_is_headed_by_its_first_line_without_repeating_it() {
        let notes = [note("a", "", "\n  Call the bank  \nask about fees")];
        let hit = &search(&notes, "bank", 10)[0];
        assert_eq!(hit.title, "Call the bank");
        assert_eq!(hit.snippet, "ask about fees");
        let alone = [note("b", "", "only line")];
        assert_eq!(search(&alone, "only", 10)[0].snippet, "");
        assert_eq!(display_title(&note("c", " ", " ")), "Untitled");
    }

    #[test]
    fn preview_keeps_markdown_and_drops_a_headline_line() {
        let titled = [note("a", "Plan", "# Steps\n- one\n- two")];
        assert_eq!(
            search(&titled, "plan", 10)[0].preview,
            "# Steps\n- one\n- two"
        );
        let untitled = [note("b", "", "Call the bank\n- fees\n- card")];
        assert_eq!(search(&untitled, "bank", 10)[0].preview, "- fees\n- card");
        let one_line = [note("c", "", "just this")];
        assert_eq!(search(&one_line, "just", 10)[0].preview, "");
        let long = [note("d", "T", &"x".repeat(PREVIEW_CHARS + 50))];
        assert_eq!(
            search(&long, "t", 10)[0].preview.chars().count(),
            PREVIEW_CHARS
        );
    }

    #[test]
    fn long_snippet_is_clipped() {
        let long = "word ".repeat(40);
        let notes = [note("a", "T", &long)];
        let snippet = &search(&notes, "word", 10)[0].snippet;
        assert_eq!(snippet.chars().count(), SNIPPET_CHARS + 1);
        assert!(snippet.ends_with('…'));
    }

    #[test]
    fn blank_query_lists_newest_first_and_limit_applies() {
        let mut old = note("old", "Old", "");
        old.updated_at_unix_s = 1;
        let mut new = note("new", "New", "");
        new.updated_at_unix_s = 9;
        let notes = [old, new];
        assert_eq!(hit_ids(&search(&notes, "  ", 10)), ["new", "old"]);
        assert_eq!(hit_ids(&search(&notes, "", 1)), ["new"]);
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
