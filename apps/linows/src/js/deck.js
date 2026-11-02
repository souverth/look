// The notes deck window (see src-tauri/src/deck.rs for the window itself).
//
// A thin strip on the screen edge with one dash per note; the pointer fans the
// notes out; a click opens one beside the list, saved shortly after each edit.
// Everything is drawn here, the Rust side only resizes the window.

import { notesList, notesSave, notesTagColors, deckMode } from './ipc.js';
import { tagPicks, tagIndex, swatchStyle } from './screens/commands/note-tag-style.js';
import { noteLabel, ageLabel, newestFirst } from './deck-format.js';

const SHOWN = 8; // notes in the list before "+N more"
const MAX_DASHES = 8;
const SAVE_DELAY_MS = 250;
const COLLAPSE_DELAY_MS = 450;
const REFRESH_MS = 4000;

const $ = (id) => document.getElementById(id);
const deck = $('deck');
const rail = $('rail');
const pill = $('pill');
const list = $('list');
const tiles = $('tiles');
const editor = $('editor');
const titleEl = $('ed-title');
const bodyEl = $('ed-body');
const statusEl = $('ed-status');

let mode = 'pill';
let notes = [];
let showAll = false;
let current = null; // the note open in the editor
let saveTimer = null;
let saving = Promise.resolve();
let collapseTimer = null;
let drawn = ''; // what the list shows now, so a refresh that changed nothing draws nothing

const nowS = () => Math.floor(Date.now() / 1000);

// A note takes the colour of its first tag; one with no tag stays neutral.
const styleOf = (note) => (note.tags?.length ? swatchStyle(tagIndex(note.tags[0])) : '');

async function refresh() {
    try {
        const [all, colors] = await Promise.all([notesList(), notesTagColors().catch(() => [])]);
        tagPicks.clear();
        for (const { tag, color } of colors) tagPicks.set(tag, color);
        notes = (all || []).slice().sort(newestFirst);
        // The note being typed into is the page's own copy, not the stored one.
        if (mode !== 'note') render();
    } catch (err) {
        console.warn('[deck] could not read the notes:', err);
    }
}

// --- Drawing -----------------------------------------------------------------

function render() {
    const key = JSON.stringify([mode, showAll, current?.id, notes.map((n) => [n.id, n.updated_at_unix_s, n.tags])]);
    if (key === drawn) return;
    drawn = key;
    deck.dataset.mode = mode;
    renderPill();
    list.hidden = mode === 'pill';
    pill.hidden = mode !== 'pill';
    if (mode !== 'pill') renderList();
}

function renderPill() {
    const dashes = notes.slice(0, MAX_DASHES).map((note) => {
        const dash = document.createElement('i');
        dash.className = 'deck-dash';
        dash.setAttribute('style', styleOf(note));
        return dash;
    });
    if (!dashes.length) {
        const empty = document.createElement('i');
        empty.className = 'deck-dash deck-dash--empty';
        dashes.push(empty);
    }
    pill.replaceChildren(...dashes);
}

function renderList() {
    const visible = showAll ? notes : notes.slice(0, SHOWN);
    const now = nowS();
    const rows = visible.map((note, i) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = `deck-tile${current?.id === note.id ? ' is-open' : ''}`;
        tile.setAttribute('style', `${styleOf(note)};--i:${i}`);
        const title = document.createElement('span');
        title.className = 'deck-tile-title';
        title.textContent = noteLabel(note);
        const meta = document.createElement('span');
        meta.className = 'deck-tile-meta';
        meta.textContent = [ageLabel(note.updated_at_unix_s, now), ...(note.tags || []).slice(0, 2)].join('  ');
        tile.append(title, meta);
        tile.addEventListener('click', () => void open(note));
        return tile;
    });
    const hidden = notes.length - visible.length;
    if (hidden > 0) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'deck-tile deck-tile--more';
        more.style.setProperty('--i', String(visible.length));
        more.textContent = `+${hidden} more`;
        more.addEventListener('click', () => {
            showAll = true;
            drawn = '';
            render();
        });
        rows.push(more);
    }
    tiles.replaceChildren(...rows);
}

// --- Size: the strip, the list, a note beside it -------------------------------

async function setMode(next) {
    if (next === mode) return;
    mode = next;
    drawn = '';
    await deckMode(next).catch((err) => console.warn('[deck] resize failed:', err));
    editor.hidden = next !== 'note';
    render();
}

const cancelCollapse = () => clearTimeout(collapseTimer);

function collapseSoon() {
    cancelCollapse();
    // An open note stays; the strip comes back only when the pointer has left the list.
    if (mode !== 'list') return;
    collapseTimer = setTimeout(() => {
        showAll = false;
        void setMode('pill');
    }, COLLAPSE_DELAY_MS);
}

rail.addEventListener('mouseenter', () => {
    cancelCollapse();
    if (mode === 'pill') {
        void refresh();
        void setMode('list');
    }
});
document.documentElement.addEventListener('mouseenter', cancelCollapse);
document.documentElement.addEventListener('mousemove', cancelCollapse);
document.documentElement.addEventListener('mouseleave', collapseSoon);

// --- An open note ------------------------------------------------------------

async function open(note) {
    await flush();
    current = { ...note, tags: [...(note.tags || [])] };
    titleEl.value = current.title;
    bodyEl.value = current.body;
    showEditorMeta();
    await setMode('note');
    drawn = '';
    render();
    bodyEl.focus();
}

function showEditorMeta() {
    $('ed-dot').setAttribute('style', styleOf(current));
    $('ed-tags').replaceChildren(
        ...(current.tags || []).map((tag) => {
            const chip = document.createElement('span');
            chip.className = 'deck-tag';
            chip.setAttribute('style', swatchStyle(tagIndex(tag)));
            chip.textContent = tag;
            return chip;
        }),
    );
    statusEl.textContent = '';
}

function newNote() {
    const now = nowS();
    void open({
        id: crypto.randomUUID(),
        title: '',
        body: '',
        tags: [],
        created_at_unix_s: now,
        updated_at_unix_s: now,
    });
}

function scheduleSave() {
    statusEl.textContent = 'Editing';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS);
}

/** Writes the open note now, if it changed since it was last written. */
function flush() {
    clearTimeout(saveTimer);
    if (!current) return saving;
    if (titleEl.value === current.title && bodyEl.value === current.body) return saving;
    const draft = { ...current, title: titleEl.value, body: bodyEl.value };
    current = draft;
    saving = saving.then(async () => {
        try {
            const stored = await notesSave(draft);
            // A note with nothing in it is dropped by the store, and null comes back.
            if (stored) {
                notes = [stored, ...notes.filter((n) => n.id !== stored.id)].sort(newestFirst);
                if (current?.id === stored.id) current.updated_at_unix_s = stored.updated_at_unix_s;
            } else {
                notes = notes.filter((n) => n.id !== draft.id);
            }
            if (current?.id === draft.id) statusEl.textContent = 'Saved';
        } catch (err) {
            console.error('[deck] save failed:', err);
            statusEl.textContent = 'Save failed';
        }
    });
    return saving;
}

async function closeNote() {
    await flush();
    current = null;
    await setMode('list');
    drawn = '';
    render();
    void refresh();
    // The window just got narrower, so the pointer is usually outside it now and
    // no "left" event will ever come: start the countdown here. Moving over the
    // list cancels it.
    collapseSoon();
}

titleEl.addEventListener('input', scheduleSave);
bodyEl.addEventListener('input', scheduleSave);
$('ed-close').addEventListener('click', () => void closeNote());
$('new-note').addEventListener('click', newNote);
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (mode === 'note') void closeNote();
    else if (mode === 'list') void setMode('pill');
});
window.addEventListener('blur', () => void flush());

setInterval(() => {
    if (mode !== 'note') void refresh();
}, REFRESH_MS);
void refresh();
