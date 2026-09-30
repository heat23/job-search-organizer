// Main flows on the sample board: saving, the prep sheet, notes, calls, quick open, the Library, backups, layout.
const { ok, wait, esc2, launch, mkpage, report, data, parseBoard } = require("./lib.js");
const JOB = "lumenfield",
  JOB2 = "harborlight";
(async () => {
  let b;
  try {
    b = await launch();
    const ctx = await b.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const p = await mkpage(ctx, { second: "MyBackup" });
    // T1 tabs
    const tabs = await p.$$eval("#nav button", (bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    ok("T1 six tabs incl. Prep library", tabs.length === 6 && /Prep/.test(tabs[5]), tabs.join("|"));
    // T2 connect saving via the banner button
    const btn = p.getByRole("button", { name: /Turn on saving/ }).first();
    ok("T2 banner offers Turn on saving", (await btn.count()) > 0);
    if (await btn.count()) {
      await btn.click();
      await wait(p, 800);
    }
    const stat = await p.$eval("#status", (e) => e.innerText).catch(() => "");
    ok("T2 saving on", /Saved|Saving/.test(stat), stat);
    // T3 open an applied job: the prep sheet
    await p.click("#nav-jobs");
    await wait(p, 300);
    await p.evaluate((j) => openDrawer("jobs", j), JOB);
    await wait(p, 600);
    ok("T3 applied job opens prep sheet", await p.evaluate(() => !!document.querySelector("#drawerRoot .drawer.prep")));
    const secs = await p.$$eval("#drawerRoot .pills a", (as) => as.map((a) => a.innerText.replace(/\d/, "").trim()));
    ok(
      "T3 sections + outreach/posting pills",
      secs.length >= 8 && secs.includes("Outreach") && secs.includes("Posting"),
      secs.join("|"),
    );
    const payOk = await p.$eval("#drawerRoot .hs.pay", (e) => e.classList.contains("pay")).catch(() => false);
    ok(
      "T3 pay section present and NOT blurred by default",
      payOk &&
        (await p.evaluate(
          () => !getComputedStyle(document.querySelector("#drawerRoot .hs.pay > ul")).filter.includes("blur"),
        )),
    );
    await p.locator("#drawerRoot blockquote.say .qcopy").first().click();
    await wait(p, 200);
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    ok("T3 copy puts the answer on the clipboard", clip.length > 40 && !/Copy/.test(clip), clip.slice(0, 60));
    // T4 notes pad
    const f0 = await p.evaluate(() => document.activeElement && document.activeElement.id);
    ok("T4 the cursor starts in the notes pad", f0 === "notes-pad", f0);
    await p.keyboard.type("Thu call with Jordan. Team of 40.");
    await wait(p, 1600);
    const saved = await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB);
    ok("T4 notes autosaved to my_notes.md", saved && saved.includes("Team of 40"), String(saved).slice(0, 60));
    ok("T4 pad says saved", /Saved/.test(await p.$eval(".padstat", (e) => e.innerText)));
    await p.keyboard.press("Escape");
    await wait(p, 100);
    await p.keyboard.press("n");
    await wait(p, 80);
    ok("T4 N returns to the pad after Esc", await p.evaluate(() => document.activeElement.id === "notes-pad"));
    await p.keyboard.press("Escape");
    await wait(p, 100);
    ok(
      "T4 first Esc keeps the sheet open",
      await p.evaluate(() => !!document.querySelector("#drawerRoot .drawer.prep")),
    );
    await p.keyboard.press("Escape");
    await wait(p, 150);
    ok("T4 second Esc closes it", await p.evaluate(() => !document.querySelector("#drawerRoot .drawer")));
    await p.evaluate((j) => openDrawer("jobs", j), JOB);
    await wait(p, 500);
    ok("T4 notes reload on reopen", (await p.$eval("#notes-pad", (e) => e.value)).includes("Team of 40"));
    // a change made on disk by another tool appears in the pad
    await p.evaluate((j) => window.__put(`Job notes/${j}/my_notes.md`, "Edited on disk by another tool\n"), JOB);
    await wait(p, 5600);
    ok("T4 disk change appears in the pad", (await p.$eval("#notes-pad", (e) => e.value)).includes("Edited on disk"));
    // conflict: the pad has unsaved typing and the file changes on disk at the same time
    await p.focus("#notes-pad");
    await p.keyboard.press("End");
    await p.evaluate(() => {
      const t = document.querySelector("#notes-pad");
      t.value += "\nmy local line";
      t.dispatchEvent(new Event("input"));
    });
    await p.evaluate((j) => window.__put(`Job notes/${j}/my_notes.md`, "A different disk version\n"), JOB);
    await wait(p, 1700);
    const lsn = await p.evaluate((j) => window.__ls(`Job notes/${j}`), JOB);
    ok(
      "T4 conflict keeps both versions",
      lsn.some((n) => /my_notes\.changed-on-disk/.test(n)),
      lsn.join(","),
    );
    ok(
      "T4 my version wins in my_notes.md",
      (await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB)).includes("my local line"),
    );
    // T5 permission lapses
    await p.evaluate(() => {
      canWrite = false;
    });
    await p.evaluate(() => {
      const t = document.querySelector("#notes-pad");
      t.value += "\ntyped while not saving";
      t.dispatchEvent(new Event("input"));
    });
    await wait(p, 1000);
    const bad = await p.$eval(".padstat", (e) => ({ c: e.className, t: e.innerText }));
    ok("T5 red warning when saving is off", /bad/.test(bad.c) && /Turn on saving/.test(bad.t), bad.c + " " + bad.t);
    await p.evaluate(() => {
      canWrite = true;
    });
    await p.evaluate(() => {
      const t = document.querySelector("#notes-pad");
      t.value += " +more";
      t.dispatchEvent(new Event("input"));
    });
    await wait(p, 1600);
    const fin2 = await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB);
    ok("T5 nothing lost after saving resumes", fin2.includes("typed while not saving") && fin2.includes("+more"));
    // T6 booking a call
    await p.evaluate(() => {
      const s = document.querySelector("#drawerRoot .callrow select");
      s.value = "Recruiter screen";
      s.dispatchEvent(new Event("change"));
    });
    await wait(p, 200);
    const dt = new Date(Date.now() + 3 * 864e5);
    dt.setHours(10, 0, 0, 0);
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    await p.evaluate((v) => {
      const s = document.querySelector("#drawerRoot .callrow input[type=datetime-local]");
      s.value = v;
      s.dispatchEvent(new Event("change"));
    }, local);
    await wait(p, 700);
    const lane = await p.evaluate((j) => laneKey("jobs", get("jobs", j)), JOB);
    ok("T6 booking a recruiter call moves the card to Recruiter screen", lane === "screen", lane);
    ok("T6 header shows the call", /📞/.test(await p.$eval("#drawerRoot .pstrip", (e) => e.innerText)));
    await esc2(p);
    await esc2(p);
    await p.click("#nav-next");
    await wait(p, 300);
    ok("T6 Upcoming calls on Next up", (await p.$$eval(".hup-r", (r) => r.length)) === 1);
    await p.click("#nav-jobs");
    await wait(p, 200);
    ok("T6 card tag shows the call", (await p.$$eval(".tag.hcall", (r) => r.length)) === 1);
    await wait(p, 800);
    const bd = await p.evaluate(() => window.__get("board_data.js"));
    ok("T6 call saved in board_data.js", /"callAt"/.test(bd) && /"callType": "Recruiter screen"/.test(bd));
    // T7 headhunter sheet
    await p.evaluate(() => openDrawer("hunters", "h_summitvale"));
    await wait(p, 500);
    const hh = await p.evaluate(() => ({
      prep: !!document.querySelector("#drawerRoot .drawer.prep"),
      people: document.querySelectorAll("#h-people .hq").length,
      req: document.querySelectorAll("#h-people blockquote.say").length,
      script: !!document.querySelector("#h-script"),
      play: !!document.querySelector("#h-play"),
    }));
    ok(
      "T7 headhunter sheet: contacts, messages, call script, playbook",
      hh.prep && hh.people === 2 && hh.req >= 2 && hh.script && hh.play,
      JSON.stringify(hh),
    );
    await esc2(p);
    await wait(p, 150);
    // T8 quick open
    await p.click("#nav-next");
    await p.keyboard.press("g");
    await wait(p, 200);
    ok("T8 g opens quick open", await p.evaluate(() => !!document.querySelector(".hqo")));
    await p.keyboard.type("harborlight");
    await wait(p, 150);
    await p.keyboard.press("Enter");
    await wait(p, 500);
    ok(
      "T8 Enter opens the job",
      await p.evaluate(() => /Harborlight/.test((document.querySelector("#dTitle") || {}).innerText || "")),
    );
    await esc2(p);
    await wait(p, 150);
    await p.keyboard.press("Control+k");
    await wait(p, 150);
    ok("T8 Ctrl+K works while drawer closed", await p.evaluate(() => !!document.querySelector(".hqo")));
    await esc2(p);
    // T9 the Library
    await p.click("#nav-library");
    await wait(p, 500);
    const lnav = await p.$$eval(".hlnav a", (as) => as.map((a) => a.innerText));
    ok("T9 library lists the 3 sample guides", lnav.length === 3, lnav.length + ": " + lnav.join(" | "));
    const groups = await p.$$eval(".hlnav .hlg", (g) => g.map((x) => x.textContent));
    ok(
      "T9 guides are grouped by folder, in folder order",
      groups.join("|") === "Interviews|Headhunters",
      groups.join("|"),
    );
    for (const id of ["cheat-sheet", "call-scripts", "recruiter-outreach"]) {
      await p.click(`.hlnav a[data-doc="${id}"]`);
      await wait(p, 250);
      const n = await p.$$eval(".hlread .hs", (s) => s.length);
      ok("T9 guide renders: " + id, n >= 2, String(n) + " cards");
    }
    await p.click('.hlnav a[data-doc="call-scripts"]');
    await wait(p, 250);
    const qn = await p.$$eval(".hlread .hq", (s) => s.length);
    ok("T9 split: bold turns bold lines into questions", qn >= 10, String(qn));
    ok(
      "T9 pay blocks in the guides are not blurred by default",
      await p.$$eval(
        ".hlread .pay > *:not(h4)",
        (s) => s.length > 0 && s.every((e) => !getComputedStyle(e).filter.includes("blur")),
      ),
    );
    await p.click('.hlnav a[data-doc="cheat-sheet"]');
    await wait(p, 250);
    const marks = await p.evaluate(() => ({
      ex: document.querySelectorAll(".hlread em.ex").length,
      pen: document.querySelectorAll(".hlread .ex-mark").length,
      box: document.querySelectorAll(".hlread .todo-mark").length,
      fold: document.querySelectorAll(".hlread details.fold").length,
    }));
    ok(
      "T9 markup renders: examples, ✎, ☐ and folds",
      marks.ex >= 3 && marks.pen >= 2 && marks.box >= 2 && marks.fold >= 1,
      JSON.stringify(marks),
    );
    await p.locator(".hlread details.mine summary").first().click();
    await wait(p, 100);
    await p.locator(".hlread details.mine textarea").first().fill("My own weakness answer.");
    await wait(p, 1500);
    const my = await p.evaluate(() => window.__get("Library/My_answers.md"));
    ok(
      "T9 My version saved to Library/My_answers.md",
      my && my.includes("My own weakness answer."),
      String(my).slice(0, 80),
    );
    await p.fill(".hlsearch", "weakness");
    await wait(p, 300);
    ok("T9 library search finds it", (await p.$$eval("a.hit", (a) => a.length)) >= 2);
    // T10 a prep sheet changed on disk while it is open
    await p.fill(".hlsearch", "");
    await p.evaluate((j) => openDrawer("jobs", j), JOB2);
    await wait(p, 600);
    const orig = await p.evaluate((j) => window.__get(`Job notes/${j}/prep.md`), JOB2);
    await p.evaluate(
      ([j, o]) =>
        window.__put(`Job notes/${j}/prep.md`, o.replace("## Your opener", "## Your opener (edited by a tool)")),
      [JOB2, orig],
    );
    await wait(p, 11500);
    ok(
      "T10 a change while the sheet is open shows the reload pill (not a silent swap)",
      await p.evaluate(
        () =>
          !document.querySelector("#drawerRoot .prepbar").hidden &&
          !/edited by a tool/i.test(document.querySelector("#drawerRoot .pleft").innerText),
      ),
    );
    await p.evaluate(
      ([j, o]) => window.__put(`Job notes/${j}/prep.md`, o.replace("## Your opener", "## Your opener (second edit)")),
      [JOB2, orig],
    );
    await wait(p, 11500);
    ok(
      "T10 later change shows the reload pill",
      await p.evaluate(() => !document.querySelector("#drawerRoot .prepbar").hidden),
    );
    await p.click("#drawerRoot .prepbar button");
    await wait(p, 300);
    ok(
      "T10 Reload applies it",
      await p.evaluate(() => /second edit/i.test(document.querySelector("#drawerRoot .pleft").innerText)),
    );
    await esc2(p);
    // T11 backups
    const r = await p.evaluate(async () => await Prep.snapshotNotes(true));
    const bks = await p.evaluate(() => window.__ls("backups"));
    ok(
      "T11 daily notes backup created",
      r.ok && bks.some((n) => /^notes_\d{4}-\d{2}-\d{2}$/.test(n)),
      JSON.stringify(r) + bks.join(","),
    );
    ok(
      "T11 daily copy of the data file in backups/",
      bks.some((n) => /^board_data_\d{4}-\d{2}-\d{2}\.js$/.test(n)),
      bks.join(","),
    );
    const bfiles = await p.evaluate(() => {
      const names = window
        .__ls("backups")
        .filter((n) => /^notes_/.test(n))
        .sort();
      return window.__ls("backups/" + names[names.length - 1]);
    });
    ok(
      "T11 backup includes my notes and My_answers",
      bfiles.some((n) => /lumenfield__my_notes\.md/.test(n)) && bfiles.includes("My_answers.md"),
      bfiles.join(","),
    );
    await p.evaluate(() => {
      window.__idb = {};
      window.idbSet = async (k, v) => {
        window.__idb[k] = v;
      };
      window.idbGet = async (k) => window.__idb[k] || null;
    });
    await p.click("#secondBackupBtn");
    await wait(p, 1500);
    const sb = await p.evaluate(() => (window.__pick2.kids.size ? [...window.__pick2.kids.keys()] : []));
    ok(
      "T11 second-folder backup copies the board folder",
      sb.some((n) => /^board_backup_/.test(n)),
      sb.join(","),
    );
    const cnt = await p.evaluate(() => {
      const d = window.__pick2.kids.values().next().value;
      const c = (x) => (x.kind === "file" ? 1 : [...x.kids.values()].reduce((a, k) => a + c(k), 0));
      return [c(d), window.__count("") - window.__count("backups")];
    });
    ok("T11 second copy has every file (backups/ left out)", cnt[0] === cnt[1] && cnt[0] > 20, cnt.join(" vs "));
    ok(
      "T11 footer says so",
      /Second copy/.test(await p.$eval("#backupStatus", (e) => e.innerText)),
      await p.$eval("#backupStatus", (e) => e.innerText),
    );
    // T12 data integrity: counts and unrelated records unchanged
    await wait(p, 800);
    const d2 = parseBoard(await p.evaluate(() => window.__get("board_data.js")));
    ok(
      "T12 all jobs, hunters, people still there",
      Object.keys(d2.jobs).length === Object.keys(data.jobs).length &&
        Object.keys(d2.hunters).length === Object.keys(data.hunters).length &&
        Object.keys(d2.people).length === Object.keys(data.people).length,
    );
    const changed = Object.keys(d2.jobs).filter((k) => JSON.stringify(d2.jobs[k]) !== JSON.stringify(data.jobs[k]));
    ok(
      "T12 only the booked job changed (headhunters untouched)",
      changed.length === 1 && changed[0] === JOB && JSON.stringify(d2.hunters) === JSON.stringify(data.hunters),
      changed.join(","),
    );
    ok(
      "T12 stage folders unaffected (filing ran without errors)",
      !(await p.evaluate(() => document.querySelector("#toastRoot").innerText.includes("Couldn't file"))),
    );
    // T13 half a screen
    await p.setViewportSize({ width: 720, height: 800 });
    await p.evaluate((j) => openDrawer("jobs", j), JOB2);
    await wait(p, 500);
    const geo = await p.evaluate(() => {
      const n = document.querySelector("#drawerRoot .pright").getBoundingClientRect();
      const w = window.innerWidth,
        h = window.innerHeight;
      return { top: n.top, bottom: n.bottom, h, scrollX: document.documentElement.scrollWidth > w };
    });
    ok(
      "T13 at 720px the notes pad is on screen (docked)",
      geo.top < geo.h && geo.bottom <= geo.h + 1 && !geo.scrollX,
      JSON.stringify(geo),
    );
    await p.setViewportSize({ width: 1440, height: 900 });
    await wait(p, 200);
    ok("No page errors", p.errs.length === 0, p.errs.slice(0, 5).join(" || "));
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n")[0]);
  }
  report();
  if (b) await b.close();
})();
