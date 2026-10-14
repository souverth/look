// /note: quick notes for ideas. A grid of cards (title + at most 3 lines of
// body, lifting on hover); clicking one opens a Markdown editor with a
// Preview mode, list continuation, Ctrl+B/I and a "/" block menu. Unlike /todo
// there is no manual Save: the open note autosaves shortly after each edit and
// again when leaving the editor. Data lives in the shared look-notes store.

import {
    notesList,
    notesSave,
    notesDelete,
    notesTagColors,
    notesSetTagColor,
    notesRecordOpen,
} from '../../ipc.js';
import {
    notebook,
    plus,
    trash as trashIcon,
    search as searchIcon,
    check as checkIcon,
    arrowLeft,
} from '../../icons.js';
import { renderMarkdown, escapeHtml } from '../../markdown.js';
import { TAG_HUES, tagPicks, tagIndex, swatchStyle, tagStyle } from './note-tag-style.js';
import { highlightCodeBlocks, copyCode } from './note-code.js';
import { createEditing } from './note-editing.js';
import {
    todayIso,
    formatDate,
    firstLine,
    dropFirstLine,
    plainPreview,
    newId,
} from './note-format.js';

const AUTOSAVE_MS = 500;

// "/" block menu. `text` is inserted in place of the typed "/word"; `|` marks
// where the caret lands (removed from the text).
const SNIPPETS = [
    { key: 'h1', label: 'Heading 1', hint: '#', text: '# |' },
    { key: 'h2', label: 'Heading 2', hint: '##', text: '## |' },
    { key: 'h3', label: 'Heading 3', hint: '###', text: '### |' },
    { key: 'bullet', label: 'Bullet list', hint: '-', text: '- |' },
    { key: 'number', label: 'Numbered list', hint: '1.', text: '1. |' },
    { key: 'todo', label: 'Task list', hint: '[ ]', text: '- [ ] |' },
    { key: 'quote', label: 'Quote', hint: '>', text: '> |' },
    { key: 'code', label: 'Code block', hint: '```', text: '```\n|\n```' },
    { key: 'divider', label: 'Divider', hint: '---', text: '---\n|' },
    { key: 'date', label: "Today's date", hint: '', text: () => `${todayIso()} |` },
];

// --- State ---
let notes = []; // newest edit first
let loaded = false;
let visible = false;
let current = null; // note open in the editor, or null in list view
let mode = 'edit'; // 'edit' | 'preview'
let saveTimer = null;
let pendingSave = Promise.resolve();
let dirty = false;
let deleteArmed = false;
let deleteTimer = null;
let suggestItems = [];
let suggestIndex = 0;
let activeTag = null; // tag the list is filtered to, or null for all

// --- DOM refs ---
let panel, searchBar, searchInput, toolbar, countEl, newBtn, grid;
let tagBar, tagsEl, tagInput, tagMenu, colorsEl;
let colorsTag = null; // tag the colour picker is open for
let editor, backBtn, titleInput, statusEl, modeEl, deleteBtn, bodyEl, previewEl, suggestEl;

// Act on the body textarea, which init() looks up after this module loads.
const { replaceRange, lineBounds, wrapSelection, continueList, indentLines } = createEditing(
    () => bodyEl,
);

export function init() {
    panel = document.getElementById('cmd-panel-note');
    searchBar = document.getElementById('cmd-note-search-bar');
    searchInput = document.getElementById('cmd-note-search');
    toolbar = document.getElementById('cmd-note-toolbar');
    countEl = document.getElementById('cmd-note-count');
    newBtn = document.getElementById('cmd-note-new-btn');
    grid = document.getElementById('cmd-note-grid');
    tagBar = document.getElementById('cmd-note-tagbar');
    tagsEl = document.getElementById('cmd-note-tags');
    tagInput = document.getElementById('cmd-note-tag-input');
    tagMenu = document.getElementById('cmd-note-tagmenu');
    editor = document.getElementById('cmd-note-editor');
    backBtn = document.getElementById('cmd-note-back-btn');
    titleInput = document.getElementById('cmd-note-title');
    statusEl = document.getElementById('cmd-note-status');
    modeEl = document.getElementById('cmd-note-mode');
    deleteBtn = document.getElementById('cmd-note-delete-btn');
    bodyEl = document.getElementById('cmd-note-body');
    previewEl = document.getElementById('cmd-note-preview');
    suggestEl = document.getElementById('cmd-note-suggest');

    document.getElementById('cmd-note-search-icon').innerHTML = searchIcon;
    newBtn.innerHTML = `${plus} New note`;
    backBtn.innerHTML = arrowLeft;
    deleteBtn.innerHTML = `${trashIcon} Delete`;

    searchInput.addEventListener('input', renderGrid);
    newBtn.addEventListener('click', newNote);
    backBtn.addEventListener('click', closeEditor);
    deleteBtn.addEventListener('click', onDeleteClick);
    modeEl.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    previewEl.addEventListener('click', (e) => {
        const copy = e.target.closest('.md-copy');
        if (copy) {
            void copyCode(copy);
            return;
        }
        // Ticking a task rewrites that line of the note. A click that ends a
        // text selection is not a tick.
        const item = e.target.closest('li.md-task');
        if (item && !window.getSelection()?.toString()) toggleTask(Number(item.dataset.line));
    });
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-note]');
        if (card) openNote(card.dataset.note);
    });

    tagBar.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-tag]');
        if (!chip) return;
        // Clicking the active tag (or "All") clears the filter.
        activeTag = chip.dataset.tag && chip.dataset.tag !== activeTag ? chip.dataset.tag : null;
        renderGrid();
    });
    // Right-click a filter chip to recolour that tag.
    tagBar.addEventListener('contextmenu', (e) => {
        const chip = e.target.closest('[data-tag]');
        if (!chip || !chip.dataset.tag) return;
        e.preventDefault();
        openColorPicker(chip.dataset.tag, chip);
    });
    colorsEl = document.createElement('div');
    colorsEl.className = 'cmd-note-colors';
    colorsEl.hidden = true;
    panel.appendChild(colorsEl);
    colorsEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
    colorsEl.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-c]');
        if (sw && colorsTag) pickTagColor(colorsTag, sw.dataset.c === '' ? null : Number(sw.dataset.c));
    });
    document.addEventListener('mousedown', (e) => {
        if (!colorsEl.hidden && !colorsEl.contains(e.target)) closeColorPicker();
    });
    tagsEl.addEventListener('click', (e) => {
        const dot = e.target.closest('[data-color-tag]');
        if (dot) {
            openColorPicker(dot.dataset.colorTag, dot);
            return;
        }
        const del = e.target.closest('[data-del-tag]');
        if (del) removeTag(del.dataset.delTag);
        else if (!e.target.closest('input')) tagInput.focus();
    });
    tagInput.addEventListener('input', () => {
        // Typing a comma (or pasting "a, b") commits what came before it.
        if (tagInput.value.includes(',')) {
            const parts = tagInput.value.split(',');
            tagInput.value = parts.pop();
            parts.forEach(addTag);
        }
        tagMenuIndex = -1;
        updateTagMenu();
    });
    tagInput.addEventListener('focus', updateTagMenu);
    tagInput.addEventListener('blur', () => {
        addTag(tagInput.value);
        hideTagMenu();
    });
    // mousedown, not click: a click would blur the input first and close the menu.
    tagMenu.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        addTag(tagMenuItems[Number(row.dataset.i)].tag);
    });

    titleInput.addEventListener('input', scheduleSave);
    bodyEl.addEventListener('input', () => {
        scheduleSave();
        updateSuggest();
    });
    bodyEl.addEventListener('click', updateSuggest);
    bodyEl.addEventListener('scroll', positionSuggest);
    bodyEl.addEventListener('blur', hideSuggest);
    suggestEl.addEventListener('mousedown', (e) => {
        // mousedown, not click: the click would blur the textarea first.
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        applySuggestion(suggestItems[Number(row.dataset.i)]);
    });

    load();
}

export function enter() {
    visible = true;
    panel.hidden = false;
    // Always land on the list; the list is what a quick capture starts from.
    if (current) closeEditor();
    else showList();
    load();
}

export function exit() {
    visible = false;
    panel.hidden = true;
    hideSuggest();
    closeColorPicker();
    disarmDelete();
    void flush();
    current = null;
}

/** Opens one note in the editor, as a note picked from the main search does. */
export async function openById(id) {
    await load();
    if (visible) openNote(id);
}

// Tab belongs to the editor (indent / title -> body), not to command switching.
export function isEditing() {
    return visible && !!current && mode === 'edit';
}

export function handleKey(e) {
    if (!visible) return false;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (e.key === 'Escape' && !colorsEl.hidden) {
        e.preventDefault();
        closeColorPicker();
        return true;
    }
    if (e.key === 'Escape' && tagMenuOpen()) {
        e.preventDefault();
        hideTagMenu();
        return true;
    }

    if (ctrl && !e.shiftKey && key === 'n') {
        e.preventDefault();
        newNote();
        return true;
    }

    if (!current) {
        // Cards are focusable divs; Enter/Space opens one like a button.
        const card = document.activeElement?.closest?.('.cmd-note-cell');
        if (card && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openNote(card.dataset.note);
            return true;
        }
        if (e.key === 'Escape' && (searchInput.value || activeTag)) {
            // Esc peels off one filter at a time: search text, then the tag.
            if (searchInput.value) searchInput.value = '';
            else activeTag = null;
            renderGrid();
            return true;
        }
        return false;
    }

    // --- Editor ---
    if (ctrl && !e.shiftKey && key === 's') {
        e.preventDefault();
        void flush(true);
        return true;
    }
    if (ctrl && !e.shiftKey && key === 'e') {
        e.preventDefault();
        setMode(mode === 'edit' ? 'preview' : 'edit');
        return true;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        if (!suggestEl.hidden) hideSuggest();
        else closeEditor();
        return true;
    }

    const ae = document.activeElement;
    if (ae === titleInput) {
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            tagInput.focus();
            return true;
        }
        return false;
    }
    if (ae === tagInput) {
        if (tagMenuOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            moveTagMenu(e.key === 'ArrowDown' ? 1 : -1);
            return true;
        }
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            // A highlighted suggestion wins; otherwise Enter/Tab adds the
            // typed text, and on an empty field moves on to the body.
            if (tagMenuOpen() && tagMenuIndex >= 0) addTag(tagMenuItems[tagMenuIndex].tag);
            else if (tagInput.value.trim()) addTag(tagInput.value);
            else bodyEl.focus();
            return true;
        }
        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            titleInput.focus();
            return true;
        }
        if (e.key === 'Backspace' && !tagInput.value && current.tags.length) {
            e.preventDefault();
            removeTag(current.tags[current.tags.length - 1]);
            return true;
        }
        return false;
    }
    if (ae !== bodyEl) return false;

    if (!suggestEl.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = suggestItems.length;
            suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
            renderSuggest();
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            applySuggestion(suggestItems[suggestIndex]);
            return true;
        }
    }

    if (ctrl && !e.shiftKey && (key === 'b' || key === 'i')) {
        e.preventDefault();
        wrapSelection(key === 'b' ? '**' : '*');
        return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && !ctrl) {
        if (continueList()) {
            e.preventDefault();
            return true;
        }
        return false;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        indentLines(e.shiftKey);
        return true;
    }
    return false;
}

// --- Persistence ---

async function load() {
    try {
        const [rows, colors] = await Promise.all([notesList(), notesTagColors()]);
        tagPicks.clear();
        for (const c of colors) tagPicks.set(c.tag, c.color);
        // Don't clobber an open note's unsaved edits with a stale read.
        if (dirty) return;
        notes = rows;
        loaded = true;
    } catch (err) {
        console.error('[note] load failed:', err);
    }
    if (visible && !current) renderGrid();
}

function scheduleSave() {
    if (!current) return;
    dirty = true;
    setStatus('Editing…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), AUTOSAVE_MS);
}

// Writes the open note now. Serialized so a slow write never lands after a
// newer one. `announce` is the explicit Ctrl+S, which says "Saved" even when
// nothing changed.
function flush(announce = false) {
    clearTimeout(saveTimer);
    if (!current) return pendingSave;
    if (!dirty && !announce) return pendingSave;

    const draft = {
        id: current.id,
        title: titleInput.value,
        body: bodyEl.value,
        tags: [...current.tags],
        created_at_unix_s: current.created_at_unix_s,
        updated_at_unix_s: current.updated_at_unix_s,
    };
    dirty = false;
    pendingSave = pendingSave.then(async () => {
        try {
            const stored = await notesSave(draft);
            applyStored(draft.id, stored);
            if (current && current.id === draft.id) setStatus(`${checkIcon} Saved`);
        } catch (err) {
            dirty = true; // keep the draft; the next edit or Ctrl+S retries
            setStatus(`Save failed: ${escapeHtml(String(err))}`, true);
        }
    });
    return pendingSave;
}

function applyStored(id, stored) {
    const i = notes.findIndex((n) => n.id === id);
    if (!stored) {
        if (i >= 0) notes.splice(i, 1); // blank notes are removed by the store
        return;
    }
    if (i >= 0) notes.splice(i, 1);
    notes.unshift(stored);
    if (current && current.id === id) {
        current.created_at_unix_s = stored.created_at_unix_s;
        current.updated_at_unix_s = stored.updated_at_unix_s;
    }
}

// --- List view ---

function showList() {
    current = null;
    editor.hidden = true;
    searchBar.hidden = false;
    toolbar.hidden = false;
    grid.hidden = false;
    renderGrid();
    searchInput.focus();
}

function visibleNotes() {
    const base = activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes;
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return base;
    return q
        .split(/\s+/)
        .reduce(
            (list, term) =>
                list.filter((n) =>
                    `${n.title}\n${n.body}\n${n.tags.join(' ')}`.toLowerCase().includes(term),
                ),
            base,
        );
}

// "All" plus one chip per tag in use, most-used first. Hidden when no note
// has a tag yet, so the list stays uncluttered for people who never tag.
function renderTagBar() {
    const counts = new Map();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
    if (activeTag && !counts.has(activeTag)) activeTag = null;
    tagBar.hidden = counts.size === 0;
    if (!counts.size) return;
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    tagBar.innerHTML =
        `<button class="cmd-note-tagchip${activeTag ? '' : ' active'}" data-tag="">All <b>${notes.length}</b></button>` +
        tags
            .map(
                ([t, c]) =>
                    `<button class="cmd-note-tagchip${t === activeTag ? ' active' : ''}" data-tag="${escapeHtml(t)}" style="${tagStyle(t)}"><i class="cmd-note-dot"></i>${escapeHtml(t)} <b>${c}</b></button>`,
            )
            .join('');
}

function renderGrid() {
    if (!grid) return;
    renderTagBar();
    const list = visibleNotes();
    countEl.innerHTML = `${notebook} ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;

    if (!list.length) {
        const msg = notes.length
            ? 'No notes match your search.'
            : loaded
              ? 'No notes yet. Press Ctrl+N to jot down an idea.'
              : 'Loading…';
        grid.innerHTML = `<div class="cmd-note-empty">${msg}</div>`;
        return;
    }
    grid.innerHTML = list
        .map((n) => {
            const title = n.title || firstLine(n.body) || 'Untitled';
            const body = n.title ? plainPreview(n.body) : plainPreview(dropFirstLine(n.body));
            const badge = n.tags.length
                ? `<span class="cmd-note-badge" style="${tagStyle(n.tags[0])}">${escapeHtml(n.tags[0])}${n.tags.length > 1 ? ` +${n.tags.length - 1}` : ''}</span>`
                : '';
            return `<div class="cmd-note-cell" data-note="${escapeHtml(n.id)}" tabindex="0" style="${n.tags.length ? tagStyle(n.tags[0]) : ''}">
                <div class="cmd-note-card">
                    ${badge}
                    <div class="cmd-note-card-title">${escapeHtml(title)}</div>
                    <div class="cmd-note-card-body">${escapeHtml(body)}</div>
                    <div class="cmd-note-card-date">${formatDate(n.updated_at_unix_s)}</div>
                </div>
            </div>`;
        })
        .join('');
}

// --- Editor ---

function newNote() {
    if (current) void flush();
    const now = Math.floor(Date.now() / 1000);
    openEditor({
        id: newId(),
        title: '',
        body: '',
        // A note started while filtered to a tag belongs to that tag.
        tags: activeTag ? [activeTag] : [],
        created_at_unix_s: now,
        updated_at_unix_s: now,
    });
    titleInput.focus();
}

function openNote(id) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    // Feeds the main search's ranking; a failed count costs nothing visible.
    notesRecordOpen(id).catch((err) => console.warn('[note] record open failed:', err));
    openEditor({ ...note, tags: [...(note.tags || [])] });
    bodyEl.focus();
    bodyEl.setSelectionRange(bodyEl.value.length, bodyEl.value.length);
}

function openEditor(note) {
    current = note;
    dirty = false;
    titleInput.value = note.title;
    bodyEl.value = note.body;
    tagInput.value = '';
    renderTags();
    setStatus('');
    disarmDelete();
    searchBar.hidden = true;
    toolbar.hidden = true;
    tagBar.hidden = true;
    grid.hidden = true;
    editor.hidden = false;
    setMode('edit');
}

async function closeEditor() {
    hideSuggest();
    disarmDelete();
    await flush();
    showList();
}

function setMode(next) {
    mode = next;
    modeEl.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === next);
    });
    hideSuggest();
    if (next === 'preview') {
        renderPreview();
        bodyEl.hidden = true;
        previewEl.hidden = false;
        // Take focus off the hidden textarea so keys don't reach it.
        document.activeElement?.blur?.();
    } else {
        previewEl.hidden = true;
        bodyEl.hidden = false;
        bodyEl.focus();
    }
}

// Flips `[ ]` / `[x]` on one source line (also inside a quote) and re-renders
// the preview in place, keeping the scroll position.
function toggleTask(lineNo) {
    const lines = bodyEl.value.split('\n');
    const line = lines[lineNo];
    if (line === undefined) return;
    const next = line.replace(
        /^(\s*(?:>\s?)*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/,
        (_, a, mark, c) => `${a}${mark === ' ' ? 'x' : ' '}${c}`,
    );
    if (next === line) return;
    lines[lineNo] = next;
    bodyEl.value = lines.join('\n');
    scheduleSave();
    const scroll = previewEl.scrollTop;
    renderPreview();
    previewEl.scrollTop = scroll;
}

// --- Preview: rendering, code highlighting, copy ---

function renderPreview() {
    previewEl.innerHTML =
        renderMarkdown(bodyEl.value) || '<p class="md-empty">Nothing to preview yet.</p>';
    highlightCodeBlocks(previewEl);
}

// --- Tags (editor) ---

const TAG_MAX = 24;
const TAGS_MAX = 8;

function renderTags() {
    tagsEl.querySelectorAll('.cmd-note-tagpill').forEach((el) => el.remove());
    for (const t of current.tags) {
        const pill = document.createElement('span');
        pill.className = 'cmd-note-tagpill';
        pill.style.cssText = tagStyle(t);
        pill.innerHTML =
            `<button type="button" class="cmd-note-tagdot" data-color-tag="${escapeHtml(t)}" title="Change colour"></button>` +
            `${escapeHtml(t)}<button type="button" data-del-tag="${escapeHtml(t)}" title="Remove tag">×</button>`;
        tagsEl.insertBefore(pill, tagInput);
    }
    tagInput.hidden = current.tags.length >= TAGS_MAX;
    updateTagMenu();
}

// --- Tag suggestion menu (under the tag input) ---

let tagMenuItems = [];
let tagMenuIndex = -1; // -1: nothing highlighted, so Enter adds what was typed

const tagMenuOpen = () => !tagMenu.hidden;

function updateTagMenu() {
    if (!current || document.activeElement !== tagInput) return hideTagMenu();
    const q = tagInput.value.replace(/[,#]/g, '').trim().toLowerCase();
    const counts = new Map();
    for (const n of notes) {
        for (const t of n.tags) if (!current.tags.includes(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    tagMenuItems = [...counts]
        .filter(([t]) => t.includes(q))
        .sort((a, b) => (b[0].startsWith(q) - a[0].startsWith(q)) || b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([tag, count]) => ({ tag, count }));
    // Offer to create what was typed unless it already is a tag.
    if (q && !counts.has(q) && !current.tags.includes(q)) tagMenuItems.push({ tag: q, create: true });
    if (!tagMenuItems.length) return hideTagMenu();
    tagMenuIndex = Math.min(tagMenuIndex, tagMenuItems.length - 1);
    renderTagMenu();
    tagMenu.hidden = false;
    tagMenu.style.left = `${tagInput.offsetLeft}px`;
    tagMenu.style.top = `${tagInput.offsetTop + tagInput.offsetHeight + 4}px`;
}

function renderTagMenu() {
    tagMenu.innerHTML = tagMenuItems
        .map(
            (it, i) =>
                `<div class="cmd-note-tagmenu-row${i === tagMenuIndex ? ' active' : ''}" data-i="${i}">
                    <i class="cmd-note-dot" style="${tagStyle(it.tag)}"></i>
                    <span class="cmd-note-tagmenu-name">${escapeHtml(it.tag)}</span>
                    <span class="cmd-note-tagmenu-meta">${it.create ? 'New tag' : it.count}</span>
                </div>`,
        )
        .join('');
    tagMenu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function hideTagMenu() {
    tagMenuIndex = -1;
    tagMenuItems = [];
    if (tagMenu) tagMenu.hidden = true;
}

function moveTagMenu(dir) {
    const n = tagMenuItems.length;
    tagMenuIndex = tagMenuIndex < 0 ? (dir > 0 ? 0 : n - 1) : (tagMenuIndex + dir + n) % n;
    renderTagMenu();
}

function openColorPicker(tag, anchor) {
    colorsTag = tag;
    const selected = tagIndex(tag);
    colorsEl.innerHTML =
        TAG_HUES.map(
            (_, i) =>
                `<button type="button" class="cmd-note-swatch${i === selected ? ' active' : ''}" data-c="${i}" style="${swatchStyle(i)}" title="Colour ${i + 1}"></button>`,
        ).join('') +
        `<button type="button" class="cmd-note-swatch-auto" data-c="" title="Back to the automatic colour">Auto</button>`;
    colorsEl.hidden = false;
    const p = panel.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const left = Math.max(4, Math.min(a.left - p.left, p.width - colorsEl.offsetWidth - 4));
    colorsEl.style.left = `${left}px`;
    colorsEl.style.top = `${a.bottom - p.top + 6}px`;
}

function closeColorPicker() {
    colorsTag = null;
    if (colorsEl) colorsEl.hidden = true;
}

function pickTagColor(tag, index) {
    if (index === null) tagPicks.delete(tag);
    else tagPicks.set(tag, index);
    closeColorPicker();
    if (current) renderTags();
    else renderGrid();
    notesSetTagColor(tag, index).catch((err) => console.error('[note] tag colour failed:', err));
}

// Mirrors core/notes normalize_tags so what is shown is what gets stored.
function addTag(raw) {
    if (!current) return;
    const tag = String(raw).replace(/[,#]/g, '').trim().toLowerCase().slice(0, TAG_MAX);
    tagInput.value = '';
    if (!tag || current.tags.includes(tag) || current.tags.length >= TAGS_MAX) return;
    current.tags.push(tag);
    renderTags();
    scheduleSave();
}

function removeTag(tag) {
    if (!current) return;
    current.tags = current.tags.filter((t) => t !== tag);
    renderTags();
    scheduleSave();
    tagInput.focus();
}

// Two clicks to delete: the first arms the button, the second confirms.
function onDeleteClick() {
    if (!current) return;
    if (!deleteArmed) {
        deleteArmed = true;
        deleteBtn.classList.add('cmd-note-delete-armed');
        deleteBtn.innerHTML = `${trashIcon} Click again to delete`;
        deleteTimer = setTimeout(disarmDelete, 3000);
        return;
    }
    const id = current.id;
    disarmDelete();
    clearTimeout(saveTimer);
    dirty = false;
    notes = notes.filter((n) => n.id !== id);
    current = null;
    pendingSave = pendingSave.then(() => notesDelete(id)).catch((err) => {
        console.error('[note] delete failed:', err);
    });
    showList();
}

function disarmDelete() {
    deleteArmed = false;
    clearTimeout(deleteTimer);
    if (!deleteBtn) return;
    deleteBtn.classList.remove('cmd-note-delete-armed');
    deleteBtn.innerHTML = `${trashIcon} Delete`;
}

function setStatus(html, isError = false) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle('cmd-note-status-error', isError);
}

// --- "/" block menu ---

function updateSuggest() {
    if (mode !== 'edit' || !current) return hideSuggest();
    const { selectionStart: pos, selectionEnd: end, value } = bodyEl;
    if (pos !== end) return hideSuggest();
    const [ls] = lineBounds(pos);
    const m = value.slice(ls, pos).match(/^\s*\/([a-z0-9]*)$/i);
    if (!m) return hideSuggest();
    const q = m[1].toLowerCase();
    suggestItems = SNIPPETS.filter(
        (s) => s.key.startsWith(q) || s.label.toLowerCase().includes(q),
    );
    if (!suggestItems.length) return hideSuggest();
    suggestIndex = 0;
    suggestEl.hidden = false;
    renderSuggest();
    positionSuggest();
}

function renderSuggest() {
    // Rebuilding the rows resets the list's scroll, so keep it and then bring
    // the highlighted row into view; otherwise Up/Down walks off the visible
    // part of a long menu.
    const scroll = suggestEl.scrollTop;
    suggestEl.innerHTML = suggestItems
        .map(
            (s, i) =>
                `<div class="cmd-note-suggest-row${i === suggestIndex ? ' active' : ''}" data-i="${i}">
                    <span>${escapeHtml(s.label)}</span><code>${escapeHtml(s.hint)}</code>
                </div>`,
        )
        .join('');
    suggestEl.scrollTop = scroll;
    suggestEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

// Pixel position of character `pos` inside the textarea, measured by laying
// the same text out in an off-screen mirror with identical wrapping. Relative
// to the textarea's top-left corner, with its own scroll already subtracted.
function caretPosition(pos) {
    const cs = getComputedStyle(bodyEl);
    const mirror = document.createElement('div');
    for (const prop of [
        'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
        'tabSize', 'textTransform', 'textIndent',
    ]) {
        mirror.style[prop] = cs[prop];
    }
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.textContent = bodyEl.value.slice(0, pos);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    bodyEl.parentElement.appendChild(mirror);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const pos2 = {
        left: marker.offsetLeft - bodyEl.scrollLeft,
        top: marker.offsetTop - bodyEl.scrollTop,
        lineHeight,
    };
    mirror.remove();
    return pos2;
}

// Anchors the menu just under the caret; flips above it when there is no room
// below, and stays inside the editor horizontally.
function positionSuggest() {
    if (suggestEl.hidden) return;
    const wrap = bodyEl.parentElement;
    const caret = caretPosition(bodyEl.selectionStart);
    const menuW = suggestEl.offsetWidth;
    const menuH = suggestEl.offsetHeight;
    const left = Math.max(4, Math.min(caret.left, wrap.clientWidth - menuW - 4));
    let top = caret.top + caret.lineHeight + 4;
    if (top + menuH > wrap.clientHeight - 4 && caret.top - menuH - 4 >= 0) {
        top = caret.top - menuH - 4;
    }
    suggestEl.style.left = `${left}px`;
    suggestEl.style.top = `${Math.max(4, top)}px`;
}

function hideSuggest() {
    if (suggestEl) suggestEl.hidden = true;
    suggestItems = [];
}

function applySuggestion(item) {
    if (!item) return;
    const pos = bodyEl.selectionStart;
    const [ls] = lineBounds(pos);
    const indent = bodyEl.value.slice(ls, pos).match(/^\s*/)[0];
    const raw = typeof item.text === 'function' ? item.text() : item.text;
    const caretAt = raw.indexOf('|');
    const text = raw.replace('|', '');
    // Multi-line blocks keep the line's indent so they stay inside a list item.
    const body = text.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n');
    const caretOffset = caretAt < 0 ? body.length : caretAt + (body.slice(0, caretAt).split('\n').length - 1) * indent.length;
    hideSuggest();
    replaceRange(ls + indent.length, pos, body, ls + indent.length + caretOffset);
}
