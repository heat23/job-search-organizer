# Architecture

A single HTML page that runs from disk (`file://`), with no server and no framework. The browser's [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API) lets it read and write the folder it lives in, once you pick that folder.

```mermaid
flowchart LR
  subgraph Folder["Your board folder"]
    D[board_data.js]
    N["Job notes/*/my_notes.md"]
    P["Job notes/*/prep.md, Library/*.md"]
    S["Stage folders with PDFs"]
    B[backups/]
  end
  UI[organizer.html] -- "script tag at load" --> D
  UI -- "read + write (after you pick the folder)" --> D & N & S & B
  UI -- "read live, _bundle.js as fallback" --> P
  UI <-- "instant copy" --> LS[(Browser storage)]
```

## Source layout

| File | What it does |
|---|---|
| `src/js/00-config.js` | Every personal choice (lanes, call types, folder and file names, follow-up days, picker ids). Merged with `organizer.config.js`, then checked: lane ids are fixed, so a missing lane is added back with a console warning. |
| `src/js/30-store.js` | The data model: five collections of records keyed by id, and the field-level merge of two copies. |
| `src/js/40-storage.js` | Saving to the folder, the daily data backup, and moving job folders between stage folders. |
| `src/js/50-render.js` … `70-drawer.js` | Next up, the boards, cards, to-dos, the plan and the card panel. |
| `src/js/80-markdown.js` | The Markdown subset and markup for guides. Input is escaped first; only http(s) links are rendered. |
| `src/js/81-*.js` … `88-*.js` | Guides and prep sheets, the notes pad, calls, quick open, the Library tab and note backups. |
| `src/js/90-boot.js` | Wiring and start-up. |
| `tools/build.mjs` | Joins the files into one `organizer.html` per board folder and fails on duplicate top-level names. |

The scripts are classic scripts joined in file-name order, not ES modules, because browsers block modules on `file://` pages.

## Keeping data safe

- **Two copies, merged field by field.** Every change is stored in the browser at once and written to `board_data.js` 400 ms later. For each record the page remembers the version the file held at the last read or write (its base), kept in browser storage with the browser's copy so it survives a reload. A file record whose `updatedAt` is older than its base is a stale copy (a tool wrote back what it read before your last save): it is ignored and your version is written back, so a stale copy never undoes a saved edit, Remove or Restore (it also means an older backup copied over the file doesn't roll back records this browser holds newer versions of). A file record that changed with the same `updatedAt` (a tool forgot to stamp it) gives the fields this browser hasn't changed. One with a newer `updatedAt` merges field by field: a field only one side changed keeps that side's value and a field both changed takes the newer record's value. Without a base (a record never read from this file, or browser storage was full) the newer record wins. What is written is a snapshot, so an edit made during the write stays unsaved and is written next. Two open tabs merge each other's copies the same way, against the older of their two bases. On window focus the data file is read before the prep sheets are scanned.
- **Never delete.** Removing a card sets `deleted: true`; the Removed list can restore it. A removed job's files wait in `4 - Removed` for 30 days.
- **Never overwrite unread text.** The notes pad re-reads `my_notes.md` before each write. If the file changed on disk, the other version is saved beside it as `my_notes.changed-on-disk-<time>.md`. `Library/My_answers.md` is read and merged before every write (a box changed in this browser since the last write wins; an answer the file lost since the last read stays deleted and is remembered as removed, so another tab can't bring it back; other keys take the file's value); if it can't be read, the answers wait in the browser, and open tabs share them key by key.
- **Only real job folders move.** A job's `folder` must be a relative path inside the board that isn't a stage folder, `Library`, `Job notes` or `backups`; anything else is refused with a message, and a folder can never be copied into itself. Filing only looks at jobs whose stage or folder changed, with a full pass at start-up and after another tool's changes.
- **Data files are scripts.** `board_data.js` and `organizer.config.js` are loaded with `<script>` tags. Read from the folder, the data file is only JSON-parsed, and the page warns when anything besides comments surrounds `window.BOARD_DATA = {…};` (comments are read the way JavaScript reads them). The warning is a check after the fact, not a sandbox: the `<script>` tag has already run the file by then.
- **Refuse a broken file.** If `board_data.js` can't be parsed, the page keeps your changes in the browser and doesn't overwrite it.
- **Per-folder storage.** Browser storage is shared by all pages opened from disk, so every key carries the page's folder: the sample board and your own never mix.
- **Backups.** A daily copy of the data file (14 kept, taken on the first save of the day or at start-up on a day without edits) and of your notes (60 kept) in `backups/`, plus an optional daily copy of the whole folder somewhere else (5 kept).

## Tests

`npm test` runs 441 checks in headless Chromium against a copy of `boards/sample`. An in-memory folder (`src/demo/memfs.js`, with test hooks in `tests/ffs.js`) stands in for the folder picker, so the tests cover saving, conflicts, permission loss and write failures without touching the disk.

## The live demo

`tools/build-demo.mjs` turns the sample board into one page (`_site/index.html`) that GitHub Pages serves after CI passes. `src/demo/demo.js` fills the in-memory folder with the sample files, moves the sample's dates so they're relative to today, and hands the folder to the app through `window.ORGANIZER_FOLDER`. Because the folder API is provided in memory, the demo doesn't need Chrome's folder picker, so it is meant to run in Safari and Firefox too (the tests check it with the folder API removed). Nothing is uploaded, and a reload starts over.
