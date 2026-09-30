# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

```sh
npm install
npx playwright install chromium
npm run build && npm test
```

## Ground rules

- **Edit `src/`, then run `npm run build`.** Never edit `boards/*/organizer.html` by hand; it is generated. CI fails if it is out of date.
- **No runtime dependencies and no network calls.** The page must keep working from a single file on disk.
- **Keep data safe.** Don't delete records (set `deleted: true`), and never write a file the page hasn't just read.
- **Add a test** in `tests/` for any behavior you change. Tests use only the fictional sample board.
- **No real personal data** in issues, tests or sample files. Use made-up names and `example.com` links.
- Run `npm run format` before you commit.

If you change the sample board, edit `tools/make-sample.mjs` and the Markdown files under `boards/sample`, then run `npm run sample && npm run build`.
