//! The notes deck: a window docked to the right edge of the primary screen.
//!
//! It is a thin strip while idle, fans the notes out when the pointer comes to
//! it, and grows leftwards to hold one open note beside the list. The page
//! (deck.html) draws all of it and only tells this side which size it wants,
//! because a transparent window still catches the pointer over its whole area:
//! the strip has to be a small window, not a big empty one.

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const LABEL: &str = "deck";

/// Logical sizes, width then height.
const PILL: (f64, f64) = (18.0, 240.0);
const LIST: (f64, f64) = (280.0, 500.0);
const NOTE: (f64, f64) = (680.0, 500.0);

fn size_of(mode: &str) -> (f64, f64) {
    match mode {
        "list" => LIST,
        "note" => NOTE,
        _ => PILL,
    }
}

/// Places `window` flush with the right edge of the primary monitor, centred
/// vertically, at the size `mode` asks for.
fn dock(window: &WebviewWindow, mode: &str) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let (w, h) = size_of(mode);
    let (w, h) = ((w * scale).round() as u32, (h * scale).round() as u32);
    let area = monitor.work_area();
    let x = area.position.x + area.size.width as i32 - w as i32;
    let y = area.position.y + (area.size.height as i32 - h as i32) / 2;
    window
        .set_size(PhysicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Shows the deck, or removes it. Async because building a window from a
/// synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn deck_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let existing = app.get_webview_window(LABEL);
    if !enabled {
        if let Some(window) = existing {
            window.close().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    if existing.is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("deck.html".into()))
        .title("Look notes")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .inner_size(PILL.0, PILL.1)
        .build()
        .map_err(|e| e.to_string())?;
    dock(&window, "pill")
}

/// Resizes the deck for what the page is showing: `pill`, `list` or `note`.
#[tauri::command]
pub async fn deck_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    dock(&window, &mode)?;
    // An open note is typed into, so it takes the keyboard.
    if mode == "note" {
        let _ = window.set_focus();
    }
    Ok(())
}
