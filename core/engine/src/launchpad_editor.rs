//! What the Super Actions editor reads and writes.
//!
//! `launchpad.rs` turns `~/.look/super-actions.toml` into tiles; this module is
//! the other direction. The editor works on an [`EditorModel`] (tiles with a
//! cell and a size, plus the user's own tile definitions), and [`compose`]
//! turns that back into a file.
//!
//! The file stays the source of truth and stays hand-editable, so saving does
//! not rewrite it from scratch: only the `layout` drawing and the `[tiles.*]`
//! tables are replaced, and every other line - the seeded documentation, the
//! user's own comments - is kept as it was. The previous file is copied to
//! `super-actions.toml.bak` first.
//!
//! Validation is not reimplemented here. A draft is composed and handed to the
//! same [`launchpad::resolve`] the app uses, so the editor warns about exactly
//! what the app would drop, in the app's own words.

use crate::launchpad::{self, MAX_COLUMNS, MAX_ROWS, TileValue};
use look_qactions::{TileRole, launchpad_layout, min_span};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A built-in or user tile placed on the grid. `id` is the token in the drawing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditorTile {
    pub id: String,
    pub col: u8,
    pub row: u8,
    pub w: u8,
    pub h: u8,
}

/// One `[tiles.<id>]` entry, every field as the text the user typed. Empty
/// means "not set", which is also how the file reads.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct EditorCustom {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub refresh: String,
    #[serde(default)]
    pub press: String,
    #[serde(default)]
    pub confirm: String,
    #[serde(default)]
    pub mnemonic: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditorModel {
    pub columns: u8,
    pub rows: u8,
    pub tiles: Vec<EditorTile>,
    /// Every tile definition, placed or not: an unplaced one is inert by design
    /// and is how a user parks a tile while trying the grid without it.
    pub custom: Vec<EditorCustom>,
}

/// A built-in tile, for the editor's palette.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogEntry {
    pub id: String,
    pub title: String,
    pub description: &'static str,
    pub min_w: u8,
    pub min_h: u8,
    pub default_w: u8,
    pub default_h: u8,
    pub mnemonic: Option<String>,
    /// "toggle" | "action" | "info" | "media" | "weather" | "slot"
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorState {
    pub model: EditorModel,
    pub default_model: EditorModel,
    pub catalog: Vec<CatalogEntry>,
    pub warnings: Vec<String>,
    pub path: String,
    pub file_exists: bool,
    pub max_columns: u8,
    pub max_rows: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaveOutcome {
    pub path: String,
    pub warnings: Vec<String>,
    /// The existing file could not be edited in place (its tables were written
    /// in a form this editor does not touch), so it was rewritten from the
    /// seeded template. The old file is in the `.bak`.
    pub rewrote: bool,
}

/// What running a tile's `value` command printed.
#[derive(Debug, Clone, Serialize)]
pub struct ValueTest {
    pub ok: bool,
    pub output: String,
    pub parsed: Option<TileValue>,
    pub error: Option<String>,
}

const TEST_TIMEOUT: Duration = Duration::from_secs(5);
const TEST_MAX_BYTES: usize = 16 * 1024;

// --- The catalog ---

fn describe(id: &str) -> &'static str {
    match id {
        "lslot" => "Rotates between your running Pomodoro, today's open todos and the clock.",
        "bluetooth" => "Shows Bluetooth state; press to switch it on or off.",
        "wifi" => "Shows Wi-Fi state; press to switch it on or off.",
        "battery" => "Battery level and whether it is charging. Read-only.",
        "theme" => "Switches between dark and light.",
        "keepawake" => "Stops the machine from sleeping while it is on.",
        "screensaver" => "Starts the screensaver.",
        "weather" => "Current conditions and temperature for where you are. Read-only.",
        "mic" => "Mutes or unmutes the microphone.",
        "restart" => "Restarts the machine. Asks first, so a stray key cannot.",
        "shutdown" => "Shuts the machine down. Asks first, so a stray key cannot.",
        "nowplaying" => "The current track, with play and pause.",
        "agents" => {
            "How much of each coding agent's quota is used. Press to open /agents. Shows more when drawn larger."
        }
        "todo" => "Today's tasks done and still open. Press to open /todo.",
        "pomo" => {
            "Your focus timer: a live countdown while a session runs. Press to start or pause."
        }
        "speed" => "Your last internet speed result. Press to run a new test (about 15 seconds).",
        "notes" => "How many notes you have and the latest titles. Press to open /note.",
        "clock" => "The time and date. Read-only.",
        "system" => "Uptime, and more system details when drawn larger. Read-only.",
        _ => "",
    }
}

fn kind_of(role: TileRole) -> &'static str {
    match role {
        TileRole::Toggle => "toggle",
        TileRole::Action => "action",
        TileRole::Info => "info",
        TileRole::Media => "media",
        TileRole::Weather => "weather",
        TileRole::Slot => "slot",
        TileRole::Widget => "widget",
        TileRole::Custom => "custom",
    }
}

fn catalog() -> Vec<CatalogEntry> {
    look_qactions::builtin_tiles()
        .into_iter()
        .map(|tile| {
            let (min_w, min_h) = min_span(tile.role);
            CatalogEntry {
                title: if tile.title.is_empty() {
                    "Overview".to_string()
                } else {
                    tile.title.clone()
                },
                description: describe(&tile.action_id),
                min_w,
                min_h,
                default_w: tile.col_span,
                default_h: tile.row_span,
                mnemonic: tile.mnemonic.map(|c| c.to_string()),
                kind: kind_of(tile.role),
                id: tile.action_id,
            }
        })
        .collect()
}

fn builtin_ids() -> HashSet<String> {
    look_qactions::builtin_tiles()
        .into_iter()
        .map(|t| t.action_id)
        .collect()
}

fn default_model() -> EditorModel {
    let tiles: Vec<EditorTile> = launchpad_layout()
        .into_iter()
        .map(|t| EditorTile {
            id: t.action_id,
            col: t.col,
            row: t.row,
            w: t.col_span,
            h: t.row_span,
        })
        .collect();
    let columns = tiles.iter().map(|t| t.col + t.w).max().unwrap_or(1);
    let rows = tiles.iter().map(|t| t.row + t.h).max().unwrap_or(1);
    EditorModel {
        columns,
        rows,
        tiles,
        custom: Vec::new(),
    }
}

// --- Reading ---

/// Every `[tiles.*]` entry as written, valid or not: the editor should show a
/// half-finished tile rather than lose it.
fn raw_custom(contents: &str) -> Vec<EditorCustom> {
    let Ok(table) = toml::from_str::<toml::Value>(contents) else {
        return Vec::new();
    };
    let Some(entries) = table.get("tiles").and_then(|v| v.as_table()) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|(name, entry)| {
            let entry = entry.as_table()?;
            let text = |key: &str| {
                entry
                    .get(key)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            };
            Some(EditorCustom {
                id: name.clone(),
                title: text("title"),
                icon: text("icon"),
                value: text("value"),
                refresh: text("refresh"),
                press: text("press"),
                confirm: text("confirm"),
                mnemonic: text("mnemonic"),
            })
        })
        .collect()
}

fn model_from(contents: &str) -> (EditorModel, Vec<String>) {
    let resolved = launchpad::resolve(contents);
    let tiles = resolved
        .tiles
        .iter()
        .map(|t| EditorTile {
            id: t.action_id.clone(),
            col: t.col,
            row: t.row,
            w: t.col_span,
            h: t.row_span,
        })
        .collect();
    (
        EditorModel {
            columns: resolved.columns,
            rows: resolved.rows,
            tiles,
            custom: raw_custom(contents),
        },
        resolved.warnings,
    )
}

pub fn state_at(path: &Path) -> EditorState {
    let exists = path.exists();
    let (model, warnings) = if !exists {
        (default_model(), Vec::new())
    } else {
        match std::fs::read_to_string(path) {
            Ok(contents) => model_from(&contents),
            Err(err) => (
                default_model(),
                vec![format!("{} could not be read: {err}", path.display())],
            ),
        }
    };
    EditorState {
        model,
        default_model: default_model(),
        catalog: catalog(),
        warnings,
        path: path.display().to_string(),
        file_exists: exists,
        max_columns: MAX_COLUMNS as u8,
        max_rows: MAX_ROWS as u8,
    }
}

pub fn state() -> Result<EditorState, String> {
    Ok(state_at(&file_path()?))
}

fn file_path() -> Result<PathBuf, String> {
    let home = crate::config::user_home_dir().ok_or("no home directory")?;
    Ok(launchpad::launchpad_path(Path::new(&home)))
}

// --- Writing ---

fn check(model: &EditorModel) -> Result<(), String> {
    let (columns, rows) = (usize::from(model.columns), usize::from(model.rows));
    if !(1..=MAX_COLUMNS).contains(&columns) || !(1..=MAX_ROWS).contains(&rows) {
        return Err(format!(
            "the grid must be 1-{MAX_COLUMNS} columns by 1-{MAX_ROWS} rows"
        ));
    }
    let builtin = builtin_ids();
    let mut owner: std::collections::HashMap<(u8, u8), &str> = std::collections::HashMap::new();
    let mut seen = HashSet::new();
    for tile in &model.tiles {
        if tile.id.is_empty() || tile.id == "." || tile.id.contains(char::is_whitespace) {
            return Err(format!("\"{}\" is not a usable tile name", tile.id));
        }
        if !seen.insert(tile.id.as_str()) {
            return Err(format!("\"{}\" is placed twice", tile.id));
        }
        if !builtin.contains(&tile.id) && !model.custom.iter().any(|c| c.id == tile.id) {
            return Err(format!("\"{}\" is not a tile Look knows", tile.id));
        }
        if tile.w == 0 || tile.h == 0 {
            return Err(format!("\"{}\" covers no cell", tile.id));
        }
        if usize::from(tile.col) + usize::from(tile.w) > columns
            || usize::from(tile.row) + usize::from(tile.h) > rows
        {
            return Err(format!("\"{}\" runs outside the grid", tile.id));
        }
        for row in tile.row..tile.row + tile.h {
            for col in tile.col..tile.col + tile.w {
                if let Some(other) = owner.insert((col, row), &tile.id) {
                    return Err(format!("\"{}\" overlaps \"{other}\"", tile.id));
                }
            }
        }
    }
    let mut custom_ids = HashSet::new();
    for custom in &model.custom {
        if !crate::launchpad_values::is_cacheable_name(&custom.id) {
            return Err(format!(
                "\"{}\" is not a valid tile name (letters, digits, - and _ only)",
                custom.id
            ));
        }
        if builtin.contains(&custom.id) {
            return Err(format!("\"{}\" is the name of a built-in tile", custom.id));
        }
        if !custom_ids.insert(custom.id.as_str()) {
            return Err(format!("two tiles are named \"{}\"", custom.id));
        }
    }
    Ok(())
}

/// A TOML string for `s`: a literal string where that reads best (a shell
/// command full of quotes stays readable), basic otherwise.
fn toml_string(s: &str) -> String {
    let has_control = s.chars().any(|c| c.is_control() && c != '\n');
    if !has_control && !s.contains('\'') && !s.contains('\n') {
        return format!("'{s}'");
    }
    if !has_control && !s.contains("'''") && !s.ends_with('\'') {
        let lead = if s.starts_with('\n') { "\n" } else { "" };
        return format!("'''{lead}{s}'''");
    }
    toml::Value::String(s.to_string()).to_string()
}

fn layout_block(model: &EditorModel) -> String {
    let (columns, rows) = (usize::from(model.columns), usize::from(model.rows));
    let mut grid = vec![vec![".".to_string(); columns]; rows];
    for tile in &model.tiles {
        for row in tile.row..tile.row + tile.h {
            for col in tile.col..tile.col + tile.w {
                grid[usize::from(row)][usize::from(col)] = tile.id.clone();
            }
        }
    }
    let width = grid.iter().flatten().map(String::len).max().unwrap_or(1) + 1;
    let mut out = String::from("layout = [\n");
    for row in &grid {
        let cells: Vec<String> = row.iter().map(|c| format!("{c:<width$}")).collect();
        out.push_str(&format!("    \"{}\",\n", cells.join("").trim_end()));
    }
    out.push_str("]\n");
    out
}

fn tile_section(custom: &EditorCustom) -> String {
    let mut out = format!("[tiles.{}]\n", custom.id);
    let mut field = |key: &str, value: &str| {
        let value = value.trim();
        if !value.is_empty() {
            out.push_str(&format!("{key} = {}\n", toml_string(value)));
        }
    };
    field("title", &custom.title);
    field("icon", &custom.icon);
    field("value", &custom.value);
    field("refresh", &custom.refresh);
    field("press", &custom.press);
    field("confirm", &custom.confirm);
    field("mnemonic", &custom.mnemonic.trim().to_ascii_uppercase());
    out
}

fn is_tiles_header(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("[tiles.") && t.ends_with(']') && !t.starts_with("[[")
}

fn is_any_header(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with('[')
}

/// Replaces the `layout = [ ... ]` drawing, or adds one at the top.
fn replace_layout(existing: &str, block: &str) -> String {
    let lines: Vec<&str> = existing.lines().collect();
    let start = lines.iter().position(|l| {
        let t = l.trim_start();
        t.starts_with("layout") && t[6..].trim_start().starts_with('=')
    });
    let Some(start) = start else {
        return format!("{block}\n{existing}");
    };
    // The array closes on the first line that begins with `]`; a one-line
    // `layout = [...]` closes on its own line.
    let end = if lines[start].contains(']') {
        start
    } else {
        lines[start + 1..]
            .iter()
            .position(|l| l.trim_start().starts_with(']'))
            .map_or(lines.len() - 1, |i| start + 1 + i)
    };
    let mut out: Vec<String> = lines[..start].iter().map(|l| l.to_string()).collect();
    out.extend(block.trim_end().lines().map(String::from));
    out.extend(lines[end + 1..].iter().map(|l| l.to_string()));
    let mut text = out.join("\n");
    text.push('\n');
    text
}

/// Drops every `[tiles.*]` table, along with the comment lines directly above
/// it, which belong to it.
fn strip_tile_tables(existing: &str) -> String {
    let lines: Vec<&str> = existing.lines().collect();
    let mut keep = vec![true; lines.len()];
    let mut i = 0;
    while i < lines.len() {
        if is_tiles_header(lines[i]) {
            let mut j = i;
            while j > 0 && lines[j - 1].trim_start().starts_with('#') {
                j -= 1;
                keep[j] = false;
            }
            keep[i] = false;
            i += 1;
            while i < lines.len() && !is_any_header(lines[i]) {
                keep[i] = false;
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    let kept: Vec<&str> = lines
        .iter()
        .zip(&keep)
        .filter_map(|(l, k)| k.then_some(*l))
        .collect();
    kept.join("\n").trim_end().to_string()
}

fn assemble(model: &EditorModel, base: &str) -> String {
    let with_layout = replace_layout(base, &layout_block(model));
    let mut text = strip_tile_tables(&with_layout);
    text.push('\n');
    for custom in &model.custom {
        text.push('\n');
        text.push_str(&tile_section(custom));
    }
    text
}

/// The file text for `model`, edited into `existing` (or the seeded template).
/// The bool is whether `existing` had to be abandoned for the template.
pub fn compose(model: &EditorModel, existing: Option<&str>) -> Result<(String, bool), String> {
    check(model)?;
    let seed = launchpad::default_contents();
    if let Some(existing) = existing {
        let text = assemble(model, existing);
        if toml::from_str::<toml::Value>(&text).is_ok() {
            return Ok((text, false));
        }
    }
    let text = assemble(model, seed);
    toml::from_str::<toml::Value>(&text)
        .map_err(|e| format!("could not write a valid file: {e}"))?;
    Ok((text, existing.is_some()))
}

/// What the app would say about `model`: composed onto the seeded template and
/// run through the same resolver the launchpad uses.
pub fn validate(model: &EditorModel) -> Result<Vec<String>, String> {
    let (text, _) = compose(model, None)?;
    Ok(launchpad::resolve(&text).warnings)
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    path.with_file_name(name)
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = std::fs::copy(path, backup_path(path));
    }
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, contents)
        .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("could not replace {}: {e}", path.display()))
}

pub fn save_at(path: &Path, model: &EditorModel) -> Result<SaveOutcome, String> {
    let existing = std::fs::read_to_string(path).ok();
    let (text, rewrote) = compose(model, existing.as_deref())?;
    write_atomic(path, &text)?;
    Ok(SaveOutcome {
        path: path.display().to_string(),
        warnings: launchpad::resolve(&text).warnings,
        rewrote,
    })
}

pub fn save(model: &EditorModel) -> Result<SaveOutcome, String> {
    save_at(&file_path()?, model)
}

/// Back to the seeded layout. The file is rewritten rather than deleted so the
/// editor and the app keep agreeing about where it is; the old one is in `.bak`.
pub fn reset() -> Result<(), String> {
    write_atomic(&file_path()?, launchpad::default_contents())
}

/// Runs a `value` command the way a tile refresh would, and reports what it
/// printed and whether the app could use it.
pub fn test_value(command: &str) -> ValueTest {
    let command = command.trim();
    if command.is_empty() {
        return ValueTest {
            ok: false,
            output: String::new(),
            parsed: None,
            error: Some("There is no command to run.".into()),
        };
    }
    match look_sources::capture(command, None, TEST_TIMEOUT, TEST_MAX_BYTES) {
        Err(err) => ValueTest {
            ok: false,
            output: String::new(),
            parsed: None,
            error: Some(err.to_string()),
        },
        Ok(output) => match serde_json::from_str::<TileValue>(output.trim()) {
            Ok(parsed) => ValueTest {
                ok: true,
                output,
                parsed: Some(parsed),
                error: None,
            },
            Err(err) => ValueTest {
                ok: false,
                output,
                parsed: None,
                error: Some(format!("It did not print a tile value ({err}).")),
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(id: &str, col: u8, row: u8, w: u8, h: u8) -> EditorTile {
        EditorTile {
            id: id.into(),
            col,
            row,
            w,
            h,
        }
    }

    fn custom(id: &str, value: &str) -> EditorCustom {
        EditorCustom {
            id: id.into(),
            value: value.into(),
            ..Default::default()
        }
    }

    #[test]
    fn the_default_model_composes_back_to_the_default_layout() {
        let model = default_model();
        let (text, rewrote) = compose(&model, None).unwrap();
        assert!(!rewrote);
        let resolved = launchpad::resolve(&text);
        assert!(resolved.warnings.is_empty(), "{:?}", resolved.warnings);
        let mut got: Vec<_> = resolved
            .tiles
            .iter()
            .map(|t| (t.action_id.clone(), t.col, t.row, t.col_span, t.row_span))
            .collect();
        let mut want: Vec<_> = launchpad_layout()
            .iter()
            .map(|t| (t.action_id.clone(), t.col, t.row, t.col_span, t.row_span))
            .collect();
        got.sort();
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn a_saved_model_reads_back_identically() {
        let model = EditorModel {
            columns: 4,
            rows: 2,
            tiles: vec![
                tile("mic", 0, 0, 1, 1),
                tile("disk", 1, 0, 2, 1),
                tile("weather", 3, 0, 1, 2),
            ],
            custom: vec![custom("disk", r#"printf '{"value":"1"}'"#)],
        };
        let (text, _) = compose(&model, None).unwrap();
        let (back, warnings) = model_from(&text);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!((back.columns, back.rows), (4, 2));
        let mut tiles = back.tiles.clone();
        tiles.sort_by(|a, b| a.id.cmp(&b.id));
        let mut want = model.tiles.clone();
        want.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(tiles, want);
        assert_eq!(back.custom, model.custom);
    }

    #[test]
    fn comments_and_other_keys_survive_a_save() {
        let existing = "# my notes\nlayout = [\n  \"mic wifi\",\n]\n\n# keep me\nextra = 1\n";
        let model = EditorModel {
            columns: 2,
            rows: 1,
            tiles: vec![tile("wifi", 0, 0, 1, 1), tile("mic", 1, 0, 1, 1)],
            custom: vec![],
        };
        let (text, rewrote) = compose(&model, Some(existing)).unwrap();
        assert!(!rewrote);
        assert!(
            text.contains("# my notes") && text.contains("# keep me") && text.contains("extra = 1")
        );
        assert!(text.contains("wifi") && !text.contains("mic wifi"));
    }

    #[test]
    fn old_tile_tables_and_their_comments_are_replaced_not_duplicated() {
        let existing = "layout = [\n  \"a\",\n]\n\n# the disk tile\n[tiles.disk]\nvalue = 'x'\n\n[tiles.old]\npress = 'y'\n";
        let model = EditorModel {
            columns: 1,
            rows: 1,
            tiles: vec![tile("disk", 0, 0, 1, 1)],
            custom: vec![custom("disk", "echo new")],
        };
        let (text, rewrote) = compose(&model, Some(existing)).unwrap();
        assert!(!rewrote);
        assert_eq!(text.matches("[tiles.disk]").count(), 1);
        assert!(!text.contains("[tiles.old]") && !text.contains("# the disk tile"));
        assert!(text.contains("echo new") && !text.contains("value = 'x'"));
    }

    #[test]
    fn awkward_commands_round_trip() {
        for value in ["echo 'hi'", "a\nb", "say \"x\" 'y' \\ z", "tab\there", ""] {
            let model = EditorModel {
                columns: 1,
                rows: 1,
                tiles: vec![tile("t", 0, 0, 1, 1)],
                custom: vec![EditorCustom {
                    id: "t".into(),
                    value: value.into(),
                    press: "p".into(),
                    ..Default::default()
                }],
            };
            let (text, _) = compose(&model, None).unwrap();
            let back = raw_custom(&text);
            assert_eq!(back[0].value, value.trim(), "round trip of {value:?}");
        }
    }

    #[test]
    fn bad_models_are_refused_with_a_reason() {
        let base = |tiles: Vec<EditorTile>| EditorModel {
            columns: 2,
            rows: 2,
            tiles,
            custom: vec![],
        };
        assert!(
            compose(
                &base(vec![tile("mic", 0, 0, 1, 1), tile("wifi", 0, 0, 1, 1)]),
                None
            )
            .unwrap_err()
            .contains("overlaps")
        );
        assert!(
            compose(&base(vec![tile("mic", 1, 1, 2, 1)]), None)
                .unwrap_err()
                .contains("outside")
        );
        assert!(
            compose(
                &base(vec![tile("mic", 0, 0, 1, 1), tile("mic", 1, 0, 1, 1)]),
                None
            )
            .unwrap_err()
            .contains("twice")
        );
        assert!(
            compose(&base(vec![tile("nope", 0, 0, 1, 1)]), None)
                .unwrap_err()
                .contains("not a tile")
        );
        let mut huge = base(vec![]);
        huge.columns = 9;
        assert!(compose(&huge, None).is_err());
        let mut clash = base(vec![]);
        clash.custom = vec![custom("wifi", "x")];
        assert!(compose(&clash, None).unwrap_err().contains("built-in"));
    }

    #[test]
    fn validate_reports_what_the_app_would_drop() {
        let model = EditorModel {
            columns: 2,
            rows: 1,
            tiles: vec![tile("weather", 0, 0, 1, 1), tile("mic", 1, 0, 1, 1)],
            custom: vec![],
        };
        let warnings = validate(&model).unwrap();
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("weather") && w.contains("at least")),
            "{warnings:?}"
        );
    }

    #[test]
    fn an_unplaced_tile_definition_is_kept_and_inert() {
        let model = EditorModel {
            columns: 1,
            rows: 1,
            tiles: vec![tile("mic", 0, 0, 1, 1)],
            custom: vec![custom("parked", "echo hi")],
        };
        let (text, _) = compose(&model, None).unwrap();
        assert!(text.contains("[tiles.parked]"));
        assert!(launchpad::resolve(&text).warnings.is_empty());
    }

    #[test]
    fn save_writes_a_backup_and_state_reads_it_back() {
        let dir = std::env::temp_dir().join(format!("look-editor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("super-actions.toml");

        let first = state_at(&path);
        assert!(!first.file_exists);
        assert_eq!(first.model, first.default_model);

        let mut model = first.model.clone();
        model.tiles.retain(|t| t.id != "battery");
        save_at(&path, &model).unwrap();
        assert!(
            !backup_path(&path).exists(),
            "no backup when there was no file"
        );

        model.tiles.retain(|t| t.id != "wifi");
        save_at(&path, &model).unwrap();
        assert!(backup_path(&path).exists());

        let again = state_at(&path);
        assert!(again.file_exists);
        assert!(
            again
                .model
                .tiles
                .iter()
                .all(|t| t.id != "battery" && t.id != "wifi")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn catalog_lists_every_built_in_with_its_minimum() {
        let cat = catalog();
        assert_eq!(cat.len(), look_qactions::builtin_tiles().len());
        let weather = cat.iter().find(|c| c.id == "weather").unwrap();
        assert_eq!((weather.min_w, weather.min_h), (1, 2));
        assert!(cat.iter().all(|c| !c.description.is_empty()));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn a_widget_can_be_drawn_and_read_back() {
        let model = EditorModel {
            columns: 3,
            rows: 1,
            tiles: vec![tile("agents", 0, 0, 2, 1), tile("pomo", 2, 0, 1, 1)],
            custom: vec![],
        };
        let (text, _) = compose(&model, None).unwrap();
        let resolved = launchpad::resolve(&text);
        assert!(resolved.warnings.is_empty(), "{:?}", resolved.warnings);
        let ids: Vec<_> = resolved
            .tiles
            .iter()
            .map(|t| t.action_id.as_str())
            .collect();
        assert_eq!(ids, ["agents", "pomo"]);
        assert!(resolved.tiles.iter().all(|t| t.role == TileRole::Widget));
        assert!(validate(&model).unwrap().is_empty());
    }

    #[test]
    fn test_value_rejects_an_empty_command() {
        let result = test_value("  ");
        assert!(!result.ok && result.error.is_some());
    }
}
