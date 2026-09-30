# Instructions for AI assistants

This folder is a job search board. The person keeps it up to date by asking you, their AI assistant, to make changes. `organizer.html` shows the board; you edit the plain files next to it. When the person switches back to the page, it re-reads the files, shows your changes with a **New from assistant** tag, and never overwrites a file it hasn't read.

## Ground rules

1. **Edit `board_data.js` in place.** Keep the first comment lines and the `window.BOARD_DATA = { ... };` wrapper. What's inside must stay valid JSON.
2. **Stamp every record you add or change** with `"updatedAt"` (the current time, ISO 8601 in UTC with a `Z`, later than the old value) and `"changedBy": "assistant"`. When two copies of a record differ, the newer `updatedAt` wins.
3. **Never delete a record.** To remove one, set `"deleted": true`, `"removedAt"` and a new `updatedAt`.
4. **Keep the fields you don't know about.** Change only what the request needs.
5. **Read but never edit** `my_notes*.md` and `Library/My_answers.md` (the person's own notes). Don't touch `backups/` or `organizer.html`, and don't move or rename the job folders under `1 - To apply/`, `2 - Applied/` and so on: the page files them by stage on its own. You may add files to a job's folder when asked, such as a tailored résumé.
6. **Ask before guessing** a company, date or result. Say which records you changed when you're done.

## `board_data.js`

Five collections, each an object of records keyed by id. Use a short, unique, lowercase id with letters, digits and `_` (for example `acme` or `acme_platform`).

Dates: `followUp` is a local date `YYYY-MM-DD`. `callAt` is a local time `YYYY-MM-DDTHH:MM`. Other times (`createdAt`, `movedAt`, `appliedAt`, `updatedAt`) are ISO times in UTC with `Z`.

### `jobs`

| Field | Meaning |
|---|---|
| `company`, `role`, `location`, `url` | From the posting. `url` is the posting link. |
| `lane` | Stage id (see below). |
| `movedAt`, `appliedAt`, `followUp` | When it last changed stage, when you applied, the next nudge date. |
| `pay` | What the posting says about pay, as text. |
| `resume`, `sentResume` | Which résumé version was tailored and which was sent (for example `v3`). |
| `folder` | Path of the job's document folder, for example `1 - To apply/Acme - Staff Engineer`. The page keeps it current. |
| `pinned`, `pinnedAt` | Starred: shown first under To apply and on Next up. |
| `longShot` | A stretch role, listed below the others. |
| `referralId` | Id of the person in `people` who referred you. |
| `closedReason` | Why it closed: `Rejected`, `Withdrew`, `Posting closed`, `No reply` or `Took another offer`. |
| `callAt`, `callType`, `callWith`, `callLink` | The next booked call. `callType` is `Recruiter screen`, `Hiring manager`, `Panel`, `Onsite`, `Headhunter call` or `Other`. |
| `notes` | Short free text shown on the card. |

Job stages (`lane`), with the default follow-up in days: `todo` (To apply), `applied` (7), `screen` (Recruiter screen, 5), `interview` (Interviewing, 5), `offer` (3), `closed`.

### `hunters` (headhunters and agency recruiters)

`name`, `firm`, `practice`, `tier`, `url` (their candidate form or profile), `firmUrl`, `notes`, `submittedTo` (roles they submitted the person to, as text), `followUp`, `callAt`/`callType`/`callWith`/`callLink`.
Stages: `todo` (To register), `registered`, `contacted` (10), `talking` (30), `presented` (Submitted me, 7), `paused` (Not now).

### `people` (referrals and contacts)

`name`, `company`, `ask` (what the person wants from them), `url`, `notes`, `followUp`.
Stages: `todo` (To ask), `asked` (7), `talking` (14), `helped`, `noreply`.

### `todos`

`text`, `detail`, `group` (`first` or `later`), `from` (`assistant`), `done` (true or false), `doneAt`, `order`.

### `plan`

The checklist on the Headhunters tab: `week` (1 to 4), `order`, `text`, `done`, `doneAt`.

The page's settings file, `organizer.config.js`, can rename the stages and change the follow-up days. The ids above never change.

## Moving a card

Set `lane` and `movedAt`, and a new `followUp` (today plus the stage's days) unless the person gave a date.

- **Applied:** also set `appliedAt`, and `sentResume` if you know which version was sent.
- **Call booked:** set `callAt`, `callType`, `callWith`, `callLink`, move a recruiter call to `screen` and later rounds to `interview`, and set `followUp` to the day after the call.
- **Closed:** set `closedReason` and clear `followUp` (`null`) and the call fields.
- **Offer:** `lane: "offer"`, with a short summary in `notes`.

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
## Pay {.pay}
```

Markup: `✎` marks an answer the person should confirm and adds a "My version" box. `☐` marks a fact to find out. `*<...>*` marks example text that is left out when copied. `::: fold Title` … `:::` makes a block that opens and closes. `{.pay}` on a heading lets the person blur that section when sharing their screen. Use only facts from the person's résumé, the posting and what they tell you. Never invent achievements or numbers.

Guides for every job (call scripts, a cheat sheet) live in `Library/<Group>/<NN>_<Title>.md` and use the same markup.
