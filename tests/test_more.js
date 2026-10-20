// Data-file compatibility, working without folder permission, filing folders by stage, keys, drag and drop.
const { ok, wait, esc2, launch, mkpage, report, data, boardText, parseBoard, withRevs } = require("./lib.js");
const JOB = "lumenfield",
  JOB2 = "harborlight";
(async () => {
  let b;
  try {
    b = await launch();
    // ---- A: a data file edited by another tool (a script, an AI assistant) round-trips safely
    {
      const d = JSON.parse(JSON.stringify(data));
      d.pipeline = { note: "a top-level key the page doesn't know" };
      Object.assign(d.jobs[JOB], {
        lane: "screen",
        callAt: "2030-10-02T10:00",
        callType: "Recruiter screen",
        callWith: "Jordan P.",
        salaryBand: "L7",
        updatedAt: new Date().toISOString(),
        changedBy: "assistant",
      });
      const txt = boardText.slice(0, boardText.indexOf("{")) + JSON.stringify(withRevs(d), null, 1) + ";\n";
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { text: txt, connect: true });
      await p.evaluate(() => moveCard("jobs", "tidewater", "interview"));
      await wait(p, 1200);
      const d2 = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
      const m = d2.jobs[JOB];
      ok(
        "A unknown fields and top-level keys survive a save",
        d2.pipeline &&
          d2.pipeline.note &&
          m.salaryBand === "L7" &&
          m.callWith === "Jordan P." &&
          d2.jobs.tidewater.lane === "interview",
        JSON.stringify([d2.pipeline, m.salaryBand, m.callWith]),
      );
      await p.click("#nav-jobs");
      await wait(p, 300);
      ok(
        "A a record another tool changed gets a New from … tag",
        await p.evaluate(
          (j) => /New from assistant/.test(document.querySelector(`[data-key="jobs:${j}"]`).innerText),
          JOB,
        ),
      );
      ok("A no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- B: before folder permission (the bundle only)
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx);
      await p.click("#nav-jobs");
      await p.evaluate((j) => openDrawer("jobs", j), JOB);
      await wait(p, 500);
      ok(
        "B prep shows from the bundle with no permission",
        await p.evaluate(() => !!document.querySelector("#drawerRoot .drawer.prep .hs")),
      );
      ok("B pad warns it is not saving to the folder", await p.$eval(".padstat", (e) => /bad/.test(e.className)));
      await p.keyboard.type("typed before permission");
      await wait(p, 900);
      await esc2(p);
      await p.reload();
      await wait(p, 500);
      await p.click("#nav-jobs");
      await p.evaluate((j) => openDrawer("jobs", j), JOB);
      await wait(p, 500);
      ok(
        "B typed notes survive a reload (browser draft)",
        (await p.$eval("#notes-pad", (e) => e.value)).includes("typed before permission"),
      );
      await esc2(p);
      await p.click("#nav-library");
      await wait(p, 400);
      ok("B Library works from the bundle", (await p.$$eval(".hlread .hs", (s) => s.length)) > 3);
      ok("B no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- C..H with permission
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 300);
      // C: a stage change files the job's folder
      await p.evaluate((j) => openDrawer("jobs", j), JOB2);
      await wait(p, 500);
      await p.click("#lp-closed");
      await wait(p, 1500);
      const folder = await p.evaluate((j) => get("jobs", j).folder, JOB2);
      ok(
        "C closing a job files its folder into 3 - Closed",
        /^3 - Closed\//.test(folder) && !!(await p.evaluate((f) => window.__ls(f), folder)),
        folder,
      );
      ok(
        "C the old folder is gone and the résumé moved with it",
        !(await p.evaluate(() => window.__ls("2 - Applied").some((n) => /Harborlight/.test(n)))) &&
          (await p.evaluate((f) => window.__ls(f).includes("Resume.pdf"), folder)),
      );
      ok(
        "C its notes stay put (closed jobs keep their notes)",
        await p.evaluate((j) => !!window.__ls(`Job notes/${j}`), JOB2),
      );
      await esc2(p);
      await wait(p, 200);
      // D: a To-apply job with a prep sheet gets a button; the sheet opens on demand
      await p.evaluate(() => openDrawer("jobs", "brightwell_search"));
      await wait(p, 400);
      ok(
        "D To-apply job opens the simple drawer with an Open prep sheet button",
        await p.evaluate(
          () =>
            !document.querySelector("#drawerRoot .drawer.prep") &&
            [...document.querySelectorAll("#drawerRoot button")].some((b) => /Open prep sheet/.test(b.innerText)),
        ),
      );
      await p.getByRole("button", { name: /Open prep sheet/ }).click();
      await wait(p, 500);
      ok(
        "D button opens the prep sheet",
        await p.evaluate(() => !!document.querySelector("#drawerRoot .drawer.prep .hs")),
      );
      await esc2(p);
      await wait(p, 200);
      // E: headhunter notes pad
      await p.evaluate(() => openDrawer("hunters", "h_bluefin"));
      await wait(p, 500);
      await p.keyboard.type("Asked about Q4 searches");
      await wait(p, 1500);
      const hn = await p.evaluate(() => window.__get("Job notes/hunters/h_bluefin/my_notes.md"));
      ok(
        "E headhunter notes save to Job notes/hunters/<id>/my_notes.md",
        !!hn && hn.startsWith("Asked about Q4"),
        String(hn).slice(0, 50),
      );
      await esc2(p);
      await wait(p, 200);
      // F: keys and the scripts pane inside a sheet
      await p.evaluate((j) => openDrawer("jobs", j), JOB);
      await wait(p, 500);
      await p.keyboard.press("Escape");
      await p.keyboard.press("s");
      await wait(p, 300);
      ok(
        "F S opens Call scripts inside the sheet with a Back button",
        await p.evaluate(
          () =>
            !document.querySelector("#drawerRoot .plibpane").hidden && !!document.querySelector("#drawerRoot .pback"),
        ),
      );
      await p.click("#drawerRoot .pback");
      await wait(p, 200);
      await p.keyboard.press("3");
      await wait(p, 900);
      ok(
        "F number key jumps to a section",
        await p.evaluate(() => document.querySelector("#drawerRoot .pleftwrap").scrollTop > 50),
      );
      await p.keyboard.press("/");
      await p.keyboard.type("on-call");
      await wait(p, 300);
      const vis = await p.evaluate(
        () => [...document.querySelectorAll("#drawerRoot .pleft .hq")].filter((q) => !q.hidden).length,
      );
      ok("F / filters the questions", vis >= 1 && vis < 3, String(vis));
      await p.keyboard.press("Escape");
      await wait(p, 150);
      await p.keyboard.press("h");
      await wait(p, 100);
      ok(
        "F pay is not blurred by default (H does nothing)",
        await p.evaluate(
          () =>
            [...document.querySelectorAll("#drawerRoot .pay > *")].every(
              (e) => !getComputedStyle(e).filter.includes("blur"),
            ) && !document.body.classList.contains("showpay"),
        ),
      );
      await esc2(p);
      await wait(p, 200);
      // G: drag and drop between lanes
      await p.click("#nav-jobs");
      await wait(p, 300);
      const before = await p.evaluate(() =>
        [...document.querySelectorAll("section.lane")].map((l) => l.querySelectorAll("article.card").length),
      );
      await p
        .locator("section.lane")
        .nth(0)
        .locator("article.card")
        .first()
        .dragTo(p.locator("section.lane").nth(1), { targetPosition: { x: 120, y: 200 } });
      await wait(p, 900);
      const after = await p.evaluate(() =>
        [...document.querySelectorAll("section.lane")].map((l) => l.querySelectorAll("article.card").length),
      );
      ok(
        "G drag and drop moves a card between lanes",
        after[0] === before[0] - 1 && after[1] === before[1] + 1,
        before.join(",") + " -> " + after.join(","),
      );
      ok(
        "G the move is undoable (Ctrl+Z)",
        await (async () => {
          await p.keyboard.press("Control+z");
          await wait(p, 400);
          const u = await p.evaluate(() =>
            [...document.querySelectorAll("section.lane")].map((l) => l.querySelectorAll("article.card").length),
          );
          return u[0] === before[0];
        })(),
      );
      // H: a person card is still the plain drawer
      await p.evaluate(() => openDrawer("people", Object.keys(store.people)[0]));
      await wait(p, 300);
      ok(
        "H people cards keep the normal drawer",
        await p.evaluate(
          () => !!document.querySelector("#drawerRoot .drawer") && !document.querySelector("#drawerRoot .drawer.prep"),
        ),
      );
      ok("No errors (permission session)", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n").slice(0, 4).join(" / "));
  }
  report();
  if (b) await b.close();
})();
