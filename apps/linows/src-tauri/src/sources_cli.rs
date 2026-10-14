//! `lookapp sources list | show <name> | add <name> [--yes] [--force]`: the
//! ready-made sources of lookbook, installed into `~/.look/sources/`.
//!
//! A command, not a window: it prints and exits. What it installs is shell
//! commands Look will run, so `add` shows the files in full and writes nothing
//! until it is told `--yes`; the checks (parse, no clash, no overwrite) are
//! `look_sources::lookbook`'s, and this file only fetches and prints.

use look_sources::lookbook;
use std::path::PathBuf;
use std::process::Command;

const USAGE: &str = "\
usage:
  lookapp sources list                       the ready-made sources
  lookapp sources show <name>                what installing one would write
  lookapp sources add <name> [--yes] [--force]
                                             install one into ~/.look/sources/

`add` prints the files and installs nothing until you pass --yes: they hold
commands Look will run. --force replaces a file of the same name.
Browse them at https://github.com/kunkka19xx/lookbook";

/// Seconds before a request to GitHub is given up on.
const FETCH_TIMEOUT_SECS: &str = "20";

/// Runs the command and returns the process exit code: 0 done, 1 not done (an
/// error, or `add` waiting for `--yes`), 2 a command line that makes no sense.
pub fn run(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("list") if args.len() == 1 => list(),
        Some("show") => match one_name(&args[1..]) {
            Some(name) => show(name),
            None => usage_error(),
        },
        Some("add") => add(&args[1..]),
        None | Some("help" | "--help" | "-h") => {
            println!("{USAGE}");
            0
        }
        Some(_) => usage_error(),
    }
}

fn usage_error() -> i32 {
    eprintln!("lookapp: that is not a sources command\n\n{USAGE}");
    2
}

fn one_name(rest: &[String]) -> Option<&str> {
    match rest {
        [name] if !name.starts_with('-') => Some(name),
        _ => None,
    }
}

fn list() -> i32 {
    let entries =
        match fetch(&lookbook::listing_url(None)).and_then(|j| lookbook::parse_listing(&j)) {
            Ok(entries) => entries,
            Err(err) => return fail(&err),
        };
    let names = lookbook::source_names(&entries);
    if names.is_empty() {
        return fail("lookbook lists no sources");
    }
    for name in names {
        println!("{name}");
    }
    println!("\nlookapp sources show <name> to read one, add <name> to install it");
    0
}

fn show(name: &str) -> i32 {
    match planned(name, false) {
        Ok(plan) => {
            print!("{}", lookbook::review(&plan));
            0
        }
        Err(code) => code,
    }
}

fn add(rest: &[String]) -> i32 {
    let mut name = None;
    let (mut yes, mut force) = (false, false);
    for arg in rest {
        match arg.as_str() {
            "--yes" | "-y" => yes = true,
            "--force" => force = true,
            other if !other.starts_with('-') && name.is_none() => name = Some(other),
            _ => return usage_error(),
        }
    }
    let Some(name) = name else {
        return usage_error();
    };
    let plan = match planned(name, force) {
        Ok(plan) => plan,
        Err(code) => return code,
    };
    print!("{}", lookbook::review(&plan));
    if !yes {
        println!(
            "Nothing installed. These files hold commands Look will run through your shell:\n\
             read them above, then run the same command again with --yes."
        );
        return 1;
    }
    match lookbook::install(&plan) {
        Ok(written) => {
            for path in &written {
                println!("installed {}", path.display());
            }
            println!("Reload Look with Ctrl+Shift+; to pick them up.");
            0
        }
        Err(err) => fail(&err),
    }
}

/// Fetches one source's files and checks them against what is installed. On a
/// problem the reasons are already printed and the exit code comes back.
fn planned(name: &str, force: bool) -> Result<lookbook::Plan, i32> {
    if !lookbook::is_valid_name(name) {
        eprintln!("lookapp: \"{name}\" is not a source name (try `lookapp sources list`)");
        return Err(2);
    }
    let entries = fetch(&lookbook::listing_url(Some(name)))
        .and_then(|json| lookbook::parse_listing(&json))
        .map_err(|err| match err.as_str() {
            "Not Found" => {
                format!("there is no source called \"{name}\" (try `lookapp sources list`)")
            }
            _ => err,
        })
        .map_err(|err| fail(&err))?;

    let mut files = Vec::new();
    for (file, url) in lookbook::toml_files(&entries) {
        let contents = fetch(&url).map_err(|err| fail(&err))?;
        files.push((file, contents));
    }

    let dir = sources_dir().ok_or_else(|| fail("could not find your home folder"))?;
    lookbook::plan(files, &dir, force).map_err(|errors| {
        eprintln!("lookapp: \"{name}\" cannot be installed:");
        for error in errors {
            eprintln!("  - {error}");
        }
        1
    })
}

fn sources_dir() -> Option<PathBuf> {
    let home = look_engine::config_path::home()?;
    Some(look_sources::sources_dir(std::path::Path::new(&home)))
}

fn fail(message: &str) -> i32 {
    eprintln!("lookapp: {message}");
    1
}

/// curl is on Windows 10+ and every desktop Linux; Look already shells out to it
/// for the speed test, so this adds no dependency.
fn fetch(url: &str) -> Result<String, String> {
    let output = Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            FETCH_TIMEOUT_SECS,
            "--header",
            "User-Agent: lookapp",
            "--header",
            "Accept: application/vnd.github+json",
            url,
        ])
        .output()
        .map_err(|err| format!("could not run curl ({err}); is it installed?"))?;
    if !output.status.success() {
        let why = String::from_utf8_lossy(&output.stderr);
        return Err(format!("could not reach GitHub: {}", why.trim()));
    }
    String::from_utf8(output.stdout).map_err(|_| "GitHub sent text that is not UTF-8".to_string())
}

/// Release builds on Windows are GUI-subsystem programs with no console, so a
/// command that prints would print into nothing. Joins the terminal that ran it.
#[cfg(target_os = "windows")]
pub fn attach_parent_console() {
    use windows::Win32::Foundation::GENERIC_WRITE;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Console::{
        ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
        SetStdHandle,
    };
    use windows::core::w;

    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS).is_err() {
            return;
        }
        // Leave a handle alone when the caller redirected it (`> out.txt`): only
        // the ones with nowhere to go are pointed at the console.
        for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            let missing = GetStdHandle(which).map_or(true, |h| h.is_invalid() || h.0.is_null());
            if !missing {
                continue;
            }
            if let Ok(console) = CreateFileW(
                w!("CONOUT$"),
                GENERIC_WRITE.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            ) {
                let _ = SetStdHandle(which, console);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn attach_parent_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_nonsense_command_line_exits_2_without_touching_the_network() {
        assert_eq!(run(&args(&["frobnicate"])), 2);
        assert_eq!(run(&args(&["list", "extra"])), 2);
        assert_eq!(run(&args(&["show"])), 2);
        assert_eq!(run(&args(&["show", "--yes"])), 2);
        assert_eq!(run(&args(&["add"])), 2);
        assert_eq!(run(&args(&["add", "git", "--bogus"])), 2);
        assert_eq!(run(&args(&["add", "git", "docker"])), 2);
    }

    #[test]
    fn a_name_that_is_not_a_folder_is_refused_before_any_request() {
        assert_eq!(run(&args(&["show", "../../etc"])), 2);
        assert_eq!(run(&args(&["add", "Git", "--yes"])), 2);
        assert_eq!(run(&args(&["add", "a/b", "--yes"])), 2);
    }

    #[test]
    fn help_is_not_an_error() {
        assert_eq!(run(&[]), 0);
        assert_eq!(run(&args(&["help"])), 0);
        assert_eq!(run(&args(&["--help"])), 0);
    }
}
