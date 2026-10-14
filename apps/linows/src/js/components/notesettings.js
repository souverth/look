// Settings > Notes: how /note looks and opens. Every control saves the moment it
// changes, like the Animations toggle, and tells the editor straight away
// (`look:note-settings-changed`), so the choice can be judged on a note open
// behind it. The meaning of each value is note-settings.js.

import { setConfig } from '../ipc.js';
import * as banner from './banner.js';
import * as noteSettings from '../screens/commands/note-settings.js';

const SAVE_ERROR_SECS = 4;

let root = null;
let state = { ...noteSettings.DEFAULTS };

const $ = (id) => root.querySelector(`#${id}`);

export function init(screen) {
    root = screen.querySelector('#settings-tab-notes');
    if (!root) return;

    // The theme menu is built from the list the editor itself uses.
    const menu = $('settings-note-theme').querySelector('.settings-dropdown-menu');
    menu.innerHTML = noteSettings.THEMES.map(
        (t) => `<div class="settings-dropdown-item" data-value="${t.id}">${t.label}</div>`,
    ).join('');

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
    const button = theme.querySelector('.settings-dropdown-btn');
    button.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
    });
    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.settings-dropdown-item');
        if (!item) return;
        menu.hidden = true;
        change({ theme: item.dataset.value });
    });
    document.addEventListener('mousedown', (e) => {
        if (!menu.hidden && !theme.contains(e.target)) menu.hidden = true;
    });
}

/** Shows what the config holds (`{ key: value }`). */
export function populate(map) {
    if (!root) return;
    state = noteSettings.parseMap(map);
    render();
}

function render() {
    selectSegment($('settings-note-view'), state.defaultView);
    selectSegment($('settings-note-size'), state.size);
    $('settings-note-line-numbers').checked = state.lineNumbers;
    $('settings-note-wrap').checked = state.wrap;
    $('settings-note-highlight').checked = state.highlight;

    const theme = $('settings-note-theme');
    const chosen = noteSettings.THEMES.find((t) => t.id === state.theme);
    theme.querySelector('.settings-dropdown-label').textContent = chosen?.label ?? '';
    for (const item of theme.querySelectorAll('.settings-dropdown-item')) {
        item.classList.toggle('settings-dropdown-active', item.dataset.value === state.theme);
    }
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
    render();
    announce();
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
        render();
        announce();
        banner.show(`Save failed: ${err}`, 'error', SAVE_ERROR_SECS);
    }
}
