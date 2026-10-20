// An edit made while the file is being written is kept; answers to a repeated question keep their keys when other
// copies are removed or reordered; Remove deletes an answer in every tab, and an answer deleted from My_answers.md by
// hand is written back; two tabs share waiting answers; small review fixes (data file check, folder values, filing
// retry, settings). (The merge tests that were here, R1, R3 and R4, are replaced by test_revs.js.)
//   ONLY=R2,R5 node tests/test_round4.js   runs only those blocks (SAMPLE_TREE must be set, see run.mjs)
const fs = require("fs");
const path = require("path");
const { ok, wait, launch, mkpage, report, data, boardText, parseBoard, files, TREE } = require("./lib.js");

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
/* the assistant edits one record on disk (rev + 1, as AGENTS.md asks) */
const editOnDisk = (p, id, patch) =>
  p.evaluate(
    ([i, pt]) =>
      window.__get("board_data.js").then((t) => {
        const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
        d.jobs[i] = {
          ...d.jobs[i],
          ...pt,
          rev: (d.jobs[i].rev || 0) + 1,
          updatedAt: new Date().toISOString(),
          changedBy: "assistant",
        };
        window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
      }),
    [id, patch],
  );
const SLOW = `(() => { const M = window.MemFS.MemFile.prototype, cw = M.createWritable;
  M.createWritable = async function () { const w = await cw.call(this); const c = w.close;
    if (this.name === "board_data.js" && window.__slow) w.close = async () => { await new Promise(r => setTimeout(r, 700)); return c.call(w); };
    return w; }; })();`;
const REPORT = 'details.mine.ask[data-k^="prep:lumenfield::Who would I report to"] textarea';
const Q90 = "What does success look like in 90 days?";

(async () => {
  let b;
  try {
    b = await launch();
    // ---- R2: an edit made while the data file is being written is not marked saved
    if (want("R2")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true, init: SLOW });
      await wait(p, 1500);
      await p.evaluate(() => (window.__slow = 1));
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "first edit" }));
      await wait(p, 650); // the write started at 400 ms and is inside the slow close()
      await p.evaluate(() => upd("jobs", "harborlight", { location: "Typed during the save" }));
      await wait(p, 3000);
      await focus(p, 1500);
      const dk = (await disk(p)).jobs.harborlight;
      ok(
        "R2 an edit typed while the file was being written is kept and written next",
        dk.location === "Typed during the save" &&
          dk.notes === "first edit" &&
          (await p.evaluate(() => get("jobs", "harborlight").location)) === "Typed during the save",
        JSON.stringify([dk.notes, dk.location]),
      );
      ok("R2 and nothing is left unsaved", (await p.evaluate(() => [dirty, unsyncedCount()])).join() === "false,0");
      ok("R2 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- R5: a repeated question keeps its answers when other copies are removed or reordered
    if (want("R5")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const HM = `## Hiring manager round\n\n### ${Q90} {.ask}\n`,
        PANEL = `## Panel round\n\n### ${Q90} {.ask}\n`;
      const p = await mkpage(ctx, {
        connect: true,
        extra: { "Job notes/lumenfield/prep.md": `# Acme prep\n\n${HM}\n${PANEL}` },
      });
      await wait(p, 1500);
      const open = async () => {
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 1000);
      };
      const boxes = () =>
        p.$$eval("#drawerRoot details.mine.ask", (d) =>
          d.map((x) => [x.closest("section").dataset.title, x.querySelector("textarea").value]),
        );
      const close = async () => {
        await p.keyboard.press("Escape");
        await wait(p, 100);
        await p.keyboard.press("Escape");
        await wait(p, 300);
      };
      const sheet = async (t) => {
        await p.evaluate((x) => window.__put("Job notes/lumenfield/prep.md", x), t);
        await focus(p, 300);
      };
      await open();
      const tas = p.locator("#drawerRoot details.mine.ask textarea");
      await tas.nth(0).fill("HM: ship the ledger migration");
      await tas.nth(1).fill("Panel: fewer pages");
      await wait(p, 1800);
      const md = await answers(p);
      ok(
        "R5 each copy is saved under its section",
        md.includes(`## prep:lumenfield::${Q90} @Hiring manager round\nHM: ship`) &&
          md.includes(`## prep:lumenfield::${Q90} @Panel round\nPanel: fewer`),
        md.replace(/\n/g, "\\n").slice(-300),
      );
      await close();
      await sheet(`# Acme prep\n\n${PANEL}`);
      await open();
      let bx = await boxes();
      const earlier = await p.$$eval("#p-earlier .hq.earlier", (d) => d.map((x) => x.textContent));
      ok(
        "R5 with the first copy removed, the other round shows its own answer",
        JSON.stringify(bx) === JSON.stringify([["Panel round", "Panel: fewer pages"]]),
        JSON.stringify(bx),
      );
      ok(
        "R5 and the removed round's answer is under Saved answers from earlier versions",
        earlier.length === 1 && /HM: ship/.test(earlier[0]),
        JSON.stringify(earlier),
      );
      await close();
      await sheet(`# Acme prep\n\n${PANEL}\n${HM}`);
      await open();
      bx = await boxes();
      ok(
        "R5 with the rounds reordered, each shows its own answer",
        JSON.stringify(bx) ===
          JSON.stringify([
            ["Panel round", "Panel: fewer pages"],
            ["Hiring manager round", "HM: ship the ledger migration"],
          ]),
        JSON.stringify(bx),
      );
      await close();
      ok("R5 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      /* an answer saved under the plain key before the question was repeated can't be placed in one round for sure, so
         it stays under "Saved answers from earlier versions" (this check expected it to move into the first copy) */
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const MD = `# My answers\nx\n\n## prep:lumenfield::${Q90}\nAnswered before the panel round was added\n`;
      const p2 = await mkpage(ctx2, {
        connect: true,
        extra: { "Job notes/lumenfield/prep.md": `# Acme prep\n\n${HM}\n${PANEL}`, "Library/My_answers.md": MD },
      });
      await wait(p2, 1500);
      await p2.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p2, 2500);
      const vals = await p2.$$eval("#drawerRoot details.mine.ask textarea", (t) => t.map((x) => x.value));
      const md2 = await answers(p2);
      const earlier2 = await p2.$$eval("#p-earlier .hq.earlier", (d) => d.map((x) => x.dataset.ek));
      ok(
        "R5 an answer under the plain key of a repeated question isn't guessed into a round (it is under earlier versions)",
        vals[0] === "" &&
          vals[1] === "" &&
          JSON.stringify(earlier2) === JSON.stringify([`prep:lumenfield::${Q90}`]) &&
          md2.includes(`## prep:lumenfield::${Q90}\nAnswered before`),
        JSON.stringify(vals) + " " + md2.replace(/\n/g, "\\n").slice(-200),
      );
      ok("R5 plain key no errors", !p2.errs.length, p2.errs.join("|"));
      await ctx2.close();
    }
    // ---- R6: an answer removed in the page stays deleted in every tab; one deleted from the file by hand is written back
    if (want("R6")) {
      const K_OLD = "prep:lumenfield::Old question that was reworded";
      const MD = `# My answers\nx\n\n## ${K_OLD}\nOld answer: team of 6\n\n## cheat-sheet::Tell me about yourself\nPitch.\n`;
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const A = await mkpage(ctx, { connect: true, extra: { "Library/My_answers.md": MD } });
        const B = await mkpage(ctx, {
          init: "window.ORGANIZER_FOLDER = window.__pick;",
          extra: { "Library/My_answers.md": MD },
        });
        await wait(A, 1500);
        for (const p of [A, B]) {
          await p.evaluate(() => openDrawer("jobs", "lumenfield"));
          await wait(p, 1200);
        }
        ok("R6 (tab B holds the old answer)", await B.evaluate((k) => !!MY[k], K_OLD));
        await A.click("#p-earlier summary");
        await A.click("#p-earlier .erm");
        await A.click("#p-earlier .erm-yes");
        await wait(A, 1800);
        const afterRemove = await answers(A);
        ok("R6 Remove deletes it from the file", !/team of 6/.test(afterRemove));
        ok("R6 the other tab drops it too", (await B.evaluate((k) => MY[k] || "", K_OLD)) === "");
        await B.evaluate((t) => window.__put("Library/My_answers.md", t), afterRemove);
        await B.fill(REPORT, "Dana, 6 people");
        await wait(B, 1800);
        const bt = await answers(B);
        ok(
          "R6 the other tab typing another answer doesn't bring the removed one back",
          !/team of 6/.test(bt) && /Dana, 6 people/.test(bt),
        );
        ok("R6 two tabs no errors", !A.errs.length && !B.errs.length, A.errs.concat(B.errs).join("|"));
        await ctx.close();
      }
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, { connect: true, extra: { "Library/My_answers.md": MD } });
        await wait(p, 1500);
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 1200);
        await p.evaluate(() =>
          window
            .__get("Library/My_answers.md")
            .then((t) =>
              window.__put("Library/My_answers.md", t.replace(/## cheat-sheet::Tell me about yourself\nPitch.\n/, "")),
            ),
        );
        await focus(p, 300);
        await p.fill(REPORT, "Dana");
        await wait(p, 1800);
        const t = await answers(p);
        ok(
          "R6 an answer deleted from the file by hand is written back (use Remove)",
          /Pitch\./.test(t) && /Dana/.test(t),
        );
        await p.close();
        /* deleted by hand while the page was closed: after a reload, the copy kept in this browser writes it back */
        const t1 = t.replace(/## prep:lumenfield::Who would I report to[^\n]*\nDana\n/, "");
        const p2 = await mkpage(ctx, {
          init: "window.ORGANIZER_FOLDER = window.__pick;",
          extra: { "Library/My_answers.md": t1 },
        });
        await wait(p2, 1500);
        await p2.evaluate(() => mySet("prep:lumenfield::Another", "One more"));
        await wait(p2, 1800);
        const t2 = await answers(p2);
        ok(
          "R6 an answer deleted by hand while the page was closed is written back after a reload",
          t1 !== t && /\nDana\n/.test(t2) && /One more/.test(t2),
          t2.slice(-200),
        );
        ok("R6 by hand no errors", !p.errs.length && !p2.errs.length, p.errs.concat(p2.errs).join("|"));
        await ctx.close();
      }
    }
    // ---- R7: two tabs without folder access keep each other's waiting answers
    if (want("R7")) {
      const ctx = await b.newContext();
      const A = await mkpage(ctx, {});
      const B = await mkpage(ctx, {});
      await A.evaluate(() => mySet("prep:lumenfield::QA", "Typed in tab A"));
      await wait(A, 1200);
      await B.evaluate(() => mySet("prep:lumenfield::QB", "Typed in tab B"));
      await wait(B, 1200);
      ok(
        "R7 each tab sees the other's waiting answer",
        (await A.evaluate(() => MY["prep:lumenfield::QB"])) === "Typed in tab B" &&
          (await B.evaluate(() => MY["prep:lumenfield::QA"])) === "Typed in tab A",
      );
      await A.evaluate(() => myFlush());
      await B.close({ runBeforeUnload: true });
      await A.close({ runBeforeUnload: true });
      const C = await mkpage(ctx, { connect: true });
      await wait(C, 2500);
      const t = await answers(C);
      ok(
        "R7 both waiting answers are kept, and written once saving is on",
        /Typed in tab A/.test(t) && /Typed in tab B/.test(t),
        t.slice(-200),
      );
      ok("R7 no errors", !C.errs.length, C.errs.join("|"));
      await ctx.close();
    }
    // ---- L: the data file check, folder values, filing retry, settings, unknown lanes
    if (want("L")) {
      const ctx = await b.newContext();
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 1500);
      const w = await p.evaluate(() => ({
        normal: wrapperOk(serialize(store)),
        after: wrapperOk('window.BOARD_DATA = {"a":1}; // /*\nfetch("https://example.invalid/")\n// */\n'),
        before: wrapperOk('// /*\nalert(1)\n// */\nwindow.BOARD_DATA = {"a":1};\n'),
        ls: wrapperOk('window.BOARD_DATA = {"a":1}; // x alert(1)\n'),
      }));
      ok(
        "L a comment trick can't hide code around the data",
        w.normal && !w.after && !w.before && !w.ls,
        JSON.stringify(w),
      );
      const bf = await p.evaluate(() =>
        [
          "1 - To apply/Acme - Role/",
          "Acme - Node.js",
          "Vercel - Next.js",
          "1 - to apply/Acme - Role",
          "board_data.js",
          "AGENTS.md",
          "1 - To apply",
          "1 - To apply/",
        ].map((f) => badFolder(f)),
      );
      ok(
        "L valid folder values pass (trailing /, a dot in the name, stage folder case); the board's files and stage folders don't",
        bf.slice(0, 4).every((x) => x === "") && bf.slice(4).every((x) => x !== ""),
        JSON.stringify(bf),
      );
      await editOnDisk(p, "harborlight", { folder: "2 - applied/" + data.jobs.harborlight.folder.split("/")[1] + "/" });
      await focus(p, 300);
      await p.evaluate(() => upd("jobs", "fernhill", { notes: "a save" }));
      await wait(p, 1200);
      ok(
        "L such a folder value is kept in its usual spelling (and written so with the next save)",
        (await p.evaluate(() => get("jobs", "harborlight").folder)) === data.jobs.harborlight.folder &&
          (await disk(p)).jobs.harborlight.folder === data.jobs.harborlight.folder,
      );
      /* a folder move that failed is tried again with the next save */
      await p.evaluate(() => {
        const real = moveDir;
        window.__fails = 1;
        moveDir = async (f, t) => {
          if (window.__fails-- > 0) throw new Error("a sync client holds a file");
          return real(f, t);
        };
      });
      await p.evaluate(() => upd("jobs", "brightwell_search", { lane: "applied" }));
      await wait(p, 1500);
      const f1 = await p.evaluate(() => get("jobs", "brightwell_search").folder);
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "another save" }));
      await wait(p, 1500);
      const f2 = await p.evaluate(() => get("jobs", "brightwell_search").folder);
      ok(
        "L a failed folder move is tried again on the next save",
        /^1 - To apply\//.test(f1) && /^2 - Applied\//.test(f2),
        f1 + " -> " + f2,
      );
      const cw = await p.evaluate(() => {
        const cc = (over) => {
          const before = CONFIG_WARNINGS.length;
          const cfg = mergeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), over);
          checkConfig(cfg);
          return { w: CONFIG_WARNINGS.slice(before), cfg };
        };
        const re = cc({ library: { pillLabels: [[/^Why (.+)$/, "Why"]] } });
        const h = cc({ library: { sheetButtons: [{ doc: "hunters", label: "Hunters", key: "h" }] } });
        const hb = cc({ blurPay: true, library: { sheetButtons: [{ doc: "hunters", label: "Hunters", key: "h" }] } });
        const nulls = cc({ ownerName: null, removedPurgeDays: null, library: { outreachDoc: null } });
        return {
          re: re.w.length === 0 && re.cfg.library.pillLabels[0][0] === "^Why (.+)$",
          h: h.w.length === 0 && h.cfg.library.sheetButtons[0].key === "h",
          hb: hb.w.length === 1 && !hb.cfg.library.sheetButtons[0].key,
          nulls:
            nulls.w.length === 0 &&
            nulls.cfg.ownerName === null &&
            nulls.cfg.library.outreachDoc === null &&
            nulls.cfg.removedPurgeDays === 30,
        };
      });
      ok("L settings that worked before are accepted again", Object.values(cw).every(Boolean), JSON.stringify(cw));
      await p.evaluate(() => {
        store.jobs.harborlight = { ...store.jobs.harborlight, lane: "no-such-lane" };
        render();
      });
      await wait(p, 200);
      ok(
        "L an unknown lane id shows in the first lane with a console warning",
        p.warns.some((x) => /Unknown lane "no-such-lane"/.test(x)),
        p.warns.join(" | "),
      );
      ok("L no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
  } catch (e) {
    ok("round4 suite ran without crashing", false, e.stack || String(e));
  } finally {
    if (b) await b.close();
    report();
  }
})();
