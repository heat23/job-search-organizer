// Edge cases: typing right away, jump keys, copying, cues-only, call booking order, quick open ranking,
// new prep sheets, backups, permission lapses and write failures.
const { ok, wait, launch, mkpage, report } = require("./lib.js");
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
    // N1: type immediately after opening: it lands in the pad
    let p = await mkpage(ctx, { connect: true });
    await p.click("#nav-jobs");
    await p.evaluate((j) => openDrawer("jobs", j), JOB);
    await p.keyboard.type("Sam, 2 openings, 4 rounds");
    await wait(p, 1800);
    const disk = await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB);
    ok(
      "N1 typing right after opening lands in the notes (no hotkeys fired)",
      disk &&
        disk.includes("Sam, 2 openings, 4 rounds") &&
        !(await p.evaluate(() => document.body.classList.contains("showpay"))),
      String(disk).slice(0, 40),
    );
    // N2: a jump key puts the section heading at the top of the pane
    await p.keyboard.press("Escape");
    await p.keyboard.press("4");
    await wait(p, 1000);
    const off = await p.evaluate(() => {
      const w = document.querySelector("#drawerRoot .pleftwrap");
      const id = document.querySelector('#drawerRoot .pills a[data-k="4"]').getAttribute("href").slice(1);
      const t = document.getElementById(id);
      return Math.round(t.getBoundingClientRect().top - w.getBoundingClientRect().top);
    });
    ok("N2 jump key lands the section at the top of the pane", off >= 0 && off <= 30, String(off));
    // N11: keyboard scrolling after Esc
    const y0 = await p.evaluate(() => document.querySelector("#drawerRoot .pleftwrap").scrollTop);
    await p.keyboard.press("PageDown");
    await wait(p, 400);
    ok(
      "N11 PageDown scrolls the talking points",
      await p.evaluate((y) => document.querySelector("#drawerRoot .pleftwrap").scrollTop > y, y0),
    );
    // N3: section copy keeps line breaks and numbering
    await p.evaluate(() => document.querySelector("#drawerRoot .pleftwrap").scrollTo(0, 0));
    await p.locator("#drawerRoot .hs:not(.asks) .hs-h .hcopy").first().click();
    await wait(p, 200);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok(
      "N3 section copy has real line breaks and numbering",
      clip.split("\n").length >= 5 && /^1\. /m.test(clip),
      clip.slice(0, 120).replace(/\n/g, "\\n"),
    );
    ok("N3 focus returns to the pad after Copy", await p.evaluate(() => document.activeElement.id === "notes-pad"));
    // N10: cues only
    await p.click("#drawerRoot .pcues");
    await wait(p, 150);
    ok(
      "N10 Hide answers hides the full answers",
      await p.evaluate(
        () => getComputedStyle(document.querySelector("#drawerRoot .hq blockquote.say")).display === "none",
      ),
    );
    await p.click("#drawerRoot .pleft .hq h4 >> nth=0");
    await wait(p, 150);
    ok(
      "N10 clicking a question shows its answer",
      await p.evaluate(() => {
        const q = document.querySelector("#drawerRoot .hq.open blockquote.say");
        return q && getComputedStyle(q).display !== "none";
      }),
    );
    await p.click("#drawerRoot .pcues");
    // N9 + N12: booking a call, date first, type second
    const dt = new Date(Date.now() + 4 * 864e5);
    dt.setHours(11, 0, 0, 0);
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    await p.evaluate((j) => openDrawer("jobs", j), JOB2);
    await wait(p, 400);
    await p.click("#drawerRoot .callbox > summary");
    await p.evaluate((v) => {
      const s = document.querySelector("#drawerRoot .callrow input[type=datetime-local]");
      s.value = v;
      s.dispatchEvent(new Event("change"));
    }, local);
    await wait(p, 600);
    let lane = await p.evaluate((j) => laneKey("jobs", get("jobs", j)), JOB2);
    ok("N9 date first moves the card to Recruiter screen", lane === "screen", lane);
    ok(
      "N9 the follow-up becomes the day after the call",
      await p.evaluate(
        ([j, v]) => {
          const d = new Date(v);
          d.setDate(d.getDate() + 1);
          return get("jobs", j).followUp === localDate(d);
        },
        [JOB2, local],
      ),
    );
    await p.evaluate(() => {
      const s = document.querySelector("#drawerRoot .callrow select");
      s.value = "Hiring manager";
      s.dispatchEvent(new Event("change"));
    });
    await wait(p, 600);
    lane = await p.evaluate((j) => laneKey("jobs", get("jobs", j)), JOB2);
    ok("N9 choosing Hiring manager afterwards moves it to Interviewing", lane === "interview", lane);
    ok(
      "N12 booking box stays open and keyboard focus is in the With field",
      await p.evaluate(
        () =>
          document.querySelector("#drawerRoot .callbox").open &&
          document.activeElement.placeholder === "With (name, profile)",
      ),
      await p.evaluate(() => document.activeElement.tagName + ":" + document.activeElement.placeholder),
    );
    await p.keyboard.type("Jordan P.");
    await p.evaluate(() => document.activeElement.dispatchEvent(new Event("change")));
    await wait(p, 400);
    ok(
      "N12 typing in With keeps focus (no re-render) and is saved",
      await p.evaluate(
        (j) =>
          get("jobs", j).callWith === "Jordan P." &&
          /Jordan P\./.test(document.querySelector("#drawerRoot .pstrip").innerText),
        JOB2,
      ),
    );
    // N14: quick open ranking and the dead end
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await wait(p, 150);
    await p.keyboard.press("Escape");
    await p.evaluate(() => {
      const c = document.activeElement;
      if (c && c.blur) c.blur();
    });
    await p.keyboard.press("Control+k");
    await p.keyboard.type("brightwell");
    await wait(p, 200);
    const first = await p.evaluate(() => document.querySelector(".hqi.on").innerText);
    ok(
      "N14 an Applied job outranks a To-apply job in quick open",
      /Applied/.test(first) && /Learning/.test(first),
      first.replace(/\n/g, " | "),
    );
    await p.keyboard.press("Control+a");
    await p.keyboard.type("zzzzq");
    await wait(p, 200);
    ok(
      "N14 unknown name shows a no-match note plus the sheet guides",
      (await p.$$eval(".hqi", (r) => r.length)) === 3 &&
        (await p.$eval(".hqi.note", (e) => /No job/.test(e.innerText))),
    );
    await p.keyboard.press("Enter");
    await wait(p, 500);
    ok(
      "N14 Enter opens the Prep library on that guide",
      await p.evaluate(
        () => section === "library" && /Call scripts/.test(document.querySelector(".hlnav a.on").innerText),
      ),
    );
    // N15: the pay question in the headhunter script
    await p.evaluate(() => openDrawer("hunters", "h_summitvale"));
    await wait(p, 500);
    ok(
      "N15 no literal {.pay} in the headhunter sheet",
      !/\{\.pay\}/.test(await p.evaluate(() => document.querySelector("#drawerRoot .pleft").innerText)),
    );
    ok(
      "N15 the pay question in the script is marked as pay",
      await p.evaluate(() => !!document.querySelector("#drawerRoot .hq.pay")),
    );
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    // N8: a prep sheet written later is found without rebuilding the bundle
    const prepTxt = await p.evaluate((j) => window.__get(`Job notes/${j}/prep.md`), JOB2);
    await p.evaluate(
      (t) => window.__put("Job notes/quillstone/prep.md", t.replace(/Harborlight Bank/g, "Quillstone")),
      prepTxt,
    );
    const ch = await p.evaluate(async () => await Prep.scanPrep());
    await p.evaluate(() => openDrawer("jobs", "quillstone"));
    await wait(p, 400);
    ok(
      "N8 a prep sheet added later is found without a rebuild",
      ch &&
        (await p.evaluate(() =>
          [...document.querySelectorAll("#drawerRoot button")].some((b) => /Open prep sheet/.test(b.innerText)),
        )),
      String(ch),
    );
    await p.keyboard.press("Escape");
    // N17: a guide added to the folder later shows in the Library
    await p.evaluate(() =>
      window.__put(
        "Library/1_Interviews/03_Salary_talk.md",
        "# Salary talk\n\n## Opening\n\n> Let's talk scope first.\n",
      ),
    );
    await p.click("#nav-next");
    await p.click("#nav-library");
    await wait(p, 800);
    ok(
      "N17 a guide added to the folder appears in the Library",
      await p.evaluate(() => [...document.querySelectorAll(".hlnav a")].some((a) => /Salary talk/.test(a.innerText))),
    );
    // N7: backups
    const r1 = await p.evaluate(async () => await Prep.snapshotNotes(false));
    const r2 = await p.evaluate(async () => await Prep.snapshotNotes(true));
    const nb = await p.evaluate(() => window.__ls("backups").filter((n) => /^notes_/.test(n)));
    ok(
      "N7 automatic backup keeps the earlier copy; manual adds another",
      r1.ok && r1.kept && r2.ok && nb.length >= 2,
      nb.join(","),
    );
    // N6: a second folder inside the board folder is refused
    await p.evaluate(() => {
      window.__idb = {};
      window.idbSet = async (k, v) => {
        window.__idb[k] = v;
      };
      window.idbGet = async (k) => window.__idb[k] || null;
      window.__pick2 = window.__pick.kids.get("Library");
    });
    await p.click("#secondBackupBtn");
    await wait(p, 800);
    ok(
      "N6 a second folder inside the board folder is refused",
      /inside your board folder/.test(await p.$eval("#backupStatus", (e) => e.innerText)),
      await p.$eval("#backupStatus", (e) => e.innerText),
    );
    ok(
      "N6 nothing was copied into Library",
      !(await p.evaluate(() => window.__ls("Library") || [])).some((n) => /board_backup/.test(n)),
    );
    // N16: library search ranks real answers first
    await p.fill(".hlsearch", "weakness");
    await wait(p, 300);
    const top = await p.evaluate(() => document.querySelector("a.hit").innerText);
    ok(
      "N16 weakness search: first hit has a real answer (not a stub)",
      /Cheat sheet|Call scripts/.test(top) && top.length > 60,
      top.replace(/\n/g, " | ").slice(0, 120),
    );
    ok("N16 nav highlight cleared while searching", (await p.$$eval(".hlnav a.on", (a) => a.length)) === 0);
    ok("No errors", p.errs.length === 0, p.errs.join("|"));
    await ctx.close();
    // N4: opened BEFORE permission with notes already on disk: nothing is overwritten
    const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
    p = await mkpage(ctx2, { extra: { [`Job notes/${JOB}/my_notes.md`]: "IMPORTANT DISK NOTES from Tuesday\n" } });
    await p.click("#nav-jobs");
    await p.evaluate((j) => openDrawer("jobs", j), JOB);
    await wait(p, 500);
    await p.keyboard.type("fresh note before permission");
    await wait(p, 500);
    await p
      .getByRole("button", { name: /Turn on saving/ })
      .last()
      .click();
    await wait(p, 3500);
    const lsd = await p.evaluate((j) => window.__ls(`Job notes/${j}`), JOB);
    const cur = await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB);
    let copyTxt = "";
    const cf = lsd.find((n) => /changed-on-disk/.test(n));
    if (cf) copyTxt = await p.evaluate(([j, n]) => window.__get(`Job notes/${j}/` + n), [JOB, cf]);
    ok("N4 my typing is saved once saving is on", /fresh note before permission/.test(cur), cur.slice(0, 60));
    ok(
      "N4 the notes already on disk are kept beside it, not overwritten",
      /IMPORTANT DISK NOTES/.test(copyTxt) || /IMPORTANT DISK NOTES/.test(cur),
      lsd.join(","),
    );
    // N5: writes fail, then recover: retried automatically
    await p.evaluate(() => {
      window.__failWrites = true;
    });
    await p.evaluate(() => {
      const t = document.querySelector("#notes-pad");
      t.value += "\nline while folder is down";
      t.dispatchEvent(new Event("input"));
    });
    await wait(p, 1500);
    ok(
      "N5 red warning while writes fail",
      await p.$eval(".padstat", (e) => /bad/.test(e.className)),
      await p.$eval(".padstat", (e) => e.innerText),
    );
    await p.evaluate(() => {
      window.__failWrites = false;
    });
    await wait(p, 11000);
    ok(
      "N5 saves by itself once the folder is back",
      /line while folder is down/.test(await p.evaluate((j) => window.__get(`Job notes/${j}/my_notes.md`), JOB)),
    );
    ok("No errors (2)", p.errs.length === 0, p.errs.join("|"));
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n").slice(0, 3).join(" / "));
  }
  report();
  if (b) await b.close();
})();
