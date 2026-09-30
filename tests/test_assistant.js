// The AI-assistant workflow from the README: an assistant edits the files while the page is open, and the page picks
// the changes up when you switch back to it (the window's focus event), tags them, files job folders, and loses nothing.
const fs = require("fs");
const path = require("path");
const { ok, wait, launch, mkpage, report, data, boardText, parseBoard, TREE } = require("./lib.js");

const now = () => new Date().toISOString();
const withData = (d) => boardText.slice(0, boardText.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n";
const focus = async (p) => {
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await wait(p, 1500);
};

(async () => {
  let b;
  try {
    b = await launch();
    // ---- X1: the assistant adds a job, moves another and books a call
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      const d = JSON.parse(JSON.stringify(data));
      d.jobs.larkspur = {
        createdAt: now(),
        company: "Larkspur Analytics",
        role: "Senior Backend Engineer",
        url: "https://jobs.example.com/larkspur/senior-backend",
        lane: "todo",
        updatedAt: now(),
        changedBy: "assistant",
      };
      Object.assign(d.jobs.brightwell_search, {
        lane: "applied",
        movedAt: now(),
        appliedAt: now(),
        followUp: "2030-01-08",
        updatedAt: now(),
        changedBy: "assistant",
      });
      Object.assign(d.jobs.tidewater, {
        lane: "interview",
        callAt: "2030-01-10T14:00",
        callType: "Hiring manager",
        callWith: "Priya N.",
        updatedAt: now(),
        changedBy: "assistant",
      });
      await p.evaluate((t) => window.__put("board_data.js", t), withData(d));
      await focus(p);
      const card = await p.$eval('[data-key="jobs:larkspur"]', (e) => e.innerText).catch(() => "");
      ok(
        "X1 a job the assistant added shows up, tagged",
        /Larkspur/.test(card) && /New from assistant/.test(card),
        card.slice(0, 80),
      );
      ok(
        "X1 a card the assistant moved is in its new lane, with the booked call",
        await p.evaluate(
          () => get("jobs", "brightwell_search").lane === "applied" && get("jobs", "tidewater").callWith === "Priya N.",
        ),
      );
      await wait(p, 1500);
      ok(
        "X1 the moved job's folder is filed by stage without another edit",
        /^2 - Applied\//.test(await p.evaluate(() => get("jobs", "brightwell_search").folder)) &&
          (await p.evaluate(() => window.__ls("2 - Applied"))).some((n) =>
            /^Brightwell Labs - Senior Software Engineer, Search$/.test(n),
          ),
        await p.evaluate(() => get("jobs", "brightwell_search").folder),
      );
      ok("X1 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- X2: a prep sheet the assistant writes appears on the card when you switch back
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 3000);
      const tag = () => p.$eval('[data-key="jobs:tidewater"]', (e) => /No prep sheet/.test(e.innerText));
      const before = await tag();
      // the example prep sheet from AGENTS.md, as an assistant would write it
      const guide = fs.readFileSync(path.join(TREE, "AGENTS.md"), "utf8");
      const example = /```markdown\n([\s\S]*?)```/.exec(guide)[1];
      await p.evaluate((t) => window.__put("Job notes/tidewater/prep.md", t), example);
      await focus(p);
      ok("X2 the new prep sheet is picked up on focus", before && !(await tag()));
      await p.evaluate(() => openDrawer("jobs", "tidewater"));
      await wait(p, 700);
      const titles = await p.$$eval("#drawerRoot .hs .hs-h", (h) => h.map((x) => x.textContent.trim().toLowerCase()));
      ok(
        "X2 the prep sheet template in AGENTS.md renders every section",
        ["your opener", "what they're asking for", "likely questions", "questions to ask them", "pay"].every((s) =>
          titles.some((t) => t.startsWith(s)),
        ),
        titles.join(" | "),
      );
      ok("X2 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- X3: a chat tool hands back a partial or older board file: nothing is lost, and the file is repaired
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      const d = JSON.parse(JSON.stringify(data));
      const dropped = Object.keys(d.jobs).slice(0, 3);
      for (const id of dropped) delete d.jobs[id];
      delete d.people;
      await p.evaluate((t) => window.__put("board_data.js", t), withData(d));
      await focus(p);
      await wait(p, 1200);
      const after = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      ok(
        "X3 records missing from the returned file are kept and written back",
        dropped.every((id) => after.jobs[id] && !after.jobs[id].deleted) &&
          Object.keys(after.people || {}).length === Object.keys(data.people).length,
        dropped.join(","),
      );
      ok("X3 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- X4: both board folders carry the assistant guide
    {
      const root = path.join(__dirname, "..", "boards");
      const same = ["sample", "empty"].map((f) => fs.readFileSync(path.join(root, f, "AGENTS.md"), "utf8"));
      ok(
        "X4 AGENTS.md and CLAUDE.md are in both boards, and the guides match",
        same[0] === same[1] &&
          ["sample", "empty"].every((f) =>
            /@AGENTS\.md/.test(fs.readFileSync(path.join(root, f, "CLAUDE.md"), "utf8")),
          ),
      );
    }
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n").slice(0, 3).join(" / "));
  }
  report();
  if (b) await b.close();
})();
