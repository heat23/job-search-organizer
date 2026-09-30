// Starting a new board, settings (organizer.config.js), pay blurring, per-folder storage, view-only browsers
// and safe rendering of guides.
const { ok, wait, launch, mkpage, report } = require("./lib.js");
const EMPTY = "file://" + process.env.EMPTY_TREE + "/organizer.html";
(async () => {
  let b;
  try {
    b = await launch();
    // ---- S1: a brand-new board in an empty folder
    {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await mkpage(ctx, { url: EMPTY, files: {} });
      ok(
        "S1 the empty board opens with no cards",
        await p.evaluate(() => Object.keys(store.jobs).length === 0 && !!document.querySelector("#banner .banner")),
      );
      await p
        .getByRole("button", { name: /Turn on saving/ })
        .first()
        .click();
      await wait(p, 800);
      const created = await p.evaluate(() => window.__get("board_data.js"));
      ok(
        "S1 picking an empty folder creates board_data.js",
        !!created && /window\.BOARD_DATA = /.test(created),
        String(created).slice(0, 60),
      );
      await p.click("#addBtn");
      await wait(p, 200);
      await p.fill("#new-url", "https://boards.greenhouse.io/examplecorp/jobs/123");
      await p.fill("#new-role", "Staff Engineer");
      ok(
        "S1 the company is filled in from an applicant-tracking link",
        (await p.inputValue("#new-company")) === "Examplecorp",
        await p.inputValue("#new-company"),
      );
      await p.keyboard.press("Enter");
      await wait(p, 1000);
      const saved = await p.evaluate(() => window.__get("board_data.js"));
      ok(
        "S1 a new job is saved to the file",
        /"company": "Examplecorp"/.test(saved) && /"role": "Staff Engineer"/.test(saved),
      );
      await p.click("#nav-library");
      await wait(p, 300);
      ok(
        "S1 an empty Library explains where guides go",
        /No guides yet/.test(await p.$eval("#view", (e) => e.innerText)),
      );
      ok("S1 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- S2: a folder with other files and no board_data.js is refused
    {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { url: EMPTY, files: { "taxes.pdf": "x" } });
      await p
        .getByRole("button", { name: /Turn on saving/ })
        .first()
        .click();
      await wait(p, 600);
      ok(
        "S2 a folder with other files is not taken over",
        !(await p.evaluate(() => window.__get("board_data.js"))) &&
          /Pick the folder this page is in/.test(await p.$eval("#toastRoot", (e) => e.innerText)),
      );
      await ctx.close();
    }
    // ---- S3: settings from organizer.config.js
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const config = {
        ownerName: "Alex",
        files: { resume: "Alex_Resume.pdf" },
        stageFolders: { closed: "9 - Archive" },
        pickerIds: { board: "alex-board" },
        lanes: {
          jobs: [
            { id: "todo", name: "Wishlist", color: "gray" },
            { id: "applied", name: "Sent", color: "blue", follow: 10 },
            { id: "screen", name: "Recruiter screen", color: "amber", follow: 5 },
            { id: "interview", name: "Interviewing", color: "violet", follow: 5 },
            { id: "offer", name: "Offer", color: "green", follow: 3 },
            { id: "closed", name: "Closed", color: "slate", done: true },
          ],
        },
      };
      const p = await mkpage(ctx, { config });
      await p.evaluate(() => {
        const real = window.showDirectoryPicker;
        window.showDirectoryPicker = async (o) => {
          window.__pickerId = o && o.id;
          return real(o);
        };
      });
      await p
        .getByRole("button", { name: /Turn on saving/ })
        .first()
        .click();
      await wait(p, 700);
      ok("S3 owner name in the page title", (await p.title()) === "Alex's job search", await p.title());
      ok(
        "S3 the folder picker uses the configured id",
        (await p.evaluate(() => window.__pickerId)) === "alex-board",
        await p.evaluate(() => window.__pickerId),
      );
      await p.click("#nav-jobs");
      await wait(p, 200);
      const lanes = await p.$$eval("section.lane", (l) => l.map((x) => x.getAttribute("aria-label")));
      ok("S3 lane names come from the settings", lanes[0] === "Wishlist" && lanes[1] === "Sent", lanes.join(","));
      await p.evaluate(() => openDrawer("jobs", "cobaltpeak"));
      await wait(p, 400);
      ok(
        "S3 the Résumé button opens the configured file name",
        /Alex_Resume\.pdf$/.test(await p.$eval("#dResume", (a) => a.getAttribute("href"))),
      );
      await p.click("#lp-closed");
      await wait(p, 1500);
      ok(
        "S3 a closed job's folder moves to the configured stage folder",
        /^9 - Archive\//.test(await p.evaluate(() => get("jobs", "cobaltpeak").folder)) &&
          !!(await p.evaluate(() => window.__ls("9 - Archive"))),
      );
      await p.evaluate(() => moveCard("jobs", "quillstone", "applied"));
      await wait(p, 300);
      ok(
        "S3 the follow-up comes from the lane's configured days",
        await p.evaluate(() => get("jobs", "quillstone").followUp === addDays(10)),
      );
      ok("S3 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- S4: pay blurring (blurPay: true) for screen sharing
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { config: { blurPay: true } });
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 500);
      const blurred = () =>
        p.evaluate(() => getComputedStyle(document.querySelector("#drawerRoot .hs.pay > ul")).filter.includes("blur"));
      ok("S4 pay sections are blurred", await blurred());
      await p.keyboard.press("Escape");
      await p.keyboard.press("h");
      await wait(p, 100);
      ok("S4 H shows them", !(await blurred()));
      await p.keyboard.press("h");
      await wait(p, 100);
      ok("S4 H again hides them", await blurred());
      await p.keyboard.press("Escape");
      await p.click("#nav-library");
      await wait(p, 300);
      await p.fill(".hlsearch", "floor");
      await wait(p, 300);
      ok(
        "S4 search results don't show pay text while blurred",
        /Pay: open it to see/.test(await p.$eval(".hlread", (e) => e.innerText)),
      );
      await ctx.close();
    }
    // ---- S5: each board folder has its own browser storage
    {
      const ctx = await b.newContext();
      const p = await mkpage(ctx);
      await p.evaluate(() => put("jobs", "only_here", { company: "Local Only Co", role: "Tester", lane: "todo" }));
      await wait(p, 200);
      const p2 = await mkpage(ctx, { url: EMPTY, files: {} });
      ok(
        "S5 a card kept in one board's browser copy never shows up in another board",
        !(await p2.evaluate(() => !!get("jobs", "only_here"))) && (await p.evaluate(() => !!get("jobs", "only_here"))),
      );
      await ctx.close();
    }
    // ---- S6: browsers without folder access are view-only, and say so
    {
      const ctx = await b.newContext();
      const p = await ctx.newPage();
      p.errs = [];
      p.on("pageerror", (e) => p.errs.push(e.message));
      await p.addInitScript("delete window.showDirectoryPicker");
      await p.goto("file://" + process.env.SAMPLE_TREE + "/organizer.html");
      await wait(p, 400);
      ok(
        "S6 view-only banner in browsers that can't save to a folder",
        /View only/.test(await p.$eval("#banner", (e) => e.innerText)),
      );
      await p.click("#nav-jobs");
      await p.evaluate(() => moveCard("jobs", "quillstone", "applied"));
      await wait(p, 200);
      ok("S6 edits are blocked, not silently lost", await p.evaluate(() => get("jobs", "quillstone").lane === "todo"));
      ok("S6 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- S7: guides can't inject HTML or script links
    {
      const ctx = await b.newContext();
      const evil =
        '# Evil\n\n## Section\n\nHello <img src=x onerror="window.__pwned=1"> [click](javascript:window.__pwned=2) <script>window.__pwned=3</script>\n';
      const p = await mkpage(ctx, { extra: { "Library/1_Interviews/09_Evil.md": evil }, connect: true });
      await p.click("#nav-library");
      await wait(p, 600);
      await p.click('.hlnav a[data-doc="evil"]');
      await wait(p, 300);
      const res = await p.evaluate(() => ({
        pwned: window.__pwned || 0,
        img: document.querySelectorAll(".hlread img").length,
        js: [...document.querySelectorAll(".hlread a")].filter((a) =>
          /^javascript:/i.test(a.getAttribute("href") || ""),
        ).length,
        text: document.querySelector(".hlread").innerText,
      }));
      ok(
        "S7 HTML in a guide shows as text and never runs",
        res.pwned === 0 && res.img === 0 && res.js === 0 && /<img src=x/.test(res.text),
        JSON.stringify({ ...res, text: res.text.slice(0, 80) }),
      );
      await ctx.close();
    }
    // ---- S8: the page never talks to the network
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const seen = [];
      ctx.on("request", (r) => seen.push(r.url()));
      const p = await mkpage(ctx, { connect: true });
      for (const t of ["#nav-jobs", "#nav-hunters", "#nav-people", "#nav-library", "#nav-todos", "#nav-next"]) {
        await p.click(t);
        await wait(p, 150);
      }
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 600);
      const remote = seen.filter((u) => !u.startsWith("file://") && !u.startsWith("data:") && !u.startsWith("blob:"));
      ok(
        "S8 no network requests: everything loads from the folder",
        seen.length > 0 && remote.length === 0,
        remote.slice(0, 3).join(", "),
      );
      await ctx.close();
    }
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n").slice(0, 3).join(" / "));
  }
  report();
  if (b) await b.close();
})();
