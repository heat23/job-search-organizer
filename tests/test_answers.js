// Answer boxes on prep sheets ("My version" for ✎, "Their answer" for {.ask}), sheet: true, picking up assistant edits
// while a panel is open, closed-card call tags, prep-sheet theme tokens, and Next up / to-do / remove flows.
const fs = require("fs");
const path = require("path");
const { ok, wait, esc2, launch, mkpage, report, data, boardText, parseBoard, TREE } = require("./lib.js");

const JOB = "lumenfield";
const now = () => new Date().toISOString();
const withData = (d) => boardText.slice(0, boardText.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n";
const copy = () => JSON.parse(JSON.stringify(data));
const focus = async (p) => {
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await wait(p, 1500);
};
const openJob = async (p, id) => {
  await p.evaluate((j) => openDrawer("jobs", j), id);
  await wait(p, 700);
};
const sheetOpen = (p) => p.evaluate(() => !!document.querySelector("#drawerRoot .drawer.prep"));
const ASK1 = "Who would I report to, and how big is the team?";
const MINE1 = "Why are you looking to leave your current team?";
/* prep-sheet answers are keyed by question and ## section */
const K_ASK = `prep:${JOB}::${ASK1} @Questions to ask them`,
  K_MINE = `prep:${JOB}::${MINE1} @Likely questions`;

(async () => {
  let b;
  try {
    b = await launch();
    // ---- A: answer boxes on a prep sheet
    {
      const ctx = await b.newContext({
        viewport: { width: 1440, height: 900 },
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await openJob(p, JOB);
      const want = (fs.readFileSync(path.join(TREE, "Job notes", JOB, "prep.md"), "utf8").match(/\{\.ask\}/g) || [])
        .length;
      const asks = await p.$$eval("#drawerRoot .pleft details.mine.ask", (d) =>
        d.map((x) => ({ open: x.open, label: x.querySelector("summary").textContent })),
      );
      ok(
        "A a {.ask} question gets a Their answer box, open from the start",
        want === 2 && asks.length === want && asks.every((a) => a.open && a.label === "Their answer"),
        JSON.stringify(asks),
      );
      const titles = await p.$$eval("#drawerRoot .pleft .hq h4 > span", (s) => s.map((x) => x.textContent));
      const pills = await p.$eval("#drawerRoot .pills", (e) => e.textContent);
      ok(
        "A {.ask} is stripped from the question title and never shows",
        titles.includes(ASK1) &&
          !(await p.evaluate(() => /\{\.ask\}/.test(document.querySelector("#drawerRoot").innerText))) &&
          !/\{\.ask\}/.test(pills),
        titles.filter((t) => /report|next steps/.test(t)).join(" | "),
      );
      const mine = await p.$$eval("#drawerRoot .pleft details.mine:not(.ask)", (d) =>
        d.map((x) => ({ open: x.open, label: x.querySelector("summary").textContent })),
      );
      ok(
        "A ✎ questions on the prep sheet get a folded My version box",
        mine.length === 2 && mine.every((m) => !m.open && m.label === "My version"),
        JSON.stringify(mine),
      );
      ok(
        "A the cursor still starts in the notes pad",
        await p.evaluate(() => document.activeElement && document.activeElement.id === "notes-pad"),
      );
      await p.locator("#drawerRoot details.mine.ask textarea").first().click();
      await p.keyboard.type("Team of six, reports to the payments director.");
      await wait(p, 1600);
      let md = (await p.evaluate(() => window.__get("Library/My_answers.md"))) || "";
      ok(
        "A typing in Their answer saves to My_answers.md under prep:<job>::<question> @<section>",
        md.includes(`## ${K_ASK}\nTeam of six, reports to the payments director.`),
        md.slice(0, 200),
      );
      ok(
        "A the box shows a check once answered",
        (await p.$eval("#drawerRoot details.mine.ask > summary", (s) => s.textContent)) === "Their answer ✓",
      );
      const box = p.locator(`#drawerRoot .pleft details.mine[data-k="${K_MINE}"]`);
      await box.locator("summary").click();
      await box.locator("textarea").fill("My team's roadmap moved away from payments.");
      await wait(p, 1600);
      md = (await p.evaluate(() => window.__get("Library/My_answers.md"))) || "";
      ok(
        "A typing in My version saves under the job key too",
        md.includes(`## ${K_MINE}\nMy team's roadmap moved away from payments.`) &&
          (await box.locator("summary").textContent()) === "My version ✓",
        md.slice(0, 300),
      );
      const notes = (await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB)) || "";
      ok(
        "A answers never go into my_notes.md",
        !notes.includes("Team of six") && !notes.includes("roadmap moved"),
        notes.slice(0, 80),
      );
      // Copy all on the section with the boxes leaves them out
      await p.evaluate(() => {
        const s = [...document.querySelectorAll("#drawerRoot .pleft .hs")].find((x) =>
          /Questions to ask/.test(x.dataset.title),
        );
        s.scrollIntoView();
        s.querySelector(".hs-h .hcopy").click();
      });
      await wait(p, 250);
      const clip = await p.evaluate(() => navigator.clipboard.readText());
      ok(
        "A Copy all leaves the answer boxes out",
        /payment flow/.test(clip) && !/Team of six|Their answer|My version|\{\.ask\}/.test(clip),
        clip.slice(0, 160).replace(/\n/g, "\\n"),
      );
      // cues only: the answer boxes stay visible
      await p.click("#drawerRoot .pcues");
      await wait(p, 150);
      ok(
        "A in Hide answers mode the Their answer boxes stay visible",
        await p.evaluate(() =>
          [...document.querySelectorAll("#drawerRoot details.mine.ask textarea")].every(
            (t) => t.getClientRects().length > 0,
          ),
        ),
      );
      await p.click("#drawerRoot .pcues");
      // half a screen
      await p.setViewportSize({ width: 900, height: 800 });
      await wait(p, 300);
      ok(
        "A at 900px the boxes fit the column",
        await p.evaluate(() => {
          const t = document.querySelector("#drawerRoot details.mine.ask textarea");
          const r = t.getBoundingClientRect();
          return r.width > 100 && r.right <= window.innerWidth && r.height < 160;
        }),
      );
      await p.setViewportSize({ width: 1440, height: 900 });
      // after a reload the answer is still there
      await esc2(p);
      await p.reload();
      await wait(p, 700);
      await p.click("#nav-jobs");
      await openJob(p, JOB);
      ok(
        "A the answer is still there after a reload",
        (await p.$eval("#drawerRoot details.mine.ask textarea", (t) => t.value)) ===
          "Team of six, reports to the payments director.",
      );
      ok("A no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
      // a fresh browser reads the answers back from My_answers.md
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await mkpage(ctx2, { connect: true, extra: { "Library/My_answers.md": md } });
      await p2.click("#nav-jobs");
      await openJob(p2, JOB);
      await wait(p2, 500);
      ok(
        "A a fresh browser fills the boxes from Library/My_answers.md",
        (await p2.$eval("#drawerRoot details.mine.ask textarea", (t) => t.value)) ===
          "Team of six, reports to the payments director." &&
          (await p2.$eval(`#drawerRoot .pleft details.mine[data-k="${K_MINE}"]`, (d) => d.open)),
      );
      // the renderer: {.ask} wins over ✎ on a sheet; a guide just drops the marker
      const r = await p2.evaluate(() => {
        const md = "# T\n## S\n### Q one ✎ {.ask}\nx\n### Q two {.ask} {.pay}\ny\n";
        const box = (h) => {
          const d = document.createElement("div");
          d.innerHTML = h;
          return {
            ask: d.querySelectorAll("details.mine.ask").length,
            mine: d.querySelectorAll("details.mine:not(.ask)").length,
            raw: /\{\.ask\}/.test(d.textContent),
            pay: d.querySelectorAll(".hq.pay").length,
          };
        };
        return {
          sheet: box(Prep.renderDoc(md, "t", { mineKey: "prep:z", ask: true }).html),
          guide: box(Prep.renderDoc(md, "g", { mineKey: "guide" }).html),
          titles: Prep.parse(md).secs[0].qs.map((q) => q.title),
        };
      });
      ok(
        "A {.ask} beats ✎ on a sheet, and a Library guide drops it (✎ box only)",
        r.sheet.ask === 2 &&
          r.sheet.mine === 0 &&
          r.guide.ask === 0 &&
          r.guide.mine === 1 &&
          !r.sheet.raw &&
          !r.guide.raw &&
          r.sheet.pay === 1 &&
          r.titles.join("|") === "Q one ✎|Q two",
        JSON.stringify(r),
      );
      ok("A fresh-browser no errors", p2.errs.length === 0, p2.errs.join("|"));
      await ctx2.close();
    }
    // ---- B: theme tokens on prep sheets follow data-theme like the board's
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx);
      const tok = () =>
        p.evaluate(() => {
          const s = getComputedStyle(document.documentElement);
          return ["--bg", "--note", "--ex", "--todo", "--flash", "--ask"].map((k) => s.getPropertyValue(k).trim());
        });
      await p.emulateMedia({ colorScheme: "light" });
      const light = await tok();
      await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      const forcedDark = await tok();
      await p.emulateMedia({ colorScheme: "dark" });
      await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
      const sysDark = await tok();
      await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      const forcedLight = await tok();
      ok(
        'B data-theme="dark" gives dark prep tokens on a light system',
        forcedDark[1] === "#23211a" && forcedDark[5] === "#1d2740" && forcedDark[0] === "#12161d",
        forcedDark.join(","),
      );
      ok(
        'B data-theme="light" keeps light prep tokens on a dark system',
        JSON.stringify(forcedLight) === JSON.stringify(light) && light[1] === "#fffceb",
        forcedLight.join(",") + " vs " + light.join(","),
      );
      ok("B the system dark setting still works", JSON.stringify(sysDark) === JSON.stringify(forcedDark));
      ok("B no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- C: sheet: true, and the call tag on a closed card
    {
      const d = copy();
      Object.assign(d.jobs.brightwell_search, { sheet: true, updatedAt: now(), changedBy: "assistant" });
      Object.assign(d.jobs.quillstone, { sheet: true, updatedAt: now(), changedBy: "assistant" });
      Object.assign(d.jobs.marigold, {
        callAt: "2030-01-10T14:00",
        callType: "Hiring manager",
        updatedAt: now(),
        changedBy: "assistant",
      });
      Object.assign(d.jobs.tidewater, {
        callAt: "2030-01-11T10:00",
        callType: "Recruiter screen",
        updatedAt: now(),
        changedBy: "assistant",
      });
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true, text: withData(d) });
      await p.click("#nav-jobs");
      await wait(p, 300);
      await openJob(p, "brightwell_search");
      ok("C a To-apply job with sheet: true opens straight to its prep sheet", await sheetOpen(p));
      await esc2(p);
      await openJob(p, "quillstone");
      ok(
        "C sheet: true without a prep.md opens the plain panel",
        !(await sheetOpen(p)) && (await p.evaluate(() => !!document.querySelector("#drawerRoot .drawer"))),
      );
      await esc2(p);
      const tags = await p.evaluate(() => ({
        closed: !!document.querySelector('[data-key="jobs:marigold"] .tag.hcall'),
        open: !!document.querySelector('[data-key="jobs:tidewater"] .tag.hcall'),
      }));
      ok("C a closed card with a future call shows no call tag", !tags.closed && tags.open, JSON.stringify(tags));
      await p.click("#nav-next");
      await wait(p, 300);
      const up = await p.$eval(".hup", (e) => e.innerText).catch(() => "");
      ok("C Upcoming calls leaves out closed jobs", /Tidewater/.test(up) && !/Marigold/.test(up), up.slice(0, 120));
      ok("C no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
      // without sheet: true the To-apply job keeps the plain panel and its button
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await mkpage(ctx2, { connect: true });
      await p2.click("#nav-jobs");
      await openJob(p2, "brightwell_search");
      ok(
        "C without sheet: true a To-apply job opens the plain panel with Open prep sheet",
        !(await sheetOpen(p2)) && (await p2.getByRole("button", { name: "Open prep sheet" }).count()) === 1,
      );
      await ctx2.close();
    }
    // ---- D: an assistant edit while a prep sheet is open is merged; the sheet and the typed notes stay
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 3000);
      await openJob(p, JOB);
      await p.keyboard.type("Typed during the call: team of 8");
      const d = copy();
      Object.assign(d.jobs.harborlight, {
        notes: "Recruiter replied: panel next week.",
        updatedAt: now(),
        changedBy: "assistant",
      });
      Object.assign(d.jobs.brightwell_search, {
        lane: "applied",
        movedAt: now(),
        appliedAt: now(),
        updatedAt: now(),
        changedBy: "assistant",
      });
      await p.evaluate((t) => window.__put("board_data.js", t), withData(d));
      await p.evaluate(() => window.__put("Job notes/tidewater/prep.md", "# Tidewater\n\n## Your opener\n- Hello\n"));
      await focus(p);
      ok(
        "D focus with a sheet open merges the assistant's edit",
        await p.evaluate(
          () =>
            get("jobs", "harborlight").notes === "Recruiter replied: panel next week." &&
            get("jobs", "brightwell_search").lane === "applied",
        ),
      );
      ok(
        "D the sheet stays open and the typed notes stay, with the cursor",
        (await sheetOpen(p)) &&
          (await p.evaluate(
            () =>
              document.activeElement.id === "notes-pad" &&
              document.activeElement.value.includes("Typed during the call: team of 8"),
          )),
      );
      ok(
        "D the new prep sheet is read in the background",
        await p.evaluate(() => /Tidewater/.test(Prep.prep.tidewater || "")),
      );
      await p.keyboard.type(" and more");
      await wait(p, 1600);
      await esc2(p);
      await wait(p, 1500);
      ok(
        "D after closing, the board shows the change and the folder is filed",
        /^2 - Applied\//.test(await p.evaluate(() => get("jobs", "brightwell_search").folder)) &&
          (await p.evaluate(
            () => !!document.querySelector('section.lane[aria-label="Applied"] [data-key="jobs:brightwell_search"]'),
          )) &&
          (await p.evaluate(
            () => !/No prep sheet/.test(document.querySelector('[data-key="jobs:tidewater"]').innerText),
          )),
        await p.evaluate(() => get("jobs", "brightwell_search").folder),
      );
      const notes = (await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB)) || "";
      ok("D nothing typed was lost", notes.includes("Typed during the call: team of 8 and more"), notes.slice(0, 80));
      const file = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      ok(
        "D the assistant's edit is kept in the file",
        file.jobs.harborlight.notes === "Recruiter replied: panel next week.",
      );
      ok("D no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- H: an assistant edit to the open record refreshes the panel's fields, so a later edit can't undo it
    {
      const ASSIST = "Assistant: the team is hiring two engineers this quarter.";
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 3000);
      await openJob(p, "fernhill");
      ok("H a To-apply job without a prep sheet opens the plain panel", !(await sheetOpen(p)));
      const d = copy();
      Object.assign(d.jobs.fernhill, { notes: ASSIST, updatedAt: now(), changedBy: "assistant" });
      await p.evaluate((t) => window.__put("board_data.js", t), withData(d));
      await focus(p);
      ok(
        "H focus shows the assistant's notes in the open panel",
        (await p.$eval("#f-notes", (e) => e.value)) === ASSIST,
        await p.$eval("#f-notes", (e) => e.value),
      );
      await p.focus("#f-notes");
      await p.evaluate(() => {
        const t = document.querySelector("#f-notes");
        t.setSelectionRange(t.value.length, t.value.length);
      });
      await p.keyboard.type(" Then I asked about the stack.");
      await wait(p, 2000);
      const file = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      ok(
        "H typing after the refresh keeps the assistant's text and adds yours, in the file",
        file.jobs.fernhill.notes === ASSIST + " Then I asked about the stack.",
        file.jobs.fernhill.notes,
      );
      ok("H no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- H2: the same while you are typing in that field: your text is kept; other fields still update
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 3000);
      await openJob(p, "fernhill");
      await p.click("#drawerRoot details.edit summary");
      const before = await p.$eval("#f-notes", (e) => e.value);
      await p.focus("#f-notes");
      await p.evaluate(() => {
        const t = document.querySelector("#f-notes");
        t.setSelectionRange(t.value.length, t.value.length);
      });
      await p.keyboard.type(" Typing now");
      const d = copy();
      Object.assign(d.jobs.fernhill, {
        notes: "Assistant rewrote the notes.",
        location: "Remote (assistant)",
        updatedAt: now(),
        changedBy: "assistant",
      });
      await p.evaluate((t) => window.__put("board_data.js", t), withData(d));
      await focus(p);
      await wait(p, 800);
      const field = await p.$eval("#f-notes", (e) => e.value);
      const file = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      ok(
        "H2 the field you are typing in keeps your text, in the page and the file",
        field === before + " Typing now" &&
          (await p.evaluate(() => get("jobs", "fernhill").notes)) === field &&
          file.jobs.fernhill.notes === field,
        JSON.stringify([field, file.jobs.fernhill.notes]),
      );
      ok(
        "H2 a field you are not typing in shows the assistant's value",
        (await p.$eval("#f-location", (e) => e.value)) === "Remote (assistant)" &&
          file.jobs.fernhill.location === "Remote (assistant)",
      );
      ok("H2 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- I: with a plain panel open, the job's own new prep.md is still picked up on focus
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 3000);
      await openJob(p, "quillstone");
      const btn = () => p.getByRole("button", { name: "Open prep sheet" }).count();
      ok("I no prep sheet yet: no Open prep sheet button", !(await sheetOpen(p)) && (await btn()) === 0);
      await p.evaluate(() => window.__put("Job notes/quillstone/prep.md", "# Quillstone\n\n## Your opener\n- Hello\n"));
      await focus(p);
      ok(
        "I focus reads the open job's prep.md and offers Open prep sheet",
        (await p.evaluate(() => /Quillstone/.test(Prep.prep.quillstone || ""))) && (await btn()) === 1,
      );
      ok("I no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- J: an answer with a line starting "## " round-trips through My_answers.md
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await openJob(p, JOB);
      await p.locator("#drawerRoot details.mine.ask textarea").first().click();
      await p.keyboard.type("First line\n## Heading inside\nLast line");
      await wait(p, 1600);
      const md = (await p.evaluate(() => window.__get("Library/My_answers.md"))) || "";
      ok(
        "J a line starting with ## is written escaped",
        md.includes(`## ${K_ASK}\nFirst line\n\\## Heading inside\nLast line`) && !/^## Heading inside$/m.test(md),
        md.slice(0, 300),
      );
      ok(
        "J older files without escapes read the same, and a typed backslash line survives",
        await p.evaluate(() => {
          const a = myFromMd("# My answers\n\n## q one\nline\n\n## q two\n> said\n");
          const typed = "\\## kept as typed";
          MY.__t = typed;
          const back = myFromMd(myToMd()).__t;
          delete MY.__t;
          return a["q one"] === "line" && a["q two"] === "> said" && back === typed;
        }),
      );
      await ctx.close();
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await mkpage(ctx2, { connect: true, extra: { "Library/My_answers.md": md } });
      await p2.click("#nav-jobs");
      await openJob(p2, JOB);
      await wait(p2, 500);
      const keys = await p2.evaluate(() => Object.keys(MY));
      ok(
        "J a fresh browser reads the answer back whole, with no extra key",
        (await p2.$eval("#drawerRoot details.mine.ask textarea", (t) => t.value)) ===
          "First line\n## Heading inside\nLast line" && !keys.some((k) => /Heading inside/.test(k)),
        JSON.stringify(keys),
      );
      ok("J no errors", p.errs.length === 0 && p2.errs.length === 0, p.errs.concat(p2.errs).join("|"));
      await ctx2.close();
    }
    // ---- E: Next up actions: Log follow-up (with Undo), Snooze a week, Keep waiting
    {
      const d = copy();
      const ago = (n) => new Date(Date.now() - n * 864e5).toISOString();
      for (const j of Object.values(d.jobs)) Object.assign(j, { followUp: null, movedAt: now(), updatedAt: now() });
      for (const c of ["hunters", "people"])
        for (const r of Object.values(d[c])) Object.assign(r, { followUp: null, movedAt: now(), updatedAt: now() });
      const ymd = (n) => {
        const t = new Date();
        t.setDate(t.getDate() + n);
        return new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      };
      Object.assign(d.jobs.harborlight, { followUp: ymd(-1), notes: "" });
      d.jobs.lumenfield.followUp = ymd(0);
      Object.assign(d.jobs.tidewater, { movedAt: ago(30), followUp: ymd(5), keepUntil: null });
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true, text: withData(d) });
      await p.click("#nav-next");
      await wait(p, 300);
      const row = (k) => p.locator(`[data-key="due:jobs:${k}"]`);
      ok(
        "E Follow up lists the due and stale jobs",
        (await row("harborlight").count()) === 1 &&
          (await row("lumenfield").count()) === 1 &&
          (await row("tidewater").count()) === 1,
      );
      await row("harborlight").getByRole("button", { name: "Log follow-up" }).click();
      await wait(p, 200);
      const logged = await p.evaluate(() => {
        const x = get("jobs", "harborlight");
        return {
          ok: x.followUp === addDays(7) && x.keepUntil === addDays(14) && x.notes === logLine("Followed up."),
          x: [x.followUp, x.keepUntil, x.notes],
        };
      });
      ok(
        "E Log follow-up adds a dated line and sets the next follow-up",
        logged.ok && (await row("harborlight").count()) === 0,
        JSON.stringify(logged.x),
      );
      await p.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(p, 200);
      ok(
        "E Undo puts the follow-up back",
        await p.evaluate(
          (f) => get("jobs", "harborlight").followUp === f && !get("jobs", "harborlight").notes,
          ymd(-1),
        ),
      );
      await row("lumenfield").getByRole("button", { name: "Snooze a week" }).click();
      await wait(p, 200);
      ok(
        "E Snooze a week moves the follow-up seven days out",
        (await p.evaluate(() => get("jobs", "lumenfield").followUp === addDays(7))) &&
          (await row("lumenfield").count()) === 0,
      );
      await row("tidewater").getByRole("button", { name: "Keep waiting" }).click();
      await wait(p, 200);
      ok(
        "E Keep waiting hides a stale card for two weeks",
        (await p.evaluate(() => get("jobs", "tidewater").keepUntil === addDays(14))) &&
          (await row("tidewater").count()) === 0,
      );
      await wait(p, 900);
      const file = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      ok(
        "E the changes are saved to the file",
        file.jobs.tidewater.keepUntil && file.jobs.lumenfield.followUp === (await p.evaluate(() => addDays(7))),
      );
      ok("E no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- F: to-dos (add, mark done, Undo) and removing a card (Restore)
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-todos");
      await wait(p, 200);
      await p.fill("#newTodo", "Send the thank-you note to Lumenfield");
      await p.keyboard.press("Enter");
      await wait(p, 300);
      const tid = await p.evaluate(
        () => Object.entries(live("todos")).find(([, t]) => t.text === "Send the thank-you note to Lumenfield")?.[0],
      );
      ok(
        "F a new to-do is added at the top, marked as yours",
        !!tid &&
          (await p.evaluate((id) => get("todos", id).from === "you" && !get("todos", id).done, tid)) &&
          /thank-you note/.test(await p.$eval(".todos .group .todo", (e) => e.innerText)),
      );
      await p.click(`#td-t-${tid}`);
      await wait(p, 200);
      ok(
        "F checking it marks it done",
        await p.evaluate((id) => get("todos", id).done === true && !!get("todos", id).doneAt, tid),
      );
      await p.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(p, 200);
      ok(
        "F Undo reopens it",
        await p.evaluate((id) => get("todos", id).done === false && !get("todos", id).doneAt, tid),
      );
      await wait(p, 800);
      ok("F the to-do is in the file", !!parseBoard(await p.evaluate(() => window.__get("board_data.js"))).todos[tid]);
      // remove a job with a folder, then restore it
      await p.click("#nav-jobs");
      await wait(p, 200);
      await openJob(p, "brightwell_search");
      await p.click("#drawerRoot button.danger");
      await p.locator("#drawerRoot .confirm button", { hasText: /^Remove$/ }).click();
      await wait(p, 1500);
      const gone = await p.evaluate(() => ({
        card: !!document.querySelector('[data-key="jobs:brightwell_search"]'),
        del: get("jobs", "brightwell_search") === null && !!store.jobs.brightwell_search.deleted,
        folder: store.jobs.brightwell_search.folder,
      }));
      ok(
        "F Remove takes the card off the board and moves its folder to the removed folder",
        !gone.card && gone.del && /^4 - Removed\//.test(gone.folder),
        JSON.stringify(gone),
      );
      await p.click('section.lane[aria-label="Closed"] details.removed summary');
      await p
        .locator("details.removed .rrow", { hasText: "Brightwell" })
        .getByRole("button", { name: "Restore" })
        .click();
      await wait(p, 1500);
      ok(
        "F Restore brings the card and its folder back",
        (await p.evaluate(() => !!document.querySelector('[data-key="jobs:brightwell_search"]'))) &&
          /^1 - To apply\//.test(await p.evaluate(() => store.jobs.brightwell_search.folder)) &&
          !parseBoard(await p.evaluate(() => window.__get("board_data.js"))).jobs.brightwell_search.deleted,
        await p.evaluate(() => store.jobs.brightwell_search.folder),
      );
      ok("F no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- G: a malformed board_data.js is never overwritten
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      const bad = boardText.slice(0, boardText.indexOf("{")) + '{ "jobs": { "x": { "company": "Half written" ';
      await p.evaluate((t) => window.__put("board_data.js", t), bad);
      await p.evaluate(() => moveCard("jobs", "quillstone", "applied"));
      await wait(p, 1200);
      await focus(p);
      ok(
        "G a broken data file is left exactly as it is",
        (await p.evaluate(() => window.__get("board_data.js"))) === bad,
      );
      ok(
        "G the page says so and keeps the change",
        /has an error/.test(await p.$eval("#status", (e) => e.innerText)) &&
          (await p.evaluate(() => get("jobs", "quillstone").lane === "applied")),
      );
      await p.evaluate((t) => window.__put("board_data.js", t), boardText);
      await focus(p);
      await wait(p, 800);
      const fixed = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      ok(
        "G once the file is fixed, the kept change is written",
        fixed.jobs.quillstone.lane === "applied" && /Saved|Saving/.test(await p.$eval("#status", (e) => e.innerText)),
      );
      ok("G no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n").slice(0, 3).join(" / "));
  }
  report();
  if (b) await b.close();
})();
