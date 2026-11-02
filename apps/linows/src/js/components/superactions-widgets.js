// The data widgets of the Super Actions strip: Todo, Focus, Speed,
// Notes, Clock and System. Unlike the system toggles they have no native
// adapter; each reads a feature the app already has and hands the strip a
// "reading" - a headline, a caption and a few lines - which superactions.js
// draws with the same anatomy as a tile of your own. They are not in the default
// strip: they appear when ~/.look/super-actions.toml (or the editor) places one.
//
// Every widget is read for the shape of the cells it was given: 'compact' (one
// cell: the headline only), 'wide' (one row, several columns: a one-line
// summary beside it) or 'tall' (several rows: the caption and a short list).
//
// A reading is `{ value, caption, lines, tone, active, icon }`. `tone` is
// 'warn' | 'danger' for a quota getting tight; `active` lights the tile up the
// way an "on" toggle is (a running timer, a finished list).

import {
    todoList,
    notesList,
    systemUptime,
    getSystemInfo,
    waterStatus,
    waterDrink,
    onWaterChanged,
} from '../ipc.js';
import { snapshot as pomoSnapshot, formatTime, togglePlayback } from '../screens/commands/pomo.js';
import * as speed from '../screens/commands/speed.js';
import { listChecks, timer, clock, gauge, notebook, info, droplet } from '../icons.js';
import { noteTitle } from './superactions-format.js';

const TTL_MS = 15_000;
const SYSINFO_TTL_MS = 60_000;
let openCommand = null;

// The Water widget reads this copy, which the backend keeps true: it pushes a
// status on every glass and every tick, so the once-a-second redraw costs no IPC.
let water = null;
let waterDrankAt = 0;
let onWater = null;
const SPLASH_MS = 900;

/** Calls `fn` whenever the water numbers change, so the tile stays true. */
export function watchWater(fn) {
    onWater = fn;
    void waterStatus()
        .then((status) => {
            water = status;
            onWater?.();
        })
        .catch((err) => console.error('[water] status failed:', err));
    void onWaterChanged((event) => {
        water = event.payload;
        onWater?.();
    });
}

function drinkWater() {
    void waterDrink(1)
        .then((status) => {
            water = status;
            waterDrankAt = Date.now();
            onWater?.();
        })
        .catch((err) => console.error('[water] drink failed:', err));
}

const waterCaption = (w) => {
    if (w.count >= w.goal) return 'Goal reached';
    if (w.due) return 'Time to drink';
    if (!w.next_unix_s) return 'Press to log a glass';
    const minutes = Math.max(1, Math.ceil((w.next_unix_s * 1000 - Date.now()) / 60000));
    return minutes >= 60 ? `Next in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `Next in ${minutes} min`;
};

/** superactions.js is told how to jump into a command panel by app.js. */
export function setOpenCommand(fn) {
    openCommand = fn;
}

// A value read from the backend, reused for a few seconds: a summon, a timer tick
// and a resize all ask, and none of them needs a fresh disk read.
function cached(ttl, load) {
    let at = 0;
    let value;
    return async () => {
        if (Date.now() - at < ttl) return value;
        value = await load();
        at = Date.now();
        return value;
    };
}

const todayKey = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const readTodos = cached(TTL_MS, async () => {
    try {
        const today = todayKey();
        return ((await todoList()) || []).filter((t) => t.due_date === today);
    } catch {
        return [];
    }
});

const readNotes = cached(TTL_MS, async () => {
    try {
        return (await notesList()) || [];
    } catch {
        return [];
    }
});

const readSystem = cached(SYSINFO_TTL_MS, async () => {
    try {
        const [uptime, sections] = await Promise.all([systemUptime(), getSystemInfo()]);
        return { uptime, rows: (sections || []).flat() };
    } catch {
        return { uptime: null, rows: [] };
    }
});

// id -> { icon, live, read(roomy), press() }
//
// `live` widgets are re-read every second (a countdown, a clock); the others
// when the strip is shown.
const WIDGETS = {
    water: {
        icon: droplet,
        // The "next in" caption counts down.
        live: true,
        async read(shape) {
            if (!water) return { value: '--', caption: 'Water', lines: [] };
            const left = Math.max(0, water.goal - water.count);
            return {
                value: `${water.count}/${water.goal}`,
                caption: waterCaption(water),
                active: water.count >= water.goal,
                // The glass fills as the day goes; the tile wears it as a wave.
                fill: Math.min(1, water.count / water.goal),
                due: water.due,
                splash: Date.now() - waterDrankAt < SPLASH_MS,
                lines:
                    shape === 'tall'
                        ? [left ? `${left} to go` : 'Well done', `A glass every ${water.interval_min} min`]
                        : [],
            };
        },
        press: drinkWater,
    },

    todo: {
        icon: listChecks,
        async read(shape) {
            const tasks = await readTodos();
            const done = tasks.filter((t) => t.done).length;
            const open = tasks.filter((t) => !t.done).map((t) => t.name);
            return {
                value: `${done}/${tasks.length}`,
                caption:
                    shape === 'wide' && open.length
                        ? `Done today  ·  next: ${open[0]}`
                        : tasks.length
                          ? open.length || shape !== 'wide'
                              ? 'Done today'
                              : 'Done today  ·  all clear'
                          : 'No tasks today',
                active: tasks.length > 0 && open.length === 0,
                progress: tasks.length ? done / tasks.length : null,
                lines: shape === 'tall' ? (open.length ? open.slice(0, 5).map((n) => `• ${n}`) : tasks.length ? ['All clear'] : []) : [],
            };
        },
        press: () => openCommand?.('todo'),
    },

    pomo: {
        icon: timer,
        live: true,
        async read(shape) {
            const s = pomoSnapshot();
            if (!s) return { value: 'Start', caption: shape === 'compact' ? 'Focus timer' : 'Press to begin a session', lines: [] };
            return {
                value: formatTime(s.secondsLeft),
                caption: `${s.type === 'focus' ? 'Focus' : 'Break'} ${s.index + 1}/${s.count}`,
                active: s.running,
                progress: s.progress,
                lines: shape === 'tall' ? [s.running ? 'Running, press to pause' : 'Paused, press to resume'] : [],
            };
        },
        press: () => togglePlayback(),
    },

    speed: {
        icon: gauge,
        live: true,
        async read(shape) {
            const { running, reading, error } = speed.snapshot();
            if (running) return { value: '…', caption: shape === 'compact' ? 'Testing' : 'Testing, about 15 seconds', active: true, lines: [] };
            if (!reading) return { value: 'Run', caption: error ? 'Test failed' : 'Press to test your speed', lines: shape === 'tall' && error ? [String(error)] : [] };
            return {
                value: reading.download_display,
                caption:
                    shape === 'wide'
                        ? `Download  ·  Upload ${reading.upload_display}  ·  Ping ${reading.latency_display}`
                        : 'Download',
                lines: shape === 'tall' ? [`Upload  ${reading.upload_display}`, `Ping  ${reading.latency_display}`] : [],
            };
        },
        press() {
            if (!speed.snapshot().running) void speed.run();
        },
    },

    notes: {
        icon: notebook,
        async read(shape) {
            const notes = await readNotes();
            return {
                value: String(notes.length),
                caption:
                    shape === 'wide' && notes.length
                        ? `Latest: ${noteTitle(notes[0])}`
                        : notes.length === 1
                          ? 'Note'
                          : 'Notes',
                lines: shape === 'tall' ? notes.slice(0, 4).map(noteTitle) : [],
            };
        },
        press: () => openCommand?.('note'),
    },

    clock: {
        icon: clock,
        live: true,
        async read(shape) {
            const now = new Date();
            const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
            return { value: time, caption: date, lines: shape === 'tall' ? [now.toLocaleDateString([], { year: 'numeric' })] : [] };
        },
    },

    system: {
        icon: info,
        async read(shape) {
            const { uptime, rows } = await readSystem();
            const wanted = rows.filter((r) => !/uptime/i.test(r.label)).slice(0, 4);
            return {
                value: uptime || '--',
                caption:
                    shape === 'wide' && wanted.length
                        ? `Uptime  ·  ${wanted.slice(0, 2).map((r) => `${r.label} ${r.value}`).join('  ·  ')}`
                        : 'Uptime',
                lines: shape === 'tall' ? wanted.map((r) => `${r.label}  ${r.value}`) : [],
            };
        },
    },
};

export const isWidget = (id) => Object.hasOwn(WIDGETS, id);
export const iconFor = (id) => WIDGETS[id]?.icon ?? '';
export const isLive = (id) => Boolean(WIDGETS[id]?.live);

/** The reading for a widget, or null if `id` is not one. */
export async function read(id, shape) {
    const w = WIDGETS[id];
    if (!w) return null;
    try {
        return await w.read(shape);
    } catch (err) {
        console.error(`[widget ${id}]`, err);
        return { value: '--', caption: 'Unavailable', lines: [] };
    }
}

/** Runs the widget's press; false when it has none (a read-only widget). */
export function press(id) {
    const w = WIDGETS[id];
    if (!w?.press) return false;
    w.press();
    return true;
}
