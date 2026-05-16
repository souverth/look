//! Windows-specific window effects (Mica, Acrylic, Win11 rounded corners).

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use windows::Win32::Graphics::Dwm::{
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
};

pub(crate) fn apply(window: tauri::Window, effect: &str) -> Result<(), String> {
    let config: Option<WindowEffectsConfig> = match effect {
        "mica" => Some(WindowEffectsConfig {
            effects: vec![Effect::Mica],
            ..Default::default()
        }),
        "acrylic" => Some(WindowEffectsConfig {
            effects: vec![Effect::Acrylic],
            ..Default::default()
        }),
        "none" | "" => None,
        _ => return Err(format!("Unknown effect: {effect}")),
    };

    window
        .set_effects(config)
        .map_err(|e| format!("Failed to set effect: {e}"))
}

/// Ask DWM for Win11 rounded corners. No-op on Win10 (the attribute is ignored).
pub(crate) fn apply_round_corners(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|e| format!("Failed to get HWND: {e}"))?;
    let pref = DWMWCP_ROUND;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const _ as *const _,
            std::mem::size_of_val(&pref) as u32,
        )
    };
    result.map_err(|e| format!("DwmSetWindowAttribute: {e}"))
}
