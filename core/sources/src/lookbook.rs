//! Installing ready-made sources from lookbook (github.com/kunkka19xx/lookbook).
//!
//! A source there is a folder of `.toml` files, installed by copying them into
//! `~/.look/sources/`. This module is the part of that which needs no network and
//! no terminal: reading GitHub's folder listing, checking what would be written,
//! and writing it. Fetching is the shell's, so a test never touches the internet.
//!
//! The files hold shell commands that Look will run, so nothing is installed
//! that was not parsed first by the same reader Look loads them with, nothing
//! overwrites a file or a block id the user already has, and the caller shows the
//! text before asking for the go-ahead.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::def::parse_file;
use crate::load::load_dir;

pub const REPO: &str = "kunkka19xx/lookbook";
const API: &str = "https://api.github.com/repos";
/// Where a listing's `download_url`s must point: the repo's own raw files, so a
/// listing cannot send the installer anywhere else.
const RAW_PREFIX: &str = "https://raw.githubusercontent.com/kunkka19xx/lookbook/";
/// A source file is a few lines of declaration; this is far past any real one.
pub const MAX_FILE_BYTES: usize = 64 * 1024;
pub const MAX_FILES: usize = 16;
const MAX_NAME_LEN: usize = 64;

/// GitHub's contents listing of the `sources/` folder, or of one source's.
pub fn listing_url(source: Option<&str>) -> String {
    match source {
        Some(name) => format!("{API}/{REPO}/contents/sources/{name}"),
        None => format!("{API}/{REPO}/contents/sources"),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Entry {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub download_url: Option<String>,
}

/// Reads a contents listing. GitHub answers a missing folder, or a rate limit,
/// with an object holding a `message`, which comes back as the error.
pub fn parse_listing(json: &str) -> Result<Vec<Entry>, String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|err| format!("GitHub sent something unreadable: {err}"))?;
    if let Some(message) = value.get("message").and_then(|m| m.as_str()) {
        return Err(message.to_string());
    }
    serde_json::from_value(value).map_err(|err| format!("GitHub sent an unexpected listing: {err}"))
}

/// The folders of `sources/`: the names `add` takes.
pub fn source_names(entries: &[Entry]) -> Vec<String> {
    let mut names: Vec<String> = entries
        .iter()
        .filter(|e| e.kind == "dir" && is_valid_name(&e.name))
        .map(|e| e.name.clone())
        .collect();
    names.sort();
    names
}

/// The `.toml` files of one source, with where to fetch each. A README, a GIF or
/// an entry whose URL is not the repo's own is not one of them.
pub fn toml_files(entries: &[Entry]) -> Vec<(String, String)> {
    entries
        .iter()
        .filter(|e| e.kind == "file" && is_safe_file_name(&e.name))
        .filter_map(|e| {
            let url = e.download_url.as_deref()?;
            url.starts_with(RAW_PREFIX)
                .then(|| (e.name.clone(), url.to_string()))
        })
        .collect()
}

/// `git`, `work-setup`: lowercase words, so a name can only be a folder of the
/// repo and never a path or a URL.
pub fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        && !name.starts_with(['-', '_'])
}

/// A plain `*.toml` file name, never a path and never hidden.
pub fn is_safe_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".toml") else {
        return false;
    };
    !stem.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// One file ready to be written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlannedFile {
    pub name: String,
    pub contents: String,
    /// The block ids it declares.
    pub blocks: Vec<String>,
    /// True when `--force` is replacing a file that is already there.
    pub overwrites: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub files: Vec<PlannedFile>,
    pub dir: PathBuf,
}

/// Checks `files` (name, contents) against what is in `dir` and returns what
/// would be written, or every reason it should not be.
pub fn plan(files: Vec<(String, String)>, dir: &Path, force: bool) -> Result<Plan, Vec<String>> {
    let mut errors = Vec::new();
    if files.is_empty() {
        return Err(vec!["it has no .toml files".to_string()]);
    }
    if files.len() > MAX_FILES {
        return Err(vec![format!("it has more than {MAX_FILES} files")]);
    }

    // Block ids the user already has, and which file holds each.
    let mut taken: BTreeMap<String, String> = BTreeMap::new();
    for block in load_dir(dir).blocks {
        let file = block
            .source_file
            .as_deref()
            .and_then(|p| Path::new(p).file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        taken.insert(block.id, file);
    }

    let mut planned = Vec::new();
    for (name, contents) in files {
        if !is_safe_file_name(&name) {
            errors.push(format!("\"{name}\" is not a file name Look will write"));
            continue;
        }
        if contents.len() > MAX_FILE_BYTES {
            errors.push(format!("{name} is over {} KB", MAX_FILE_BYTES / 1024));
            continue;
        }
        let parsed = match parse_file(&contents) {
            Ok(parsed) => parsed,
            Err(message) => {
                errors.push(format!("{name} is not valid: {message}"));
                continue;
            }
        };
        for problem in &parsed.problems {
            errors.push(format!("{name}: {problem}"));
        }
        if parsed.blocks.is_empty() {
            errors.push(format!("{name} declares no blocks"));
            continue;
        }

        let overwrites = dir.join(&name).exists();
        if overwrites && !force {
            errors.push(format!(
                "{name} already exists in {}; --force replaces it",
                dir.display()
            ));
        }

        let mut ids = Vec::new();
        for block in &parsed.blocks {
            // A block of the file being replaced is the file's own, not a clash.
            let clash = taken
                .get(&block.id)
                .filter(|holder| !(overwrites && **holder == name));
            if let Some(holder) = clash {
                errors.push(format!(
                    "block [{}] in {name} is already declared in {}",
                    block.id,
                    if holder.is_empty() {
                        "your sources"
                    } else {
                        holder
                    }
                ));
            }
            if planned
                .iter()
                .any(|p: &PlannedFile| p.blocks.contains(&block.id))
            {
                errors.push(format!(
                    "block [{}] is declared by two files of this source",
                    block.id
                ));
            }
            ids.push(block.id.clone());
        }
        planned.push(PlannedFile {
            name,
            contents,
            blocks: ids,
            overwrites,
        });
    }

    if errors.is_empty() {
        Ok(Plan {
            files: planned,
            dir: dir.to_path_buf(),
        })
    } else {
        Err(errors)
    }
}

/// What to put in front of the user before anything is written: every file in
/// full, since the commands in it are what Look will run.
pub fn review(plan: &Plan) -> String {
    let mut out = String::new();
    for file in &plan.files {
        let blocks = file
            .blocks
            .iter()
            .map(|id| format!("[{id}]"))
            .collect::<Vec<_>>()
            .join(" ");
        out.push_str(&format!(
            "# {} -> {}{}\n# blocks: {blocks}\n{}\n",
            file.name,
            plan.dir.join(&file.name).display(),
            if file.overwrites {
                "  (replaces the file there)"
            } else {
                ""
            },
            file.contents.trim_end()
        ));
        out.push('\n');
    }
    out
}

/// Writes the plan. All or nothing: a file that fails takes back the ones this
/// call already wrote, so a half-installed source never lands.
pub fn install(plan: &Plan) -> Result<Vec<PathBuf>, String> {
    fs::create_dir_all(&plan.dir)
        .map_err(|err| format!("could not create {}: {err}", plan.dir.display()))?;
    let mut written: Vec<(PathBuf, Option<String>)> = Vec::new();
    for file in &plan.files {
        let path = plan.dir.join(&file.name);
        let before = if file.overwrites {
            fs::read_to_string(&path).ok()
        } else {
            None
        };
        let result = if file.overwrites {
            fs::write(&path, &file.contents)
        } else {
            // Create-new: a file that appeared since the plan was made stays.
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .and_then(|mut f| std::io::Write::write_all(&mut f, file.contents.as_bytes()))
        };
        if let Err(err) = result {
            for (done, previous) in written.iter().rev() {
                match previous {
                    Some(text) => {
                        let _ = fs::write(done, text);
                    }
                    None => {
                        let _ = fs::remove_file(done);
                    }
                }
            }
            return Err(format!("could not write {}: {err}", path.display()));
        }
        written.push((path, before));
    }
    Ok(written.into_iter().map(|(path, _)| path).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "look-lookbook-{label}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const GIT: &str = "[branches]\nname = \"Branches\"\nrun = \"git branch\"\n";
    const DOCKER: &str = "[containers]\nname = \"Containers\"\nrun = \"docker ps\"\n\n[images]\nname = \"Images\"\nrun = \"docker images\"\n";

    fn files(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter()
            .map(|(n, c)| (n.to_string(), c.to_string()))
            .collect()
    }

    #[test]
    fn urls_name_the_repo_folder() {
        assert_eq!(
            listing_url(None),
            "https://api.github.com/repos/kunkka19xx/lookbook/contents/sources"
        );
        assert!(listing_url(Some("git")).ends_with("/contents/sources/git"));
    }

    #[test]
    fn a_listing_gives_source_names_and_toml_files() {
        let json = r#"[
            {"name":"git","type":"dir","download_url":null},
            {"name":"docker","type":"dir","download_url":null},
            {"name":"README.md","type":"file","download_url":"https://raw.githubusercontent.com/kunkka19xx/lookbook/main/sources/README.md"},
            {"name":".hidden","type":"dir","download_url":null}
        ]"#;
        let entries = parse_listing(json).unwrap();
        assert_eq!(source_names(&entries), ["docker", "git"]);

        let files = r#"[
            {"name":"git.toml","type":"file","download_url":"https://raw.githubusercontent.com/kunkka19xx/lookbook/main/sources/git/git.toml"},
            {"name":"README.md","type":"file","download_url":"https://raw.githubusercontent.com/kunkka19xx/lookbook/main/sources/git/README.md"},
            {"name":"evil.toml","type":"file","download_url":"https://evil.example/evil.toml"},
            {"name":"..\\x.toml","type":"file","download_url":"https://raw.githubusercontent.com/kunkka19xx/lookbook/main/x"},
            {"name":"sub","type":"dir","download_url":null}
        ]"#;
        let found = toml_files(&parse_listing(files).unwrap());
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].0, "git.toml");
    }

    #[test]
    fn a_github_error_comes_back_as_its_message() {
        assert_eq!(
            parse_listing(r#"{"message":"Not Found","status":"404"}"#).unwrap_err(),
            "Not Found"
        );
        assert!(parse_listing("<html>").unwrap_err().contains("unreadable"));
        assert!(
            parse_listing(r#"{"x":1}"#)
                .unwrap_err()
                .contains("unexpected")
        );
    }

    #[test]
    fn names_and_file_names_are_confined() {
        assert!(is_valid_name("git"));
        assert!(is_valid_name("work-setup"));
        for bad in ["", "Git", "../git", "a/b", "git.toml", "-x", "a b", "x:y"] {
            assert!(!is_valid_name(bad), "{bad}");
        }
        assert!(is_safe_file_name("git.toml"));
        assert!(is_safe_file_name("open-in_tmux.v2.toml"));
        for bad in [
            ".toml",
            "x.txt",
            "../x.toml",
            "a/b.toml",
            "a\\b.toml",
            ".hidden.toml",
            "x.toml.sh",
        ] {
            assert!(!is_safe_file_name(bad), "{bad}");
        }
    }

    #[test]
    fn a_clean_source_plans_and_installs() {
        let tmp = TempDir::new("clean");
        let dir = tmp.0.join("sources");
        let planned = plan(files(&[("docker.toml", DOCKER)]), &dir, false).unwrap();
        assert_eq!(planned.files[0].blocks, ["containers", "images"]);
        assert!(!planned.files[0].overwrites);
        let review = review(&planned);
        assert!(review.contains("# docker.toml ->") && review.contains("docker ps"));
        assert!(review.contains("[containers] [images]"));

        let written = install(&planned).unwrap();
        assert_eq!(written.len(), 1);
        assert_eq!(fs::read_to_string(dir.join("docker.toml")).unwrap(), DOCKER);
        // The reader Look loads with sees what was installed.
        let loaded = load_dir(&dir);
        assert!(loaded.problems.is_empty());
        assert_eq!(loaded.blocks.len(), 2);
    }

    #[test]
    fn nothing_that_does_not_parse_is_written() {
        let tmp = TempDir::new("bad");
        let dir = tmp.0.join("sources");
        let broken = plan(files(&[("a.toml", "[x\nrun = ")]), &dir, false).unwrap_err();
        assert!(broken[0].contains("a.toml is not valid"), "{broken:?}");
        let no_producer =
            plan(files(&[("a.toml", "[x]\nname = \"X\"\n")]), &dir, false).unwrap_err();
        assert!(no_producer[0].starts_with("a.toml: [x]"), "{no_producer:?}");
        let empty = plan(files(&[("a.toml", "")]), &dir, false).unwrap_err();
        assert!(empty[0].contains("declares no blocks"));
        assert!(plan(vec![], &dir, false).unwrap_err()[0].contains("no .toml files"));
        assert!(!dir.exists(), "planning writes nothing");
    }

    #[test]
    fn a_file_or_block_you_already_have_is_never_overwritten_silently() {
        let tmp = TempDir::new("clash");
        let dir = tmp.0.join("sources");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("git.toml"),
            "[branches]\nname = \"Mine\"\nrun = \"echo mine\"\n",
        )
        .unwrap();
        fs::write(
            dir.join("mine.toml"),
            "[images]\nname = \"My images\"\nrun = \"echo i\"\n",
        )
        .unwrap();

        // Same file name.
        let same_file = plan(files(&[("git.toml", GIT)]), &dir, false).unwrap_err();
        assert!(
            same_file.iter().any(|e| e.contains("already exists")),
            "{same_file:?}"
        );

        // Another file already declares a block of the same id.
        let same_block = plan(files(&[("docker.toml", DOCKER)]), &dir, false).unwrap_err();
        assert!(
            same_block
                .iter()
                .any(|e| e.contains("[images]") && e.contains("mine.toml")),
            "{same_block:?}"
        );

        // --force replaces git.toml, whose own block is not a clash.
        let forced = plan(files(&[("git.toml", GIT)]), &dir, true).unwrap();
        assert!(forced.files[0].overwrites);
        install(&forced).unwrap();
        assert_eq!(fs::read_to_string(dir.join("git.toml")).unwrap(), GIT);
        // --force does not excuse a clash with a different file.
        assert!(plan(files(&[("docker.toml", DOCKER)]), &dir, true).is_err());
    }

    #[test]
    fn two_files_of_one_source_cannot_share_a_block() {
        let tmp = TempDir::new("twice");
        let err = plan(
            files(&[("a.toml", GIT), ("b.toml", GIT)]),
            &tmp.0.join("sources"),
            false,
        )
        .unwrap_err();
        assert!(err.iter().any(|e| e.contains("two files")), "{err:?}");
    }

    #[test]
    fn a_failed_write_takes_back_the_files_before_it() {
        let tmp = TempDir::new("rollback");
        let dir = tmp.0.join("sources");
        let mut planned = plan(files(&[("a.toml", GIT), ("b.toml", DOCKER)]), &dir, false).unwrap();
        // b.toml appears between planning and writing: create-new refuses it.
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("b.toml"), "theirs").unwrap();
        planned.files[1].overwrites = false;

        let err = install(&planned).unwrap_err();
        assert!(err.contains("b.toml"), "{err}");
        assert!(!dir.join("a.toml").exists(), "a.toml was taken back");
        assert_eq!(fs::read_to_string(dir.join("b.toml")).unwrap(), "theirs");
    }

    #[test]
    fn an_oversized_file_is_refused() {
        let tmp = TempDir::new("big");
        let big = format!("{GIT}# {}\n", "x".repeat(MAX_FILE_BYTES));
        let err = plan(files(&[("big.toml", &big)]), &tmp.0, false).unwrap_err();
        assert!(err[0].contains("is over"), "{err:?}");
    }
}
