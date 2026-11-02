//! The Water widget: glasses drunk today, and a reminder when one is due.
//!
//! The reminder lives here rather than in the webview because the launcher is
//! hidden almost all day and a hidden page is not a clock to rely on. A ticker
//! checks twice a minute, sends a system notification when a glass is overdue
//! and tells the page, which animates the tile.
//!
//! State is one small JSON file beside `look.db`. It is read on every call, so
//! editing `goal`, `interval_min` or the active hours by hand takes effect at
//! the next tick without a restart.

use chrono::{Local, TimeZone, Timelike};
use linows_backend::state::default_db_path;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

const EVENT_CHANGED: &str = "water-changed";
const TICK: Duration = Duration::from_secs(30);

/// Serialises load-modify-save between the ticker and the commands.
static LOCK: Mutex<()> = Mutex::new(());
/// When this run began: a reminder is never due before it, so opening Look at
/// 3pm does not greet the user with a notification for the missed morning.
static STARTED: OnceLock<i64> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
struct Stored {
    /// Off silences the notification; the tile still counts glasses.
    reminders: bool,
    /// Glasses a day to aim for; 0 sets no goal, so the count runs on and the
    /// reminders carry on through the active hours.
    goal: u32,
    /// Minutes between reminders.
    interval_min: u32,
    /// Reminders only between these local hours: `start_hour <= h < end_hour`.
    start_hour: u32,
    end_hour: u32,
    /// The local date `count` belongs to, `YYYY-MM-DD`.
    day: String,
    count: u32,
    last_drink_unix_s: i64,
    last_remind_unix_s: i64,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            reminders: true,
            goal: 0,
            interval_min: 60,
            start_hour: 8,
            end_hour: 22,
            day: String::new(),
            count: 0,
            last_drink_unix_s: 0,
            last_remind_unix_s: 0,
        }
    }
}

/// What the page needs to draw the tile.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Status {
    pub count: u32,
    pub goal: u32,
    pub interval_min: u32,
    /// A glass is overdue and the goal is not met.
    pub due: bool,
    /// When the next glass is expected, or 0 when no reminder is pending
    /// (goal met, or reminders off).
    pub next_unix_s: i64,
    /// Outside the active hours: `next_unix_s` is then the first glass after
    /// they open, and nothing is due until then.
    pub quiet: bool,
}

/// The moment being judged, split out so the rules can be tested.
struct Clock {
    now: i64,
    hour: u32,
    day: String,
    /// Local midnight today as a unix time.
    midnight: i64,
}

impl Clock {
    fn local() -> Self {
        let now = Local::now();
        let midnight = now
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .and_then(|t| Local.from_local_datetime(&t).earliest())
            .map(|t| t.timestamp())
            .unwrap_or(0);
        Self {
            now: now.timestamp(),
            hour: now.hour(),
            day: now.format("%Y-%m-%d").to_string(),
            midnight,
        }
    }
}

/// A new day starts from zero.
fn roll_over(s: &mut Stored, clock: &Clock) {
    if s.day != clock.day {
        s.day = clock.day.clone();
        s.count = 0;
        s.last_drink_unix_s = 0;
        s.last_remind_unix_s = 0;
    }
}

fn evaluate(s: &Stored, clock: &Clock, started: i64) -> Status {
    let window_start = clock.midnight + i64::from(s.start_hour) * 3600;
    let interval = i64::from(s.interval_min.max(1)) * 60;
    let window_end = clock.midnight + i64::from(s.end_hour) * 3600;
    let in_window = (s.start_hour..s.end_hour).contains(&clock.hour);
    let wanted = s.reminders && (s.goal == 0 || s.count < s.goal);
    // The wait counts from the last glass, or from the start of the day's
    // window (or of this run, if later) when none has been drunk yet.
    let anchor = s.last_drink_unix_s.max(window_start).max(started);
    let mut next = anchor + interval;
    // Outside the hours, or a wait that would only end after they close, the
    // next glass is the first one once they open: this morning if it has not
    // yet, otherwise tomorrow's. The tile counts down to that rather than
    // showing nothing, and nothing is due before it.
    let quiet = wanted && (!in_window || next >= window_end);
    if quiet {
        let opening = if clock.hour < s.start_hour {
            window_start
        } else {
            window_start + 86_400
        };
        next = opening + interval;
    }
    Status {
        count: s.count,
        goal: s.goal,
        interval_min: s.interval_min,
        due: wanted && !quiet && clock.now >= next,
        next_unix_s: if wanted { next } else { 0 },
        quiet,
    }
}

fn path() -> PathBuf {
    default_db_path().with_file_name("water.json")
}

fn load(clock: &Clock) -> Stored {
    let mut s: Stored = std::fs::read_to_string(path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    roll_over(&mut s, clock);
    s
}

fn save(s: &Stored) -> Result<(), String> {
    let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    let path = path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn started() -> i64 {
    *STARTED.get_or_init(|| Local::now().timestamp())
}

fn status_of(s: &Stored, clock: &Clock) -> Status {
    evaluate(s, clock, started())
}

#[tauri::command]
pub fn water_status() -> Status {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let clock = Clock::local();
    status_of(&load(&clock), &clock)
}

/// What Settings edits: the part of the file that is a choice, not a count.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    pub reminders: bool,
    pub goal: u32,
    pub interval_min: u32,
    pub start_hour: u32,
    pub end_hour: u32,
}

impl Config {
    fn of(s: &Stored) -> Self {
        Self {
            reminders: s.reminders,
            goal: s.goal,
            interval_min: s.interval_min,
            start_hour: s.start_hour,
            end_hour: s.end_hour,
        }
    }

    /// Brought into range rather than refused: a box that holds `99999` or an
    /// end hour before the start should still leave something that works.
    fn clamped(mut self) -> Self {
        self.goal = self.goal.min(MAX_GOAL);
        self.interval_min = self.interval_min.clamp(1, MAX_INTERVAL_MIN);
        self.start_hour = self.start_hour.min(23);
        self.end_hour = self.end_hour.clamp(self.start_hour + 1, 24);
        self
    }
}

const MAX_GOAL: u32 = 100;
const MAX_INTERVAL_MIN: u32 = 12 * 60;

#[tauri::command]
pub fn water_config() -> Config {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Config::of(&load(&Clock::local()))
}

/// Saves the settings and returns them as kept (after clamping).
#[tauri::command]
pub fn water_configure(app: AppHandle, config: Config) -> Result<Config, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let clock = Clock::local();
    let mut s = load(&clock);
    let kept = config.clamped();
    s.reminders = kept.reminders;
    s.goal = kept.goal;
    s.interval_min = kept.interval_min;
    s.start_hour = kept.start_hour;
    s.end_hour = kept.end_hour;
    save(&s)?;
    // The tile follows at once: a new goal or interval moves its level and timer.
    let _ = app.emit(EVENT_CHANGED, &status_of(&s, &clock));
    Ok(kept)
}

/// Logs `glasses` (negative to take one back after a mis-tap).
#[tauri::command]
pub fn water_drink(app: AppHandle, glasses: i32) -> Result<Status, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let clock = Clock::local();
    let mut s = load(&clock);
    s.count = s.count.saturating_add_signed(glasses);
    if glasses > 0 {
        s.last_drink_unix_s = clock.now;
        s.last_remind_unix_s = 0;
    }
    save(&s)?;
    let status = status_of(&s, &clock);
    let _ = app.emit(EVENT_CHANGED, &status);
    Ok(status)
}

/// Checks twice a minute for the rest of the run.
pub fn start(app: AppHandle) {
    started();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(TICK).await;
            remind_if_due(&app);
        }
    });
}

/// The drop shown on the notification.
const ICON: &[u8] = include_bytes!("../../icons/water.png");

/// A toast takes its picture from a file, so the one built into the app is
/// written out beside `water.json` the first time (and again if it went missing
/// or differs, as after an update). `None` leaves the notification with the
/// default icon.
fn icon_path() -> Option<String> {
    let path = default_db_path().with_file_name("water.png");
    let current = std::fs::read(&path).ok();
    if current.as_deref() != Some(ICON) {
        std::fs::write(&path, ICON).ok()?;
    }
    path.to_str().map(str::to_owned)
}

/// Shows a system notification with the drop beside it.
///
/// Windows goes to the toast library directly: the plugin takes an icon but
/// draws none there. A toast needs an app id Windows knows; an installed Look
/// has one, a build run from `target/` does not and borrows PowerShell's, which
/// is why it is labelled "Windows PowerShell" until installed.
#[cfg(windows)]
fn notify(app: &AppHandle, title: &str, body: &str, icon: Option<&str>) -> Result<(), String> {
    use std::path::Path;
    use tauri_winrt_notification::{IconCrop, Toast};

    let from_target = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .is_some_and(|dir| {
            dir.ends_with(Path::new("target").join("debug"))
                || dir.ends_with(Path::new("target").join("release"))
        });
    let id = &app.config().identifier;
    let app_id = if from_target {
        Toast::POWERSHELL_APP_ID
    } else {
        id.as_str()
    };
    let mut toast = Toast::new(app_id).title(title).text1(body);
    if let Some(icon) = icon {
        toast = toast.icon(Path::new(icon), IconCrop::Square, "Water");
    }
    toast.show().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn notify(app: &AppHandle, title: &str, body: &str, icon: Option<&str>) -> Result<(), String> {
    let mut toast = app.notification().builder().title(title).body(body);
    if let Some(icon) = icon {
        toast = toast.icon(icon);
    }
    toast.show().map_err(|e| e.to_string())
}

/// Whether the drawing in `super-actions.toml` places the Water tile. The
/// reminders are the tile's, so a user who has not put it on the strip is never
/// notified.
fn on_strip() -> bool {
    linows_backend::look_engine::launchpad::layout()
        .tiles
        .iter()
        .any(|tile| tile.action_id == linows_backend::look_qactions::action_id::WATER)
}

fn remind_if_due(app: &AppHandle) {
    if !on_strip() {
        return;
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let clock = Clock::local();
    let mut s = load(&clock);
    let status = status_of(&s, &clock);
    // Every interval until a glass is logged, not every tick.
    let again = clock.now - s.last_remind_unix_s >= i64::from(s.interval_min.max(1)) * 60;
    if status.due && again {
        let body = if s.goal == 0 {
            format!("Time for a glass of water. {} so far today.", s.count)
        } else {
            format!(
                "Time for a glass of water. {} of {} today.",
                s.count, s.goal
            )
        };
        if let Err(err) = notify(app, "Time to drink", &body, icon_path().as_deref()) {
            eprintln!("[water] could not send the reminder: {err}");
        }
        s.last_remind_unix_s = clock.now;
        let _ = save(&s);
    }
    // The page keeps the tile's state true even if the tick sent nothing new:
    // it is what flips the tile to "due" the moment the interval runs out.
    let _ = app.emit(EVENT_CHANGED, &status);
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIDNIGHT: i64 = 1_000_000;
    /// The default window opens at 08:00.
    const START: i64 = MIDNIGHT + 8 * 3600;

    fn clock(now: i64, hour: u32) -> Clock {
        Clock {
            now,
            hour,
            day: "2026-11-02".into(),
            midnight: MIDNIGHT,
        }
    }

    fn at(s: &Stored, now: i64, hour: u32) -> Status {
        evaluate(s, &clock(now, hour), 0)
    }

    #[test]
    fn a_glass_is_due_one_interval_after_the_window_opens() {
        let s = Stored::default();
        assert!(!at(&s, START + 59 * 60, 8).due);
        assert!(at(&s, START + 60 * 60, 9).due);
    }

    #[test]
    fn drinking_restarts_the_wait() {
        let s = Stored {
            count: 1,
            last_drink_unix_s: START + 3 * 3600,
            ..Stored::default()
        };
        assert!(!at(&s, START + 3 * 3600 + 30 * 60, 11).due);
        assert!(at(&s, START + 4 * 3600, 12).due);
    }

    #[test]
    fn nothing_is_due_outside_the_hours_or_once_the_goal_is_met() {
        let s = Stored::default();
        let late = START + 15 * 3600; // 23:00
        let status = at(&s, late, 23);
        assert!(!status.due, "after the window");
        assert!(status.quiet);
        let tomorrow = MIDNIGHT + 86_400 + 8 * 3600 + 3600;
        assert_eq!(
            status.next_unix_s, tomorrow,
            "counts down to the first glass tomorrow"
        );
        let done = Stored {
            goal: 8,
            count: 8,
            ..Stored::default()
        };
        let status = at(&done, START + 5 * 3600, 13);
        assert!(!status.due, "goal met");
        assert_eq!(
            status.next_unix_s, 0,
            "nothing is pending, so nothing to count down to"
        );
    }

    #[test]
    fn before_the_hours_open_the_first_glass_is_this_morning() {
        let s = Stored::default();
        let early = MIDNIGHT + 5 * 3600; // 05:00
        let status = at(&s, early, 5);
        assert!(status.quiet && !status.due);
        assert_eq!(
            status.next_unix_s,
            START + 3600,
            "an interval after the window opens"
        );
    }

    #[test]
    fn a_wait_that_would_end_after_closing_time_rests_until_morning() {
        // A glass at 21:30 would be due at 22:30, but the hours end at 22:00.
        let s = Stored {
            count: 1,
            last_drink_unix_s: MIDNIGHT + 21 * 3600 + 1800,
            ..Stored::default()
        };
        let status = at(&s, MIDNIGHT + 21 * 3600 + 1900, 21);
        assert!(status.quiet && !status.due);
        assert_eq!(status.next_unix_s, MIDNIGHT + 86_400 + 9 * 3600);
    }

    #[test]
    fn settings_are_brought_into_range() {
        let wild = Config {
            reminders: true,
            goal: 99_999,
            interval_min: 0,
            start_hour: 40,
            end_hour: 3,
        }
        .clamped();
        assert_eq!(wild.goal, MAX_GOAL);
        assert_eq!(wild.interval_min, 1);
        assert_eq!((wild.start_hour, wild.end_hour), (23, 24));

        let backwards = Config {
            start_hour: 18,
            end_hour: 9,
            ..Config::of(&Stored::default())
        }
        .clamped();
        assert_eq!((backwards.start_hour, backwards.end_hour), (18, 19));
        assert_eq!(
            Config::of(&Stored::default()).clamped(),
            Config::of(&Stored::default()),
            "the defaults are already in range"
        );
    }

    #[test]
    fn taking_a_glass_back_never_goes_below_none() {
        assert_eq!(0u32.saturating_add_signed(-1), 0);
        assert_eq!(3u32.saturating_add_signed(-1), 2);
    }

    #[test]
    fn no_goal_means_no_ceiling() {
        let s = Stored {
            count: 20,
            ..Stored::default()
        };
        assert_eq!(s.goal, 0, "the default sets no goal");
        assert!(
            at(&s, START + 5 * 3600, 13).due,
            "still asks after 20 glasses"
        );
    }

    #[test]
    fn reminders_off_still_counts_but_never_asks() {
        let s = Stored {
            reminders: false,
            count: 3,
            ..Stored::default()
        };
        let status = at(&s, START + 5 * 3600, 13);
        assert!(!status.due);
        assert_eq!(status.count, 3);
    }

    #[test]
    fn a_run_that_starts_late_does_not_owe_the_morning() {
        let s = Stored::default();
        let late = START + 6 * 3600;
        let status = evaluate(&s, &clock(late + 60, 14), late);
        assert!(!status.due, "the wait starts when Look does");
    }

    #[test]
    fn a_new_day_starts_from_zero() {
        let mut s = Stored {
            day: "2026-11-01".into(),
            count: 5,
            last_drink_unix_s: 42,
            ..Stored::default()
        };
        roll_over(&mut s, &clock(START, 8));
        assert_eq!((s.count, s.last_drink_unix_s), (0, 0));
        assert_eq!(s.day, "2026-11-02");
    }
}
