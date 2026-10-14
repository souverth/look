// Customize Super Actions: a visual editor for ~/.look/super-actions.toml.
//
// The file stays the source of truth and stays hand-editable; this screen edits
// a draft of it. Placement is a grid of cells, drawn here the way the file draws
// it: drag a tile to move it (onto a same-sized neighbour to swap), drag its
// corner to resize, add tiles from the tray, and define tiles of your own. Every
// draft is checked by the same resolver the launcher uses, so the warnings are
// the app's own words about what it would drop. Saving keeps the file's
// comments and leaves the previous version in super-actions.toml.bak.

import {
    launchpadEditorState,
    launchpadEditorValidate,
    launchpadEditorSave,
    launchpadEditorReset,
    launchpadEditorTestValue,
    refreshLaunchpadTiles,
} from '../ipc.js';
import {
    arrowLeft,
    undo2,
    redo2,
    rotateCcw,
    save as saveIcon,
    plus,
    minus,
    xMark,
    trash as trashIcon,
    layoutGrid,
    alertCircle,
    check as checkIcon,
    copy as copyIcon,
    play,
    zap,
} from '../icons.js';
import { escapeHtml } from '../markdown.js';
import * as superactions from '../components/superactions.js';
import { GLYPHS, TILE_ICON, REFRESH_CHOICES } from './layout-editor-data.js';
import {
    overlaps,
    inside as gridInside,
    fits as gridFits,
    findSpot as gridFindSpot,
    titleCase,
} from './layout-grid.js';
import { createHistory } from './layout-history.js';

const UNDO_LIMIT = 100;
const VALIDATE_MS = 220;
const DRAG_THRESHOLD = 5;
const GAP = 6;

// --- State ---
let info = null; // what the backend reported: catalog, path, limits, defaults
let draft = null; // the model being edited
let savedJson = '';
const editHistory = createHistory(UNDO_LIMIT);
let selectedId = null;
let tab = 'tiles';
let issues = [];
let issuesOpen = false;
let saving = false;
let active = false;
let discardArmed = false;
let discardTimer = null;
let toastTimer = null;
let validateTimer = null;
let fieldSnapshotTaken = false;
let drag = null;
// A drag from the tray ends in a click on the chip; that click is not a request
// to add the tile a second time.
let justDragged = false;
let testResult = null; // { id, result } for the last "Test" press
let testing = false;

// --- DOM ---
let root, backBtn, undoBtn, redoBtn, resetBtn, saveBtn, colsEl, rowsEl;
let canvasEl, gridEl, tabsEl, sideEl, footerEl, issuesEl, toastEl, chipEl;

// ---------------------------------------------------------------- lifecycle

export function init() {
    root = document.getElementById('layout-editor');
    backBtn = document.getElementById('le-back');
    undoBtn = document.getElementById('le-undo');
    redoBtn = document.getElementById('le-redo');
    resetBtn = document.getElementById('le-reset');
    saveBtn = document.getElementById('le-save');
    colsEl = document.getElementById('le-cols');
    rowsEl = document.getElementById('le-rows');
    canvasEl = document.getElementById('le-canvas');
    gridEl = document.getElementById('le-grid');
    tabsEl = document.getElementById('le-tabs');
    sideEl = document.getElementById('le-side-body');
    footerEl = document.getElementById('le-footer');
    issuesEl = document.getElementById('le-issues');
    toastEl = document.getElementById('le-toast');
    chipEl = document.getElementById('le-drag-chip');

    document.getElementById('le-title-icon').innerHTML = layoutGrid;
    backBtn.innerHTML = `${arrowLeft} Back`;
    undoBtn.innerHTML = undo2;
    redoBtn.innerHTML = redo2;
    resetBtn.innerHTML = `${rotateCcw} Reset`;

    backBtn.addEventListener('click', requestClose);
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    resetBtn.addEventListener('click', resetToDefault);
    saveBtn.addEventListener('click', () => void save());

    tabsEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (b) setTab(b.dataset.tab);
    });

    colsEl.addEventListener('click', (e) => stepGrid(e, 'columns'));
    rowsEl.addEventListener('click', (e) => stepGrid(e, 'rows'));

    gridEl.addEventListener('pointerdown', onGridPointerDown);
    sideEl.addEventListener('pointerdown', onSidePointerDown);
    sideEl.addEventListener('click', onSideClick);
    sideEl.addEventListener('input', onSideInput);
    sideEl.addEventListener('change', onSideChange);
    sideEl.addEventListener('focusin', () => {
        fieldSnapshotTaken = false;
    });
    footerEl.addEventListener('click', onFooterClick);
    issuesEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-close-issues]')) toggleIssues(false);
    });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('resize', () => active && renderCanvas());
}

export function isActive() {
    return active;
}

export async function open() {
    let state;
    try {
        state = await launchpadEditorState();
    } catch (err) {
        console.error('[layout-editor] load failed:', err);
        return false;
    }
    info = state;
    draft = clone(state.model);
    savedJson = JSON.stringify(draft);
    editHistory.clear();
    selectedId = null;
    tab = 'tiles';
    issues = state.warnings.slice();
    issuesOpen = false;
    discardArmed = false;
    testResult = null;
    active = true;
    root.hidden = false;
    document.activeElement?.blur?.();
    renderAll();
    // The canvas has no size until it is visible.
    requestAnimationFrame(renderCanvas);
    scheduleValidate();
    return true;
}

function close() {
    active = false;
    root.hidden = true;
    cancelDrag();
    clearTimeout(validateTimer);
    document.activeElement?.blur?.();
}

function requestClose() {
    if (!isDirty()) {
        close();
        return;
    }
    // Two presses to throw changes away; the button says so.
    if (!discardArmed) {
        discardArmed = true;
        backBtn.innerHTML = `${arrowLeft} Discard changes?`;
        backBtn.classList.add('le-danger');
        clearTimeout(discardTimer);
        discardTimer = setTimeout(disarmDiscard, 3000);
        return;
    }
    disarmDiscard();
    close();
}

function disarmDiscard() {
    discardArmed = false;
    clearTimeout(discardTimer);
    if (!backBtn) return;
    backBtn.innerHTML = `${arrowLeft} Back`;
    backBtn.classList.remove('le-danger');
}

// ---------------------------------------------------------------- model

const clone = (v) => JSON.parse(JSON.stringify(v));
const isDirty = () => JSON.stringify(draft) !== savedJson;

const entry = (id) => info.catalog.find((c) => c.id === id);
const customOf = (id) => draft.custom.find((c) => c.id === id);
const tileOf = (id) => draft.tiles.find((t) => t.id === id);
const isCustom = (id) => !entry(id);

function minSize(id) {
    const e = entry(id);
    return e ? [e.min_w, e.min_h] : [1, 1];
}

function defaultSize(id) {
    const e = entry(id);
    return e ? [e.default_w, e.default_h] : [1, 1];
}

function titleOf(id) {
    const e = entry(id);
    if (e) return e.title;
    const c = customOf(id);
    return c?.title || titleCase(id);
}

// The placement rules (layout-grid.js), asked of the draft being edited.
const inside = (r) => gridInside(r, draft);
const fits = (rect, ignore = []) => gridFits(rect, draft, ignore);
const findSpot = (w, h) => gridFindSpot(draft, w, h);

function snapshot() {
    editHistory.record(JSON.stringify(draft));
}

// One undo step per edit; the render and the re-check follow.
function mutate(fn) {
    snapshot();
    fn(draft);
    afterChange();
}

function afterChange() {
    renderAll();
    scheduleValidate();
}

function undo() {
    const previous = editHistory.undo(JSON.stringify(draft));
    if (previous === null) return;
    draft = JSON.parse(previous);
    keepSelection();
    afterChange();
}

function redo() {
    const next = editHistory.redo(JSON.stringify(draft));
    if (next === null) return;
    draft = JSON.parse(next);
    keepSelection();
    afterChange();
}

function keepSelection() {
    if (selectedId && !tileOf(selectedId) && !customOf(selectedId)) selectedId = null;
}

// ---------------------------------------------------------------- placing

function place(id, col, row, w, h) {
    mutate((d) => {
        const t = d.tiles.find((x) => x.id === id);
        if (t) Object.assign(t, { col, row, w, h });
        else d.tiles.push({ id, col, row, w, h });
    });
    select(id);
}

// Click on a tray tile: the first free spot that fits, growing the grid by a
// row when there is none and the limit allows it.
function autoPlace(id) {
    const [w, h] = defaultSize(id);
    const [mw, mh] = minSize(id);
    let spot = findSpot(w, h);
    let size = [w, h];
    if (!spot) {
        spot = findSpot(mw, mh);
        size = [mw, mh];
    }
    if (spot) {
        place(id, spot.col, spot.row, size[0], size[1]);
        return;
    }
    if (draft.rows + mh <= info.max_rows) {
        snapshot();
        const row = draft.rows;
        draft.rows += mh;
        draft.tiles.push({ id, col: 0, row, w: mw, h: mh });
        selectedId = id;
        afterChange();
        toast(`Added a row for ${titleOf(id)}`);
        return;
    }
    toast('No room. Remove a tile or make the grid larger.', true);
}

function removeFromGrid(id) {
    if (!tileOf(id)) return;
    mutate((d) => {
        d.tiles = d.tiles.filter((t) => t.id !== id);
    });
    // A built-in goes back to the tray; a tile of your own stays defined.
    toast(`${titleOf(id)} removed from the grid`);
}

function deleteCustom(id) {
    mutate((d) => {
        d.tiles = d.tiles.filter((t) => t.id !== id);
        d.custom = d.custom.filter((c) => c.id !== id);
    });
    if (selectedId === id) select(null);
    toast('Tile deleted');
}

function newCustom() {
    let n = 1;
    let id = 'tile';
    while (customOf(id) || entry(id)) id = `tile-${++n}`;
    snapshot();
    draft.custom.push({ id, title: 'New tile', icon: '', value: '', refresh: '', press: '', confirm: '', mnemonic: '' });
    selectedId = id;
    tab = 'props';
    autoPlaceQuiet(id);
    afterChange();
}

function autoPlaceQuiet(id) {
    const spot = findSpot(1, 1);
    if (spot) draft.tiles.push({ id, col: spot.col, row: spot.row, w: 1, h: 1 });
    else if (draft.rows < info.max_rows) {
        draft.tiles.push({ id, col: 0, row: draft.rows, w: 1, h: 1 });
        draft.rows += 1;
    }
}

function resizeBy(id, dw, dh) {
    const t = tileOf(id);
    if (!t) return false;
    const [mw, mh] = minSize(id);
    const next = { ...t, w: t.w + dw, h: t.h + dh };
    if (next.w < mw || next.h < mh || !fits(next, [id])) return false;
    mutate(() => Object.assign(t, { w: next.w, h: next.h }));
    return true;
}

// Move by whole cells; onto a same-sized neighbour that swaps places.
function nudge(id, dc, dr) {
    const t = tileOf(id);
    if (!t) return;
    const next = { ...t, col: t.col + dc, row: t.row + dr };
    if (fits(next, [id])) {
        mutate(() => Object.assign(t, { col: next.col, row: next.row }));
        return;
    }
    const swap = swapTarget(t, next);
    if (swap) doSwap(t, swap);
}

// The one tile a move would land on, when swapping with it is possible.
function swapTarget(tile, target) {
    if (!inside(target)) return null;
    const hit = draft.tiles.filter((o) => o.id !== tile.id && overlaps(target, o));
    if (hit.length !== 1) return null;
    const other = hit[0];
    if (other.w !== tile.w || other.h !== tile.h) return null;
    return other;
}

function doSwap(a, b) {
    mutate(() => {
        [a.col, b.col] = [b.col, a.col];
        [a.row, b.row] = [b.row, a.row];
    });
}

function stepGrid(e, key) {
    const b = e.target.closest('[data-step]');
    if (!b || b.disabled) return;
    const dir = Number(b.dataset.step);
    mutate((d) => {
        d[key] += dir;
    });
}

function canShrink(key) {
    const limit = key === 'columns'
        ? Math.max(1, ...draft.tiles.map((t) => t.col + t.w))
        : Math.max(1, ...draft.tiles.map((t) => t.row + t.h));
    return draft[key] > limit;
}

function resetToDefault() {
    // Built-ins go back where they started; your own tiles are parked, not lost.
    mutate((d) => {
        const base = clone(info.default_model);
        d.columns = base.columns;
        d.rows = base.rows;
        d.tiles = base.tiles;
    });
    select(null);
    toast('Built-in tiles are back in their default places. Save to keep it.');
}

// ---------------------------------------------------------------- selection

function select(id) {
    selectedId = id;
    if (id) tab = 'props';
    else if (tab === 'props') tab = 'tiles';
    testResult = null;
    renderAll();
}

function setTab(next) {
    if (next === 'props' && !selectedId) {
        toast('Select a tile to see its properties');
        return;
    }
    tab = next;
    renderSide();
    renderTabs();
}

// ---------------------------------------------------------------- validation

function scheduleValidate() {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(runValidate, VALIDATE_MS);
}

async function runValidate() {
    const snap = JSON.stringify(draft);
    try {
        const warnings = await launchpadEditorValidate(draft);
        if (snap !== JSON.stringify(draft)) return; // edited meanwhile
        issues = warnings.map(cleanWarning);
    } catch (err) {
        issues = [String(err)];
    }
    renderFooter();
    renderCanvasBadges();
}

// The app's warnings are written for a log: drop the file prefix.
function cleanWarning(w) {
    return String(w).replace(/^super-actions\.toml:\s*/, '');
}

// ---------------------------------------------------------------- saving

async function save() {
    if (saving) return;
    saving = true;
    renderHeader();
    try {
        const out = await launchpadEditorSave(draft);
        savedJson = JSON.stringify(draft);
        issues = out.warnings.map(cleanWarning);
        info.file_exists = true;
        toast(out.rewrote
            ? 'Saved. The old file could not be edited in place, so it was rewritten (copy kept as .bak).'
            : 'Saved. Your layout is live.');
        // Apply it to the strip now, running any new tile once so it is not blank.
        try {
            await refreshLaunchpadTiles();
        } catch {
            /* a tile command failing is reported by the strip itself */
        }
        await superactions.reload();
    } catch (err) {
        toast(`Could not save: ${err}`, true);
    } finally {
        saving = false;
        renderAll();
    }
}

// ---------------------------------------------------------------- rendering

function renderAll() {
    if (!active) return;
    renderHeader();
    renderSteppers();
    renderCanvas();
    renderTabs();
    renderSide();
    renderFooter();
}

function renderHeader() {
    undoBtn.disabled = !editHistory.canUndo();
    redoBtn.disabled = !editHistory.canRedo();
    const dirty = isDirty();
    saveBtn.disabled = saving || !dirty;
    saveBtn.innerHTML = saving
        ? 'Saving…'
        : `${saveIcon} Save${dirty ? '<i class="le-dot"></i>' : ''}`;
    if (!dirty && discardArmed) disarmDiscard();
}

function stepperHtml(label, key, max) {
    const v = draft[key];
    const minusOff = v <= 1 || !canShrink(key);
    const why = minusOff && v > 1 ? `A tile reaches the last ${key === 'columns' ? 'column' : 'row'}` : `Fewer ${key}`;
    return `<span class="le-stepper-label">${label}</span>
        <button data-step="-1" ${minusOff ? 'disabled' : ''} title="${why}">${minus}</button>
        <b>${v}</b>
        <button data-step="1" ${v >= max ? 'disabled' : ''} title="More ${key}">${plus}</button>`;
}

function renderSteppers() {
    colsEl.innerHTML = stepperHtml('Columns', 'columns', info.max_columns);
    rowsEl.innerHTML = stepperHtml('Rows', 'rows', info.max_rows);
}

function cellHeight() {
    const avail = canvasEl.clientHeight - 8;
    const h = Math.floor((avail - (draft.rows - 1) * GAP) / draft.rows);
    return Math.max(46, Math.min(104, h));
}

function renderCanvas() {
    if (!active || !draft) return;
    const cellH = cellHeight();
    gridEl.style.setProperty('--cols', draft.columns);
    gridEl.style.setProperty('--rows', draft.rows);
    gridEl.style.setProperty('--cell-h', `${cellH}px`);

    let html = '';
    for (let r = 0; r < draft.rows; r++) {
        for (let c = 0; c < draft.columns; c++) {
            html += `<div class="le-cell" style="grid-column:${c + 1};grid-row:${r + 1}"></div>`;
        }
    }
    for (const t of draft.tiles) html += tileHtml(t);
    gridEl.innerHTML = html;
    renderCanvasBadges();
}

function kindOf(id) {
    return entry(id)?.kind ?? 'custom';
}

function tileHtml(t) {
    const kind = kindOf(t.id);
    const [mw, mh] = minSize(t.id);
    const tooSmall = t.w < mw || t.h < mh;
    const key = keyOf(t.id);
    const glyph = isCustom(t.id) ? glyphFor(customOf(t.id)?.icon) : TILE_ICON[t.id] || zap;
    const sel = t.id === selectedId ? ' is-selected' : '';
    return `<div class="le-tile k-${kind}${sel}${tooSmall ? ' is-small' : ''}" data-id="${escapeHtml(t.id)}" tabindex="-1"
        style="grid-column:${t.col + 1} / span ${t.w};grid-row:${t.row + 1} / span ${t.h}">
        <span class="le-tile-icon">${glyph}</span>
        <span class="le-tile-title">${escapeHtml(titleOf(t.id))}</span>
        <span class="le-tile-foot"><span class="le-tile-size">${t.w}&times;${t.h}</span>${key ? `<kbd class="le-key">${escapeHtml(key)}</kbd>` : ''}</span>
        <span class="le-badge" hidden>${alertCircle}</span>
        <span class="le-handle" data-handle title="Drag to resize"></span>
    </div>`;
}

function glyphFor(icon) {
    return GLYPHS[icon] || zap;
}

function keyOf(id) {
    const e = entry(id);
    if (e) return e.mnemonic || '';
    return (customOf(id)?.mnemonic || '').toUpperCase();
}

// Marks tiles the app would drop or complain about, from the warnings' text.
function renderCanvasBadges() {
    if (!gridEl) return;
    for (const el of gridEl.querySelectorAll('.le-tile')) {
        const id = el.dataset.id;
        const hit = issues.filter((w) => w.includes(`"${id}"`) || w.includes(`[tiles.${id}]`));
        el.classList.toggle('has-issue', hit.length > 0);
        const badge = el.querySelector('.le-badge');
        badge.hidden = hit.length === 0;
        badge.title = hit.join('\n');
    }
}

function renderTabs() {
    for (const b of tabsEl.querySelectorAll('[data-tab]')) {
        b.classList.toggle('active', b.dataset.tab === tab);
        if (b.dataset.tab === 'props') b.disabled = !selectedId;
    }
}

// ---- side panel

function renderSide() {
    if (!active) return;
    // Keep the caret where it was when an edit re-renders the panel under it.
    const had = document.activeElement && sideEl.contains(document.activeElement)
        ? document.activeElement.dataset?.field
        : null;
    const caret = had ? document.activeElement.selectionStart : null;

    sideEl.innerHTML = tab === 'props' && selectedId ? propsHtml() : tilesHtml();

    if (had) {
        const el = sideEl.querySelector(`[data-field="${had}"]`);
        if (el) {
            el.focus();
            if (caret !== null && el.setSelectionRange) {
                try {
                    el.setSelectionRange(caret, caret);
                } catch {
                    /* not a text field */
                }
            }
        }
    }
}

function chipHtml(id, opts = {}) {
    const kind = kindOf(id);
    const glyph = isCustom(id) ? glyphFor(customOf(id)?.icon) : TILE_ICON[id] || zap;
    const [w, h] = defaultSize(id);
    // The size it lands at; it can be resized afterwards.
    const size = `${w}×${h}`;
    return `<button class="le-chip k-${kind}" data-add="${escapeHtml(id)}" title="${escapeHtml(opts.title || 'Click to add, or drag onto the grid')}">
        <span class="le-chip-icon">${glyph}</span>
        <span class="le-chip-text"><b>${escapeHtml(titleOf(id))}</b><small>${opts.sub || size}</small></span>
    </button>`;
}

function tilesHtml() {
    const placed = new Set(draft.tiles.map((t) => t.id));
    const free = info.catalog.filter((c) => !placed.has(c.id) && c.kind !== 'widget');
    const freeWidgets = info.catalog.filter((c) => !placed.has(c.id) && c.kind === 'widget');
    const parked = draft.custom.filter((c) => !placed.has(c.id));
    const mine = draft.custom.filter((c) => placed.has(c.id));

    let html = '<p class="le-note le-drop-hint">Drag a tile onto the grid to add it, or off the grid to remove it.</p>';
    if (free.length) {
        html += `<div class="le-section">Controls</div><div class="le-chips">${free.map((c) => chipHtml(c.id)).join('')}</div>`;
    }
    if (freeWidgets.length) {
        html += `<div class="le-section">Widgets</div><div class="le-chips">${freeWidgets.map((c) => chipHtml(c.id)).join('')}</div>`;
    }
    if (!free.length && !freeWidgets.length) {
        html += '<p class="le-empty">Every built-in tile is on the grid.</p>';
    }

    html += '<div class="le-section">Your tiles</div>';
    const own = [...parked.map((c) => chipHtml(c.id, { sub: 'not on grid' })), ...mine.map((c) => chipHtml(c.id, { sub: 'on grid', title: 'Select it on the grid to edit' }))];
    html += own.length ? `<div class="le-chips">${own.join('')}</div>` : '';
    html += `<button class="le-new" data-new>${plus} New tile…</button>
        <p class="le-note">A tile of your own can show the output of a command and run another when pressed.</p>`;
    return html;
}

function field(label, name, value, opts = {}) {
    const attrs = `data-field="${name}" spellcheck="false" autocomplete="off"`;
    const control = opts.area
        ? `<textarea ${attrs} rows="${opts.rows || 3}" placeholder="${escapeHtml(opts.placeholder || '')}">${escapeHtml(value)}</textarea>`
        : `<input ${attrs} type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(opts.placeholder || '')}" ${opts.max ? `maxlength="${opts.max}"` : ''}>`;
    return `<label class="le-field${opts.area ? ' is-area' : ''}"><span>${label}${opts.hint ? `<em>${opts.hint}</em>` : ''}</span>${control}</label>`;
}

function sizeRow(t, id) {
    const [mw, mh] = minSize(id);
    const btn = (dw, dh, icon, label) => {
        const next = { ...t, w: t.w + dw, h: t.h + dh };
        const ok = next.w >= mw && next.h >= mh && fits(next, [id]);
        return `<button data-resize="${dw},${dh}" ${ok ? '' : 'disabled'} title="${label}">${icon}</button>`;
    };
    return `<div class="le-row"><span class="le-row-label">Size</span>
        <div class="le-size">
            <span>${btn(-1, 0, minus, 'Narrower')}<b>${t.w}</b>${btn(1, 0, plus, 'Wider')}</span>
            <i>&times;</i>
            <span>${btn(0, -1, minus, 'Shorter')}<b>${t.h}</b>${btn(0, 1, plus, 'Taller')}</span>
        </div>
        <small>min ${mw}×${mh}</small></div>`;
}

function usedKeys(except) {
    const keys = new Map();
    for (const t of draft.tiles) {
        if (t.id === except) continue;
        const k = keyOf(t.id);
        if (k) keys.set(k.toUpperCase(), titleOf(t.id));
    }
    return keys;
}

function propsHtml() {
    const id = selectedId;
    const t = tileOf(id);
    const placed = Boolean(t);
    if (!isCustom(id)) {
        const e = entry(id);
        return `<div class="le-props-head k-${e.kind}"><span class="le-chip-icon">${TILE_ICON[id] || zap}</span><div><b>${escapeHtml(e.title)}</b><small>Built-in tile</small></div></div>
            <p class="le-desc">${escapeHtml(e.description)}</p>
            ${e.mnemonic ? `<div class="le-row"><span class="le-row-label">Shortcut</span><kbd class="le-key big">Alt+${escapeHtml(e.mnemonic)}</kbd></div>` : '<div class="le-row"><span class="le-row-label">Shortcut</span><small>none, it is read-only</small></div>'}
            ${placed ? sizeRow(t, id) : ''}
            <div class="le-actions">
                ${placed ? `<button class="le-btn" data-remove>${xMark} Remove from grid</button>` : ''}
            </div>`;
    }

    const c = customOf(id);
    if (!c) return tilesHtml();
    const taken = usedKeys(id);
    const mine = issues.filter((w) => w.includes(`"${id}"`) || w.includes(`[tiles.${id}]`));
    const iconChips = Object.entries(GLYPHS)
        .map(([name, svg]) => `<button type="button" class="le-glyph${c.icon === name ? ' active' : ''}" data-glyph="${name}" title="${name}">${svg}</button>`)
        .join('');
    const refreshKnown = REFRESH_CHOICES.some(([v]) => v === c.refresh);
    const options = [...REFRESH_CHOICES, ...(refreshKnown ? [] : [[c.refresh, `Every ${c.refresh}`]])]
        .map(([v, label]) => `<option value="${escapeHtml(v)}" ${v === c.refresh ? 'selected' : ''}>${label}</option>`)
        .join('');

    return `<div class="le-props-head k-custom"><span class="le-chip-icon">${glyphFor(c.icon)}</span><div><b>${escapeHtml(titleOf(id))}</b><small>Your tile</small></div></div>
        ${mine.length ? `<div class="le-inline-issues">${mine.map((w) => `<div>${alertCircle}<span>${escapeHtml(w)}</span></div>`).join('')}</div>` : ''}
        ${field('Title', 'title', c.title, { placeholder: titleCase(id) })}
        ${field('Name', 'id', c.id, { hint: 'letters, digits, - and _', max: 40 })}
        <div class="le-field"><span>Icon</span>
            <div class="le-glyphs">${iconChips}</div>
            <input data-field="icon" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(GLYPHS[c.icon] ? '' : c.icon)}" placeholder="…or the path of an image">
        </div>
        ${field('Show', 'value', c.value, { area: true, rows: 3, hint: 'a command that prints a tile value', placeholder: '{"value":"42%","caption":"DISK"}' })}
        <div class="le-testrow">
            <button class="le-btn" data-test ${c.value.trim() && !testing ? '' : 'disabled'}>${play} ${testing ? 'Running…' : 'Test'}</button>
            <label class="le-select"><span>Refresh</span><select data-field="refresh">${options}</select></label>
        </div>
        ${testPanel(id)}
        ${field('When pressed', 'press', c.press, { area: true, rows: 2, hint: 'a command to run', placeholder: 'start ms-settings:' })}
        ${field('Ask first', 'confirm', c.confirm, { hint: 'a question, shown before it runs', placeholder: 'Run it?' })}
        <div class="le-row"><span class="le-row-label">Shortcut</span>
            <span class="le-keyin">Alt+<input data-field="mnemonic" type="text" maxlength="1" value="${escapeHtml(c.mnemonic)}" spellcheck="false" autocomplete="off"></span>
            <small>${taken.size ? `taken: ${[...taken.keys()].join(' ')}` : ''}</small></div>
        ${placed ? sizeRow(t, id) : '<p class="le-note">This tile is not on the grid. Add it from the Tiles tab.</p>'}
        <div class="le-actions">
            ${placed ? `<button class="le-btn" data-remove>${xMark} Remove from grid</button>` : ''}
            <button class="le-btn le-danger-btn" data-delete>${trashIcon} Delete tile</button>
        </div>`;
}

function testPanel(id) {
    if (!testResult || testResult.id !== id) return '';
    const r = testResult.result;
    if (!r.ok) {
        return `<div class="le-test bad"><b>${alertCircle} ${escapeHtml(r.error || 'Failed')}</b>${r.output ? `<pre>${escapeHtml(r.output.slice(0, 400))}</pre>` : ''}</div>`;
    }
    const p = r.parsed;
    return `<div class="le-test good"><b>${checkIcon} Works</b>
        <div class="le-test-card"><strong>${escapeHtml(p.value)}</strong>${p.caption ? `<small>${escapeHtml(p.caption)}</small>` : ''}${p.lines?.length ? p.lines.map((l) => `<small>${escapeHtml(l)}</small>`).join('') : ''}</div></div>`;
}

function renderFooter() {
    if (!footerEl) return;
    const n = issues.length;
    const status = n
        ? `<button class="le-status warn" data-issues>${alertCircle} ${n} issue${n === 1 ? '' : 's'}<span>${escapeHtml(issues[0])}</span></button>`
        : `<span class="le-status ok">${checkIcon} Looks good</span>`;
    footerEl.innerHTML = `${status}
        <span class="le-spacer"></span>
        <button class="le-link" data-copy-path title="Copy the file path">${copyIcon}<span>${escapeHtml(info.path)}</span></button>`;
    renderIssues();
}

function renderIssues() {
    issuesEl.hidden = !(issuesOpen && issues.length);
    if (issuesEl.hidden) return;
    issuesEl.innerHTML = `<div class="le-issues-head"><b>What the launcher would do with this layout</b><button data-close-issues>${xMark}</button></div>
        ${issues.map((w) => `<div class="le-issue">${alertCircle}<span>${escapeHtml(w)}</span></div>`).join('')}`;
}

function toggleIssues(open) {
    issuesOpen = open ?? !issuesOpen;
    renderIssues();
}

function onFooterClick(e) {
    if (e.target.closest('[data-issues]')) toggleIssues();
    else if (e.target.closest('[data-copy-path]')) {
        navigator.clipboard
            ?.writeText(info.path)
            .then(() => toast('Path copied'))
            .catch(() => toast('Could not copy the path', true));
    }
}

function toast(text, isError = false) {
    toastEl.textContent = text;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), isError ? 4200 : 2400);
}

// ---------------------------------------------------------------- side events

function onSideClick(e) {
    const add = e.target.closest('[data-add]');
    if (add && !justDragged) {
        const id = add.dataset.add;
        // A parked tile of your own, or a built-in not yet placed.
        if (!tileOf(id)) autoPlace(id);
        else select(id);
        return;
    }
    if (e.target.closest('[data-new]')) {
        newCustom();
        return;
    }
    const resize = e.target.closest('[data-resize]');
    if (resize && !resize.disabled && selectedId) {
        const [dw, dh] = resize.dataset.resize.split(',').map(Number);
        resizeBy(selectedId, dw, dh);
        return;
    }
    if (e.target.closest('[data-remove]')) {
        const id = selectedId;
        removeFromGrid(id);
        // A built-in has nothing left to show once it is off the grid.
        if (!isCustom(id)) select(null);
        else renderAll();
        return;
    }
    if (e.target.closest('[data-delete]')) {
        deleteCustom(selectedId);
        return;
    }
    const glyph = e.target.closest('[data-glyph]');
    if (glyph) {
        const c = customOf(selectedId);
        if (!c) return;
        mutate(() => {
            c.icon = c.icon === glyph.dataset.glyph ? '' : glyph.dataset.glyph;
        });
        return;
    }
    if (e.target.closest('[data-test]')) void runTest();
}

async function runTest() {
    const c = customOf(selectedId);
    if (!c || testing) return;
    testing = true;
    testResult = null;
    renderSide();
    try {
        const result = await launchpadEditorTestValue(c.value);
        testResult = { id: c.id, result };
    } catch (err) {
        testResult = { id: c.id, result: { ok: false, error: String(err), output: '' } };
    }
    testing = false;
    renderSide();
}

// Typing updates the draft live; one undo step covers a whole stretch in a field.
function onSideInput(e) {
    const el = e.target.closest('[data-field]');
    const c = customOf(selectedId);
    if (!el || !c) return;
    const name = el.dataset.field;
    if (name === 'id' || name === 'refresh') return; // applied on change
    if (!fieldSnapshotTaken) {
        snapshot();
        fieldSnapshotTaken = true;
    }
    c[name] = name === 'mnemonic' ? el.value.toUpperCase().slice(0, 1) : el.value;
    if (name === 'mnemonic') el.value = c[name];
    // Cheap refresh of what depends on the field, without rebuilding the panel
    // under the caret.
    renderHeader();
    renderCanvas();
    scheduleValidate();
    const head = sideEl.querySelector('.le-props-head b');
    if (head && name === 'title') head.textContent = titleOf(c.id);
    const testBtn = sideEl.querySelector('[data-test]');
    if (testBtn && name === 'value') testBtn.disabled = !c.value.trim() || testing;
}

function onSideChange(e) {
    const el = e.target.closest('[data-field]');
    const c = customOf(selectedId);
    if (!el || !c) return;
    if (el.dataset.field === 'refresh') {
        mutate(() => {
            c.refresh = el.value;
        });
    } else if (el.dataset.field === 'id') {
        renameCustom(c, el.value);
    } else if (el.dataset.field === 'icon') {
        renderSide();
    }
}

function renameCustom(c, raw) {
    const next = raw.trim();
    if (next === c.id) return;
    const problem = !/^[A-Za-z0-9_-]+$/.test(next)
        ? 'A name can use letters, digits, - and _ only'
        : entry(next)
          ? `"${next}" is a built-in tile`
          : customOf(next)
            ? `There is already a tile named "${next}"`
            : '';
    if (problem) {
        toast(problem, true);
        renderSide();
        return;
    }
    const old = c.id;
    mutate((d) => {
        d.custom.find((x) => x.id === old).id = next;
        const t = d.tiles.find((x) => x.id === old);
        if (t) t.id = next;
    });
    selectedId = next;
    renderAll();
}

// ---------------------------------------------------------------- dragging

function cellAt(clientX, clientY) {
    const rect = gridEl.getBoundingClientRect();
    const cellH = cellHeight();
    const colW = (rect.width + GAP) / draft.columns;
    return {
        col: Math.floor((clientX - rect.left) / colW),
        row: Math.floor((clientY - rect.top) / (cellH + GAP)),
        over: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
    };
}

// Whether the pointer is still over the canvas panel. Leaving it - onto the tray,
// or off the window - means the dragged tile is being taken off the grid.
function pointerOverCanvas(e) {
    const r = canvasEl.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function onGridPointerDown(e) {
    if (e.button !== 0) return;
    const tileEl = e.target.closest('.le-tile');
    if (!tileEl) {
        // Empty canvas: let go of the selection.
        if (selectedId) select(null);
        return;
    }
    const id = tileEl.dataset.id;
    const t = tileOf(id);
    const wasSelected = selectedId === id;
    if (!wasSelected) select(id);
    const cell = cellAt(e.clientX, e.clientY);
    // Keep receiving moves when the pointer leaves the window: dragging a tile
    // off the grid is how it is removed.
    try {
        gridEl.setPointerCapture(e.pointerId);
    } catch {
        /* a synthetic event has no pointer to capture */
    }
    drag = {
        kind: e.target.closest('[data-handle]') ? 'resize' : 'move',
        id,
        startX: e.clientX,
        startY: e.clientY,
        grab: { col: cell.col - t.col, row: cell.row - t.row },
        moved: false,
        target: null,
    };
    e.preventDefault();
}

function onSidePointerDown(e) {
    const chip = e.target.closest('[data-add]');
    if (!chip || e.button !== 0) return;
    const id = chip.dataset.add;
    if (tileOf(id)) return;
    drag = { kind: 'add', id, startX: e.clientX, startY: e.clientY, moved: false, target: null };
}

function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.moved = true;
        document.body.classList.add('le-dragging');
        if (drag.kind === 'add') showChip(drag.id);
        // The tray is where a dragged-out tile lands, so have it showing.
        if (drag.kind === 'move' && tab !== 'tiles') {
            tab = 'tiles';
            renderTabs();
            renderSide();
        }
    }
    if (drag.kind === 'add') moveChip(e.clientX, e.clientY);
    drag.target = computeTarget(e);
    // Off the grid: a placed tile is being taken out. Say so, and follow the
    // pointer so it is clear what will be removed.
    const leaving = Boolean(drag.target?.remove);
    sideEl.parentElement.classList.toggle('is-drop', leaving);
    gridEl
        .querySelector(`.le-tile[data-id="${CSS.escape(drag.id)}"]`)
        ?.classList.toggle('is-leaving', leaving);
    if (drag.kind === 'move') {
        if (leaving) {
            showChip(drag.id, `Remove ${titleOf(drag.id)}`);
            moveChip(e.clientX, e.clientY);
        } else hideChip();
    }
    paintGhost();
}

function computeTarget(e) {
    const cell = cellAt(e.clientX, e.clientY);
    if (drag.kind === 'resize') {
        const t = tileOf(drag.id);
        const [mw, mh] = minSize(drag.id);
        const w = Math.max(mw, Math.min(cell.col - t.col + 1, draft.columns - t.col));
        const h = Math.max(mh, Math.min(cell.row - t.row + 1, draft.rows - t.row));
        const rect = { col: t.col, row: t.row, w, h };
        return { rect, ok: fits(rect, [drag.id]) };
    }
    if (!cell.over && drag.kind === 'add') return null;
    if (drag.kind === 'move' && !pointerOverCanvas(e)) return { remove: true, ok: true };
    if (drag.kind === 'add') {
        const [w, h] = defaultSize(drag.id);
        const [mw, mh] = minSize(drag.id);
        // Anchor by the tile's top-left cell, shrinking to the minimum if the
        // default does not fit there.
        const col = Math.max(0, Math.min(cell.col, draft.columns - 1));
        const row = Math.max(0, Math.min(cell.row, draft.rows - 1));
        for (const [cw, ch] of [[w, h], [mw, mh]]) {
            const rect = { col: Math.min(col, draft.columns - cw), row: Math.min(row, draft.rows - ch), w: cw, h: ch };
            if (fits(rect)) return { rect, ok: true, size: [cw, ch] };
        }
        return { rect: { col, row, w: mw, h: mh }, ok: false };
    }
    const t = tileOf(drag.id);
    const col = Math.max(0, Math.min(cell.col - drag.grab.col, draft.columns - t.w));
    const row = Math.max(0, Math.min(cell.row - drag.grab.row, draft.rows - t.h));
    const rect = { col, row, w: t.w, h: t.h };
    if (fits(rect, [t.id])) return { rect, ok: true };
    const swap = swapTarget(t, rect);
    if (swap) return { rect, ok: true, swap };
    return { rect, ok: false };
}

function paintGhost() {
    gridEl.querySelector('.le-ghost')?.remove();
    const tg = drag?.target;
    if (!tg || tg.remove) return;
    const ghost = document.createElement('div');
    ghost.className = `le-ghost ${tg.ok ? (tg.swap ? 'swap' : 'ok') : 'bad'}`;
    ghost.style.gridColumn = `${tg.rect.col + 1} / span ${tg.rect.w}`;
    ghost.style.gridRow = `${tg.rect.row + 1} / span ${tg.rect.h}`;
    if (tg.swap) ghost.textContent = `Swap with ${titleOf(tg.swap.id)}`;
    gridEl.appendChild(ghost);
}

function onPointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearDragMarks();
    hideChip();
    gridEl.querySelector('.le-ghost')?.remove();
    if (!d.moved) return;
    justDragged = true;
    setTimeout(() => {
        justDragged = false;
    }, 0);
    const tg = d.target;
    if (!tg) return;
    if (tg.remove) {
        const id = d.id;
        removeFromGrid(id);
        if (!isCustom(id)) select(null);
        return;
    }
    if (!tg.ok) {
        toast(d.kind === 'resize' ? 'Not enough room there' : 'That spot is taken', true);
        return;
    }
    if (d.kind === 'add') {
        const [w, h] = tg.size || [tg.rect.w, tg.rect.h];
        place(d.id, tg.rect.col, tg.rect.row, w, h);
    } else if (d.kind === 'resize') {
        const t = tileOf(d.id);
        if (tg.rect.w !== t.w || tg.rect.h !== t.h) mutate(() => Object.assign(t, { w: tg.rect.w, h: tg.rect.h }));
    } else if (tg.swap) {
        doSwap(tileOf(d.id), tg.swap);
    } else {
        const t = tileOf(d.id);
        if (tg.rect.col !== t.col || tg.rect.row !== t.row) mutate(() => Object.assign(t, { col: tg.rect.col, row: tg.rect.row }));
    }
}

function clearDragMarks() {
    document.body.classList.remove('le-dragging');
    sideEl?.parentElement?.classList.remove('is-drop');
    gridEl?.querySelector('.le-tile.is-leaving')?.classList.remove('is-leaving');
}

function cancelDrag() {
    if (!drag) return;
    drag = null;
    clearDragMarks();
    hideChip();
    gridEl?.querySelector('.le-ghost')?.remove();
}

function showChip(id, text) {
    chipEl.classList.toggle('is-remove', Boolean(text));
    chipEl.innerHTML = `<span class="le-chip-icon">${isCustom(id) ? glyphFor(customOf(id)?.icon) : TILE_ICON[id] || zap}</span>${escapeHtml(text || titleOf(id))}`;
    chipEl.hidden = false;
}

function moveChip(x, y) {
    chipEl.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

function hideChip() {
    if (chipEl) chipEl.hidden = true;
}

// ---------------------------------------------------------------- keyboard

// Only a field of the editor counts: the launcher's own search box can still
// hold focus underneath it, and that is not the user typing here.
const isTyping = (el) =>
    el &&
    root.contains(el) &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export function handleKey(e) {
    if (!active) return false;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (ctrl && !e.shiftKey && key === 's') {
        e.preventDefault();
        void save();
        return true;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        if (isTyping(document.activeElement)) document.activeElement.blur();
        else if (issuesOpen) toggleIssues(false);
        else if (drag) cancelDrag();
        else requestClose();
        return true;
    }
    // Inside a field, typing and the field's own undo are left alone.
    if (isTyping(document.activeElement)) return false;

    if (ctrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return true;
    }
    if (ctrl && key === 'y') {
        e.preventDefault();
        redo();
        return true;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && tileOf(selectedId)) {
            e.preventDefault();
            const id = selectedId;
            removeFromGrid(id);
            if (!isCustom(id)) select(null);
            return true;
        }
    }

    if (e.key.startsWith('Arrow') && selectedId && tileOf(selectedId)) {
        e.preventDefault();
        const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (e.shiftKey) {
            if (!resizeBy(selectedId, dx, dy)) toast('Cannot resize that way', true);
        } else nudge(selectedId, dx, dy);
        return true;
    }

    if (e.key === 'Tab') {
        e.preventDefault();
        cycleSelection(e.shiftKey ? -1 : 1);
        return true;
    }
    if (!ctrl && key === 'n') {
        e.preventDefault();
        newCustom();
        return true;
    }
    // Modal: nothing underneath should react, and a stray letter must not be
    // typed into the launcher's search box behind the editor.
    if (!ctrl && !e.altKey) e.preventDefault();
    return true;
}

function cycleSelection(dir) {
    const ordered = [...draft.tiles].sort((a, b) => a.row - b.row || a.col - b.col);
    if (!ordered.length) return;
    const i = ordered.findIndex((t) => t.id === selectedId);
    const next = ordered[(i + dir + ordered.length) % ordered.length];
    select(next.id);
}
