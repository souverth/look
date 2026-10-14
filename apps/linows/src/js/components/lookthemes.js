// Settings > Appearance: the launcher's colours in detail, and themes of one's own.
//
// A built-in theme is three colours (tint, font, border) and a block of variables in
// theme.css. This adds a colour for each of the rest (accent, status, surfaces, code)
// and a way to keep what has been made as a theme: a file under ~/.look/themes/look,
// listed in the Theme menu under "My themes".
//
// What is changed is held in the config:
//
//   ui_colors=--accent-color:#89b4fa;...   colours changed on top of the theme
//   ui_theme_name=Midnight                 the saved theme in use (ui_theme is then "custom")
//   ui_theme_base=tokyo-night              the built-in theme it was made from, so a restart
//                                          still has that theme's other variables
//
// settings.js owns the sliders and the rest of the screen; it hands over what this needs
// to touch them (`host`).

import { themesList, themeSave, themeDelete } from '../ipc.js';
import { LOOK_COLORS, decodeColors, encodeColors, namesOf, normalizeColor } from '../theme-colors.js';
import { THEME_PRESETS } from '../theme-defaults.js';
import { createColorRows } from './colorrows.js';

// The sliders a saved theme keeps: the look, not where a background image is or how
// the settings window itself is blurred.
export const THEME_SLIDERS = [
    'ui_tint_red', 'ui_tint_green', 'ui_tint_blue', 'ui_tint_opacity',
    'ui_font_red', 'ui_font_green', 'ui_font_blue', 'ui_font_opacity',
    'ui_border_red', 'ui_border_green', 'ui_border_blue', 'ui_border_opacity', 'ui_border_thickness',
    'ui_blur_opacity', 'ui_surface_radius', 'inner_gap', 'ui_font_size',
];

const COLOR_SAVE_DELAY_MS = 350;
const DELETE_ARM_MS = 3000;

let screen = null;
let host = null;
let rows = null;
let userThemes = []; // [{ name, data }]
let colors = {}; // changed on top of the theme, what the config holds
let baseline = {}; // the colours of the saved theme in use: changes are measured from these
let activeName = null; // the saved theme in use
let applied = new Set(); // names set inline on the root, so they can be taken off
let colorTimer = 0;
let deleteArmed = false;
let deleteTimer = 0;

const root = () => document.documentElement;
const $ = (id) => screen.querySelector(`#${id}`);

/**
 * `host`: { saveConfig(updates), applyPreset(id), setSlider(key, value), sliderValue(key),
 * applyFont(name), fontName(), applySurface(surface), base(), surface(), setThemeLabel(text, active) }.
 */
export function init(settingsScreen, hostApi) {
    screen = settingsScreen;
    host = hostApi;

    rows = createColorRows({
        container: $('settings-look-color-rows'),
        catalog: LOOK_COLORS,
        read: readColor,
        onChange: setColor,
        onReset: resetColor,
    });
    initSwatches();
    $('settings-look-theme-save').addEventListener('click', () => void saveNew());
    $('settings-look-theme-update').addEventListener('click', () => void update());
    $('settings-look-theme-delete').addEventListener('click', () => void remove());
    $('settings-look-colors-reset').addEventListener('click', resetAll);
    $('settings-look-theme-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void saveNew();
        }
    });
}

// --- A colour picker for each of the three colours made of sliders ---

// Tint, font and border are each three 0-1 sliders; the picker sets the three at once.
const SWATCHES = [
    { id: 'tint', label: 'Tint Colour', keys: ['ui_tint_red', 'ui_tint_green', 'ui_tint_blue'] },
    { id: 'font', label: 'Text Colour', keys: ['ui_font_red', 'ui_font_green', 'ui_font_blue'] },
    { id: 'border', label: 'Border Colour', keys: ['ui_border_red', 'ui_border_green', 'ui_border_blue'] },
];

const sliderOf = (key) => screen.querySelector(`.settings-row[data-key="${key}"] .settings-slider`);

function initSwatches() {
    for (const group of SWATCHES) {
        const first = sliderOf(group.keys[0])?.closest('.settings-row');
        if (!first) continue;
        const row = document.createElement('div');
        row.className = 'settings-row';
        row.innerHTML =
            `<label class="settings-label">${group.label}</label>` +
            `<input type="color" class="theme-color-swatch" id="settings-swatch-${group.id}" aria-label="${group.label}">` +
            '<span class="settings-hint-text">or the three sliders below</span>';
        first.before(row);
        const input = row.querySelector('input');
        // Dragging in the picker previews (the sliders' own input handlers); closing it saves.
        input.addEventListener('input', () => setSliders(group, input.value, 'input'));
        input.addEventListener('change', () => setSliders(group, input.value, 'change'));
    }
    // The picker follows its sliders, whoever moves them.
    screen.addEventListener('input', (e) => {
        if (e.target.classList?.contains('settings-slider')) syncSwatches();
    });
}

function setSliders(group, hex, eventName) {
    const n = Number.parseInt(hex.slice(1), 16);
    const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    group.keys.forEach((key, i) => {
        const slider = sliderOf(key);
        slider.value = (parts[i] / 255).toFixed(2);
        slider.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
}

/** The pickers show what the sliders say. */
export function syncSwatches() {
    if (!screen) return;
    for (const group of SWATCHES) {
        const input = screen.querySelector(`#settings-swatch-${group.id}`);
        if (!input || document.activeElement === input) continue;
        const hex = group.keys
            .map((key) => Math.round(Number.parseFloat(sliderOf(key)?.value ?? '0') * 255))
            .map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0'))
            .join('');
        input.value = `#${hex}`;
    }
}

// --- Colours on the page ---

/** Puts `next` on the root and takes off what an earlier set put there and this one does not. */
function applyColors(next) {
    for (const name of applied) if (!(name in next)) root().style.removeProperty(name);
    applied = new Set(Object.keys(next));
    for (const [name, value] of Object.entries(next)) root().style.setProperty(name, value);
}

// A colour as the page shows it, whatever it is written as in the stylesheet.
function readColor(name) {
    const raw = getComputedStyle(root()).getPropertyValue(name).trim();
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    probe.style.color = raw || 'transparent';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return normalizeColor(resolved) ?? '#000000';
}

/** The colours from the config, on the page (before the settings screen is ever opened). */
export function applyFromConfig(map) {
    // Only a custom theme carries colours of its own; a built-in one is what its block says.
    const custom = map.ui_theme === 'custom';
    colors = custom ? decodeColors(map.ui_colors, LOOK_COLORS) : {};
    applyColors(colors);
    // A theme made from a built-in one keeps that one's other variables (polarity, file-type
    // colours): the attribute is what the stylesheet keys on, and "custom" has none of its own.
    const base = custom ? map.ui_theme_base : '';
    if (base && THEME_PRESETS[base]) root().setAttribute('data-theme', base);
}

/** The saved theme in use, or null. */
export const activeThemeName = () => activeName;

/** Shows what the config holds: the list of saved themes, the menu, the colour rows. */
export async function populate(map) {
    if (!screen) return;
    colors = decodeColors(map.ui_colors, LOOK_COLORS);
    activeName = map.ui_theme === 'custom' && map.ui_theme_name ? map.ui_theme_name : null;
    render();
    await loadThemes();
}

/** A built-in theme was chosen: it brings its own colours, so the changes made on the last go. */
export function presetChosen() {
    activeName = null;
    colors = {};
    baseline = {};
    applyColors({});
    host.saveConfig({ ui_colors: '', ui_theme_name: '', ui_theme_base: '' });
    render();
}

// --- Saved themes ---

async function loadThemes() {
    try {
        userThemes = await themesList('look');
    } catch (err) {
        console.warn('Could not list the saved themes:', err);
        userThemes = [];
    }
    const mine = findTheme(activeName);
    baseline = mine ? readTheme(mine.data).colors : {};
    buildMenu();
    render();
}

const findTheme = (name) => (name ? userThemes.find((t) => t.name.toLowerCase() === name.toLowerCase()) : undefined);

function readTheme(text) {
    let data = {};
    try {
        data = JSON.parse(text);
    } catch {
        // not JSON: an empty theme
    }
    const base = THEME_PRESETS[data?.base] ? data.base : '';
    const sliders = {};
    for (const key of THEME_SLIDERS) {
        const v = Number.parseFloat(data?.sliders?.[key]);
        if (Number.isFinite(v)) sliders[key] = String(v);
    }
    return {
        base,
        sliders,
        font: typeof data?.font === 'string' ? data.font : '',
        surface: typeof data?.surface === 'string' ? data.surface : '',
        colors: decodeColors(encodeColors(data?.colors, LOOK_COLORS), LOOK_COLORS),
    };
}

// What the current look is, as a theme file.
function snapshot() {
    const sliders = Object.fromEntries(THEME_SLIDERS.map((key) => [key, host.sliderValue(key)]));
    const all = Object.fromEntries(namesOf(LOOK_COLORS).map((name) => [name, readColor(name)]));
    return JSON.stringify(
        { kind: 'look', version: 1, base: host.base(), surface: host.surface(), font: host.fontName(), sliders, colors: all },
        null,
        2,
    );
}

function buildMenu() {
    const menu = screen.querySelector('#settings-theme .settings-dropdown-menu');
    for (const el of menu.querySelectorAll('[data-mine]')) el.remove();
    if (!userThemes.length) return;
    const heading = document.createElement('div');
    heading.className = 'settings-dropdown-heading';
    heading.dataset.mine = '1';
    heading.textContent = 'My themes';
    menu.appendChild(heading);
    for (const t of userThemes) {
        const item = document.createElement('div');
        item.className = 'settings-dropdown-item';
        item.dataset.value = `user:${t.name}`;
        item.dataset.mine = '1';
        item.textContent = t.name;
        menu.appendChild(item);
    }
}

/** A saved theme was chosen in the Theme menu: its look goes on, and is kept. */
export function applyUserTheme(name) {
    const found = findTheme(name);
    if (!found) return;
    const theme = readTheme(found.data);
    // The built-in theme it was made from first (its variables, its sliders), then what was
    // saved over it.
    if (theme.base) host.applyPreset(theme.base);
    else root().removeAttribute('data-theme');
    host.applySurface(theme.surface);
    for (const [key, value] of Object.entries(theme.sliders)) host.setSlider(key, value);
    if (theme.font) host.applyFont(theme.font);
    activeName = found.name;
    baseline = theme.colors;
    colors = { ...theme.colors };
    applyColors(colors);
    host.saveConfig({
        ui_theme: 'custom',
        ui_theme_name: found.name,
        ui_theme_base: theme.base,
        ui_surface: theme.surface,
        ui_colors: encodeColors(colors, LOOK_COLORS),
        ...theme.sliders,
        ...(theme.font ? { ui_font_name: theme.font } : {}),
    });
    render();
}

function say(text, isError = false) {
    const el = $('settings-look-theme-msg');
    el.textContent = text;
    el.classList.toggle('error', isError);
}

async function saveNew() {
    const input = $('settings-look-theme-name');
    const name = input.value.trim();
    if (!name) {
        say('Give the theme a name', true);
        input.focus();
        return;
    }
    try {
        const saved = await themeSave('look', name, snapshot(), null);
        input.value = '';
        await loadThemes();
        applyUserTheme(saved);
        say(`Saved "${saved}"`);
    } catch (err) {
        say(String(err), true);
    }
}

async function update() {
    if (activeName === null) return;
    try {
        await themeSave('look', activeName, snapshot(), activeName);
        const name = activeName;
        await loadThemes();
        applyUserTheme(name);
        say(`Updated "${name}"`);
    } catch (err) {
        say(String(err), true);
    }
}

async function remove() {
    if (activeName === null) return;
    const button = $('settings-look-theme-delete');
    if (!deleteArmed) {
        deleteArmed = true;
        button.textContent = 'Click again to delete';
        deleteTimer = setTimeout(disarm, DELETE_ARM_MS);
        return;
    }
    disarm();
    const name = activeName;
    try {
        await themeDelete('look', name);
        // What is on screen stays as it is, now no longer a saved theme.
        activeName = null;
        baseline = {};
        await loadThemes();
        host.setThemeLabel('Custom', null);
        host.saveConfig({ ui_theme_name: '' });
        say(`Deleted "${name}"`);
    } catch (err) {
        say(String(err), true);
    }
}

function disarm() {
    deleteArmed = false;
    clearTimeout(deleteTimer);
    if (screen) $('settings-look-theme-delete').textContent = 'Delete theme';
}

// --- Editing colours ---

const changedNames = () => new Set(Object.keys(colors).filter((name) => colors[name] !== baseline[name]));

// A colour changed by hand makes the theme a custom one, as moving a tint slider does.
function markCustom() {
    host.saveConfig({ ui_theme: 'custom', ui_theme_base: host.base() || '', ui_theme_name: activeName ?? '' });
    host.setThemeLabel(activeName ?? 'Custom', activeName);
}

function setColor(name, colour) {
    colors = { ...colors, [name]: colour };
    root().style.setProperty(name, colour);
    applied.add(name);
    markCustom();
    renderButtons();
    clearTimeout(colorTimer);
    colorTimer = setTimeout(persistColors, COLOR_SAVE_DELAY_MS);
}

// One colour back to what the theme has: the saved theme's, or the built-in one's own.
function resetColor(name) {
    if (name in baseline) {
        colors = { ...colors, [name]: baseline[name] };
        root().style.setProperty(name, baseline[name]);
    } else {
        const { [name]: _gone, ...rest } = colors;
        colors = rest;
        root().style.removeProperty(name);
        applied.delete(name);
    }
    renderButtons();
    clearTimeout(colorTimer);
    colorTimer = setTimeout(persistColors, COLOR_SAVE_DELAY_MS);
}

function resetAll() {
    colors = { ...baseline };
    applyColors(colors);
    persistColors();
    render();
}

function persistColors() {
    host.saveConfig({ ui_colors: encodeColors(colors, LOOK_COLORS) });
}

// --- The screen ---

/** Redraws what depends on the config and the sliders (the screen was just opened or filled). */
export function refresh() {
    render();
}

function render() {
    if (!screen) return;
    syncSwatches();
    renderButtons();
    rows.refresh(changedNames());
}

function renderButtons() {
    const saved = activeName !== null && findTheme(activeName);
    const update = $('settings-look-theme-update');
    update.hidden = !saved;
    update.textContent = saved ? `Update "${activeName}"` : 'Update';
    update.disabled = changedNames().size === 0;
    $('settings-look-theme-delete').hidden = !saved;
    $('settings-look-colors-reset').disabled = changedNames().size === 0;
    if (saved) host.setThemeLabel(activeName, true);
}

