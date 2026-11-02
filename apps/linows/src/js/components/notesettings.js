// Settings > Notes: how /note looks and opens. Every control saves the moment it
// changes, like the Animations toggle, and tells the editor straight away
// (`look:note-settings-changed`), so the choice can be judged on a note open
// behind it. The meaning of each value is note-settings.js.
//
// The editor's colours are editable one by one (the Theme colours section). What was
// changed is kept in the config on top of the chosen theme, and "Save as new" makes it a
// theme of its own, a file under ~/.look/themes/note, listed in the Editor Theme menu.

import { setConfig, themesList, themeSave, themeDelete } from '../ipc.js';
import * as banner from './banner.js';
import * as noteSettings from '../screens/commands/note-settings.js';
import { SHORTCUTS } from '../screens/commands/note-shortcuts.js';
import { NOTE_COLORS, namesOf, normalizeColor } from '../theme-colors.js';
import { createColorRows } from './colorrows.js';
import { escapeHtml } from '../markdown.js';

const SAVE_ERROR_SECS = 4;
const COLOR_SAVE_DELAY_MS = 350;
const DELETE_ARM_MS = 3000;

let root = null;
let state = { ...noteSettings.DEFAULTS };
let userThemes = []; // [{ name, data }]
let rows = null; // the colour rows
let colorTimer = 0;
let deleteArmed = false;
let deleteTimer = 0;

const $ = (id) => root.querySelector(`#${id}`);
const wrap = () => document.getElementById('cmd-note-body-wrap');

export function init(screen) {
    root = screen.querySelector('#settings-tab-notes');
    if (!root) return;

    for (const [id, key] of [
        ['settings-note-view', 'defaultView'],
        ['settings-note-size', 'size'],
    ]) {
        $(id).addEventListener('click', (e) => {
            const item = e.target.closest('.settings-segment-item');
            if (item) change({ [key]: item.dataset.value });
        });
    }

    for (const [id, key] of [
        ['settings-note-line-numbers', 'lineNumbers'],
        ['settings-note-wrap', 'wrap'],
        ['settings-note-highlight', 'highlight'],
    ]) {
        $(id).addEventListener('change', (e) => change({ [key]: e.target.checked }));
    }

    const theme = $('settings-note-theme');
    const menu = theme.querySelector('.settings-dropdown-menu');
    theme.querySelector('.settings-dropdown-btn').addEventListener('click', () => {
        menu.hidden = !menu.hidden;
    });
    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.settings-dropdown-item');
        if (!item) return;
        menu.hidden = true;
        // A different theme starts clean: the colours changed on the last one do not follow.
        change({ theme: item.dataset.value, colors: {} });
    });
    document.addEventListener('mousedown', (e) => {
        if (!menu.hidden && !theme.contains(e.target)) menu.hidden = true;
    });

    rows = createColorRows({
        container: $('settings-note-color-rows'),
        catalog: NOTE_COLORS,
        read: readColor,
        onChange: setColor,
        onReset: resetColor,
    });
    $('settings-note-theme-save').addEventListener('click', () => void saveNew());
    $('settings-note-theme-update').addEventListener('click', () => void update());
    $('settings-note-theme-reset').addEventListener('click', () => change({ colors: {} }));
    $('settings-note-theme-delete').addEventListener('click', () => void remove());
    $('settings-note-theme-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void saveNew();
        }
    });

    renderKeys();
    buildMenu();
}

/** Shows what the config holds (`{ key: value }`). */
export function populate(map) {
    if (!root) return;
    state = noteSettings.parseMap(map);
    render();
    void loadThemes();
}

// --- The list of keys (the same one F1 shows in a note) ---

function renderKeys() {
    $('settings-note-keys').innerHTML = SHORTCUTS.map(
        (g) =>
            `<div class="settings-shortcut-group">${escapeHtml(g.group)}</div>` +
            g.items
                .map(([keys, what]) => `<div class="settings-shortcut"><kbd>${escapeHtml(keys)}</kbd><span>${escapeHtml(what)}</span></div>`)
                .join(''),
    ).join('');
}

// --- Themes the user saved ---

async function loadThemes() {
    try {
        userThemes = await themesList('note');
    } catch (err) {
        console.warn('Could not list the saved note themes:', err);
        userThemes = [];
    }
    buildMenu();
    announceThemes();
    render();
}

function buildMenu() {
    const menu = $('settings-note-theme').querySelector('.settings-dropdown-menu');
    const builtIn = noteSettings.THEMES.map(
        (t) => `<div class="settings-dropdown-item" data-value="${t.id}">${escapeHtml(t.label)}</div>`,
    ).join('');
    const mine = userThemes.length
        ? '<div class="settings-dropdown-heading">My themes</div>' +
          userThemes
              .map((t) => `<div class="settings-dropdown-item" data-value="user:${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>`)
              .join('')
        : '';
    menu.innerHTML = builtIn + mine;
}

// The editor reads the saved themes from here, to lay one over the editor.
function announceThemes() {
    document.dispatchEvent(new CustomEvent('look:note-themes-changed', { detail: userThemes }));
}

const activeName = () => noteSettings.userThemeName(state.theme);

function themeData(base, colors) {
    return JSON.stringify({ kind: 'note', version: 1, base, colors }, null, 2);
}

// The built-in theme the current look is built on.
function baseId() {
    return noteSettings.resolveTheme({ ...state, colors: {} }, userThemes).base;
}

// Every colour as the editor shows it now: what a saved theme keeps.
function snapshot() {
    return Object.fromEntries(namesOf(NOTE_COLORS).map((name) => [name, readColor(name)]));
}

function say(text, isError = false) {
    const el = $('settings-note-theme-msg');
    el.textContent = text;
    el.classList.toggle('error', isError);
}

async function saveNew() {
    const name = $('settings-note-theme-name').value.trim();
    if (!name) {
        say('Give the theme a name', true);
        $('settings-note-theme-name').focus();
        return;
    }
    try {
        const saved = await themeSave('note', name, themeData(baseId(), snapshot()), null);
        $('settings-note-theme-name').value = '';
        await loadThemes();
        change({ theme: `user:${saved}`, colors: {} });
        say(`Saved "${saved}"`);
    } catch (err) {
        say(String(err), true);
    }
}

// The changes made on a saved theme go back into its file.
async function update() {
    const name = activeName();
    if (name === null) return;
    try {
        await themeSave('note', name, themeData(baseId(), snapshot()), name);
        await loadThemes();
        change({ colors: {} });
        say(`Updated "${name}"`);
    } catch (err) {
        say(String(err), true);
    }
}

async function remove() {
    const name = activeName();
    if (name === null) return;
    const button = $('settings-note-theme-delete');
    // Two presses, as Delete does on a note.
    if (!deleteArmed) {
        deleteArmed = true;
        button.textContent = 'Click again to delete';
        deleteTimer = setTimeout(disarm, DELETE_ARM_MS);
        return;
    }
    disarm();
    try {
        await themeDelete('note', name);
        await loadThemes();
        change({ theme: 'look', colors: {} });
        say(`Deleted "${name}"`);
    } catch (err) {
        say(String(err), true);
    }
}

function disarm() {
    deleteArmed = false;
    clearTimeout(deleteTimer);
    const button = root && $('settings-note-theme-delete');
    if (button) button.textContent = 'Delete theme';
}

// --- The colours ---

// A colour as the editor shows it, whatever it is written as in the stylesheet (a
// mixed or inherited one is asked of the browser by painting it on a throwaway element).
function readColor(name) {
    const el = wrap();
    if (!el) return '#000000';
    const raw = getComputedStyle(el).getPropertyValue(name).trim();
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    probe.style.color = raw || 'transparent';
    el.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return normalizeColor(resolved) ?? '#000000';
}

function setColor(name, colour) {
    state = { ...state, colors: { ...state.colors, [name]: colour } };
    announce();
    renderButtons();
    // The file is written once the dragging stops, not on every step of it.
    clearTimeout(colorTimer);
    colorTimer = setTimeout(persistColors, COLOR_SAVE_DELAY_MS);
}

function resetColor(name) {
    const { [name]: _gone, ...rest } = state.colors;
    state = { ...state, colors: rest };
    announce();
    renderButtons();
    clearTimeout(colorTimer);
    colorTimer = setTimeout(persistColors, COLOR_SAVE_DELAY_MS);
}

async function persistColors() {
    const updates = Object.entries(noteSettings.toUpdates({ colors: state.colors })).map(([key, value]) => ({ key, value }));
    try {
        await setConfig(updates);
    } catch (err) {
        console.error('Failed to save note colours:', err);
        banner.show(`Save failed: ${err}`, 'error', SAVE_ERROR_SECS);
    }
}

// --- The screen ---

function render() {
    selectSegment($('settings-note-view'), state.defaultView);
    selectSegment($('settings-note-size'), state.size);
    $('settings-note-line-numbers').checked = state.lineNumbers;
    $('settings-note-wrap').checked = state.wrap;
    $('settings-note-highlight').checked = state.highlight;

    const theme = $('settings-note-theme');
    const name = activeName();
    const builtIn = noteSettings.THEMES.find((t) => t.id === state.theme);
    // A saved theme that is gone reads as the default, as the editor treats it.
    const missing = name !== null && !userThemes.some((t) => t.name.toLowerCase() === name.toLowerCase());
    theme.querySelector('.settings-dropdown-label').textContent = missing ? 'Follow Look' : (builtIn?.label ?? name ?? '');
    for (const item of theme.querySelectorAll('.settings-dropdown-item')) {
        item.classList.toggle('settings-dropdown-active', item.dataset.value === state.theme);
    }
    renderButtons();
    rows?.refresh(new Set(Object.keys(state.colors)));
}

// Update and Delete belong to a saved theme; Reset to a theme with changes on it.
function renderButtons() {
    const name = activeName();
    const changed = Object.keys(state.colors).length > 0;
    const update = $('settings-note-theme-update');
    update.hidden = name === null;
    update.textContent = name === null ? 'Update' : `Update "${name}"`;
    update.disabled = !changed;
    $('settings-note-theme-delete').hidden = name === null;
    $('settings-note-theme-reset').disabled = !changed;
}

function selectSegment(segment, value) {
    for (const el of segment.querySelectorAll('.settings-segment-item')) {
        el.classList.toggle('settings-segment-active', el.dataset.value === value);
    }
}

function announce() {
    document.dispatchEvent(new CustomEvent('look:note-settings-changed', { detail: { ...state } }));
}

async function change(patch) {
    const before = state;
    state = { ...state, ...patch };
    clearTimeout(colorTimer);
    disarm();
    // The editor takes the change first: the colour rows then read what it shows.
    announce();
    render();
    const updates = Object.entries(noteSettings.toUpdates(patch)).map(([key, value]) => ({
        key,
        value,
    }));
    try {
        await setConfig(updates);
    } catch (err) {
        // The file still holds the old value, so the screen and the editor go back.
        console.error('Failed to save note settings:', err);
        state = before;
        announce();
        render();
        banner.show(`Save failed: ${err}`, 'error', SAVE_ERROR_SECS);
    }
}
