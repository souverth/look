// Code-aware completion in /note, two kinds:
//
//   - after an opening ``` : the languages whose name starts with what was typed;
//   - inside a fenced block : the language's keywords plus the words already used
//     in that block, for the identifier being typed.
//
// Pure, like note-format-ops.js: it reads the text and the caret and answers with
// what to offer; note.js draws the list and applies the pick.

// [id, name, ...aliases]. The id is what goes after the fence, so it is one the
// preview's highlighter knows wherever it knows the language at all.
const LANGUAGES = [
    ['asm', 'Assembly', 'nasm', 'x86'],
    ['bash', 'Shell', 'sh', 'zsh', 'shell', 'console', 'terminal'],
    ['bat', 'Batch', 'cmd'],
    ['c', 'C'],
    ['clojure', 'Clojure', 'clj'],
    ['cpp', 'C++', 'cc', 'cplusplus'],
    ['cs', 'C#', 'csharp', 'dotnet'],
    ['css', 'CSS'],
    ['dart', 'Dart'],
    ['diff', 'Diff', 'patch'],
    ['dockerfile', 'Dockerfile', 'docker'],
    ['elixir', 'Elixir', 'ex'],
    ['erlang', 'Erlang', 'erl'],
    ['fsharp', 'F#', 'fs'],
    ['go', 'Go', 'golang'],
    ['graphql', 'GraphQL', 'gql'],
    ['groovy', 'Groovy', 'gradle'],
    ['haskell', 'Haskell', 'hs'],
    ['html', 'HTML', 'xhtml'],
    ['ini', 'INI', 'conf'],
    ['java', 'Java'],
    ['js', 'JavaScript', 'javascript', 'node', 'mjs'],
    ['json', 'JSON', 'jsonc'],
    ['jsx', 'JSX', 'react'],
    ['julia', 'Julia', 'jl'],
    ['kt', 'Kotlin', 'kotlin'],
    ['latex', 'LaTeX', 'tex'],
    ['lua', 'Lua'],
    ['makefile', 'Makefile', 'make'],
    ['md', 'Markdown', 'markdown'],
    ['matlab', 'MATLAB'],
    ['nginx', 'Nginx'],
    ['nim', 'Nim'],
    ['objc', 'Objective-C', 'objectivec'],
    ['ocaml', 'OCaml', 'ml'],
    ['perl', 'Perl', 'pl'],
    ['php', 'PHP'],
    ['plaintext', 'Plain text', 'text', 'txt'],
    ['powershell', 'PowerShell', 'ps1', 'pwsh'],
    ['proto', 'Protocol Buffers', 'protobuf'],
    ['py', 'Python', 'python', 'python3'],
    ['r', 'R'],
    ['regex', 'Regular Expression', 'regexp'],
    ['rb', 'Ruby', 'ruby'],
    ['rs', 'Rust', 'rust'],
    ['scala', 'Scala'],
    ['scss', 'SCSS', 'sass'],
    ['sol', 'Solidity', 'solidity'],
    ['sql', 'SQL', 'mysql', 'postgres', 'sqlite'],
    ['svelte', 'Svelte'],
    ['swift', 'Swift'],
    ['terraform', 'Terraform', 'tf', 'hcl'],
    ['toml', 'TOML'],
    ['ts', 'TypeScript', 'typescript'],
    ['tsx', 'TSX'],
    ['vb', 'Visual Basic', 'vba'],
    ['vim', 'Vim script', 'vimscript'],
    ['vue', 'Vue'],
    ['wasm', 'WebAssembly', 'wat'],
    ['xml', 'XML', 'svg'],
    ['yaml', 'YAML', 'yml'],
    ['zig', 'Zig'],
];

const JS = 'async await break case catch class const continue debugger default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of package private protected public readonly return static super switch this throw true try type typeof undefined var void while with yield console document window Promise Array Object String Number Boolean Map Set JSON Math Date Error';
const KEYWORDS = {
    js: JS,
    jsx: JS,
    ts: `${JS} abstract as declare keyof namespace never unknown any is satisfies infer`,
    tsx: `${JS} abstract as declare keyof namespace never unknown any is satisfies infer`,
    py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield print len range str int float list dict set tuple',
    rs: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Vec String Option Result Some None Ok Err Box println',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false make len append string int bool error fmt',
    java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void volatile while String System List Map ArrayList',
    kt: 'abstract class companion const constructor data else enum false for fun if import in interface is lateinit null object open override package private protected public return sealed super this true try val var when while',
    cs: 'abstract async await bool break case catch char class const continue decimal default delegate do double else enum event false finally float for foreach if in int interface internal is lock long namespace new null object out override private protected public readonly ref return sealed static string struct switch this throw true try typeof using var virtual void while Console List Dictionary',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL printf malloc free include define',
    cpp: 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while std string vector map cout cin include',
    bash: 'alias bg break case cd continue declare do done echo elif else esac eval exec exit export false fi for function if in local printf read return set shift source then trap true unset until while grep sed awk cat ls mkdir rm cp mv chmod curl',
    sh: 'case do done echo elif else esac exit export fi for function if in local read return set then until while',
    powershell: 'begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while Get-ChildItem Set-Location Write-Host Write-Output ForEach-Object Where-Object Select-Object',
    rb: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield puts require attr_accessor',
    php: 'abstract and array as break case catch class clone const continue declare default do echo else elseif empty extends final finally fn for foreach function global if implements include instanceof interface isset namespace new null private protected public require return static switch throw trait true try unset use var while',
    swift: 'as associatedtype break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat return self static struct subscript super switch throws true try typealias var where while',
    sql: 'ADD ALTER AND AS ASC BETWEEN BY CASE COLUMN CREATE DATABASE DEFAULT DELETE DESC DISTINCT DROP ELSE END EXISTS FROM FULL GROUP HAVING IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL OFFSET ON OR ORDER OUTER PRIMARY REFERENCES RIGHT SELECT SET TABLE THEN UNION UNIQUE UPDATE VALUES VIEW WHEN WHERE select from where insert update delete join group order limit',
    css: 'align-items animation background background-color border border-radius bottom box-shadow color content cursor display flex flex-direction font-family font-size font-weight gap grid height justify-content left line-height margin max-width min-height opacity overflow padding position right text-align top transition transform width z-index important inherit initial none auto block inline absolute relative fixed sticky',
    html: 'a article aside body br button canvas class div footer form h1 h2 h3 head header href html id img input label li link main meta nav ol option p script section select span src style table td textarea th title tr ul',
    json: 'true false null',
    yaml: 'true false null',
    md: 'true false',
    dart: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield',
    lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while print require pairs ipairs table string',
    scala: 'abstract case catch class def do else extends false final finally for forSome if implicit import lazy match new null object override package private protected return sealed super this throw trait true try type val var while with yield',
    haskell: 'case class data default deriving do else foreign if import in infix infixl infixr instance let module newtype of then type where',
    r: 'break else FALSE for function if in Inf NA NaN next NULL repeat return TRUE while library print',
    elixir: 'after and case catch cond def defmodule defp do else end false fn for if import in nil not or quote raise receive require rescue true try unless unquote use when with',
    dockerfile: 'ADD ARG CMD COPY ENTRYPOINT ENV EXPOSE FROM HEALTHCHECK LABEL ONBUILD RUN SHELL STOPSIGNAL USER VOLUME WORKDIR AS',
    makefile: 'all clean install ifeq ifneq else endif include define endef export override .PHONY',
    terraform: 'data dynamic for_each locals module output provider resource variable terraform count depends_on lifecycle',
};

// Aliases of a fence's language (`typescript`, `python3`) onto the ids above.
const ALIAS = new Map();
for (const [id, name, ...aliases] of LANGUAGES) {
    ALIAS.set(id, id);
    ALIAS.set(name.toLowerCase(), id);
    for (const a of aliases) ALIAS.set(a.toLowerCase(), id);
}

/** The id a fence's language word stands for (`TypeScript` -> `ts`), or the word itself. */
export function languageId(word) {
    const w = (word || '').toLowerCase();
    return ALIAS.get(w) ?? w;
}

const FENCE = /^\s*```/;

/**
 * What the caret is in. `{ kind: 'lang', from, query }` right after an opening
 * fence, `{ kind: 'word', from, query, lang, block }` inside a block on an
 * identifier of at least two characters, `{ kind: 'inside', lang }` anywhere else
 * in a block (where emoji, tags and the like stay out of the way), or null.
 */
export function codeContext(text, caret) {
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    const line = text.slice(lineStart, caret);
    const before = text.slice(0, lineStart).split('\n');
    // Fence lines above this one: an odd count means a block is open.
    let opening = null;
    let openAt = -1;
    let open = false;
    before.forEach((l, i) => {
        if (FENCE.test(l)) {
            open = !open;
            opening = open ? l : null;
            openAt = open ? i : -1;
        }
    });

    const fence = line.match(/^\s*```([\w+#.-]*)$/);
    if (fence) {
        if (open) return null; // this is the closing fence
        return { kind: 'lang', from: caret - fence[1].length, query: fence[1].toLowerCase() };
    }
    if (!open) return null;

    const lang = languageId((opening.replace(/^\s*```/, '').trim().split(/[\s:]/)[0]) || '');
    const word = line.match(/[A-Za-z_$][\w$-]*$/);
    if (!word || word[0].length < 2) return { kind: 'inside', lang };
    // The block as far as its closing fence, for the words already in use.
    const rest = text.slice(lineStart).split('\n');
    const end = rest.findIndex((l, i) => i > 0 && FENCE.test(l));
    const block = [...before.slice(openAt + 1), ...(end < 0 ? rest : rest.slice(0, end))].join('\n');
    return { kind: 'word', from: caret - word[0].length, query: word[0], lang, block };
}

/** Languages whose id, name or alias starts with `query` (then those containing it). */
export function filterLanguages(query) {
    const q = query.toLowerCase();
    const starts = [];
    const has = [];
    for (const [id, name, ...aliases] of LANGUAGES) {
        const names = [id, name, ...aliases].map((s) => s.toLowerCase());
        if (!q || names.some((n) => n.startsWith(q))) starts.push({ id, name });
        else if (names.some((n) => n.includes(q))) has.push({ id, name });
    }
    // What was typed in full comes first, so Enter on ```ts means ts and not toml.
    starts.sort((a, b) => (b.id === q) - (a.id === q));
    return [...starts, ...has].slice(0, 30);
}

/** Keywords of the language and words already in the block that continue `query`. */
export function filterWords({ query, lang, block }) {
    const q = query.toLowerCase();
    const seen = new Map(); // word -> kind
    for (const w of (KEYWORDS[lang] || '').split(/\s+/)) if (w) seen.set(w, 'keyword');
    for (const w of block.match(/[A-Za-z_$][\w$-]*/g) || []) {
        if (!seen.has(w)) seen.set(w, 'text');
    }
    const out = [];
    for (const [word, kind] of seen) {
        if (word === query) continue;
        if (word.toLowerCase().startsWith(q) || (q.length >= 3 && word.toLowerCase().includes(q))) {
            out.push({ word, kind, starts: word.toLowerCase().startsWith(q) });
        }
    }
    // Prefix matches before inner matches, keywords before plain words, short before long.
    out.sort(
        (a, b) =>
            b.starts - a.starts ||
            (a.kind === b.kind ? 0 : a.kind === 'keyword' ? -1 : 1) ||
            a.word.length - b.word.length ||
            a.word.localeCompare(b.word),
    );
    return out.slice(0, 30);
}

const keywordSets = new Map();

/** The keywords of a language (an id from this file) as a Set; SQL's lower-cased. */
export function keywordsFor(lang) {
    if (!keywordSets.has(lang)) {
        const words = (KEYWORDS[lang] || '').split(/\s+/).filter(Boolean);
        keywordSets.set(lang, new Set(lang === 'sql' ? words.map((w) => w.toLowerCase()) : words));
    }
    return keywordSets.get(lang);
}