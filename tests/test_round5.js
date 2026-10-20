// Content-based merge: an older copy written back never undoes your change, whatever its updatedAt says, and a new
// value from another tool is taken whatever its stamp (future, date-only, local time written as Z); the file's older copy
// goes to backups/ with a short note. Two tabs settle on the latest change (also an Undo). Restore a backup… (with Undo,
// kept after focus and reload). My_answers.md read as empty or cut short never deletes answers; Clear all my answers.
// Older answer keys move to a round only when that is certain. A write landing between the page's read and write is
// merged. Browser storage full: a typed answer shows a warning. Save time and storage size with 1,000 jobs.
//   ONLY=C1,C6 node tests/test_round5.js   runs only those blocks (SAMPLE_TREE must be set, see run.mjs)
const fs = require("fs");
const path = require("path");
const { ok, wait, launch, mkpage, report, boardText, parseBoard, files, TREE } = require("./lib.js");

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const focus = async (p, extra = 200) => {
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.evaluate(() => (typeof focusRun !== "undefined" && focusRun) || new Promise((r) => setTimeout(r, 1500)));
  await wait(p, extra);
};
const withData = (d) => boardText.slice(0, boardText.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n";
const disk = async (p) => parseBoard(await p.evaluate(() => window.__get("board_data.js")));
const answers = (p) => p.evaluate(() => window.__get("Library/My_answers.md").then((t) => t || ""));
/* the assistant edits one record on disk; `stamp` is its updatedAt (a string, or "now") */
const editOnDisk = (p, id, patch, stamp) =>
  p.evaluate(
    ([i, pt, st]) =>
      window.__get("board_data.js").then((t) => {
        const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
        d.jobs[i] = {
          ...d.jobs[i],
          ...pt,
          updatedAt: st === "now" ? new Date().toISOString() : st,
          changedBy: "assistant",
        };
        window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
      }),
    [id, patch, stamp],
  );
const Q = "### Who would I report to? {.ask}";
const PLAIN = "prep:lumenfield::Who would I report to?";
const boxes = (p) =>
  p.$$eval("#drawerRoot details.mine.ask", (d) =>
    d.map((x) => [x.closest("section").dataset.title, x.querySelector("textarea").value]),
  );
const earlier = (p) => p.$$eval("#p-earlier .hq.earlier", (d) => d.map((x) => x.dataset.ek));

(async () => {
  let b;
  try {
    b = await launch();
    // ---- C1: an assistant edit is kept whatever its updatedAt (future, date-only, local time as Z, older)
    if (want("C1")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 1500);
      await editOnDisk(p, "quillstone", { notes: "Future-stamped" }, "2099-01-01T00:00:00Z");
      await focus(p, 1200);
      const q1 = await p.evaluate(() => get("jobs", "quillstone"));
      ok(
        "C1 a future updatedAt is read as now (the edit is kept)",
        q1.notes === "Future-stamped" && Date.parse(q1.updatedAt) < Date.now() + 6 * 60e3,
        q1.updatedAt,
      );
      ok(
        "C1 and the file gets the corrected time",
        Date.parse((await disk(p)).jobs.quillstone.updatedAt) < Date.now() + 6 * 60e3,
      );
      await editOnDisk(p, "quillstone", { location: "Correct now stamp" }, "now");
      await focus(p, 1200);
      ok(
        "C1 a later edit stamped with the real time is kept after a future stamp",
        (await p.evaluate(() => get("jobs", "quillstone").location)) === "Correct now stamp" &&
          (await disk(p)).jobs.quillstone.location === "Correct now stamp",
      );
      await p.evaluate(() => upd("jobs", "quillstone", { notes: "Typed in the page" }));
      await wait(p, 1200);
      const day = new Date().toISOString().slice(0, 10);
      const cases = [
        ["a date-only updatedAt", { location: "Date-only stamp" }, day],
        [
          "local time written as Z, 4 hours behind",
          { pay: "Local as Z" },
          new Date(Date.now() - 4 * 3600e3).toISOString(),
        ],
        ["an updatedAt from 2020", { url: "https://example.com/older-stamp" }, "2020-01-01T00:00:00.000Z"],
      ];
      for (const [label, patch, stamp] of cases) {
        await editOnDisk(p, "quillstone", patch, stamp);
        await focus(p, 1200);
        const [k, v] = Object.entries(patch)[0];
        const st = await p.evaluate(() => get("jobs", "quillstone"));
        ok(
          `C1 an assistant edit with ${label} is kept (and your notes too)`,
          st[k] === v && (await disk(p)).jobs.quillstone[k] === v && st.notes === "Typed in the page",
          JSON.stringify([st[k], st.notes]),
        );
      }
      ok("C1 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- C2: an older copy written back, with the assistant's own change to the same card but the card's old updatedAt
    //      (with a newer updatedAt the card counts as edited on purpose, and the file's values are taken: see C11)
    if (want("C2")) {
      for (const variant of ["Restore", "Remove", "drag to Interview", "notes typed"]) {
        const ctx = await b.newContext();
        const p = await mkpage(ctx, { connect: true });
        await wait(p, 1500);
        if (variant === "Restore") {
          await p.evaluate(() => del("jobs", "harborlight"));
          await wait(p, 1200);
        }
        const t0 = await p.evaluate(() => window.__get("board_data.js")); // the assistant reads the file
        await p.evaluate((v) => {
          if (v === "Restore") upd("jobs", "harborlight", { deleted: false, removedAt: null });
          else if (v === "Remove") del("jobs", "harborlight");
          else if (v === "notes typed") upd("jobs", "harborlight", { notes: "PERSON TYPED THIS" });
          else moveCard("jobs", "harborlight", "interview");
        }, variant);
        await wait(p, 1200);
        await p.evaluate((t) => {
          const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
          d.jobs.harborlight = { ...d.jobs.harborlight, location: "Remote (assistant)", changedBy: "assistant" };
          window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
        }, t0);
        await focus(p, 1500);
        const st = await p.evaluate(() => store.jobs.harborlight);
        const dk = (await disk(p)).jobs.harborlight;
        const kept = (r) =>
          variant === "Restore"
            ? !r.deleted
            : variant === "Remove"
              ? r.deleted === true
              : variant === "notes typed"
                ? r.notes === "PERSON TYPED THIS"
                : r.lane === "interview";
        ok(
          `C2 your saved ${variant} is kept, and the assistant's new location in the same card is taken (page and file)`,
          kept(st) && kept(dk) && st.location === "Remote (assistant)" && dk.location === "Remote (assistant)",
          JSON.stringify([st.deleted, st.lane, st.notes, st.location]),
        );
        if (variant === "Remove") {
          const status = await p.$eval("#status", (n) => n.textContent);
          ok(
            "C2 the status line says your newer change was kept",
            /Kept your newer changes to 1 card; the file's older copy is in backups\//.test(status),
            status,
          );
          const older = await p.evaluate(() =>
            window.__get(`backups/board_data_older_${TODAY()}.js`).then((t) => t || ""),
          );
          ok("C2 the file as the assistant wrote it is kept in backups/", older.includes("Remote (assistant)"));
        }
        ok(`C2 ${variant} no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
    // ---- C3: you and the assistant changed the same field: the later change wins
    if (want("C3")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 1500);
      await p.evaluate(() => {
        upd("jobs", "fernhill", { notes: "Mine, typed now" });
        clearTimeout(saveTimer);
      });
      await editOnDisk(p, "fernhill", { notes: "Theirs, an hour ago" }, new Date(Date.now() - 3600e3).toISOString());
      await focus(p, 1200);
      ok(
        "C3 your later change wins over an older edit to the same field",
        (await p.evaluate(() => get("jobs", "fernhill").notes)) === "Mine, typed now",
      );
      await p.evaluate(() => {
        upd("jobs", "orchardline", { notes: "Mine, typed first" });
        clearTimeout(saveTimer);
      });
      await editOnDisk(
        p,
        "orchardline",
        { notes: "Theirs, a minute later" },
        new Date(Date.now() + 60e3).toISOString(),
      );
      await focus(p, 1200);
      ok(
        "C3 the assistant's later edit to the same field wins over yours",
        (await p.evaluate(() => get("jobs", "orchardline").notes)) === "Theirs, a minute later",
      );
      ok("C3 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- C4: two tabs settle on the latest change, also when it puts a value back (Undo)
    if (want("C4")) {
      const ctx = await b.newContext();
      const A = await mkpage(ctx, {});
      const B = await mkpage(ctx, {});
      await wait(A, 300);
      await A.evaluate(() => moveCard("jobs", "harborlight", "interview"));
      await wait(B, 400);
      ok("C4 a move in tab A reaches tab B", (await B.evaluate(() => get("jobs", "harborlight").lane)) === "interview");
      await A.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(B, 400);
      const lanes = [
        await A.evaluate(() => get("jobs", "harborlight").lane),
        await B.evaluate(() => get("jobs", "harborlight").lane),
      ];
      ok("C4 and so does its Undo (both tabs are back on Applied)", lanes.join() === "applied,applied", lanes.join());
      await A.evaluate(() => upd("jobs", "quillstone", { notes: "A's notes" }));
      await B.evaluate(() => upd("jobs", "quillstone", { location: "B's location" }));
      await wait(A, 500);
      const q = await Promise.all(
        [A, B].map((p) =>
          p.evaluate(() => [get("jobs", "quillstone").notes, get("jobs", "quillstone").location].join("|")),
        ),
      );
      ok(
        "C4 edits to different fields of one card in two tabs are both kept",
        q[0] === q[1] && q[0] === "A's notes|B's location",
        q.join(" / "),
      );
      ok("C4 no errors", !A.errs.length && !B.errs.length, A.errs.concat(B.errs).join("|"));
      await ctx.close();
    }
    // ---- C5: browser storage too full for the merge history: a one-time note, saving goes on
    if (want("C5")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, {
        connect: true,
        init: `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) {
          if (window.__full && String(v).includes('"_hist"')) throw new DOMException("full", "QuotaExceededError");
          return set.call(this, k, v); }; })();`,
      });
      await wait(p, 1500);
      await p.evaluate(() => (window.__full = 1));
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "Storage is full" }));
      await wait(p, 1200);
      const status = await p.$eval("#status", (n) => n.textContent);
      ok("C5 the status line says the merge history couldn't be kept", /Browser storage is full/.test(status), status);
      ok(
        "C5 and the change is saved in the file",
        (await disk(p)).jobs.harborlight.notes === "Storage is full" && (await p.evaluate(() => localOk)) === true,
      );
      ok("C5 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- C6: Restore a backup… (lists backups with dates and counts, asks, saves the current file first, Undo)
    if (want("C6")) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
      const BK = "backups/board_data_2026-01-15.js";
      const p = await mkpage(ctx, { connect: true, extra: { [BK]: boardText } });
      await wait(p, 1500);
      /* a bad, properly stamped bulk edit by a tool */
      await editOnDisk(p, "quillstone", { location: "BROKEN" }, "now");
      await editOnDisk(p, "harborlight", { location: "BROKEN" }, "now");
      await focus(p, 1200);
      ok("C6 (the bad edit is taken)", (await p.evaluate(() => get("jobs", "quillstone").location)) === "BROKEN");
      await p.click("#restoreBtn");
      await wait(p, 800);
      const rows = await p.$$eval(".drawer.restore .rrow", (r) => r.map((x) => x.textContent));
      const mine = rows.find((r) => r.includes("board_data_2026-01-15.js")) || "";
      const jobsLive = Object.values(parseBoard(boardText).jobs).filter((j) => !j.deleted).length;
      ok(
        "C6 the dialog lists the backups with a date and card counts",
        /\d{4}/.test(mine) && mine.includes(`${jobsLive} jobs`) && /to-do/.test(mine),
        rows.join(" / "),
      );
      const row = p.locator(".drawer.restore .rrow", { hasText: "board_data_2026-01-15.js" });
      await row.getByRole("button", { name: "Restore…" }).click();
      ok("C6 it asks first", await row.getByText("Replace your board with this copy?").isVisible());
      await row.getByRole("button", { name: "Restore", exact: true }).click();
      await wait(p, 1500);
      const orig = parseBoard(boardText).jobs;
      const st = await p.evaluate(() => [get("jobs", "quillstone").location, get("jobs", "harborlight").location]);
      const dk = (await disk(p)).jobs;
      ok(
        "C6 the backup's records replace the board (page and file)",
        st[0] === orig.quillstone.location &&
          st[1] === orig.harborlight.location &&
          dk.quillstone.location === orig.quillstone.location,
        JSON.stringify(st),
      );
      const before = await p.evaluate(() => (window.__ls("backups") || []).filter((n) => /before_restore/.test(n)));
      const beforeText = before.length ? await p.evaluate((n) => window.__get("backups/" + n), before[0]) : "";
      ok(
        "C6 the file as it was is saved to backups/ first",
        before.length === 1 && beforeText.includes("BROKEN"),
        before.join(),
      );
      ok(
        "C6 a toast says what was restored, with Undo",
        /Restored the copy from/.test(await p.$eval("#toastRoot", (n) => n.textContent)) &&
          (await p.locator("#toastRoot button", { hasText: "Undo" }).count()) === 1,
      );
      await focus(p, 1200);
      ok(
        "C6 the restore holds after the page reads the file again",
        (await p.evaluate(() => get("jobs", "quillstone").location)) === orig.quillstone.location &&
          (await disk(p)).jobs.quillstone.location === orig.quillstone.location,
      );
      /* the assistant writes back the broken copy it read before: an older copy, so the restore stays */
      await p.evaluate((t) => window.__put("board_data.js", t), beforeText);
      await focus(p, 1500);
      ok(
        "C6 an older broken copy written back doesn't undo the restore",
        (await p.evaluate(() => get("jobs", "quillstone").location)) === orig.quillstone.location &&
          (await disk(p)).jobs.quillstone.location === orig.quillstone.location,
      );
      const synced = await p.evaluate(() => window.__get("board_data.js"));
      ok("C6 no errors", !p.errs.length, p.errs.join("|"));
      await p.close();
      fs.writeFileSync(path.join(TREE, "board_data.js"), synced);
      try {
        const p2 = await mkpage(ctx, { text: synced, init: "window.ORGANIZER_FOLDER = window.__pick;" });
        await wait(p2, 2000);
        ok(
          "C6 the restore holds after a reload",
          (await p2.evaluate(() => get("jobs", "quillstone").location)) === orig.quillstone.location &&
            (await disk(p2)).jobs.quillstone.location === orig.quillstone.location,
        );
        ok("C6 reload no errors", !p2.errs.length, p2.errs.join("|"));
      } finally {
        fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
      }
      await ctx.close();
      /* Undo, and a file chosen from anywhere */
      const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
      const q = await mkpage(ctx2, { connect: true });
      await wait(q, 1500);
      await editOnDisk(q, "quillstone", { location: "BROKEN" }, "now");
      await focus(q, 1200);
      await q.click("#restoreBtn");
      await wait(q, 600);
      const d = parseBoard(boardText);
      d.jobs.quillstone = { ...d.jobs.quillstone, location: "From a downloaded copy" };
      await q.setInputFiles(".drawer.restore input.rpick", {
        name: "board_data_backup_2026-01-10.js",
        mimeType: "text/javascript",
        buffer: Buffer.from(withData(d)),
      });
      await wait(q, 400);
      const prow = q.locator(".drawer.restore .rrow", { hasText: "board_data_backup_2026-01-10.js" });
      await prow.getByRole("button", { name: "Restore…" }).click();
      await prow.getByRole("button", { name: "Restore", exact: true }).click();
      await wait(q, 1500);
      ok(
        "C6 a chosen file can be restored",
        (await q.evaluate(() => get("jobs", "quillstone").location)) === "From a downloaded copy" &&
          (await disk(q)).jobs.quillstone.location === "From a downloaded copy",
      );
      await q.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(q, 1500);
      ok(
        "C6 Undo puts the board back as it was before the restore (page and file)",
        (await q.evaluate(() => get("jobs", "quillstone").location)) === "BROKEN" &&
          (await disk(q)).jobs.quillstone.location === "BROKEN",
      );
      await focus(q, 1200);
      ok("C6 and Undo holds after a read", (await q.evaluate(() => get("jobs", "quillstone").location)) === "BROKEN");
      ok("C6 Undo no errors", !q.errs.length, q.errs.join("|"));
      await ctx2.close();
    }
    // ---- C7: My_answers.md read as empty, without its title or with every answer gone never deletes answers
    if (want("C7")) {
      const K1 = "cheat-sheet::Tell me about yourself",
        K2 = "cheat-sheet::Why are you leaving?",
        K3 = "prep:lumenfield::Old question";
      const MD = `# My answers\nx\n\n## ${K1}\nPitch line one.\n\n## ${K2}\nGrowth.\n\n## ${K3}\nTeam of 6\n`;
      for (const [label, bad] of [
        ["empty", ""],
        ["without its title (cut short)", `## ${K1}\nPitch line one.\n`],
        ["with every answer gone at once", "# My answers\nx\n"],
      ]) {
        const ctx = await b.newContext();
        const p = await mkpage(ctx, { connect: true, extra: { "Library/My_answers.md": MD } });
        await wait(p, 2500);
        await p.evaluate(() => myLoad());
        await wait(p, 400);
        await p.evaluate((t) => window.__put("Library/My_answers.md", t), bad);
        await p.evaluate(() => myLoad());
        await wait(p, 1500);
        const keys = await p.evaluate(() => Object.keys(MY).filter((k) => MY[k]));
        ok(`C7 a file read ${label} deletes nothing in this browser`, keys.length === 3, JSON.stringify(keys));
        await p.evaluate(() => mySet("prep:lumenfield::New Q", "new answer"));
        await wait(p, 2000);
        const t = await answers(p);
        ok(
          `C7 (${label}) the file is written again with every answer`,
          /^# My answers/.test(t) && [/Pitch line one/, /Growth\./, /Team of 6/, /new answer/].every((r) => r.test(t)),
          t.slice(-200),
        );
        if (bad) {
          const odd = (await p.evaluate(() => window.__ls("backups") || [])).filter((n) => /^My_answers_odd_/.test(n));
          ok(`C7 (${label}) the odd file is copied to backups/ first`, odd.length === 1, odd.join());
        }
        ok(`C7 ${label} no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      /* deleting one answer by hand still sticks; Clear all my answers (asks, then Undo) */
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
      const p = await mkpage(ctx, { connect: true, extra: { "Library/My_answers.md": MD } });
      await wait(p, 2500);
      await p.evaluate(() => myLoad());
      await p.evaluate(
        ([k]) =>
          window
            .__get("Library/My_answers.md")
            .then((t) => window.__put("Library/My_answers.md", t.replace(`## ${k}\nGrowth.\n`, ""))),
        [K2],
      );
      await p.evaluate(() => myLoad());
      await p.evaluate(() => mySet("prep:lumenfield::New Q", "x"));
      await wait(p, 2000);
      const t1 = await answers(p);
      ok("C7 one answer deleted by hand stays deleted", !/Growth/.test(t1) && /Pitch line one/.test(t1));
      await p.evaluate(() => goSection("library"));
      await wait(p, 600);
      await p.click(".hlclear button");
      ok(
        "C7 Clear all my answers asks first",
        /Remove all 3 of your answers/.test(await p.$eval(".hlclear", (n) => n.textContent)),
      );
      await p.click(".hlclear .hl-yes");
      await wait(p, 2000);
      const t2 = await answers(p);
      ok("C7 Clear all empties the file", /^# My answers/.test(t2) && !/^## /m.test(t2), t2);
      await p.evaluate(() => myLoad());
      await wait(p, 600);
      ok("C7 and the empty file is not written back", !/^## /m.test(await answers(p)));
      await p.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(p, 2000);
      const t3 = await answers(p);
      ok(
        "C7 Undo brings every answer back",
        [/Pitch line one/, /Team of 6/, /\nx\n/].every((r) => r.test(t3)),
        t3.slice(-200),
      );
      ok("C7 clear no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- C8: older answer keys move to a round only when that is certain
    if (want("C8")) {
      const run = async (prep, md, then) => {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, {
          connect: true,
          extra: { "Job notes/lumenfield/prep.md": prep, "Library/My_answers.md": md },
        });
        await wait(p, 3200);
        if (then) {
          await p.evaluate((t) => window.__put("Job notes/lumenfield/prep.md", t), then);
          await focus(p, 600);
        }
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 1500);
        const r = { boxes: await boxes(p), earlier: await earlier(p), md: await answers(p), errs: p.errs };
        await ctx.close();
        return r;
      };
      const MD1 = `# My answers\nx\n\n## ${PLAIN}\nRecruiter: Dana, Eng Director\n`;
      let r = await run(
        `# L\n\n## Recruiter screen\n\n${Q}\n`,
        MD1,
        `# L\n\n## Hiring manager round\n\n${Q}\n\n## Recruiter screen\n\n${Q}\n`,
      );
      ok(
        "C8 a new round added above: the older answer stays with the round it was typed in",
        JSON.stringify(r.boxes) ===
          JSON.stringify([
            ["Hiring manager round", ""],
            ["Recruiter screen", "Recruiter: Dana, Eng Director"],
          ]) && r.md.includes(`## ${PLAIN} @Recruiter screen\n`),
        JSON.stringify(r.boxes),
      );
      r = await run(`# L\n\n## Recruiter screen\n\n${Q}\n`, MD1, `# L\n\n## Hiring manager round (Oct 24)\n\n${Q}\n`);
      ok(
        "C8 a round replaced by the next one: its box starts empty and the old answer is under earlier versions",
        JSON.stringify(r.boxes) === JSON.stringify([["Hiring manager round (Oct 24)", ""]]) &&
          r.earlier.length === 1 &&
          r.earlier[0] === `${PLAIN} @Recruiter screen`,
        JSON.stringify(r),
      );
      const Q90 = "### What does success look like in 90 days? {.ask}",
        P90 = "prep:lumenfield::What does success look like in 90 days?";
      const MD2 = `# My answers\nx\n\n## ${P90}\nHM: ship the ledger migration\n\n## ${P90} #2\nPanel: reduce pages\n`;
      r = await run(
        `# L\n\n## Hiring manager round\n\n${Q90}\n\n## Panel round\n\n${Q90}\n`,
        MD2,
        `# L\n\n## Panel round\n\n${Q90}\n`,
      );
      ok(
        "C8 old numbered answers to a repeated question are not guessed into a round",
        JSON.stringify(r.boxes) === JSON.stringify([["Panel round", ""]]) && r.earlier.length === 2,
        JSON.stringify(r.boxes) + JSON.stringify(r.earlier),
      );
      r = await run(`# L\n\n## Recruiter screen\n\n${Q}\n`, MD1, null);
      ok(
        "C8 a question on the sheet once takes its older answer (saved under its round)",
        JSON.stringify(r.boxes) === JSON.stringify([["Recruiter screen", "Recruiter: Dana, Eng Director"]]) &&
          r.md.includes(`## ${PLAIN} @Recruiter screen\n`) &&
          !r.md.includes(`## ${PLAIN}\n`),
        JSON.stringify(r.boxes),
      );
      ok("C8 no errors", !r.errs.length, r.errs.join("|"));
    }
    // ---- C9: a write that lands between the page's read and write is merged; storage full warns about answers
    if (want("C9")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 1500);
      await p.evaluate(() => {
        const MF = window.MemFS.MemFile.prototype,
          orig = MF.createWritable;
        MF.createWritable = async function () {
          if (this.name === "board_data.js" && window.__slow) await new Promise((r) => setTimeout(r, 300));
          return orig.call(this);
        };
        window.__slow = true;
      });
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "person edit" }));
      await wait(p, 520);
      await editOnDisk(p, "quillstone", { location: "Remote (assistant, mid-save)" }, "now");
      await wait(p, 1500);
      const dk = (await disk(p)).jobs;
      ok(
        "C9 an assistant write between the page's read and write is merged, not overwritten",
        dk.quillstone.location === "Remote (assistant, mid-save)" && dk.harborlight.notes === "person edit",
        JSON.stringify([dk.quillstone.location, dk.harborlight.notes]),
      );
      ok("C9 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      const ctx2 = await b.newContext();
      const q = await mkpage(ctx2, {});
      await wait(q, 800);
      await q.evaluate(() => {
        const o = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (/myAnswers/.test(k)) throw new DOMException("full", "QuotaExceededError");
          return o.call(this, k, v);
        };
      });
      await q.evaluate(() => mySet("prep:lumenfield::Who would I report to?", "Dana, 6 people"));
      await wait(q, 1200);
      const status = await q.$eval("#status", (n) => n.textContent);
      ok(
        "C9 browser storage full: a typed answer shows a warning",
        /couldn't save your last change/.test(status),
        status,
      );
      ok("C9 storage no errors", !q.errs.length, q.errs.join("|"));
      await ctx2.close();
    }
    // ---- C10: a copy kept by the previous version (with "bases") still merges field by field after the update
    if (want("C10")) {
      const ctx = await b.newContext();
      const orig = parseBoard(boardText).jobs.quillstone;
      const p1 = await mkpage(ctx, {});
      await p1.evaluate((o) => {
        const st = JSON.parse(localStorage.getItem(lsKey("board")));
        st.jobs.quillstone = { ...o, notes: "Typed before the update", updatedAt: new Date().toISOString() };
        const bases = {};
        for (const c of COLLS) for (const id of Object.keys(st[c])) bases[c + ":" + id] = 1;
        bases["jobs:quillstone"] = o;
        delete st._hist;
        delete st._ft;
        st._bases = bases;
        localStorage.setItem(lsKey("board"), JSON.stringify(st));
      }, orig);
      await p1.close();
      const d = parseBoard(boardText);
      d.jobs.quillstone = {
        ...orig,
        location: "Assistant, older stamp",
        updatedAt: new Date(Date.now() - 60e3).toISOString(),
        changedBy: "assistant",
      };
      const text = withData(d);
      fs.writeFileSync(path.join(TREE, "board_data.js"), text);
      try {
        const p2 = await mkpage(ctx, { text });
        const q = await p2.evaluate(() => get("jobs", "quillstone"));
        ok(
          "C10 after the update, your unsaved edit and the assistant's edit to another field are both kept",
          q.notes === "Typed before the update" && q.location === "Assistant, older stamp",
          JSON.stringify([q.notes, q.location]),
        );
        ok("C10 no errors", !p2.errs.length, p2.errs.join("|"));
      } finally {
        fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
      }
      await ctx.close();
    }
    // ---- C11: an assistant that stamps its edits can put a field back to a value it had before
    if (want("C11")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 1500);
      const t0 = await p.evaluate(() => window.__get("board_data.js")); // an older copy, read before every step below
      const step = async (id, patch) => {
        await wait(p, 5);
        await editOnDisk(p, id, patch, "now");
        await focus(p, 900);
        const [st, dk] = [await p.evaluate((i) => store.jobs[i], id), (await disk(p)).jobs[id]];
        return Object.entries(patch).every(
          ([k, v]) =>
            JSON.stringify(st[k] ?? null) === JSON.stringify(v ?? null) &&
            JSON.stringify(dk[k] ?? null) === JSON.stringify(v ?? null),
        );
      };
      const runs = async (label, id, patches) => {
        const r = [];
        for (const pt of patches) r.push(await step(id, pt));
        ok(`C11 ${label}: every step is applied (page and file)`, r.every(Boolean), JSON.stringify(r));
      };
      const f0 = (await p.evaluate(() => get("jobs", "harborlight").followUp)) || "2030-01-05";
      await runs("lane Applied → Screen → Applied", "harborlight", [{ lane: "screen" }, { lane: "applied" }]);
      await runs("pinned true → false → true", "fernhill", [{ pinned: true }, { pinned: false }, { pinned: true }]);
      await runs("followUp cleared, then set back to its earlier date", "harborlight", [
        { followUp: null },
        { followUp: f0 },
        { followUp: null },
        { followUp: f0 },
      ]);
      const R = new Date(Date.now() - 3600e3).toISOString();
      await runs("removed → restored → removed (same removedAt)", "orchardline", [
        { deleted: true, removedAt: R },
        { deleted: false, removedAt: null },
        { deleted: true, removedAt: R },
      ]);
      await runs("closedReason toggled back", "marigold", [
        { closedReason: "No reply" },
        { closedReason: "Rejected" },
        { closedReason: "No reply" },
      ]);
      /* the older copy read before all that, written back with its old stamps, still loses */
      await p.evaluate((t) => window.__put("board_data.js", t), t0);
      await focus(p, 1500);
      const st = await p.evaluate(() => ({
        lane: store.jobs.harborlight.lane,
        f: store.jobs.harborlight.followUp,
        pin: store.jobs.fernhill.pinned,
        del: store.jobs.orchardline.deleted,
        why: store.jobs.marigold.closedReason,
      }));
      const dk = (await disk(p)).jobs;
      ok(
        "C11 an older copy written back after those changes still loses (page and file)",
        st.lane === "applied" &&
          st.f === f0 &&
          st.pin === true &&
          st.del === true &&
          st.why === "No reply" &&
          dk.fernhill.pinned === true &&
          dk.orchardline.deleted === true &&
          dk.marigold.closedReason === "No reply",
        JSON.stringify(st),
      );
      /* a person's change, then the older copy written back by a tool that didn't stamp it: yours stays */
      await p.evaluate(() => upd("jobs", "fernhill", { pinned: false }));
      await wait(p, 1200);
      await p.evaluate(
        (t) => window.__put("board_data.js", t),
        t0.replace('"fernhill": {', '"fernhill": {\n  "pinned": true,'),
      );
      await focus(p, 1500);
      ok(
        "C11 your un-star survives an older copy written back",
        (await p.evaluate(() => store.jobs.fernhill.pinned)) === false,
      );
      ok("C11 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      /* one 2099 stamp, then edits with the real time keep applying, also back to an earlier value */
      const ctx2 = await b.newContext();
      const q = await mkpage(ctx2, { connect: true });
      await wait(q, 1500);
      const loc0 = await q.evaluate(() => get("jobs", "quillstone").location);
      await editOnDisk(q, "quillstone", { notes: "2099 stamp" }, "2099-01-01T00:00:00Z");
      await focus(q, 900);
      const r = [];
      for (const pt of [{ location: "Remote" }, { location: loc0 }, { location: "Remote" }, { notes: "" }]) {
        await wait(q, 5);
        await editOnDisk(q, "quillstone", pt, "now");
        await focus(q, 900);
        const [k, v] = Object.entries(pt)[0];
        r.push(
          (await q.evaluate((k) => store.jobs.quillstone[k], k)) === v && (await disk(q)).jobs.quillstone[k] === v,
        );
      }
      ok(
        "C11 after one 2099 stamp, edits stamped with the real time keep applying",
        r.every(Boolean),
        JSON.stringify(r),
      );
      ok("C11 2099 no errors", !q.errs.length, q.errs.join("|"));
      await ctx2.close();
    }
    // ---- P: 1,000 jobs: a save stays quick and the copy in browser storage stays small
    if (want("P")) {
      const d = parseBoard(boardText);
      const tmpl = Object.values(d.jobs)[0];
      for (let i = 0; i < 1000; i++)
        d.jobs["job" + i] = {
          ...tmpl,
          company: "Co " + i,
          role: "Engineer " + i,
          folder: null,
          notes: "n".repeat(1000),
          updatedAt: new Date(Date.now() - 864e5 + i).toISOString(),
        };
      const text = withData(d);
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true, text, files: files({}, text) });
      await wait(p, 5000);
      const r = await p.evaluate(async () => {
        const t = performance.now();
        for (let i = 0; i < 5; i++) upd("jobs", "job5", { notes: "edit " + i });
        const updMs = (performance.now() - t) / 5;
        await new Promise((res) => setTimeout(res, 2500));
        return {
          updMs,
          data: JSON.stringify(store).length,
          ls: (localStorage.getItem(lsKey("board")) || "").length,
          saved: (await window.__get("board_data.js")).includes("edit 4"),
        };
      });
      ok(
        "P with 1,000 jobs an edit is saved, and the copy in browser storage is under 1.5x the data",
        r.saved && r.ls < 1.5 * r.data && r.updMs < 250,
        JSON.stringify(r),
      );
      ok("P no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
  } catch (e) {
    ok("round5 suite ran without crashing", false, e.stack || String(e));
  } finally {
    if (b) await b.close();
    report();
  }
})();
