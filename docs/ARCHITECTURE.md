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
| `src/js/30-store.js` | The data model: five collections of records keyed by id, and the revision-counter merge of the file, the browser's copy and other tabs. |
| `src/js/40-storage.js` | Saving to the folder, the daily data backup, and moving job folders between stage folders. |
| `src/js/50-render.js` … `70-drawer.js` | Next up, the boards, cards, to-dos, the plan and the card panel. |
| `src/js/80-markdown.js` | The Markdown subset and markup for guides. Input is escaped first; only http(s) links are rendered. |
| `src/js/81-*.js` … `88-*.js` | Guides and prep sheets, My_answers.md, the notes pad, calls, quick open, the Library tab, note backups and Restore a backup. |
| `src/js/90-boot.js` | Wiring and start-up. |
| `tools/build.mjs` | Joins the files into one `organizer.html` per board folder and fails on duplicate top-level names. |

The scripts are classic scripts joined in file-name order, not ES modules, because browsers block modules on `file://` pages.

## Keeping data safe

- **Two copies, merged by revision numbers.** Every change is stored in the browser at once and written to `board_data.js` 400 ms later. Every record has a whole number `rev` (missing = 0). Whoever changes a record, the page or another tool, sets `rev` to the old value + 1; `updatedAt` and `changedBy` are only shown, never compared, so clocks play no part. For each record the page keeps its **base**: the record exactly as the file held it at the last successful read or write, stored with the browser's copy (in memory only while storage is full, with a one-time note). When the file's record F differs from the browser's record L:
  - **F.rev > base.rev:** a real new edit. Per field (`deleted` and `removedAt` count as one), the side that changed it since the base wins. A field both changed to different values keeps L's value: a conflict, recorded. The result's rev is max(F.rev, L.rev), + 1 while L's changes are unwritten.
  - **F.rev ≤ base.rev but F ≠ base:** an older copy written back, or an edit made without a new rev. L is kept for every field and written back, recorded.
  - **No base:** a record new on both sides keeps L, recorded. A copy stored without bases (storage full, or a version before revisions) keeps L only if L.rev > F.rev; otherwise it takes F and records L.
  - **Missing from the file but with a base:** kept and written back (deleting is `deleted: true`), recorded.

  "Recorded" means the other side's version goes to `backups/board_data_kept_<date>_<HHMM>.js` (or `…_browser_…` for the browser's), the last 10 of each kind are kept, and the status line says "Kept your version of N cards; the file's version is saved in backups/…". The page never blocks or asks. Every write raises `rev` above the base for each record that differs from it. Before writing, the page checks the file's modification time and size again and merges first if another tool wrote it since the read. What is written is a snapshot, so an edit made during the write stays unsaved and is written next. Open tabs share the copy and its bases in browser storage. When another tab writes its copy, this tab merges it per field against the shared copy as it was before: the side that changed a field since then wins, and a field both changed goes to the higher rev (every edit raises it). A newer base the other tab read from the file is taken over. So a change made in any tab counts as local when the file is merged. With old data, the first read sets the bases and nothing is written until the person edits. On window focus the data file is read before the prep sheets are scanned.
- **Restore a backup.** The footer's "Restore a backup…" lists `backups/board_data_*.js` (or takes any `.js` copy) with date and card counts. After a confirm it saves the current file as `backups/board_data_before_restore_<time>.js`, then every record of the backup that differs becomes the next revision (rev = current rev + 1; cards added since then are removed the same way), so the restore wins in the file, in other tabs and in later merges. A full filing pass then moves each job folder to its restored stage folder, and the folder listing is refreshed. A toast offers Undo, which does the same with the saved copy. Copying an old file over `board_data.js` by hand restores nothing: its revs aren't newer.
- **Never delete.** Removing a card sets `deleted: true`; the Removed list can restore it. A removed job's files wait in `4 - Removed` for 30 days.
- **Never overwrite unread text.** The notes pad re-reads `my_notes.md` before each write. If the file changed on disk, the other version is saved beside it as `my_notes.changed-on-disk-<time>.md`. `Library/My_answers.md` is read and merged before every write. A box changed in this browser since the last write wins, and other keys take the file's value. An answer missing from the file is never deleted from the browser; it is written back, so a file read cut short, empty or half-written deletes nothing. Deleting goes through the page (emptying a box, Remove, or "Clear all my answers…" in the Prep library). The removal is kept as a tombstone shared by open tabs, so no tab brings it back; another browser or computer that still has the answer writes it back. Deleting an answer from the file by hand isn't supported. If the file can't be read, the answers wait in the browser. A file that reads as empty or without its `# My answers` title is copied to `backups/` before it is written again. Prep-sheet answers are keyed by question and `## section`; an answer under an older key moves to a box only when that is certain (the question is on the sheet once and it is the only older answer), otherwise it is listed under "Saved answers from earlier versions".
- **Only real job folders move.** A job's `folder` must be a relative path inside the board that isn't a stage folder, `Library`, `Job notes` or `backups`; anything else is refused with a message, and a folder can never be copied into itself. Filing only looks at jobs whose stage or folder changed, with a full pass at start-up and after another tool's changes.
- **Data files are scripts.** `board_data.js` and `organizer.config.js` are loaded with `<script>` tags. Read from the folder, the data file is only JSON-parsed, and the page warns when anything besides comments surrounds `window.BOARD_DATA = {…};` (comments are read the way JavaScript reads them). The warning is a check after the fact, not a sandbox: the `<script>` tag has already run the file by then.
- **Refuse a broken file.** If `board_data.js` can't be parsed, the page keeps your changes in the browser and doesn't overwrite it.
- **Per-folder storage.** Browser storage is shared by all pages opened from disk, so every key carries the page's folder: the sample board and your own never mix.
- **Backups.** A daily copy of the data file (14 kept, taken on the first save of the day or at start-up on a day without edits; the copies saved before a restore are kept 14 too, and the versions a merge kept out 10 per kind) and of your notes (60 kept) in `backups/`, plus an optional daily copy of the whole folder somewhere else (5 kept).

## Tests

`npm test` runs 552 checks (12 suites) in headless Chromium against a copy of `boards/sample`. An in-memory folder (`src/demo/memfs.js`, with test hooks in `tests/ffs.js`) stands in for the folder picker, so the tests cover saving, conflicts, permission loss and write failures without touching the disk.

## The live demo

`tools/build-demo.mjs` turns the sample board into one page (`_site/index.html`) that GitHub Pages serves after CI passes. `src/demo/demo.js` fills the in-memory folder with the sample files, moves the sample's dates so they're relative to today, and hands the folder to the app through `window.ORGANIZER_FOLDER`. Because the folder API is provided in memory, the demo doesn't need Chrome's folder picker, so it is meant to run in Safari and Firefox too (the tests check it with the folder API removed). Nothing is uploaded, and a reload starts over.
