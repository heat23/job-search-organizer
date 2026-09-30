# Job Search Organizer

**Your whole job search in one HTML file.** Boards for jobs, headhunters and referrals, a prep sheet for every call, and your notes, all saved as plain files in a folder on your own computer. No server, no account, no install.

[![CI](https://github.com/heat23/job-search-organizer/actions/workflows/ci.yml/badge.svg)](https://github.com/heat23/job-search-organizer/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![No server](https://img.shields.io/badge/server-none-1e8a5a) ![No dependencies](https://img.shields.io/badge/runtime%20dependencies-0-1e8a5a)

### [▶ Try the live demo](https://heat23.github.io/job-search-organizer/)

A made-up senior engineer's job search, running in your browser. Nothing to install and nothing uploaded.

[![Demo: moving a job to Applied, opening its prep sheet, taking notes, quick open and the guide search](docs/images/demo.gif)](https://heat23.github.io/job-search-organizer/)

## Why

- **Private by design.** Your data lives in files you own: a JSON data file, Markdown notes and your résumé PDFs. The page makes no network requests.
- **Built for the call itself.** Talking points on the left, a notes pad on the right, and number keys to jump between sections while you talk.
- **Nothing to set up.** Open the file in Chrome or Edge, pick a folder, done.

## What it does

| | |
|---|---|
| ![The Jobs board](docs/images/board.png) | ![A prep sheet with the notes pad](docs/images/prep-sheet.png) |
| **Boards.** Jobs, headhunters and people in lanes, with drag and drop, follow-up dates, stale-card nudges and undo. | **Prep sheets.** Your talking points and a notes pad side by side. Book a call and the card moves forward on its own. |
| ![The Prep library](docs/images/library.png) | ![Dark mode](docs/images/board-dark.png) |
| **Prep library.** Markdown guides with search, copy buttons and a "My version" box for your own answers. | **Dark mode**, keyboard shortcuts, quick open (G) and a layout for half a screen next to a video call. |

It also:

- Moves each job's résumé and cover-letter folder into a stage folder (`1 - To apply`, `2 - Applied`, `3 - Closed`) when the card changes lane.
- Shows **Next up** each morning: follow-ups due, upcoming calls, starred jobs, top to-dos and your plan.
- Warns you before you apply somewhere a headhunter has already submitted you.
- Backs up your data and notes every day, with an optional second copy on another drive.

## Try it

- **In your browser:** open the [live demo](https://heat23.github.io/job-search-organizer/). Everything runs in the page, and a reload starts over.
- **On your computer:** click **Code → Download ZIP**, unzip it, and open `boards/sample/organizer.html` in Chrome or Edge. Click **Turn on saving** and pick the `boards/sample` folder to see real saving.

## Start your own board

1. Copy the **`boards/empty`** folder somewhere private, for example `Documents/Job Search`.
2. Open `organizer.html` from that folder, click **Turn on saving** and pick the same folder.
3. Optional: open `organizer.config.js` in a text editor to set your name, file names, lane names or stage folders.

To start from the sample guides, copy the `.md` files under `boards/sample/Library` into your own `Library` folder.

## Your data stays on your computer

```
Job Search/
├── organizer.html          the app (open this)
├── organizer.config.js     your settings (optional)
├── board_data.js           jobs, headhunters, people, to-dos, plan (JSON)
├── 1 - To apply/           one folder per job: Resume.pdf, Cover_Letter.pdf
├── 2 - Applied/  3 - Closed/  4 - Removed/
├── Job notes/<job>/        prep.md, my_notes.md, outreach.md, posting.md
├── Library/                your guides (Markdown), My_answers.md
└── backups/                daily copies of the data file and your notes
```

- Chrome and Edge can write to a folder you pick (the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API)). Other browsers open the page as view-only.
- Every change is also kept in the browser, so nothing is lost if saving pauses. If a notes file changes on disk while you type, both versions are kept.
- Everything is plain text, so you can read it, search it or back it up with any tool, and it still works if this project goes away.

## Guides and prep sheets

Guides are ordinary Markdown with a few extras. The sample guides show every one of them.

| Write | Shows as |
|---|---|
| `## Section` / `### Question` | a card / a question in it (with a jump key and a Copy button) |
| `> What you'd say` | an answer with a Copy answer button |
| `*<example answer>*` | an example, in a different color, left out when you copy |
| `✎` / `☐` | not confirmed yet (adds a "My version" box) / a fact to find out |
| `::: fold Title` … `:::` | a block you can open and close |
| `## Pay {.pay}` | a pay section (optionally blurred until you press H, for screen sharing) |

A job gets a prep sheet as soon as `Job notes/<job id>/prep.md` exists.

## Works with scripts and AI assistants

Because everything is plain files, any tool you trust can help: add jobs to `board_data.js`, write a prep sheet before a call, or draft a guide. The page picks up the changes, tags records **New from assistant**, and never overwrites a file it hasn't read. The rules for tools are at the top of `board_data.js`.

## How it's built

- **No framework, no runtime dependencies.** 18 small plain-JavaScript files under `src/`, joined by an 80-line build script into one HTML file that runs from `file://`.
- **Safe with other writers.** Records merge by `updatedAt`, nothing is hard-deleted, and a notes file that changed on disk is never overwritten, so the page, a script and an AI assistant can all edit the same folder.
- **Tested in a real browser.** 146 Playwright checks run in CI against an in-memory folder that implements the File System Access API. The same in-memory folder powers the live demo.
- **Private.** Guides are escaped before rendering, and a test fails if the page makes any network request.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```sh
npm install
npx playwright install chromium   # once, for the tests
npm run build                     # src/ -> boards/*/organizer.html
npm test                          # 146 browser checks
npm run demo                      # the live demo page -> _site/index.html
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to help.

## License

[MIT](LICENSE) © 2026 Sudhir Prakash. The sample board is a fictional senior software engineer's search: every company, person and link in it is made up.
