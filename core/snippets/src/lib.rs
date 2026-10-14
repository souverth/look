//! Text snippets for Look: canned text you paste into whatever you were typing
//! in, with the date, the clipboard or a fresh id filled in.
//!
//! They live in `~/.look/snippets.toml`, one table each, so the file stays
//! hand-editable and fits a dotfiles repo:
//!
//! ```toml
//! [snippets.sig]
//! name = "Email signature"      # optional; the key is the name when absent
//! keyword = "sig"               # optional; the key when absent
//! text = """
//! Best regards,
//! Ethan
//! """
//! ```
//!
//! This crate is the shared part: reading the file, finding a snippet from what
//! was typed, and expanding its placeholders. Where the date comes from, how the
//! clipboard is read and how the text reaches the other app are each shell's own.

use look_matching::{normalize_for_search, text_match_score_normalized};
use serde::Serialize;

/// The file a first run writes, which doubles as the documentation.
pub const SEED: &str = r##"# Snippets: text you paste into the app you were typing in.
#
# Find one in the launcher with  s"  (then a word of its name, keyword or text).
# Enter pastes it, Ctrl+C copies it.
#
# Each snippet is a table. `name` and `keyword` are optional and default to the
# key. A line break right at the end of `text` is dropped; end with a blank line
# to keep one.
#
# Placeholders, filled in when you paste:
#   {date}       2026-10-13          {time}      14:05
#   {weekday}    Tuesday             {datetime}  2026-10-13 14:05
#   {clipboard}  what you last copied
#   {uuid}       a fresh random id
# A word in braces that is none of these stays as written. Type {{ for a
# literal {, and }} for a literal }.

[snippets.today]
name = "Today's date"
keyword = "date"
text = "{date}"

[snippets.standup]
name = "Standup note"
text = """
Standup {date} ({weekday})
Yesterday:
Today:
Blocked:
"""

# [snippets.sig]
# name = "Email signature"
# text = """
# Best regards,
# Your Name
# """
"##;

/// Longest a snippet's text may be. A paste of this size is already a document.
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
/// Characters of the text shown under a snippet's name in a result row.
pub const PREVIEW_CHARS: usize = 90;

const KEYWORD_EXACT: i64 = 3_000;
const KEYWORD_PREFIX: i64 = 2_500;
const NAME_WEIGHT: i64 = 2;
const TEXT_WEIGHT: i64 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Snippet {
    /// The table key: stable, and what a paste asks for.
    pub id: String,
    pub name: String,
    pub keyword: String,
    pub text: String,
}

/// What reading the file made of it. A snippet that cannot be trusted is left
/// out and said so, rather than failing the rest.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Loaded {
    pub snippets: Vec<Snippet>,
    pub warnings: Vec<String>,
}

/// Parses the contents of `snippets.toml`.
pub fn parse(source: &str) -> Loaded {
    let mut loaded = Loaded::default();
    let table: toml::Table = match source.parse() {
        Ok(table) => table,
        Err(err) => {
            loaded
                .warnings
                .push(format!("snippets.toml is not valid TOML: {err}"));
            return loaded;
        }
    };
    let Some(snippets) = table.get("snippets") else {
        return loaded;
    };
    let Some(snippets) = snippets.as_table() else {
        loaded
            .warnings
            .push("snippets.toml: `snippets` must be a table of [snippets.<key>]".to_string());
        return loaded;
    };

    for (id, value) in snippets {
        let Some(fields) = value.as_table() else {
            loaded
                .warnings
                .push(format!("snippets.toml: [snippets.{id}] is not a table"));
            continue;
        };
        let text = match fields.get("text") {
            Some(toml::Value::String(text)) => text.strip_suffix('\n').unwrap_or(text),
            Some(_) => {
                loaded.warnings.push(format!(
                    "snippets.toml: [snippets.{id}] `text` must be a string"
                ));
                continue;
            }
            None => {
                loaded
                    .warnings
                    .push(format!("snippets.toml: [snippets.{id}] has no `text`"));
                continue;
            }
        };
        let text = text.strip_suffix('\r').unwrap_or(text);
        if text.trim().is_empty() {
            loaded
                .warnings
                .push(format!("snippets.toml: [snippets.{id}] has empty `text`"));
            continue;
        }
        if text.len() > MAX_TEXT_BYTES {
            loaded.warnings.push(format!(
                "snippets.toml: [snippets.{id}] is over {} KB and was left out",
                MAX_TEXT_BYTES / 1024
            ));
            continue;
        }
        let field = |key: &str| -> Option<String> {
            match fields.get(key) {
                Some(toml::Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
                _ => None,
            }
        };
        loaded.snippets.push(Snippet {
            id: id.clone(),
            name: field("name").unwrap_or_else(|| id.clone()),
            keyword: field("keyword").unwrap_or_else(|| id.clone()),
            text: text.to_string(),
        });
    }

    loaded
        .snippets
        .sort_by_key(|s| (normalize_for_search(&s.name), s.id.clone()));
    for (i, a) in loaded.snippets.iter().enumerate() {
        let shared = loaded.snippets[..i]
            .iter()
            .find(|b| normalize_for_search(&b.keyword) == normalize_for_search(&a.keyword));
        if let Some(b) = shared {
            loaded.warnings.push(format!(
                "snippets.toml: [snippets.{}] and [snippets.{}] share the keyword \"{}\"",
                b.id, a.id, a.keyword
            ));
        }
    }
    loaded
}

/// One snippet matching a query typed after `s"`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SnippetHit {
    pub id: String,
    pub name: String,
    pub keyword: String,
    /// The start of the text, on one line, so the row says what it would paste.
    pub preview: String,
    pub score: i64,
}

fn preview_of(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = flat.chars().take(PREVIEW_CHARS).collect();
    if flat.chars().count() > PREVIEW_CHARS {
        out.push('…');
    }
    out
}

/// Snippets matching `query`, best first, at most `limit`. The keyword is what
/// people type most, so it ranks first: an exact keyword, then one that starts
/// with the query. Otherwise every word has to appear in the name or the text.
/// A blank query lists them all, by name.
pub fn search(snippets: &[Snippet], query: &str, limit: usize) -> Vec<SnippetHit> {
    let query = normalize_for_search(query.trim());
    let mut hits: Vec<SnippetHit> = snippets
        .iter()
        .filter_map(|s| {
            let score = if query.is_empty() {
                0
            } else {
                score_snippet(s, &query)?
            };
            Some(SnippetHit {
                id: s.id.clone(),
                name: s.name.clone(),
                keyword: s.keyword.clone(),
                preview: preview_of(&s.text),
                score,
            })
        })
        .collect();
    // Stable: equal scores (a blank query) keep the file's by-name order.
    hits.sort_by_key(|hit| std::cmp::Reverse(hit.score));
    hits.truncate(limit);
    hits
}

fn score_snippet(s: &Snippet, query: &str) -> Option<i64> {
    let keyword = normalize_for_search(&s.keyword);
    if keyword == query {
        return Some(KEYWORD_EXACT);
    }
    if keyword.starts_with(query) {
        return Some(KEYWORD_PREFIX);
    }
    let name = text_match_score_normalized(query, &normalize_for_search(&s.name))
        .map(|score| score * NAME_WEIGHT);
    let text = text_match_score_normalized(query, &normalize_for_search(&s.text))
        .map(|score| score * TEXT_WEIGHT);
    name.max(text)
}

/// What the shell knows that the text can ask for. The core does no clock or
/// clipboard reading of its own, so a snippet expands the same way everywhere.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize)]
pub struct Context {
    pub date: String,
    pub time: String,
    pub weekday: String,
    pub clipboard: String,
    pub uuid: String,
}

/// Fills in `{date}`, `{time}`, `{weekday}`, `{datetime}`, `{clipboard}` and
/// `{uuid}`. `{{` and `}}` are literal braces. A word in braces that is none of
/// those is left as written, so a snippet holding code or JSON survives.
pub fn expand(text: &str, ctx: &Context) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(['{', '}']) {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        if let Some(after) = tail.strip_prefix("{{") {
            out.push('{');
            rest = after;
        } else if let Some(after) = tail.strip_prefix("}}") {
            out.push('}');
            rest = after;
        } else if let Some(inner) = tail.strip_prefix('{') {
            // `{word}`: a closing brace before any other brace. Anything else is
            // a brace that is just a brace.
            let close = inner
                .find(['{', '}'])
                .filter(|&end| inner[end..].starts_with('}'));
            match close {
                Some(end) => {
                    match value_of(&inner[..end], ctx) {
                        Some(value) => out.push_str(&value),
                        None => {
                            out.push('{');
                            out.push_str(&inner[..=end]);
                        }
                    }
                    rest = &inner[end + 1..];
                }
                None => {
                    out.push('{');
                    rest = inner;
                }
            }
        } else if let Some(after) = tail.strip_prefix('}') {
            out.push('}');
            rest = after;
        } else {
            out.push_str(tail);
            rest = "";
        }
    }
    out.push_str(rest);
    out
}

fn value_of(name: &str, ctx: &Context) -> Option<String> {
    Some(match name {
        "date" => ctx.date.clone(),
        "time" => ctx.time.clone(),
        "weekday" => ctx.weekday.clone(),
        "datetime" => format!("{} {}", ctx.date, ctx.time),
        "clipboard" => ctx.clipboard.clone(),
        "uuid" => ctx.uuid.clone(),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> Context {
        Context {
            date: "2026-10-13".into(),
            time: "14:05".into(),
            weekday: "Tuesday".into(),
            clipboard: "COPIED".into(),
            uuid: "1234".into(),
        }
    }

    fn load(source: &str) -> Loaded {
        parse(source)
    }

    #[test]
    fn the_seed_file_parses_clean_and_its_examples_work() {
        let loaded = load(SEED);
        assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
        let ids: Vec<_> = loaded.snippets.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            ["standup", "today"],
            "sorted by name; the sig is commented out"
        );
        let today = &loaded.snippets[1];
        assert_eq!(today.keyword, "date");
        assert_eq!(expand(&today.text, &ctx()), "2026-10-13");
        let standup = expand(&loaded.snippets[0].text, &ctx());
        assert!(standup.starts_with("Standup 2026-10-13 (Tuesday)\n"));
    }

    #[test]
    fn name_and_keyword_default_to_the_key() {
        let loaded = load("[snippets.sig]\ntext = \"hi\"\n");
        let s = &loaded.snippets[0];
        assert_eq!(
            (s.id.as_str(), s.name.as_str(), s.keyword.as_str()),
            ("sig", "sig", "sig")
        );
    }

    #[test]
    fn one_trailing_line_break_is_dropped_and_two_keep_one() {
        let loaded = load(
            "[snippets.a]\ntext = \"\"\"\nline\n\"\"\"\n[snippets.b]\ntext = \"\"\"\nline\n\n\"\"\"\n",
        );
        let by_id = |id: &str| {
            loaded
                .snippets
                .iter()
                .find(|s| s.id == id)
                .unwrap()
                .text
                .clone()
        };
        assert_eq!(by_id("a"), "line");
        assert_eq!(by_id("b"), "line\n");
    }

    #[test]
    fn a_bad_snippet_is_left_out_and_reported_without_losing_the_rest() {
        let loaded = load(
            "[snippets.ok]\ntext = \"fine\"\n\
             [snippets.none]\nname = \"x\"\n\
             [snippets.blank]\ntext = \"  \"\n\
             [snippets.num]\ntext = 5\n",
        );
        let ids: Vec<_> = loaded.snippets.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["ok"]);
        assert_eq!(loaded.warnings.len(), 3, "{:?}", loaded.warnings);
        assert!(
            loaded
                .warnings
                .iter()
                .any(|w| w.contains("[snippets.none] has no `text`"))
        );
    }

    #[test]
    fn broken_toml_and_a_missing_table_do_not_panic() {
        let broken = load("[snippets.a\ntext = ");
        assert!(broken.snippets.is_empty());
        assert!(broken.warnings[0].contains("not valid TOML"));
        assert_eq!(load(""), Loaded::default());
        assert!(load("snippets = 3").warnings[0].contains("must be a table"));
    }

    #[test]
    fn two_snippets_with_one_keyword_are_flagged() {
        let loaded = load(
            "[snippets.a]\nkeyword = \"x\"\ntext = \"1\"\n[snippets.b]\nkeyword = \"X\"\ntext = \"2\"\n",
        );
        assert_eq!(loaded.snippets.len(), 2);
        assert!(loaded.warnings[0].contains("share the keyword"));
    }

    fn sample() -> Vec<Snippet> {
        load(
            "[snippets.sig]\nname = \"Email signature\"\nkeyword = \"sig\"\ntext = \"Best regards, Ethan\"\n\
             [snippets.sign]\nname = \"Sign off\"\nkeyword = \"signoff\"\ntext = \"Cheers\"\n\
             [snippets.addr]\nname = \"Home address\"\ntext = \"12 Example Street, signed for\"\n",
        )
        .snippets
    }

    fn ids(hits: &[SnippetHit]) -> Vec<&str> {
        hits.iter().map(|h| h.id.as_str()).collect()
    }

    #[test]
    fn the_keyword_ranks_first_exact_then_prefix_then_the_rest() {
        let snippets = sample();
        // `sig` is the exact keyword of one, a prefix of `signoff`, and a word of
        // the third snippet's text.
        assert_eq!(ids(&search(&snippets, "sig", 10)), ["sig", "sign", "addr"]);
        assert_eq!(ids(&search(&snippets, "SIG", 10))[0], "sig", "case folds");
    }

    #[test]
    fn words_match_the_name_or_the_text_in_any_order() {
        let snippets = sample();
        assert_eq!(ids(&search(&snippets, "address home", 10)), ["addr"]);
        assert_eq!(ids(&search(&snippets, "regards", 10)), ["sig"]);
        assert!(search(&snippets, "nothing like it", 10).is_empty());
    }

    #[test]
    fn a_blank_query_lists_all_by_name_and_limit_applies() {
        let snippets = sample();
        let all = search(&snippets, "  ", 10);
        // By name: Email signature, Home address, Sign off.
        assert_eq!(ids(&all), ["sig", "addr", "sign"]);
        assert_eq!(ids(&search(&snippets, "", 2)), ["sig", "addr"]);
    }

    #[test]
    fn the_row_previews_the_text_on_one_line() {
        let loaded = load("[snippets.a]\ntext = \"\"\"\nfirst\n\n   second\n\"\"\"\n");
        assert_eq!(
            search(&loaded.snippets, "first", 1)[0].preview,
            "first second"
        );
        let long = format!("[snippets.b]\ntext = \"{}\"\n", "word ".repeat(40));
        let hit = &search(&load(&long).snippets, "word", 1)[0];
        assert_eq!(hit.preview.chars().count(), PREVIEW_CHARS + 1);
        assert!(hit.preview.ends_with('…'));
    }

    #[test]
    fn placeholders_fill_in() {
        let c = ctx();
        assert_eq!(expand("on {date} at {time}", &c), "on 2026-10-13 at 14:05");
        assert_eq!(
            expand("{datetime} {weekday}", &c),
            "2026-10-13 14:05 Tuesday"
        );
        assert_eq!(expand("re: {clipboard}", &c), "re: COPIED");
        assert_eq!(expand("id {uuid}", &c), "id 1234");
        assert_eq!(expand("{date}{date}", &c), "2026-10-132026-10-13");
    }

    #[test]
    fn unknown_words_and_stray_braces_survive_so_code_does_too() {
        let c = ctx();
        assert_eq!(expand("hello {name}", &c), "hello {name}");
        assert_eq!(expand(r#"{"a": {"b": 1}}"#, &c), r#"{"a": {"b": 1}}"#);
        assert_eq!(
            expand("fn f() { return {date}; }", &c),
            "fn f() { return 2026-10-13; }"
        );
        assert_eq!(expand("a { b", &c), "a { b");
        assert_eq!(expand("a } b", &c), "a } b");
        assert_eq!(expand("{", &c), "{");
        assert_eq!(expand("", &c), "");
    }

    #[test]
    fn doubled_braces_are_literal() {
        let c = ctx();
        assert_eq!(expand("{{date}}", &c), "{date}");
        assert_eq!(expand("{{{date}}}", &c), "{2026-10-13}");
        assert_eq!(expand("}}{{", &c), "}{");
    }

    #[test]
    fn expansion_keeps_multibyte_text_whole() {
        let c = ctx();
        assert_eq!(
            expand("Xin chào {date} — 好", &c),
            "Xin chào 2026-10-13 — 好"
        );
        assert_eq!(expand("😀{weekday}😀", &c), "😀Tuesday😀");
    }
}
