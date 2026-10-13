// Quick capture from the search box: save a note, add a task, or tick one off
// without opening the panel.
//
//   :note buy milk #errands   saves a note (hashtags become tags)
//   :todo call the dentist    adds a task to today
//   :done                     lists today's open tasks; Enter ticks one off
//   :done dentist             the same, narrowed to what matches
//
// The grammar and the row ids live in catalog.js (pure, testable); this module
// builds the rows from live data and runs the action. Tasks go through the same
// full-set save /todo uses, with the same limits, so the two never disagree.

import { todoList, todoSave, notesSave } from '../ipc.js';
import { notebook, listChecks, check, alertCircle } from '../icons.js';
import { quickResultId, splitNoteTags } from '../catalog.js';
import * as todoCmd from '../screens/commands/todo.js';
import * as banner from './banner.js';

// Mirrors /todo: names at most this long. The per-day unfinished cap is off,
// as in /todo; uncomment UNFINISHED_LIMIT and its checks below to restore it.
// const UNFINISHED_LIMIT = 3;
const NAME_MAX_LEN = 256;
const TITLE_MAX = 90;

const pad2 = (n) => String(n).padStart(2, '0');

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const clip = (s, n = TITLE_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function row(action, payload, title, subtitle, iconSvg, score) {
    return { id: quickResultId(action, payload), kind: 'app', title, subtitle, path: '', score, iconSvg };
}

// A row that explains why nothing will happen, instead of an empty list.
const noteRow = (title, subtitle, icon = alertCircle) =>
    row('none', subtitle, title, subtitle, icon, 0);

async function allTasks() {
    try {
        return (await todoList()) || [];
    } catch {
        return [];
    }
}

const openToday = (tasks) => tasks.filter((t) => t.due_date === todayKey() && !t.done);

/** The result rows for a parsed `:note` / `:todo` / `:done` query. */
export async function quickCaptureRows(q) {
    if (q.action === 'note') {
        const { body, tags } = splitNoteTags(q.text);
        if (!body && !tags.length) {
            return [noteRow('Type a note', 'Everything after :note is saved, #tags become tags', notebook)];
        }
        return [
            row(
                'note',
                q.text,
                clip(body || tags.map((t) => `#${t}`).join(' ')),
                `Save as a new note${tags.length && body ? ` · ${tags.map((t) => `#${t}`).join(' ')}` : ''} · Enter`,
                notebook,
                1,
            ),
        ];
    }

    const tasks = await allTasks();
    const open = openToday(tasks);

    if (q.action === 'task') {
        if (!q.text) return [noteRow('Type a task', 'Everything after :todo is added to today', listChecks)];
        // if (open.length >= UNFINISHED_LIMIT) {
        //     return [
        //         noteRow(
        //             clip(q.text),
        //             `Today already has ${UNFINISHED_LIMIT} unfinished tasks. Finish one first (:done)`,
        //         ),
        //     ];
        // }
        return [
            row(
                'task',
                q.text,
                clip(q.text),
                // `Add to today · ${open.length}/${UNFINISHED_LIMIT} unfinished · Enter`,
                `Add to today · ${open.length} unfinished · Enter`,
                listChecks,
                1,
            ),
        ];
    }

    // done
    const needle = q.text.toLowerCase();
    const matches = open.filter((t) => !needle || t.name.toLowerCase().includes(needle));
    if (!matches.length) {
        return [
            noteRow(
                open.length ? 'No open task matches' : 'Nothing left to do today',
                open.length ? `Open tasks: ${open.map((t) => t.name).join(' · ')}` : 'You have no unfinished tasks today',
                open.length ? alertCircle : check,
            ),
        ];
    }
    return matches.map((t, i) =>
        row('done', t.id, clip(t.name), 'Mark as done · Enter', check, matches.length - i),
    );
}

/**
 * Runs the action behind a `quick:` row. Resolves to `{ clear }`: whether the
 * search box should be emptied (a note or task was added) or re-run (a task was
 * ticked, so the list shrinks).
 */
export async function runQuick({ action, payload }) {
    try {
        if (action === 'none') {
            banner.show(payload || 'Nothing to do', 'info', 2.4);
            return { clear: false };
        }
        if (action === 'note') return await saveNote(payload);
        if (action === 'task') return await addTask(payload);
        if (action === 'done') return await finishTask(payload);
    } catch (err) {
        console.error('[quick] failed:', err);
        banner.show(`Could not save: ${err}`, 'error', 3);
    }
    return { clear: false };
}

async function saveNote(text) {
    const { body, tags } = splitNoteTags(text);
    if (!body && !tags.length) return { clear: false };
    const now = Math.floor(Date.now() / 1000);
    await notesSave({
        id: crypto.randomUUID(),
        title: '',
        body,
        tags,
        created_at_unix_s: now,
        updated_at_unix_s: now,
    });
    banner.show(`Note saved${tags.length ? ` · ${tags.map((t) => `#${t}`).join(' ')}` : ''}`, 'success', 1.6);
    return { clear: true };
}

// /todo holds unsaved edits in memory and writes the whole set on Save; adding
// behind its back would be overwritten by that Save, so ask for the Save first.
function todoBlocked() {
    if (!todoCmd.hasUnsavedChanges()) return false;
    banner.show('Save your changes in /todo first (Ctrl+S)', 'warning', 3);
    return true;
}

async function addTask(text) {
    const name = text.trim().slice(0, NAME_MAX_LEN);
    if (!name || todoBlocked()) return { clear: false };
    const tasks = await allTasks();
    // if (openToday(tasks).length >= UNFINISHED_LIMIT) {
    //     banner.show(`Today already has ${UNFINISHED_LIMIT} unfinished tasks`, 'warning', 2.6);
    //     return { clear: false };
    // }
    tasks.push({
        id: crypto.randomUUID(),
        name,
        done: false,
        due_date: todayKey(),
        created_at_unix_s: Math.floor(Date.now() / 1000),
    });
    await todoSave(tasks);
    todoCmd.reloadIfClean();
    banner.show('Task added to today', 'success', 1.6);
    return { clear: true };
}

async function finishTask(id) {
    if (todoBlocked()) return { clear: false };
    const tasks = await allTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) {
        banner.show('That task is gone', 'info', 1.8);
        return { clear: false };
    }
    task.done = true;
    await todoSave(tasks);
    todoCmd.reloadIfClean();
    banner.show(`Done: ${clip(task.name, 40)}`, 'success', 1.6);
    return { clear: false };
}
