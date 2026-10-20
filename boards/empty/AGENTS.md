# Instructions for AI assistants

This folder is a job search board. The person keeps it up to date by asking you, their AI assistant, to make changes. `organizer.html` shows the board; you edit the plain files next to it. When the person switches back to the page, it re-reads the files, shows your changes with a **New from assistant** tag, and never overwrites a file it hasn't read.

## Ground rules

1. **Edit `board_data.js` in place.** Keep the first comment lines and the `window.BOARD_DATA = { ... };` wrapper. What's inside must stay valid JSON. The page loads this file (and `organizer.config.js`) as a script, so change only the JSON object: never add code, other statements or anything outside the wrapper. The page warns the person when the file holds anything else.
2. **Bump `rev` on every record you add or change: `"rev": <its old rev> + 1`** (a new record gets `"rev": 1`; a record without `rev` counts as `0`, so it gets `1`). This is how the page knows your change is new. **Always bump `rev`; if you forget, an edit made on the current file is still applied, but an old copy never overwrites newer changes**: the page keeps the person's version, saves your file to `backups/` and tells them. Also set `"updatedAt"` (now, ISO 8601 in UTC with a `Z`) and `"changedBy": "assistant"`; they're only shown (the **New from assistant** tag), never used to decide anything.
   - **Read the file right before you write it**, and write back only what you read then plus your change. Change only the records and fields you mean to, and bump `rev` only on those.
   - The page merges field by field. If the person changed a field you also changed since your read, the person's value is kept and your file is saved to `backups/`. A copy you read earlier and write back later carries old `rev`s, so it never undoes the person's changes.
   - Example: you read `"harborlight": { "lane": "applied", "rev": 4, … }` and move it to the screen: write `"lane": "screen"`, `"movedAt"`, `"followUp"`, `"rev": 5`, `"updatedAt"`, `"changedBy": "assistant"`.
3. **Never delete a record.** To remove one, set `"deleted": true`, `"removedAt"` (the current time) and `"rev": n+1`. A record missing from the file is put back by the page.
4. **Keep the fields you don't know about.** Change only what the request needs.
5. **Read but never edit** `my_notes*.md` and `Library/My_answers.md` (the person's own notes). Don't touch `backups/` or `organizer.html`, and don't move or rename the job folders under `1 - To apply/`, `2 - Applied/` and so on: the page files them by stage on its own. You may add files to a job's folder when asked, such as a tailored résumé.
6. **Never "restore" by copying an old file** from `backups/` (or anywhere) over `board_data.js` or `Library/My_answers.md`: an old copy has old `rev`s, so the page keeps the current values (and an answer missing from `My_answers.md` is written back). When the person wants an earlier version back, tell them to click **Restore a backup…** at the bottom of the page (it saves the current file first and has an Undo). To remove all their answers, they use **Clear all my answers…** in the Prep library.
7. **Ask before guessing** a company, date or result. Say which records you changed when you're done.

## `board_data.js`

Five collections, each an object of records keyed by id. Use a short, unique, lowercase id with letters, digits and `_` (for example `acme` or `acme_platform`).

Every record has `rev` (a whole number, see ground rule 2), `updatedAt` and `changedBy`. Dates: `followUp` and `keepUntil` are local dates `YYYY-MM-DD`. `callAt` is a local time `YYYY-MM-DDTHH:MM`. Other times (`createdAt`, `movedAt`, `appliedAt`, `updatedAt`) are ISO times in UTC with `Z`.

### `jobs`

| Field | Meaning |
|---|---|
| `company`, `role`, `location`, `url` | From the posting. `url` is the posting link. |
| `lane` | Stage id (see below). |
| `movedAt`, `appliedAt`, `followUp` | When it last changed stage, when you applied, the next nudge date. |
| `pay` | What the posting says about pay, as text. |
| `resume`, `sentResume` | Which résumé version was tailored and which was sent (for example `v3`). |
| `folder` | Path of the job's document folder inside the board, for example `1 - To apply/Acme - Staff Engineer`. The page keeps it current. Never a stage folder itself, `Library`, `Job notes`, `backups`, an absolute path or one with `..` or `\`: the page refuses those and moves nothing. |
| `noResume`, `noLetter` | `true` when the job's package has no tailored résumé or no cover letter (the card stops asking for one). |
| `resumeFile`, `letterFile` | File names inside the folder when they differ from the names in the settings (default `Resume.pdf` and `Cover_Letter.pdf`). |
| `pinned`, `pinnedAt` | Starred: shown first under To apply and on Next up. |
| `longShot` | A stretch role, listed below the others. |
| `order` | Position among the other unstarred cards in To apply (lower first). |
| `sheet` | `true` opens the job straight to its prep sheet even before it is applied to (for example a role a headhunter brought, with a call coming). Needs `prep.md`; without one the plain panel opens. |
| `keepUntil` | No "no change in N days" nudge before this date. The page sets it when the person logs a follow-up or chooses Keep waiting. |
| `referralId` | Id of the person in `people` who referred you. |
| `closedReason` | Why it closed: `Rejected`, `Withdrew`, `Posting closed`, `No reply` or `Took another offer`. |
| `callAt`, `callType`, `callWith`, `callLink` | The next booked call. `callType` is one of the call type labels in the settings; by default `Recruiter screen`, `Hiring manager`, `Panel`, `Onsite`, `Headhunter call` or `Other`. |
| `notes` | Short free text shown on the card. |

Job stages (`lane`), with the default follow-up in days: `todo` (To apply), `applied` (7), `screen` (Recruiter screen, 5), `interview` (Interviewing, 5), `offer` (3), `closed`.

### `hunters` (headhunters and agency recruiters)

`name`, `firm`, `practice`, `tier`, `url` (their candidate form or profile), `linkLabel` (the text of the `url` link, default "Open ↗"), `firmUrl`, `notes`, `submittedTo` (roles they submitted the person to, as text), `followUp`, `callAt`/`callType`/`callWith`/`callLink`.
Stages: `todo` (To register), `registered`, `contacted` (10), `talking` (30), `presented` (Submitted me, 7), `paused` (Not now).

### `people` (referrals and contacts)

`name`, `company`, `ask` (what the person wants from them), `url`, `notes`, `followUp`.
Stages: `todo` (To ask), `asked` (7), `talking` (14), `helped`, `noreply`.

### `todos`

`text`, `detail`, `url` and `urlLabel` (a link shown with the detail, default label "Open ↗"), `group` (`first` or `later`), `done` (true or false), `doneAt`, `order`. The page sets `from: "you"` on to-dos the person adds ("Added by you"); leave `from` out on yours. The **New** tag comes from `changedBy`.

### `plan`

The checklist on the Headhunters tab: `week` (1 to 4), `order`, `text`, `done`, `doneAt`. A step with `auto` ticks itself: `"hunters_registered"` (every headhunter with a `tier` is past To register) or `"people10"` (ten people on the board).

The page's settings file, `organizer.config.js`, can rename the stages, change their follow-up days and rename the call types. The stage ids above never change, so always write the ids, never the names. Each call type in `callTypes` has a `label` (the text you store in `callType`) and `moves`: `"screen"`, `"interview"` or `"none"` (an older settings file may list plain strings instead).

## Moving a card

Set `lane` and `movedAt`, and a new `followUp` (today plus the stage's days) unless the person gave a date, with `"rev": n+1` (n: the rev you read).

- **Applied:** also set `appliedAt`, and `sentResume` if you know which version was sent.
- **Call booked:** set `callAt`, `callType`, `callWith`, `callLink`, and set `followUp` to the day after the call. Move the job the way its call type's `moves` says: `screen` moves it from `applied` to `screen`, `interview` moves it from `applied` or `screen` to `interview`, `none` leaves it. With the default types, a recruiter call goes to `screen` and later rounds to `interview`.
- **Closed:** set `closedReason` and clear `followUp` (`null`). A closed card's call is hidden (on the card, in Upcoming calls and in quick open) and no longer opens the prep sheet by itself, so clearing the call fields is optional.
- **Offer:** `lane: "offer"`, with a short summary in `notes`.

A new job: `"rev": 1`, `createdAt`, `company`, `role`, `url`, `lane: "todo"`, `updatedAt`, `changedBy: "assistant"`. Any other change to a record, such as `notes` or a to-do's `done`: the fields you change and `"rev": n+1`.

## A new job's résumé folder

When the person asks you to set up the documents for a job (for example a tailored résumé you wrote):

1. Create `1 - To apply/<Company> - <Role>/` (no `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>` or `|` in the name, and no dot or space at the end, so it also works on Windows; use the `stageFolders.todo` name if `organizer.config.js` changes it), even if the job is already further along.
2. Save the files there under the names in `organizer.config.js` (`files.resume` and `files.coverLetter`, default `Resume.pdf` and `Cover_Letter.pdf`), or set `resumeFile` / `letterFile` on the job. Set `noLetter: true` if there is no cover letter.
3. Set the job's `folder` to that path, with `"rev": n+1`. The page moves the folder to the job's stage folder on its own, and its card says when a file it expects isn't in the folder.

## Prep sheets and notes

`Job notes/<job id>/` holds the Markdown files for one job:

- `prep.md`: the prep sheet shown next to the notes pad during a call. Write it when asked.
- `posting.md`: a copy of the job posting. Save it when you add a job from a posting.
- `outreach.md`: a note to the hiring manager and screening answers.

A prep sheet is Markdown. Every `## Section` becomes a card with a jump key, so keep sections short and scannable. A good one has:

```markdown
---
asks: First thing the posting asks for | Second | Third
---
# Company: Role

## Your opener
1. Three to five short lines to say in the first minute.
> The same opener as one paragraph to say out loud.

## Why Company
- What about this team fits the person, from the posting and public sources.
- ☐ A fact to check before the call.

## Likely questions
### A question they'll probably ask
> A short answer in the person's own words, based on their résumé.
### A question you're unsure how they'd answer ✎
> *<example answer: the person should replace this>*

## Gaps they may probe
## Questions to ask them
1. A question for the interviewer.
### Who would I report to? {.ask}
## Pay {.pay}
```

Markup: `✎` marks an answer the person should confirm and adds a "My version" box. `{.ask}` on a `###` question in a prep sheet adds an open "Their answer" box where the person types what the interviewer said (use it for questions the person asks them). Both boxes save to `Library/My_answers.md` under `## prep:<job id>::<question> @<its ## section title>` (a guide's under `## <guide id>::<question>`), so each round keeps its own answers: keep section titles as they are once answered, and write the next round as a new section with its own title (for example `## Questions to ask them (hiring manager, Oct 24)`), not a second section with the same title. Never write them yourself, but read them when asked what was said. Answers are matched to their question by its exact text, so don't reword a question the person has already answered: if you do, the answer is listed under "Saved answers from earlier versions" at the end of the sheet instead of under the question. `☐` marks a fact to find out. `*<...>*` marks example text that is left out when copied. `::: fold Title` … `:::` makes a block that opens and closes. `{.pay}` on a heading lets the person blur that section when sharing their screen. Use only facts from the person's résumé, the posting and what they tell you. Never invent achievements or numbers.

Guides for every job (call scripts, a cheat sheet) live in `Library/<Group>/<NN>_<Title>.md` and use the same markup, except `{.ask}`, which only adds a box in a prep sheet (in a guide it is ignored).
