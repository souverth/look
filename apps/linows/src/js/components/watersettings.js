// Settings > Advanced > Water Reminder: what the Water widget aims for and when it
// speaks. The values live in the backend's water.json (src-tauri/src/water.rs),
// not in ~/.look/config, because the same file holds the day's count.

import { waterConfig, waterConfigure } from '../ipc.js';
import * as banner from './banner.js';

const SAVE_DELAY_MS = 450;
const SAVE_ERROR_SECS = 4;

const FIELDS = [
    ['settings-water-goal', 'goal'],
    ['settings-water-interval', 'interval_min'],
    ['settings-water-start', 'start_hour'],
    ['settings-water-end', 'end_hour'],
];

let root = null;
let saveTimer = 0;

const $ = (id) => root.querySelector(`#${id}`);

export function init(screen) {
    root = screen;
    $('settings-water-reminders').addEventListener('change', scheduleSave);
    for (const [id] of FIELDS) {
        $(id).addEventListener('input', scheduleSave);
        // Leaving a box shows the value as kept, e.g. "99999" as 100.
        $(id).addEventListener('change', () => void save());
    }
}

/** Shows what the backend holds. Quietly leaves the section as it is when there is none. */
export async function populate() {
    if (!root) return;
    try {
        show(await waterConfig());
    } catch (err) {
        console.warn('[water] could not read its settings:', err);
    }
}

function show(config) {
    $('settings-water-reminders').checked = config.reminders;
    for (const [id, key] of FIELDS) $(id).value = String(config[key]);
}

/** The boxes as a config; an empty or odd box is the number it already shows, never NaN. */
function read() {
    const config = { reminders: $('settings-water-reminders').checked };
    for (const [id, key] of FIELDS) {
        const n = Number.parseInt($(id).value, 10);
        config[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return config;
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
}

async function save() {
    clearTimeout(saveTimer);
    try {
        // The backend clamps; what comes back is what was kept.
        show(await waterConfigure(read()));
    } catch (err) {
        console.error('Failed to save the water settings:', err);
        banner.show(`Save failed: ${err}`, 'error', SAVE_ERROR_SECS);
    }
}
