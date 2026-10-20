// Review fixes: My_answers.md is only written after it was read and merged; repeated questions get their own box; an
// unknown call type survives a background merge; field-level merge of records both sides changed; bad "folder" values
// are refused; wrong-typed settings; saved answers from an earlier version of a sheet; filing work is bounded; closed
// cards keep their call hidden; a board_data.js with code in it is flagged; two tabs refresh an open panel; small fixes.
//   ONLY=M1,M4 node tests/test_round3.js   runs only those blocks (SAMPLE_TREE must be set, see run.mjs)
const fs = require("fs");
const path = require("path");
const { ok, wait, launch, mkpage, report, data, boardText, parseBoard, files, TREE } = require("./lib.js");

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
/* fire the window focus handler and wait until its pass is over (focusRun is the running pass) */
const focus = async (p, extra = 200) => {
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.evaluate(() => (typeof focusRun !== "undefined" && focusRun) || new Promise((r) => setTimeout(r, 1500)));
  await wait(p, extra);
};
const withData = (d) => boardText.slice(0, boardText.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n";
const copy = () => JSON.parse(JSON.stringify(data));
const disk = async (p) => parseBoard(await p.evaluate(() => window.__get("board_data.js")));
/* an assistant edits one record in board_data.js on disk; `ms` is its updatedAt relative to now */
async function assistantEdit(p, coll, id, patch, ms = 2000) {
  await p.evaluate(
    ([c, i, pt, off]) =>
      window.__get("board_data.js").then((t) => {
        const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
        d[c][i] = { ...d[c][i], ...pt, updatedAt: new Date(Date.now() + off).toISOString(), changedBy: "assistant" };
        window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
      }),
    [coll, id, patch, ms],
  );
}
const hide = (p, hidden = true) =>
  p.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
const answers = (p) => p.evaluate(() => window.__get("Library/My_answers.md").then((t) => t || ""));
const cardTags = (p, id, sec = "jobs") =>
  p.$$eval(`[data-key="${sec}:${id}"] .tag`, (t) => t.map((x) => x.textContent));
const MD =
  "# My answers\nx\n\n## cheat-sheet::Tell me about yourself\nMy long elevator pitch.\n\n## prep:harborlight::Why us?\nBecause.\n\n## prep:lumenfield::Who would I report to, and how big is the team?\nOld note.\n";
const NEXT = 'details.mine.ask[data-k^="prep:lumenfield::What are the next"] textarea';
const REPORT = 'details.mine.ask[data-k^="prep:lumenfield::Who would I report to"] textarea';

(async () => {
  let b;
  try {
    b = await launch();
    // ---- M1: My_answers.md is never written without reading and merging it first
    if (want("M1")) {
      // a) a second browser (no answers stored here) opens a sheet before saving is allowed again, types, and switches tab at once
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, {
          files: files({ "Library/My_answers.md": MD }),
          init: "window.__perm='prompt'; window.ORGANIZER_FOLDER = window.__pick;",
        });
        await wait(p, 800);
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 600);
        await p.evaluate(() => allowAgain());
        await p.click(NEXT);
        await p.keyboard.type("Two weeks");
        await hide(p);
        await wait(p, 1500);
        let md = await answers(p);
        ok(
          "M1 switching tab right after typing keeps every answer already in My_answers.md",
          ["My long elevator pitch.", "Because.", "Old note.", "Two weeks"].every((s) => md.includes(s)),
          md.slice(0, 400).replace(/\n/g, "\\n"),
        );
        await hide(p, false);
        await wait(p, 4500);
        const bk = ((await p.evaluate(() => window.__ls("backups"))) || []).filter((n) => /^notes_/.test(n));
        const bmd = bk.length ? await p.evaluate((d) => window.__get("backups/" + d + "/My_answers.md"), bk[0]) : "";
        ok(
          "M1 the day's notes backup holds the full file",
          !!bmd && bmd.includes("My long elevator pitch.") && bmd.includes("Because."),
          bk.join(",") + " " + String(bmd).slice(0, 120),
        );
        ok("M1a no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      // b) the file can't be read for a while: nothing is written, and nothing counts as loaded, until it can
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, {
          files: files({ "Library/My_answers.md": MD }),
          init: `window.__failMy = true; window.ORGANIZER_FOLDER = window.__pick;
            (function(){ const F = window.MemFS.MemFile.prototype, g = F.getFile;
              F.getFile = function(){ if (window.__failMy && this.name === "My_answers.md") return Promise.reject(new DOMException("busy", "NotReadableError")); return g.call(this); }; })();`,
        });
        await wait(p, 1500);
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 800);
        ok("M1 a read that failed doesn't count as loaded", (await p.evaluate(() => myLoaded)) === false);
        await p.click(NEXT);
        await p.keyboard.type("Two weeks");
        await wait(p, 2000);
        await p.evaluate(() => (window.__failMy = false));
        let md = await answers(p);
        ok(
          "M1 while the file can't be read, nothing is written over it",
          md === MD,
          md.slice(0, 200).replace(/\n/g, "\\n"),
        );
        await wait(p, 6000);
        md = await answers(p);
        ok(
          "M1 once it can be read, the answer is merged into the file",
          md.includes("My long elevator pitch.") && md.includes("Two weeks") && md.includes("Old note."),
          md.slice(0, 400).replace(/\n/g, "\\n"),
        );
        ok("M1b no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      // c) saving paused: answers wait in the browser and are written (merged) when saving is back
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, { connect: true, files: files({ "Library/My_answers.md": MD }) });
        await wait(p, 1000);
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 800);
        await p.evaluate(() => {
          window.__failWrites = true;
          upd("jobs", "lumenfield", { pay: "paused" });
        });
        await wait(p, 900);
        ok("M1 (saving is paused)", (await p.evaluate(() => canWrite)) === false);
        await p.click(NEXT);
        await p.keyboard.type("Paused answer");
        await wait(p, 1800);
        ok("M1 with saving paused the file isn't written", (await answers(p)) === MD);
        ok(
          "M1 the answer is kept in the browser",
          /Paused answer/.test(await p.evaluate(() => localStorage.getItem(lsKey("myAnswers")))),
        );
        await p.evaluate(() => {
          window.__failWrites = false;
          return allowAgain();
        });
        await wait(p, 1800);
        const md = await answers(p);
        ok(
          "M1 when saving is back, the waiting answer is written and merged with the file",
          md.includes("Paused answer") && md.includes("My long elevator pitch.") && md.includes("Because."),
          md.slice(0, 400).replace(/\n/g, "\\n"),
        );
        ok("M1c no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      // d) the merge rule: your edit wins for its key, keys only in the file are kept, other keys take the file's value
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, { connect: true });
        await wait(p, 1000);
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 800);
        await p.fill(REPORT, "Local A1");
        await wait(p, 1500);
        await p.fill(NEXT, "Local B1");
        await wait(p, 1500);
        await p.evaluate(async () => {
          const t = await window.__get("Library/My_answers.md");
          window.__put(
            "Library/My_answers.md",
            t.replace("Local B1", "Disk B2") + "\n## prep:lumenfield::A question from another browser\nDisk only.\n",
          );
        });
        await p.fill(REPORT, "Local A2");
        await wait(p, 1800);
        const md = await answers(p);
        ok(
          "M1 merge: your edit wins, a key only in the file is kept, an unchanged key takes the file's value",
          md.includes("Local A2") && md.includes("Disk B2") && !md.includes("Local B1") && md.includes("Disk only."),
          md.replace(/\n/g, "\\n").slice(0, 500),
        );
        ok("M1 the box shows the value from the file", (await p.$eval(NEXT, (t) => t.value)) === "Disk B2");
        ok("M1d no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
    // ---- M2: the same question twice on one sheet gets two boxes
    if (want("M2")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const prep =
        "# Tidewater\n\n## Round 1: recruiter\n### What does success look like in 90 days? {.ask}\n### Why this role? ✎\n> x\n\n## Round 2: hiring manager\n### What does success look like in 90 days? {.ask}\n### Why this role? ✎\n> y\n";
      const p = await mkpage(ctx, { connect: true, extra: { "Job notes/tidewater/prep.md": prep } });
      await wait(p, 1500);
      await p.evaluate(() => openDrawer("jobs", "tidewater"));
      await wait(p, 1000);
      const ks = await p.$$eval("#drawerRoot .pleft details.mine", (d) => d.map((x) => x.dataset.k));
      const Q = "prep:tidewater::What does success look like in 90 days?";
      const W = "prep:tidewater::Why this role?";
      ok(
        "M2 a repeated question gets its own key: the first keeps the old one, the next gets #2",
        JSON.stringify(ks) === JSON.stringify([Q, W, Q + " #2", W + " #2"]),
        JSON.stringify(ks),
      );
      const boxes = p.locator("#drawerRoot details.mine.ask textarea");
      await boxes.nth(0).fill("Recruiter: ship the migration.");
      await boxes.nth(1).fill("Manager: own the on-call rotation.");
      await wait(p, 1800);
      const md = await answers(p);
      ok(
        "M2 both answers are saved, under different keys",
        md.includes(`## ${Q}\nRecruiter: ship the migration.`) &&
          md.includes(`## ${Q} #2\nManager: own the on-call rotation.`),
        md.replace(/\n/g, "\\n").slice(0, 400),
      );
      ok(
        "M2 the boxes keep their own text",
        (await boxes.nth(0).inputValue()) === "Recruiter: ship the migration." &&
          (await boxes.nth(1).inputValue()) === "Manager: own the on-call rotation.",
      );
      ok("M2 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- M3: a call type the settings don't list survives a background merge and later edits
    if (want("M3")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 2500);
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 800);
      const t = new Date(Date.now() + 4 * 864e5);
      const callAt = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) + "T15:00";
      await assistantEdit(p, "jobs", "lumenfield", { callType: "Technical interview", callAt, callWith: "Priya" });
      await focus(p, 600);
      const sel = await p.$eval("#drawerRoot .callrow select", (s) => s.value);
      ok("M3 after the merge the call type list shows the stored label", sel === "Technical interview", sel);
      await p.evaluate(() => {
        const i = document.querySelectorAll("#drawerRoot .callrow input[type=text]")[1];
        i.value = "zoom.us/j/1";
        i.dispatchEvent(new Event("change"));
      });
      await wait(p, 800);
      let x = await p.evaluate(() => get("jobs", "lumenfield"));
      ok(
        "M3 editing the meeting link keeps the call type and doesn't move the card",
        x.callType === "Technical interview" && x.callLink === "zoom.us/j/1" && x.lane === "applied",
        JSON.stringify({ t: x.callType, l: x.callLink, lane: x.lane }),
      );
      await p.evaluate(() => {
        const i = document.querySelectorAll("#drawerRoot .callrow input[type=text]")[0];
        i.value = "Priya Raman";
        i.dispatchEvent(new Event("change"));
      });
      await wait(p, 800);
      x = await p.evaluate(() => get("jobs", "lumenfield"));
      ok(
        "M3 editing who you talk to changes only that field",
        x.callType === "Technical interview" && x.callWith === "Priya Raman" && x.lane === "applied",
        JSON.stringify({ t: x.callType, w: x.callWith, lane: x.lane }),
      );
      await p.evaluate(() => {
        const s = document.querySelector("#drawerRoot .callrow select");
        s.value = "";
        s.dispatchEvent(new Event("change"));
      });
      await wait(p, 600);
      x = await p.evaluate(() => get("jobs", "lumenfield"));
      ok(
        "M3 picking the blank type on purpose clears it, without moving the card",
        x.callType === "" && x.lane === "applied",
        JSON.stringify({ t: x.callType, lane: x.lane }),
      );
      ok("M3 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      // a label with repeated spaces is stored as written (and its moves setting applies)
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const config = {
        callTypes: [
          { label: "Intro call", moves: "screen" },
          { label: "Team  interview", moves: "none" },
        ],
      };
      const p2 = await mkpage(ctx2, { connect: true, config });
      await wait(p2, 1000);
      await p2.evaluate(() => openDrawer("jobs", "harborlight"));
      await wait(p2, 800);
      await p2.evaluate(() => {
        const s = document.querySelector("#drawerRoot .callrow select");
        s.selectedIndex = [...s.options].findIndex((o) => /Team/.test(o.textContent));
        s.dispatchEvent(new Event("change"));
        const w = document.querySelector("#drawerRoot .callrow input[type=datetime-local]");
        const t = new Date(Date.now() + 3 * 864e5);
        w.value = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) + "T10:30";
        w.dispatchEvent(new Event("change"));
      });
      await wait(p2, 800);
      const h = await p2.evaluate(() => get("jobs", "harborlight"));
      ok(
        "M3 a call type label with two spaces is stored exactly, so its moves: none applies",
        h.callType === "Team  interview" && h.lane === "applied",
        JSON.stringify({ t: h.callType, lane: h.lane }),
      );
      ok("M3 spaces no errors", !p2.errs.length, p2.errs.join("|"));
      await ctx2.close();
    }
    // ---- M4: records both sides changed merge field by field; the data file is read before the prep sheets
    if (want("M4")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 2500);
      /* your edit (not written yet: the save waits 400 ms) and the assistant's edit, then focus */
      const race = (id, mine, theirs, ms) =>
        p.evaluate(
          async ([i, a, t, off]) => {
            upd("jobs", i, a);
            const txt = await window.__get("board_data.js");
            const d = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
            d.jobs[i] = {
              ...d.jobs[i],
              ...t,
              updatedAt: new Date(Date.now() + off).toISOString(),
              changedBy: "assistant",
            };
            window.__put("board_data.js", txt.slice(0, txt.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
            window.dispatchEvent(new Event("focus"));
            await ((typeof focusRun !== "undefined" && focusRun) || new Promise((r) => setTimeout(r, 1500)));
          },
          [id, mine, theirs, ms],
        );
      const both = async (id) => {
        await wait(p, 1500);
        return { st: await p.evaluate((i) => store.jobs[i], id), dk: (await disk(p)).jobs[id] };
      };
      await race("quillstone", { notes: "You: called the recruiter." }, { location: "Remote (assistant)" }, 2000);
      let r = await both("quillstone");
      ok(
        "M4 the assistant changes one field while you change another: both survive (assistant newer)",
        r.st.notes === "You: called the recruiter." &&
          r.st.location === "Remote (assistant)" &&
          r.dk.notes === r.st.notes &&
          r.dk.location === r.st.location,
        JSON.stringify({ st: [r.st.notes, r.st.location], dk: [r.dk.notes, r.dk.location] }),
      );
      await race("orchardline", { notes: "You: sent the form." }, { pay: "$200k (assistant)" }, -1000);
      r = await both("orchardline");
      ok(
        "M4 the same with your edit newer: both survive",
        r.st.notes === "You: sent the form." &&
          r.st.pay === "$200k (assistant)" &&
          r.dk.notes === r.st.notes &&
          r.dk.pay === r.st.pay,
        JSON.stringify({ st: [r.st.notes, r.st.pay], dk: [r.dk.notes, r.dk.pay] }),
      );
      await race("fernhill", { notes: "Yours" }, { notes: "Theirs (newer)" }, 2000);
      r = await both("fernhill");
      ok(
        "M4 both change the same field: the newer edit wins (the assistant's)",
        r.st.notes === "Theirs (newer)" && r.dk.notes === "Theirs (newer)",
        r.st.notes + " / " + r.dk.notes,
      );
      await race("fernhill", { notes: "Yours (newer)" }, { notes: "Theirs (older)" }, -1000);
      r = await both("fernhill");
      ok(
        "M4 both change the same field: the newer edit wins (yours)",
        r.st.notes === "Yours (newer)" && r.dk.notes === "Yours (newer)",
        r.st.notes + " / " + r.dk.notes,
      );
      await race(
        "brightwell_search",
        { notes: "Edited while it was being removed" },
        { deleted: true, removedAt: new Date().toISOString() },
        -1000,
      );
      r = await both("brightwell_search");
      ok(
        "M4 a removal by the assistant is kept when you edit another field (tombstone)",
        r.st.deleted === true && r.st.notes === "Edited while it was being removed" && r.dk.deleted === true,
        JSON.stringify({ del: r.st.deleted, notes: r.st.notes, dk: r.dk.deleted }),
      );
      // the data file is merged before the prep sheets are scanned (a slow folder makes the scan long)
      await p.evaluate(() => openDrawer("jobs", "quillstone"));
      await wait(p, 500);
      await assistantEdit(p, "jobs", "quillstone", { location: "Hybrid (assistant, second)" });
      await p.evaluate(() => {
        const r = FS.read.bind(FS);
        FS.read = async (path) => {
          if (/prep\.md$/.test(path)) await new Promise((res) => setTimeout(res, 1500));
          return r(path);
        };
      });
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      await wait(p, 400);
      ok(
        "M4 on focus the data file is merged before the slow prep sheet scan finishes",
        (await p.evaluate(() => get("jobs", "quillstone").location)) === "Hybrid (assistant, second)" &&
          (await p.$eval("#f-location", (i) => i.value)) === "Hybrid (assistant, second)",
      );
      await p.evaluate(() => (typeof focusRun !== "undefined" && focusRun) || new Promise((r) => setTimeout(r, 6000)));
      ok("M4 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      // after a reload: an edit made while saving was paused still merges field by field with the assistant's
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p1 = await mkpage(ctx2, { connect: true });
      await wait(p1, 1500);
      await p1.evaluate(() => {
        window.__failWrites = true;
        upd("jobs", "quillstone", { notes: "Typed while saving was paused." });
      });
      await wait(p1, 900);
      ok("M4 (saving paused in the first page)", (await p1.evaluate(() => canWrite)) === false);
      await p1.close();
      const d = copy();
      d.jobs.quillstone = {
        ...d.jobs.quillstone,
        location: "Remote (assistant, while closed)",
        updatedAt: new Date(Date.now() + 5000).toISOString(),
        changedBy: "assistant",
      };
      const text = withData(d);
      fs.writeFileSync(path.join(TREE, "board_data.js"), text);
      try {
        const p2 = await mkpage(ctx2, { text, init: "window.ORGANIZER_FOLDER = window.__pick;" });
        await wait(p2, 1500);
        const q = await p2.evaluate(() => get("jobs", "quillstone"));
        ok(
          "M4 after a reload, your paused edit and the assistant's newer edit are both kept",
          q.notes === "Typed while saving was paused." && q.location === "Remote (assistant, while closed)",
          JSON.stringify({ n: q.notes, l: q.location }),
        );
        ok("M4 reload no errors", !p2.errs.length, p2.errs.join("|"));
      } finally {
        fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
      }
      await ctx2.close();
    }
    // ---- M5: a "folder" value that isn't a job folder is never moved, copied or linked
    if (want("M5")) {
      const setFolder = async (p, id, folder) => {
        await assistantEdit(p, "jobs", id, { folder });
        await focus(p, 1200);
      };
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, { connect: true });
        await wait(p, 1500);
        const libN = await p.evaluate(() => window.__count("Library"));
        const appliedN = await p.evaluate(() => window.__count("2 - Applied"));
        await setFolder(p, "quillstone", "Library");
        ok(
          'M5 folder: "Library" leaves the Library folder where it is',
          (await p.evaluate(() => window.__count("Library"))) === libN &&
            !(await p.evaluate(() => window.__ls("1 - To apply"))).includes("Library"),
        );
        ok(
          "M5 and says so once, without moving anything",
          /Didn't move the folder for Quillstone/.test(await p.$eval("#toastRoot", (t) => t.textContent)) &&
            (await p.evaluate(() => get("jobs", "quillstone").folder)) === "Library",
          await p.$eval("#toastRoot", (t) => t.textContent),
        );
        await setFolder(p, "orchardline", "Job notes");
        await setFolder(p, "fernhill", "backups");
        ok(
          'M5 "Job notes" and "backups" stay at the top of the board',
          (await p.evaluate(() => window.__ls(""))).includes("Job notes") &&
            (await p.evaluate(() => window.__ls(""))).includes("backups") &&
            !(await p.evaluate(() => window.__ls("1 - To apply"))).some((n) => /Job notes|backups/.test(n)),
          JSON.stringify(await p.evaluate(() => window.__ls("1 - To apply"))),
        );
        await setFolder(p, "quillstone", "2 - Applied");
        ok(
          'M5 folder: "2 - Applied" on a To-apply job doesn\'t move the stage folder',
          (await p.evaluate(() => window.__count("2 - Applied"))) === appliedN &&
            !(await p.evaluate(() => window.__ls("1 - To apply"))).includes("2 - Applied"),
        );
        await setFolder(p, "quillstone", "../x");
        await p.click("#nav-jobs");
        await wait(p, 300);
        const tags = await cardTags(p, "quillstone");
        await p.evaluate(() => openDrawer("jobs", "quillstone"));
        await wait(p, 400);
        ok(
          'M5 folder: "../x" gets no Résumé link and a "check the folder path" tag',
          !(await p.$("#dResume")) && !(await p.$("#dLetter")) && tags.includes("✗ Check the folder path"),
          tags.join(","),
        );
        await p.keyboard.press("Escape");
        ok(
          "M5 badFolder refuses absolute paths, backslashes, empty parts and stage folders; accepts a job folder",
          await p.evaluate(
            () =>
              typeof badFolder === "function" &&
              !!badFolder("/etc") &&
              !!badFolder("C:/Users/x") &&
              !!badFolder("a\\b") &&
              !!badFolder("a//b") &&
              !!badFolder("1 - To apply") &&
              !!badFolder("1 - To apply/2 - Applied") &&
              !!badFolder("") &&
              !badFolder("1 - To apply/Acme - Engineer") &&
              !badFolder("Acme - Engineer"),
          ),
        );
        /* the old code looped forever here and froze the page, so the time limit is kept on this side */
        const guard = await Promise.race([
          p.evaluate(async () => {
            window.__put("1 - To apply/Selfcopy/a.txt", "x");
            let moveErr = "",
              copyErr = "";
            try {
              await Promise.race([
                moveDir("1 - To apply/Selfcopy", "1 - To apply/Selfcopy/inner"),
                new Promise((r, j) => setTimeout(() => j(new Error("hung")), 3000)),
              ]);
            } catch (e) {
              moveErr = e.message;
            }
            const src = await dirAt("1 - To apply/Selfcopy");
            const inner = await src.getDirectoryHandle("inner", { create: true });
            try {
              await Promise.race([
                copyFolder(src, inner),
                new Promise((r, j) => setTimeout(() => j(new Error("hung")), 3000)),
              ]);
            } catch (e) {
              copyErr = e.message;
            }
            return { moveErr, copyErr };
          }),
          new Promise((res) => setTimeout(() => res({ moveErr: "HUNG", copyErr: "hung" }), 15000)),
        ]);
        ok(
          "M5 a folder can't be moved or copied into itself",
          /into itself/.test(guard.moveErr) && guard.copyErr !== "hung",
          JSON.stringify(guard),
        );
        ok("M5 no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      // a job in Applied whose folder is "2 - Applied": no endless copy into itself
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const p = await mkpage(ctx, { connect: true });
        await wait(p, 1500);
        const n = await p.evaluate(() => window.__count("2 - Applied"));
        await assistantEdit(p, "jobs", "harborlight", { folder: "2 - Applied" });
        await p.evaluate(() => window.dispatchEvent(new Event("focus")));
        const r = await Promise.race([
          (async () => {
            await wait(p, 2000);
            return p.evaluate(() => ({
              n: window.__count("2 - Applied"),
              inner: window.__ls("2 - Applied/2 - Applied"),
            }));
          })(),
          new Promise((res) => setTimeout(() => res("HUNG"), 15000)),
        ]);
        ok(
          'M5 folder: "2 - Applied" on an Applied job doesn\'t copy the stage folder into itself',
          r !== "HUNG" && r.n === n && r.inner === null,
          JSON.stringify(r),
        );
        await ctx.close();
      }
    }
    // ---- M6: wrong-typed settings fall back to the defaults with a warning
    if (want("M6")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const config = {
        sections: null,
        stale: null,
        closedReasons: "Rejected",
        lanes: { jobs: [{ id: "applied", name: "Sent", follow: "10" }] },
        library: {
          sheetButtons: [
            { doc: "call-scripts", label: "Scripts", key: 4 },
            { doc: "cheat-sheet", label: "Cheat sheet", key: "n" },
            { label: "No doc" },
            { doc: "cheat-sheet", key: "c" },
          ],
        },
      };
      const p = await mkpage(ctx, { connect: true, config });
      await wait(p, 800);
      const tabs = await p.$$eval("#nav button .long", (s) => s.map((x) => x.textContent));
      ok(
        "M6 sections: null still shows the page with the default tab names",
        tabs.includes("Headhunters") && tabs.includes("People") && !p.errs.length,
        tabs.join("|") + " " + p.errs.join("|"),
      );
      ok(
        "M6 stale: null turns the stale nudges off without breaking Next up",
        !!(await p.$("#view .next")) && (await p.evaluate(() => staleList().length)) === 0,
      );
      ok(
        "M6 follow days written as text count as a number",
        (await p.evaluate(() => laneOf("jobs", "applied").follow)) === 10,
      );
      ok(
        "M6 closedReasons that isn't a list falls back to the defaults",
        (await p.evaluate(() => CONFIG.closedReasons.length)) === 5,
      );
      const btns = await p.evaluate(() => CONFIG.library.sheetButtons.map((b) => [b.doc, b.label, b.key || ""]));
      ok(
        "M6 sheet buttons: no doc is skipped, a missing label uses the doc, bad or taken keys are dropped",
        JSON.stringify(btns) ===
          JSON.stringify([
            ["call-scripts", "Scripts", ""],
            ["cheat-sheet", "Cheat sheet", ""],
            ["cheat-sheet", "cheat-sheet", "c"],
          ]),
        JSON.stringify(btns),
      );
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 800);
      ok("M6 a prep sheet opens with those buttons", !!(await p.$("#drawerRoot .drawer.prep .plib")));
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      await wait(p, 200);
      await p.keyboard.press("?");
      await wait(p, 200);
      ok("M6 the shortcuts list opens", !!(await p.$("#kTitle")));
      ok(
        "M6 each problem is reported with a console warning",
        p.warns.some((w) => /sections should be an object/.test(w)) &&
          p.warns.some((w) => /closedReasons should be a list/.test(w)) &&
          p.warns.some((w) => /key should be one character/.test(w)) &&
          p.warns.some((w) => /key "n" is already taken/.test(w)) &&
          p.warns.some((w) => /has no doc/.test(w)),
        p.warns.join(" | "),
      );
      ok("M6 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await mkpage(ctx2, { config: { sections: { hunters: "Recruiters", people: { label: "" } } } });
      await wait(p2, 500);
      const t2 = await p2.$$eval("#nav button .long", (s) => s.map((x) => x.textContent));
      const noun = await p2.evaluate(() => SECTIONS.hunters.noun);
      ok(
        "M6 a section given as text, or an empty label, falls back to the default names",
        t2.includes("Headhunters") && t2.includes("People") && noun === "headhunter" && !p2.errs.length,
        t2.join("|") + " " + noun + " " + p2.errs.join("|"),
      );
      await ctx2.close();
    }
    // ---- M7: answers whose question was reworded show under "Saved answers from earlier versions"
    if (want("M7")) {
      const ctx = await b.newContext({
        viewport: { width: 1440, height: 900 },
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const p = await mkpage(ctx, { connect: true });
      await wait(p, 1500);
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 800);
      ok("M7 no section while every answer has its question", !(await p.$("#p-earlier")));
      await p.fill(REPORT, "Reports to Dana, team of 6.");
      await wait(p, 1600);
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      await p.evaluate(async () => {
        const t = await window.__get("Job notes/lumenfield/prep.md");
        window.__put(
          "Job notes/lumenfield/prep.md",
          t.replace(
            "Who would I report to, and how big is the team?",
            "Who would I report to, and how large is the team?",
          ),
        );
      });
      await focus(p);
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 1200);
      const sec = await p.evaluate(() => {
        const s = document.querySelector("#p-earlier");
        if (!s) return null;
        const d = s.querySelector("details");
        return {
          open: d.open,
          sum: d.querySelector("summary").textContent,
          text: s.textContent,
          last: !s.nextElementSibling,
        };
      });
      ok(
        "M7 the answer shows, folded, under Saved answers from earlier versions (1) at the end of the sheet",
        !!sec &&
          !sec.open &&
          sec.sum === "Saved answers from earlier versions (1)" &&
          /team of 6/.test(sec.text) &&
          sec.last,
        JSON.stringify(sec),
      );
      await p.click("#p-earlier summary");
      await p.click("#p-earlier .qcopy");
      await wait(p, 300);
      ok(
        "M7 Copy answer copies it",
        (await p.evaluate(() => navigator.clipboard.readText())) === "Reports to Dana, team of 6.",
      );
      await p.click("#p-earlier .erm");
      ok("M7 Remove asks first", !!(await p.$("#p-earlier .erm-yes")) && /team of 6/.test(await answers(p)));
      await p.click("#p-earlier .erm-no");
      ok("M7 Keep keeps it", !!(await p.$("#p-earlier .erm")) && /team of 6/.test(await answers(p)));
      await p.click("#p-earlier .erm");
      await p.click("#p-earlier .erm-yes");
      await wait(p, 1600);
      ok(
        "M7 Remove deletes the answer from My_answers.md and the section goes away",
        !(await p.$("#p-earlier")) && !/team of 6/.test(await answers(p)),
      );
      ok("M7 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- M8: one save with many jobs lists a bounded number of folders
    if (want("M8")) {
      const d = copy();
      const extra = {};
      for (let i = 0; i < 300; i++) {
        const f = `2 - Applied/Co${i} - Eng`;
        d.jobs["j" + i] = {
          company: "Co" + i,
          role: "Eng",
          lane: "applied",
          folder: f,
          updatedAt: "2026-01-01T00:00:00Z",
        };
        extra[f + "/Resume.pdf"] = "x";
        extra[f + "/Cover_Letter.pdf"] = "x";
      }
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, {
        connect: true,
        files: files(extra, withData(d)),
        init: `(function(){const D=window.__FDir.prototype;const e=D.entries;D.entries=function(){window.__lists=(window.__lists||0)+1;return e.call(this);};})();`,
      });
      await wait(p, 4000);
      let before = await p.evaluate(() => window.__lists || 0);
      await p.evaluate(() => upd("jobs", "quillstone", { notes: "x" }));
      await wait(p, 2000);
      let n = (await p.evaluate(() => window.__lists || 0)) - before;
      ok("M8 one field save with 300 job folders lists at most a few folders", n <= 5, String(n));
      before = await p.evaluate(() => window.__lists || 0);
      await p.evaluate(() => moveCard("jobs", "j7", "closed"));
      await wait(p, 2000);
      n = (await p.evaluate(() => window.__lists || 0)) - before;
      ok(
        "M8 a stage change still files that job's folder, listing only what it moved",
        (await p.evaluate(() => get("jobs", "j7").folder)) === "3 - Closed/Co7 - Eng" && n <= 10,
        n + " " + (await p.evaluate(() => get("jobs", "j7").folder)),
      );
      ok("M8 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- M9: a closed card with a future call: no call badge in quick open, no automatic prep sheet
    if (want("M9")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, {
        connect: true,
        extra: { "Job notes/marigold/prep.md": "# Marigold\n\n## Notes\n- Old prep.\n" },
      });
      await wait(p, 1500);
      await p.evaluate(() => {
        const t = new Date(Date.now() + 2 * 864e5);
        upd("jobs", "marigold", { callAt: localDate(t) + "T14:00", callType: "Panel" });
      });
      await p.keyboard.press("g");
      await wait(p, 200);
      await p.keyboard.type("marigold");
      await wait(p, 200);
      const row = await p.$eval(".hqo .hqi.on", (r) => r.textContent).catch(() => "");
      ok("M9 quick open shows no call badge on a closed card", /Marigold/.test(row) && !/📞/.test(row), row);
      await p.keyboard.press("Escape");
      await p.keyboard.press("g");
      await wait(p, 200);
      const top = await p.$eval(".hqo .hqi.on", (r) => r.textContent).catch(() => "");
      ok("M9 and doesn't rank it first as a booked call", !/Marigold/.test(top), top);
      await p.keyboard.press("Escape");
      await p.evaluate(() => openDrawer("jobs", "marigold"));
      await wait(p, 500);
      ok("M9 the closed card opens the plain panel, not the prep sheet", !(await p.$("#drawerRoot .drawer.prep")));
      const btn = p.locator("#drawerRoot button", { hasText: "Open prep sheet" });
      ok("M9 it still offers Open prep sheet", (await btn.count()) === 1);
      await btn.click();
      await wait(p, 500);
      ok("M9 which opens it", !!(await p.$("#drawerRoot .drawer.prep")));
      ok("M9 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- M10: a board_data.js with anything besides the data is flagged
    if (want("M10")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true, text: boardText + "window.__extra = 1;\n" });
      await wait(p, 800);
      ok(
        "M10 code after the data in board_data.js is flagged with a warning",
        p.warns.some((w) => /holds something besides the data/.test(w)) &&
          /holds something besides the data/.test(await p.$eval("#toastRoot", (t) => t.textContent)),
        p.warns.join(" | "),
      );
      await wait(p, 1000);
      ok(
        "M10 the next save writes a clean file",
        await p.evaluate(() =>
          window
            .__get("board_data.js")
            .then((t) => typeof wrapperOk === "function" && wrapperOk(t) && !/__extra/.test(t)),
        ),
      );
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await mkpage(ctx2, { connect: true });
      await wait(p2, 800);
      ok(
        "M10 the normal file (comments and the wrapper) raises no warning",
        !p2.warns.some((w) => /besides the data/.test(w)) && (await p2.evaluate((t) => wrapperOk(t), boardText)),
      );
      ok(
        "M10 code before the data is flagged too",
        !(await p2.evaluate((t) => wrapperOk(t), "fetch('x');\n" + boardText)) &&
          !(await p2.evaluate(() => wrapperOk('window.BOARD_DATA = {"a":1}; /* ok */ x()'))) &&
          (await p2.evaluate(() => wrapperOk('/* c */\nwindow.BOARD_DATA = {"a":1}; // end\n'))),
      );
      ok("M10 no errors", !p.errs.length && !p2.errs.length, p.errs.concat(p2.errs).join("|"));
      await ctx.close();
      await ctx2.close();
    }
    // ---- M12: two tabs: an open panel shows the other tab's change
    if (want("M12")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const a = await mkpage(ctx, { connect: true });
      const c = await mkpage(ctx);
      await c.evaluate(() => openDrawer("jobs", "quillstone"));
      await wait(c, 400);
      await a.evaluate(() => upd("jobs", "quillstone", { notes: "Changed in the other tab." }));
      await wait(c, 800);
      ok(
        "M12 an open panel shows the change made in another tab",
        (await c.$eval("#f-notes", (n) => n.value)) === "Changed in the other tab.",
      );
      ok("M12 no errors", !a.errs.length && !c.errs.length, a.errs.concat(c.errs).join("|"));
      await ctx.close();
    }
    // ---- C: behavior that had no test (review C's surviving mutants)
    if (want("C")) {
      const guide =
        "# Zoo\n\n## Animals\n\n### Zebra facts\n> zebra\n\n### Other\n> A medium answer that mentions the zebra once, long enough to count.\n\n### Longest\n> " +
        "A long answer about the savanna and its animals, including one zebra, that goes on for a while so it is the longest of all the answers in this little guide. ".repeat(
          2,
        ) +
        "\n\n### Zebra question\n> An answer to a question about the zebra, a bit longer than sixty characters.\n";
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true, extra: { "Library/1_Interviews/08_Zoo.md": guide } });
      await wait(p, 1500);
      // the Library search order: real answers first, a hit in the question next, then the longer answer
      await p.click("#nav-library");
      await wait(p, 800);
      await p.fill(".hlsearch", "zebra");
      await wait(p, 300);
      const order = await p.$$eval("a.hit b", (h) => h.map((x) => x.textContent));
      ok(
        "C the Library search puts real answers first, then a hit in the question, then the longer answer",
        JSON.stringify(order) === JSON.stringify(["Zebra question", "Longest", "Other", "Zebra facts"]),
        JSON.stringify(order),
      );
      await p.fill(".hlsearch", "");
      // a closed card whose PDFs are gone shows no missing-file tag
      await p.evaluate(() => {
        const d = window.__pick.at(get("jobs", "marigold").folder);
        d.kids.delete("Resume.pdf");
        d.kids.delete("Cover_Letter.pdf");
      });
      await p.click("#nav-jobs");
      await focus(p, 600);
      const mt = await cardTags(p, "marigold");
      ok("C a closed card never shows a missing-file tag", !mt.some((t) => /✗/.test(t)), mt.join(","));
      // a plain panel is rebuilt when another tool moves the card (here to Closed: the reasons appear)
      await p.evaluate(() => openDrawer("jobs", "quillstone"));
      await wait(p, 400);
      await assistantEdit(p, "jobs", "quillstone", { lane: "closed", closedReason: "Posting closed" });
      await focus(p, 400);
      ok(
        "C an open plain panel is rebuilt for the new stage another tool set",
        (await p.$eval("#drawerRoot .drawer", (d) => d.dataset.lane)) === "closed" &&
          (await p.$eval('#drawerRoot [data-reason="Posting closed"]', (c) => c.getAttribute("aria-pressed"))) ===
            "true",
      );
      await p.keyboard.press("Escape");
      await wait(p, 200);
      // the closed-reason chips use the merged record, not the one the panel was built from
      await p.evaluate(() => openDrawer("jobs", "marigold"));
      await wait(p, 400);
      await assistantEdit(p, "jobs", "marigold", { closedReason: "Withdrew" });
      await focus(p, 400);
      await p.click('#drawerRoot [data-reason="Withdrew"]');
      await wait(p, 300);
      ok(
        "C clicking the reason another tool just set clears it (the chip reads the merged record)",
        (await p.evaluate(() => get("jobs", "marigold").closedReason)) === null,
        String(await p.evaluate(() => get("jobs", "marigold").closedReason)),
      );
      await p.keyboard.press("Escape");
      await wait(p, 200);
      // an answer box keeps the cursor where it was when the sheet is rebuilt (outreach.md changed on disk)
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 800);
      await p.click(REPORT);
      await p.keyboard.type("abcdef");
      await p.evaluate((s) => document.querySelector(s).setSelectionRange(2, 2), REPORT);
      await p.evaluate(() => window.__put("Job notes/lumenfield/outreach.md", "# Outreach\n\nA new note.\n"));
      await p.waitForFunction(() => /A new note/.test(document.querySelector("#p-outreach").textContent), null, {
        timeout: 15000,
      });
      const caret = await p.evaluate((s) => {
        const t = document.querySelector(s);
        return { focused: document.activeElement === t, at: t.selectionStart, v: t.value };
      }, REPORT);
      ok(
        "C after a rebuild the answer box you were typing in keeps the focus and the cursor",
        caret.focused && caret.at === 2 && caret.v === "abcdef",
        JSON.stringify(caret),
      );
      ok("C no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- L: small fixes
    if (want("L")) {
      const d = copy();
      d.jobs.harborlight.resumeFile = "Résumé.pdf";
      d.jobs.harborlight.updatedAt = new Date().toISOString();
      const extra = {};
      extra[d.jobs.harborlight.folder + "/" + "Résumé.pdf".normalize("NFD")] = "x";
      extra[d.jobs.cobaltpeak.folder + "/resume.pdf"] = "x";
      const fl = files(extra, withData(d));
      delete fl[d.jobs.cobaltpeak.folder + "/Resume.pdf"];
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true, files: fl });
      await wait(p, 1500);
      await p.click("#nav-jobs");
      await wait(p, 600);
      const t1 = await cardTags(p, "cobaltpeak");
      const t2 = await cardTags(p, "harborlight");
      ok(
        "L the file check ignores case and Unicode form, like macOS and Windows",
        t1.includes("✓ Résumé + letter") && t2.includes("✓ Résumé + letter"),
        t1.join(",") + " / " + t2.join(","),
      );
      // the copy fallback names the right shortcut for this platform
      await p.click("#nav-library");
      await wait(p, 500);
      await p.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error("no")) },
        });
        document.execCommand = () => false;
      });
      await p.locator(".hlread .hcopy").first().click();
      await wait(p, 200);
      const lab = await p.locator(".hlread .hcopy").first().textContent();
      ok("L the copy fallback says Ctrl+C off a Mac", lab === "Press Ctrl+C", lab);
      // {.ask} in a heading with a very long run of spaces is quick
      const ms = await p.evaluate(() => {
        const t0 = performance.now();
        Prep.parse("# T\n## S\n### Q" + " ".repeat(100000) + "x {.ask}\n");
        Prep.parse("# T\n## S" + " ".repeat(100000) + "y\n");
        return performance.now() - t0;
      });
      ok("L a heading with 100,000 spaces parses quickly", ms < 1000, Math.round(ms) + " ms");
      ok("L no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
  } catch (e) {
    ok("round3 suite ran without crashing", false, e.stack || String(e));
  } finally {
    if (b) await b.close();
    report();
  }
})();
