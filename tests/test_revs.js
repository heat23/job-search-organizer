// The merge protocol: per-field revisions kept in the file. A record carries `revs` ({field: n}, missing = 0); whoever
// changes a field sets revs[field] + 1. The browser's copy keeps the fields changed here and not yet written (dirty).
// Per field the higher revision wins; on a tie the file's value wins (an edit made without a bump), except that a dirty
// field (an unsaved change) is never lost: it keeps the person's value, and a conflict is recorded (the file's version in
// backups/ and one status line). Clocks play no part, and every browser decides the same way.
// The scenarios come from the adversarial reviews (stale write-backs in this and other browsers, cleared site data,
// re-stamped and re-bumped whole files, A→B→A toggles, clock skew, conflicts, unbumped edits, two tabs, storage full or
// cleared, Restore and Undo with folders, upgrading from the public version, every page write path).
//   ONLY=V1,V5 node tests/test_revs.js   runs only those blocks (SAMPLE_TREE must be set, see run.mjs)
const fs = require("fs");
const path = require("path");
const { ok, wait, launch, mkpage, report, boardText, parseBoard, data, TREE, bumped } = require("./lib.js");

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const C = ["jobs", "hunters", "people", "todos", "plan"];
const focus = async (p, extra = 300) => {
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.evaluate(() => (typeof focusRun !== "undefined" && focusRun) || new Promise((r) => setTimeout(r, 1500)));
  await wait(p, extra);
};
const raw = (p) => p.evaluate(() => window.__get("board_data.js"));
const disk = async (p) => parseBoard(await raw(p));
const status = (p) => p.$eval("#status", (n) => n.textContent);
const backups = (p, re) => p.evaluate((s) => (window.__ls("backups") || []).filter((n) => new RegExp(s).test(n)), re);
const textOf = (t, d) => t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n";
const rv = (r, f) => (r && r.revs && r.revs[f]) || 0;
/* An assistant writes the file: `mutate(d)` changes what it read (the file now, or `t0`, a copy it read earlier). */
async function write(p, mutate, t0) {
  const t = t0 || (await raw(p));
  const d = parseBoard(t);
  mutate(d);
  await p.evaluate((x) => window.__put("board_data.js", x), textOf(t, d));
}
/* an assistant's change to record r: revs + 1 for each field it changes, as AGENTS.md asks (bump false: without),
   stamped with `at` */
const A = (r, patch, bump = true, at = new Date().toISOString()) => {
  const out = { ...r, ...patch, updatedAt: at, changedBy: "assistant" };
  return bump ? bumped(r, out) : out;
};
const withText = (d) => textOf(boardText, d);
const KEPT =
  /Kept your version of (\d+) fields? on (\d+) cards?(?:; took \d+ changes? from the file)?; the file's version is in backups\/board_data_kept_\d{4}-\d{2}-\d{2}_\d{4,6}\.js\./;
/* as in real use, the <script src="board_data.js"> tag loads the same file the folder holds */
const SCRIPT = (t) =>
  `Object.defineProperty(window,"BOARD_DATA",{get:()=>(${JSON.stringify(parseBoard(t))}),set:()=>{},configurable:true});`;
const folderInit = (t) => "window.ORGANIZER_FOLDER = window.__pick;" + SCRIPT(t);

(async () => {
  let b;
  try {
    b = await launch();
    const open = async (opts = {}) => {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true, ...opts });
      await wait(p, 1500);
      return { ctx, p };
    };
    // ---- V1: an older copy written back never undoes what you saved, however it is stamped or re-bumped
    if (want("V1")) {
      const acts = {
        "notes typed": [
          () => upd("jobs", "harborlight", { notes: "PERSON TYPED THIS" }),
          (r) => r.notes === "PERSON TYPED THIS",
        ],
        Remove: [() => del("jobs", "harborlight"), (r) => r.deleted === true],
        Restore: [() => upd("jobs", "harborlight", { deleted: false, removedAt: null }), (r) => !r.deleted],
        "drag to Interviewing": [() => moveCard("jobs", "harborlight", "interview"), (r) => r.lane === "interview"],
      };
      for (const [variant, [act, kept]] of Object.entries(acts)) {
        const { ctx, p } = await open();
        if (variant === "Restore") {
          await p.evaluate(() => del("jobs", "harborlight"));
          await wait(p, 1200);
        }
        const t0 = await raw(p); // the assistant reads the file
        await p.evaluate(act);
        await wait(p, 1200);
        /* it writes back what it read, with its own change to quillstone and, in the same stale copy, a new field value
           on harborlight (each bumped from what it read) */
        await write(
          p,
          (d) => {
            d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" });
            d.jobs.harborlight = A(d.jobs.harborlight, { pay: "Stale copy's pay" });
          },
          t0,
        );
        await focus(p, 1500);
        const st = await p.evaluate(() => store.jobs);
        const dk = (await disk(p)).jobs;
        ok(
          `V1 your saved ${variant} is kept (page and file)`,
          kept(st.harborlight) && kept(dk.harborlight),
          JSON.stringify([st.harborlight.notes, st.harborlight.deleted, st.harborlight.lane]),
        );
        ok(
          `V1 (${variant}) the assistant's edit to another card, and its new field on the same card, are taken`,
          st.quillstone.location === "Remote (assistant)" &&
            dk.quillstone.location === "Remote (assistant)" &&
            st.harborlight.pay === "Stale copy's pay" &&
            dk.harborlight.pay === "Stale copy's pay",
        );
        if (variant === "notes typed") {
          const s = await status(p);
          ok("V1 the status line says so and names the backup", KEPT.test(s) && /1 field on 1 card;/.test(s), s);
          const kb = await backups(p, "^board_data_kept_");
          const kt = kb.length ? await p.evaluate((n) => window.__get("backups/" + n), kb[0]) : "";
          ok(
            "V1 the file as the assistant wrote it is in backups/",
            kb.length === 1 && kt.includes("Stale copy's pay"),
          );
        }
        ok(`V1 ${variant} no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      /* whole-file rewrites of an older read: re-stamped with revs kept, an old-style record "rev" + 1 on every record,
         or revs + 1 on every field it changed (only its own edit) */
      for (const how of ["every record re-stamped", "record rev + 1 everywhere", "revs bumped as asked"]) {
        const { ctx, p } = await open();
        const t0 = await raw(p);
        await p.evaluate(() => {
          upd("jobs", "fernhill", { notes: "PERSON NOTE" });
          moveCard("jobs", "harborlight", "screen");
          del("jobs", "orchardline");
        });
        await wait(p, 1500);
        await write(
          p,
          (d) => {
            for (const c of C)
              for (const id of Object.keys(d[c]))
                d[c][id] = { ...A(d[c][id], {}, false), ...(how.startsWith("record") ? { rev: 7 } : {}) };
            d.jobs.quillstone = A(
              d.jobs.quillstone,
              { location: "Remote (assistant)" },
              how === "revs bumped as asked",
            );
          },
          t0,
        );
        await focus(p, 1500);
        const pick = (j) => [j.fernhill.notes, j.harborlight.lane, !!j.orchardline.deleted, j.quillstone.location];
        const want1 = JSON.stringify(["PERSON NOTE", "screen", true, "Remote (assistant)"]);
        const st = pick(await p.evaluate(() => store.jobs)),
          dk = pick((await disk(p)).jobs);
        ok(
          `V1 a whole older copy (${how}): your three saved edits stay and its own edit is taken (page and file)`,
          JSON.stringify(st) === want1 && JSON.stringify(dk) === want1,
          JSON.stringify({ st, dk }),
        );
        ok(`V1 (${how}) recorded once`, /on 3 cards;/.test(await status(p)), await status(p));
        ok(`V1 ${how} no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
    // ---- V2: notes typed in the panel with many pauses (many saves) survive an older copy written back
    if (want("V2")) {
      const { ctx, p } = await open();
      const t0 = await raw(p);
      await p.evaluate(() => openDrawer("jobs", "fernhill"));
      await wait(p, 400);
      await p.locator("#f-notes").click();
      await p.keyboard.press("End");
      for (let i = 1; i <= 8; i++) {
        await p.keyboard.type(` word${i}`, { delay: 10 });
        await wait(p, 1150); // each pause commits the field and saves the file
      }
      await p.keyboard.press("Escape");
      await wait(p, 1200);
      const typed = (await disk(p)).jobs.fernhill.notes;
      await write(p, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" })), t0);
      await focus(p, 1500);
      ok(
        "V2 eight pauses while typing, then an older copy written back: the typed notes stay (page and file)",
        /word8$/.test(typed) &&
          (await p.evaluate(() => store.jobs.fernhill.notes)) === typed &&
          (await disk(p)).jobs.fernhill.notes === typed &&
          (await disk(p)).jobs.quillstone.location === "Remote (assistant)",
        typed.slice(-30),
      );
      ok("V2 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V3: an assistant that bumps can set a field back to an earlier value, again and again
    if (want("V3")) {
      const { ctx, p } = await open();
      const t0 = await raw(p);
      const step = async (id, patch) => {
        await write(p, (d) => (d.jobs[id] = A(d.jobs[id], patch)));
        await focus(p, 900);
        const st = await p.evaluate((i) => store.jobs[i], id),
          dk = (await disk(p)).jobs[id];
        const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
        return Object.entries(patch).every(([k, v]) => same(st[k], v) && same(dk[k], v));
      };
      const runs = async (label, id, patches) => {
        const r = [];
        for (const pt of patches) r.push(await step(id, pt));
        ok(`V3 ${label}: every step is taken (page and file)`, r.every(Boolean), JSON.stringify(r));
      };
      const R = new Date(Date.now() - 3600e3).toISOString();
      await runs("lane Applied → Screen → Applied → Screen", "harborlight", [
        { lane: "screen" },
        { lane: "applied" },
        { lane: "screen" },
      ]);
      await runs("pinned true → false → true", "fernhill", [{ pinned: true }, { pinned: false }, { pinned: true }]);
      await runs("removed → restored → removed", "orchardline", [
        { deleted: true, removedAt: R },
        { deleted: false, removedAt: null },
        { deleted: true, removedAt: R },
      ]);
      await write(p, () => {}, t0);
      await focus(p, 1200);
      const st = await p.evaluate(() => [
        store.jobs.harborlight.lane,
        store.jobs.fernhill.pinned,
        store.jobs.orchardline.deleted,
      ]);
      const dk = await disk(p);
      ok(
        "V3 the older copy read before all that, written back, changes nothing (page and file)",
        st.join() === "screen,true,true" &&
          dk.jobs.harborlight.lane === "screen" &&
          dk.jobs.orchardline.deleted === true,
        st.join(),
      );
      ok("V3 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V4: clocks play no part: any updatedAt is fine, and the later change wins either way
    if (want("V4")) {
      const { ctx, p } = await open();
      const day = new Date().toISOString().slice(0, 10);
      const stamps = [
        ["2099 (far ahead)", "2099-01-01T00:00:00Z"],
        ["local time written as Z, 5.5 hours ahead", new Date(Date.now() + 5.5 * 3600e3).toISOString()],
        ["a date only", day],
        ["2020 (far behind)", "2020-01-01T00:00:00.000Z"],
        ["local time written as Z, 7 hours behind", new Date(Date.now() - 7 * 3600e3).toISOString()],
      ];
      const r = [];
      for (const [label, at] of stamps) {
        await write(p, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "At " + label }, true, at)));
        await focus(p, 900);
        r.push((await p.evaluate(() => store.jobs.quillstone.location)) === "At " + label);
        /* you then change the same field in the page: your later change is written */
        await p.evaluate((v) => upd("jobs", "quillstone", { location: v }), "Person after " + label);
        await wait(p, 1000);
        r.push((await disk(p)).jobs.quillstone.location === "Person after " + label);
      }
      ok(
        "V4 assistant edits with any updatedAt are taken, and your later edit after each is kept",
        r.every(Boolean),
        JSON.stringify(r),
      );
      /* you drag a card; a minute later the assistant (fresh read, clock 3 minutes slow) moves it back */
      await p.evaluate(() => moveCard("jobs", "harborlight", "screen"));
      await wait(p, 1200);
      await write(
        p,
        (d) =>
          (d.jobs.harborlight = A(
            d.jobs.harborlight,
            { lane: "applied" },
            true,
            new Date(Date.now() - 180e3).toISOString(),
          )),
      );
      await focus(p, 1200);
      ok(
        "V4 an assistant with a slow clock can move your card back (it read your move first)",
        (await p.evaluate(() => store.jobs.harborlight.lane)) === "applied" &&
          (await disk(p)).jobs.harborlight.lane === "applied",
      );
      ok("V4 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V5: you (unsaved) and the assistant change the same field: yours is kept, recorded; other fields merge
    if (want("V5")) {
      const { ctx, p } = await open();
      for (const [label, times] of [
        ["the same revision", 1],
        ["a higher revision", 2],
      ]) {
        await p.evaluate(() => setNote(""));
        await p.evaluate((l) => {
          upd("jobs", "fernhill", { notes: "Mine, " + l });
          upd("jobs", "orchardline", { notes: "Mine too" });
          clearTimeout(saveTimer);
        }, label);
        await write(p, (d) => {
          let f = d.jobs.fernhill;
          for (let i = 0; i < times; i++) f = A(f, { notes: "Theirs " + i, location: "Austin (assistant) " + label });
          d.jobs.fernhill = f;
          d.jobs.orchardline = A(d.jobs.orchardline, { pay: "$190k (assistant) " + label });
        });
        const fileRev = rv((await disk(p)).jobs.fernhill, "notes");
        await focus(p, 1500);
        const f = await p.evaluate(() => store.jobs.fernhill),
          o = await p.evaluate(() => store.jobs.orchardline);
        const fd = (await disk(p)).jobs.fernhill;
        ok(
          `V5 (${label}) the field you both changed keeps your value; the assistant's other field is taken (page and file)`,
          f.notes === "Mine, " + label &&
            f.location === "Austin (assistant) " + label &&
            fd.notes === "Mine, " + label &&
            fd.location === "Austin (assistant) " + label,
          JSON.stringify([f.notes, f.location, fd.notes, fd.location]),
        );
        ok(
          `V5 (${label}) different fields of one card: both kept`,
          o.notes === "Mine too" && o.pay === "$190k (assistant) " + label,
          JSON.stringify([o.notes, o.pay]),
        );
        const s = await status(p);
        const kb = await backups(p, "^board_data_kept_");
        const kt = kb.length ? await p.evaluate((n) => window.__get("backups/" + n), kb[kb.length - 1]) : "";
        ok(
          `V5 (${label}) the conflict is recorded (status line, the file's version in backups/)`,
          KEPT.test(s) && /of 1 field on 1 card;/.test(s) && kt.includes('"Theirs ' + (times - 1) + '"'),
          s,
        );
        ok(
          `V5 (${label}) your value is written with a revision above the file's`,
          rv(fd, "notes") === fileRev + 1,
          JSON.stringify([rv(fd, "notes"), fileRev]),
        );
      }
      ok("V5 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V6: an edit without a bump: applied unless you changed that field since; an older copy never undoes yours
    if (want("V6")) {
      const { ctx, p } = await open();
      const r0 = rv((await disk(p)).jobs.orchardline, "pay");
      await write(p, (d) => (d.jobs.orchardline = A(d.jobs.orchardline, { pay: "$190k (no bump)" }, false)));
      await focus(p, 1500);
      const dk = (await disk(p)).jobs.orchardline;
      ok(
        "V6 an assistant edit on the current file without a bump is applied, and written back with revs + 1",
        (await p.evaluate(() => store.jobs.orchardline.pay)) === "$190k (no bump)" &&
          dk.pay === "$190k (no bump)" &&
          rv(dk, "pay") === r0 + 1,
        JSON.stringify([dk.pay, dk.revs, r0]),
      );
      ok("V6 and nothing is recorded", !/Kept your version/.test(await status(p)), await status(p));
      /* you changed notes (not written yet); the assistant changes notes and pay without a bump */
      await p.evaluate(() => {
        upd("jobs", "fernhill", { notes: "Mine, unsaved" });
        clearTimeout(saveTimer);
      });
      await write(
        p,
        (d) => (d.jobs.fernhill = A(d.jobs.fernhill, { notes: "Theirs (no bump)", pay: "$180k (no bump)" }, false)),
      );
      await focus(p, 1500);
      const f = (await disk(p)).jobs.fernhill;
      ok(
        "V6 without a bump, a field you changed keeps your value and the other field is taken",
        f.notes === "Mine, unsaved" && f.pay === "$180k (no bump)",
        JSON.stringify([f.notes, f.pay]),
      );
      /* an older copy written back without bumps, after your saved edit: not applied to that field */
      const t0 = await raw(p);
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "Saved after the read" }));
      await wait(p, 1200);
      await write(p, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "From the older copy" }, false)), t0);
      await focus(p, 1500);
      const dk2 = (await disk(p)).jobs;
      ok(
        "V6 an older copy without bumps never undoes your saved edit (its edit on an untouched card is applied)",
        dk2.harborlight.notes === "Saved after the read" && dk2.quillstone.location === "From the older copy",
        JSON.stringify([dk2.harborlight.notes, dk2.quillstone.location]),
      );
      /* a stamp-only rewrite (updatedAt and changedBy only, same revs) is quietly ignored: nothing to keep */
      await p.evaluate(() => setNote(""));
      await write(p, (d) => (d.jobs.lumenfield = A(d.jobs.lumenfield, {}, false)));
      await focus(p, 1200);
      ok(
        "V6 a record only re-stamped (same revs, same fields) records nothing",
        !/Kept your version/.test(await status(p)),
        await status(p),
      );
      ok("V6 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V7: two tabs, the assistant and reloads
    if (want("V7")) {
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        const Ta = await mkpage(ctx, { connect: true });
        await wait(Ta, 1500);
        const Tb = await mkpage(ctx, {});
        await wait(Tb, 800);
        await Tb.evaluate(() => upd("jobs", "quillstone", { notes: "typed in tab B" }));
        await wait(Ta, 300);
        await write(Ta, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" })));
        await focus(Ta, 1500);
        const qa = await Ta.evaluate(() => store.jobs.quillstone),
          qb = await Tb.evaluate(() => store.jobs.quillstone),
          qd = (await disk(Ta)).jobs.quillstone;
        ok(
          "V7 tab B's change counts as yours: the assistant's edit and B's notes both end up in tab A, tab B and the file",
          [qa, qb, qd].every((q) => q.notes === "typed in tab B" && q.location === "Remote (assistant)"),
          JSON.stringify([qa, qb, qd].map((q) => [q.notes, q.location, q.revs])),
        );
        /* the same field in both tabs, one after the other: the later edit wins everywhere, nothing recorded */
        await Tb.evaluate(() => upd("jobs", "fernhill", { notes: "typed in B" }));
        await wait(Ta, 1500);
        await Ta.evaluate(() => upd("jobs", "fernhill", { notes: "typed in A after" }));
        await wait(Ta, 1500);
        const f = [
          await Ta.evaluate(() => store.jobs.fernhill.notes),
          await Tb.evaluate(() => store.jobs.fernhill.notes),
          (await disk(Ta)).jobs.fernhill.notes,
        ];
        ok(
          "V7 the same field edited in B, then in A: A's later edit everywhere",
          f.every((x) => x === "typed in A after"),
          f.join(" / "),
        );
        ok("V7 and no spurious note", !/Kept your version/.test(await status(Ta)), await status(Ta));
        /* the assistant writes an older copy while both tabs are open: both keep the person's version */
        const t0 = await raw(Ta);
        await Tb.evaluate(() => upd("jobs", "orchardline", { notes: "B again" }));
        await wait(Ta, 1500);
        await write(Ta, () => {}, t0);
        await focus(Ta, 1500);
        await wait(Tb, 300);
        ok(
          "V7 an older copy written back with two tabs open: both tabs and the file keep B's edit",
          (await Ta.evaluate(() => store.jobs.orchardline.notes)) === "B again" &&
            (await Tb.evaluate(() => store.jobs.orchardline.notes)) === "B again" &&
            (await disk(Ta)).jobs.orchardline.notes === "B again",
        );
        ok("V7 tabs no errors", !Ta.errs.length && !Tb.errs.length, Ta.errs.concat(Tb.errs).join("|"));
        await ctx.close();
      }
      /* copies crossing between tabs (advG MEDIUM-1), driven with storage events */
      {
        const { ctx, p } = await open();
        const r = await p.evaluate(async () => {
          const key = lsKey("board");
          const ev = (j) =>
            window.dispatchEvent(new StorageEvent("storage", { key, newValue: JSON.stringify(j), oldValue: null }));
          const out = {};
          /* 1. A edits; then a copy B held from before that edit arrives */
          const bCopy = JSON.parse(localStorage.getItem(key));
          upd("jobs", "fernhill", { notes: "TYPED IN A" });
          ev(bCopy);
          await new Promise((res) => setTimeout(res, 1500));
          out.crossing = [store.jobs.fernhill.notes, JSON.parse(localStorage.getItem(key)).jobs.fernhill.notes];
          /* 2. both tabs change the same field, unsaved: the higher revision wins */
          canWrite = false;
          const base = JSON.parse(localStorage.getItem(key));
          const q = base.jobs.quillstone;
          upd("jobs", "quillstone", { notes: "A once" });
          upd("jobs", "quillstone", { notes: "A twice" });
          ev({
            ...base,
            jobs: {
              ...base.jobs,
              quillstone: {
                ...q,
                notes: "B once",
                revs: { ...(q.revs || {}), notes: ((q.revs || {}).notes || 0) + 1 },
              },
            },
            _dirty: { ...base._dirty, "jobs:quillstone": ["notes"] },
          });
          out.higher = store.jobs.quillstone.notes;
          /* 3. a tie: the later copy (the other tab's) wins */
          const base3 = JSON.parse(localStorage.getItem(key));
          const o = base3.jobs.orchardline;
          upd("jobs", "orchardline", { notes: "A tie" });
          ev({
            ...base3,
            jobs: {
              ...base3.jobs,
              orchardline: {
                ...o,
                notes: "B tie",
                revs: { ...(o.revs || {}), notes: ((o.revs || {}).notes || 0) + 1 },
              },
            },
            _dirty: { ...base3._dirty, "jobs:orchardline": ["notes"] },
          });
          out.tie = store.jobs.orchardline.notes;
          /* 4. the other tab's unsaved change against a higher revision this tab took from the file: never lost */
          const base4 = JSON.parse(localStorage.getItem(key));
          const h = base4.jobs.harborlight;
          store.jobs.harborlight = { ...h, notes: "from the file", revs: { ...(h.revs || {}), notes: 5 } };
          ev({
            ...base4,
            jobs: { ...base4.jobs, harborlight: { ...h, notes: "B unsaved", revs: { ...(h.revs || {}), notes: 1 } } },
            _dirty: { ...base4._dirty, "jobs:harborlight": ["notes"] },
          });
          out.unsaved = [store.jobs.harborlight.notes, store.jobs.harborlight.revs.notes, !!dirtyF["jobs:harborlight"]];
          canWrite = true;
          writeFile();
          await new Promise((res) => setTimeout(res, 1500));
          return out;
        });
        const dk = (await disk(p)).jobs;
        ok(
          "V7 a copy from the other tab that crosses this tab's edit doesn't revert it (page, storage, file)",
          r.crossing.join() === "TYPED IN A,TYPED IN A" && dk.fernhill.notes === "TYPED IN A",
          JSON.stringify(r.crossing),
        );
        ok("V7 the same field changed in both tabs goes to the higher revision", r.higher === "A twice", r.higher);
        ok("V7 a tie goes to the later copy", r.tie === "B tie" && dk.orchardline.notes === "B tie", r.tie);
        ok(
          "V7 the other tab's unsaved change beats a higher revision this tab took from the file, and is written",
          r.unsaved[0] === "B unsaved" && r.unsaved[1] === 6 && dk.harborlight.notes === "B unsaved",
          JSON.stringify(r.unsaved),
        );
        ok("V7 crossing: no note", !/Kept your version/.test(await status(p)), await status(p));
        ok("V7 crossing no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      /* reload orders: tab A is closed, the assistant edits, tab B (no folder) edits, then a fresh page with the folder */
      {
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
        try {
          const Ta = await mkpage(ctx, {});
          await wait(Ta, 500);
          await Ta.evaluate(() => upd("jobs", "quillstone", { notes: "typed in tab A" }));
          const d = parseBoard(boardText);
          d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" });
          const f1 = withText(d);
          fs.writeFileSync(path.join(TREE, "board_data.js"), f1);
          const Tb = await mkpage(ctx, { text: f1 });
          await wait(Tb, 600);
          const qb = await Tb.evaluate(() => store.jobs.quillstone);
          ok(
            "V7 a tab that loaded the newer file merges the other tab's edit field by field",
            qb.location === "Remote (assistant)" && qb.notes === "typed in tab A",
            JSON.stringify([qb.location, qb.notes]),
          );
          await Ta.close();
          await Tb.evaluate(() => upd("jobs", "harborlight", { notes: "typed in tab B" }));
          await wait(Tb, 300);
          await Tb.close();
          const Cp = await mkpage(ctx, { text: f1, init: "window.ORGANIZER_FOLDER = window.__pick;" });
          await wait(Cp, 2000);
          const r = await Cp.evaluate(() => [
            store.jobs.quillstone.location,
            store.jobs.quillstone.notes,
            store.jobs.harborlight.notes,
          ]);
          const dk = (await disk(Cp)).jobs;
          ok(
            "V7 after a reload with the folder, all three changes are in the page and the file",
            r.join("|") === "Remote (assistant)|typed in tab A|typed in tab B" &&
              dk.quillstone.notes === "typed in tab A" &&
              dk.harborlight.notes === "typed in tab B" &&
              dk.quillstone.location === "Remote (assistant)",
            r.join("|"),
          );
          ok("V7 reload no errors", !Cp.errs.length, Cp.errs.join("|"));
        } finally {
          fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
        }
        await ctx.close();
      }
    }
    // ---- V8: browser storage full: edits are still written to the file, and the file's revs keep an older copy out
    if (want("V8")) {
      const { ctx, p } = await open({
        init: `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) {
          if (window.__full && /:board$/.test(k)) throw new DOMException("full", "QuotaExceededError");
          return set.call(this, k, v); }; })();`,
      });
      const t0 = await raw(p);
      await p.evaluate(() => (window.__full = 1));
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "Storage is full" }));
      await wait(p, 1200);
      ok(
        "V8 with browser storage full the edit is written to the file and is no longer dirty",
        (await disk(p)).jobs.harborlight.notes === "Storage is full" &&
          (await p.evaluate(() => !dirtyF["jobs:harborlight"])),
      );
      await write(p, () => {}, t0);
      await focus(p, 1500);
      ok("V8 an older copy written back is kept out", (await disk(p)).jobs.harborlight.notes === "Storage is full");
      ok("V8 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V9: browser storage cleared
    if (want("V9")) {
      {
        const { ctx, p } = await open();
        const t0 = await raw(p);
        await p.evaluate(() => upd("jobs", "harborlight", { notes: "Saved before the clear" }));
        await wait(p, 1200);
        await p.evaluate(() => localStorage.clear());
        await write(p, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" })), t0);
        await focus(p, 1500);
        const dk = (await disk(p)).jobs;
        ok(
          "V9 after a clear, an older copy is kept out and a real edit is taken",
          dk.harborlight.notes === "Saved before the clear" && dk.quillstone.location === "Remote (assistant)",
          JSON.stringify([dk.harborlight.notes, dk.quillstone.location]),
        );
        ok(
          "V9 and the copy with its dirty fields is back in browser storage",
          await p.evaluate(() => {
            const j = JSON.parse(localStorage.getItem(lsKey("board")) || "{}");
            return !!j._dirty && j.jobs.harborlight.notes === "Saved before the clear";
          }),
        );
        ok("V9 no errors", !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
      {
        /* saving paused, a change only in this browser, storage cleared, then the page is hidden */
        const { ctx, p } = await open();
        await p.evaluate(() => {
          canWrite = false;
          window.__perm = "prompt";
          upd("jobs", "fernhill", { notes: "ONLY IN THIS BROWSER" });
        });
        await wait(p, 600);
        await p.evaluate(() => localStorage.clear());
        await p.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        ok(
          "V9 a change waiting in this browser is stored again (still dirty) when the page is hidden",
          await p.evaluate(() => {
            const j = JSON.parse(localStorage.getItem(lsKey("board")) || "{}");
            return j.jobs.fernhill.notes === "ONLY IN THIS BROWSER" && j._dirty["jobs:fernhill"].includes("notes");
          }),
        );
        await ctx.close();
      }
      {
        /* a reload with browser storage empty: the file is taken as it is, nothing on disk is rewritten */
        const ctx = await b.newContext();
        const d = parseBoard(boardText);
        d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" });
        const text = withText(d);
        fs.writeFileSync(path.join(TREE, "board_data.js"), text);
        try {
          const p = await mkpage(ctx, { text, init: "window.ORGANIZER_FOLDER = window.__pick;" });
          await wait(p, 2000);
          ok(
            "V9 with nothing stored, the file's records are taken as they are and the file is not rewritten",
            (await p.evaluate(() => store.jobs.quillstone.location)) === "Remote (assistant)" &&
              (await raw(p)) === text,
          );
          ok("V9 reload no errors", !p.errs.length, p.errs.join("|"));
        } finally {
          fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
        }
        await ctx.close();
      }
    }
    // ---- V10: Restore a backup… and its Undo: new revisions, folders filed, Undo keeps later changes, no Ctrl+Z
    if (want("V10")) {
      const { ctx, p } = await open();
      const where = (name) =>
        p.evaluate((n) => STAGE_DIRS.filter((s) => (window.__ls(s) || []).some((x) => x.startsWith(n))), name);
      await p.evaluate(() => moveCard("jobs", "brightwell_search", "applied"));
      await wait(p, 2000);
      await p.evaluate(() => {
        window.__put("1 - To apply/NewCo - Eng/Resume.pdf", "x");
        put("jobs", "newco", {
          company: "NewCo",
          role: "Eng",
          lane: "todo",
          folder: "1 - To apply/NewCo - Eng",
          noLetter: true,
        });
        upd("jobs", "fernhill", { notes: "AFTER THE BACKUP" });
      });
      await wait(p, 2000);
      const moved = await where("Brightwell Labs - Senior Software Engineer, Search");
      const before = await p.evaluate(() => JSON.parse(JSON.stringify(store.jobs)));
      await p.evaluate(() => openRestore());
      await wait(p, 1200);
      const row = p.locator(".drawer.restore .rrow", { hasText: /board_data_\d{4}-\d{2}-\d{2}\.js/ }).first();
      await row.getByRole("button", { name: "Restore…" }).click();
      await row.getByRole("button", { name: "Restore", exact: true }).click();
      await wait(p, 3000);
      await p.locator("#toastRoot .toast").hover(); // the toast stays while the pointer is on it
      const bs = await p.evaluate(() => store.jobs.brightwell_search);
      const dk = (await disk(p)).jobs;
      ok(
        "V10 each restored field is a new edit: its revision goes up by one (page and file); untouched fields keep theirs",
        bs.lane === "todo" &&
          rv(bs, "lane") === rv(before.brightwell_search, "lane") + 1 &&
          rv(dk.brightwell_search, "lane") === rv(bs, "lane") &&
          rv(bs, "company") === rv(before.brightwell_search, "company") &&
          dk.newco.deleted === true,
        JSON.stringify([bs.lane, bs.revs, before.brightwell_search.revs, dk.newco.deleted]),
      );
      ok(
        "V10 the job folder moves back to To apply with its restored stage",
        moved.join() === "2 - Applied" &&
          (await where("Brightwell Labs - Senior Software Engineer, Search")).join() === "1 - To apply",
        JSON.stringify([moved, await where("Brightwell Labs - Senior Software Engineer, Search")]),
      );
      ok(
        "V10 and a card added after the backup has its folder in the removed folder",
        (await where("NewCo - Eng")).join() === "4 - Removed",
      );
      await p.evaluate(() => {
        section = "jobs";
        render();
      });
      await wait(p, 600);
      const tags = await p.$$eval('[data-key="jobs:brightwell_search"] .tag', (t) => t.map((x) => x.textContent));
      ok("V10 the card finds its files", !tags.some((t) => /✗/.test(t)), tags.join(","));
      /* Ctrl+Z never undoes a restore (Undo is in the toast only) */
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      await p.keyboard.press("Control+z");
      await wait(p, 800);
      ok(
        "V10 Ctrl+Z does not undo the restore",
        (await p.evaluate(() => store.jobs.brightwell_search.lane)) === "todo" &&
          (await p.locator("#toastRoot button", { hasText: "Undo" }).count()) === 1,
      );
      /* after the restore: you change a restored field, and the assistant (fresh read) changes another restored one */
      await p.evaluate(() => upd("jobs", "fernhill", { notes: "AFTER THE RESTORE" }));
      await wait(p, 1200);
      await write(
        p,
        (d) => (d.jobs.brightwell_search = A(d.jobs.brightwell_search, { movedAt: "2031-01-01T00:00:00.000Z" })),
      );
      await focus(p, 1500);
      await p.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(p, 3000);
      const st = await p.evaluate(() => store.jobs);
      const dk2 = (await disk(p)).jobs;
      ok(
        "V10 Undo puts back what the restore changed, and both folders",
        st.brightwell_search.lane === "applied" &&
          !st.newco.deleted &&
          dk2.brightwell_search.lane === "applied" &&
          (await where("Brightwell Labs - Senior Software Engineer, Search")).join() === "2 - Applied" &&
          (await where("NewCo - Eng")).join() === "1 - To apply",
        JSON.stringify([await where("Brightwell Labs - Senior Software Engineer, Search"), await where("NewCo - Eng")]),
      );
      ok(
        "V10 Undo keeps the changes made since the restore (yours and the assistant's) and says so",
        st.fernhill.notes === "AFTER THE RESTORE" &&
          dk2.fernhill.notes === "AFTER THE RESTORE" &&
          dk2.brightwell_search.movedAt === "2031-01-01T00:00:00.000Z" &&
          /Restore undone\. Kept 2 changes made since the restore\./.test(
            await p.$eval("#toastRoot", (t) => t.textContent),
          ),
        JSON.stringify([
          st.fernhill.notes,
          dk2.brightwell_search.movedAt,
          await p.$eval("#toastRoot", (t) => t.textContent),
        ]),
      );
      ok("V10 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V11: My_answers.md read cut short deletes nothing; deleting by hand isn't supported (written back)
    if (want("V11")) {
      const HDR = "# My answers\nx\n\n";
      const K = [
        "cheat-sheet::Tell me about yourself",
        "cheat-sheet::Why are you leaving?",
        "prep:lumenfield::Old question",
      ];
      const MD = HDR + `## ${K[0]}\nPitch.\n\n## ${K[1]}\nGrowth.\n\n## ${K[2]}\nTeam of 6\n`;
      const { ctx, p } = await open({ extra: { "Library/My_answers.md": MD } });
      await wait(p, 1000);
      await p.evaluate(() => myLoad());
      await wait(p, 400);
      await p.evaluate((t) => window.__put("Library/My_answers.md", t), HDR + `## ${K[0]}\nPitch.\n`);
      await p.evaluate(() => myLoad());
      await wait(p, 2000);
      const t1 = await p.evaluate(() => window.__get("Library/My_answers.md"));
      ok(
        "V11 a file read cut short (title and first answer) deletes nothing: every answer is written back",
        [/Pitch\./, /Growth\./, /Team of 6/].every((r) => r.test(t1)) &&
          (await p.evaluate(() => Object.keys(MY).length)) === 3,
        t1.slice(-160),
      );
      await p.evaluate(
        (k) =>
          window
            .__get("Library/My_answers.md")
            .then((t) => window.__put("Library/My_answers.md", t.replace(`## ${k}\nGrowth.\n`, ""))),
        K[1],
      );
      await focus(p, 300);
      await p.evaluate(() => myLoad());
      await wait(p, 2000);
      ok(
        "V11 an answer deleted from the file by hand is written back",
        /Growth\./.test(await p.evaluate(() => window.__get("Library/My_answers.md"))),
      );
      ok("V11 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V12: upgrading from the public version (advG HIGH-3): a browser copy without revs or dirty fields, with
    //      changes only in this browser, and a file without revs
    if (want("V12")) {
      const old = parseBoard(boardText);
      const oldText = textOf(boardText, old).replace(/"revs"/g, '"revs_unused"'); // the sample has none anyway
      const seed = (st, v) => {
        const now = new Date().toISOString();
        delete st.version;
        delete st.savedAt;
        if (v !== "in sync") {
          st.jobs.fernhill = { ...st.jobs.fernhill, notes: "MY BROWSER-ONLY NOTE", updatedAt: now, changedBy: "you" };
          st.jobs.harborlight = { ...st.jobs.harborlight, lane: "screen", updatedAt: now, changedBy: "you" };
          st.jobs.newjob1 = { company: "Only In Browser Inc", role: "Eng", lane: "todo", updatedAt: now };
          /* an older browser copy of a card the file changed since: the file's (newer) record is taken */
          st.jobs.quillstone = { ...st.jobs.quillstone, notes: "OLD BROWSER VALUE", updatedAt: "2020-01-01T00:00:00Z" };
        }
        return st;
      };
      for (const variant of ["browser-only changes", "in sync"]) {
        const ctx = await b.newContext();
        try {
          fs.writeFileSync(path.join(TREE, "board_data.js"), oldText);
          const st = seed(JSON.parse(JSON.stringify(old)), variant);
          const init = `if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear();
            localStorage.setItem(lsKey("board"), ${JSON.stringify(JSON.stringify(st))}); }`;
          /* lsKey is defined by the page; seed after it loads its helpers but before the store reads storage */
          const p0 = await mkpage(ctx, { text: oldText });
          const key = await p0.evaluate(() => lsKey("board"));
          await p0.close();
          const p = await mkpage(ctx, {
            text: oldText,
            init:
              init.replace('lsKey("board")', JSON.stringify(key)) +
              (variant === "in sync" ? "window.ORGANIZER_FOLDER = window.__pick;" : ""),
          });
          await wait(p, 2000);
          const look = () =>
            p.evaluate(() => [
              store.jobs.fernhill.notes,
              store.jobs.harborlight.lane,
              !!store.jobs.newjob1,
              store.jobs.quillstone.notes,
            ]);
          if (variant === "in sync") {
            ok("V12 old data in sync: nothing is written at load", (await raw(p)) === oldText);
            await p.evaluate(() => upd("jobs", "harborlight", { notes: "First edit" }));
            await wait(p, 1200);
            const dk = (await disk(p)).jobs;
            ok(
              "V12 the first edit writes revs 1 for that field only",
              rv(dk.harborlight, "notes") === 1 &&
                Object.keys(dk.harborlight.revs).length === 1 &&
                !dk.fernhill.revs &&
                dk.harborlight.notes === "First edit",
              JSON.stringify([dk.harborlight.revs, dk.fernhill.revs]),
            );
          } else {
            const s1 = await look();
            ok(
              `V12 (${variant}) the browser's newer changes are kept at load, the file's newer card is taken`,
              s1[0] === "MY BROWSER-ONLY NOTE" &&
                s1[1] === "screen" &&
                s1[2] === true &&
                s1[3] === data.jobs.quillstone.notes,
              JSON.stringify(s1),
            );
            const banner = await p.$eval("#banner", (n) => n.textContent);
            ok(
              `V12 (${variant}) the banner counts all three`,
              /3 changes are only in this browser/.test(banner),
              banner,
            );
            {
              await p.reload();
              await wait(p, 1500);
              const s2 = await look();
              ok(
                "V12 after closing and reopening (saving never turned on), they are still there, stored with their dirty fields",
                s2[0] === "MY BROWSER-ONLY NOTE" && s2[1] === "screen" && s2[2] === true,
                JSON.stringify(s2),
              );
            }
            await p
              .getByRole("button", { name: /Turn on saving/ })
              .first()
              .click();
            await wait(p, 2500);
            const dk = (await disk(p)).jobs;
            ok(
              `V12 (${variant}) once saving is on, they are written to the file, with nothing recorded`,
              dk.fernhill.notes === "MY BROWSER-ONLY NOTE" &&
                dk.harborlight.lane === "screen" &&
                !!dk.newjob1 &&
                dk.quillstone.notes === data.jobs.quillstone.notes &&
                rv(dk.fernhill, "notes") === 1 &&
                !/Kept your version|Took/.test(await status(p)),
              JSON.stringify([dk.fernhill.notes, dk.harborlight.lane, dk.fernhill.revs, await status(p)]),
            );
          }
          ok(`V12 ${variant} no errors`, !p.errs.length, p.errs.join("|"));
        } finally {
          fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
        }
        await ctx.close();
      }
    }
    // ---- V13: a record deleted from the file by hand is kept; the same new id on both sides merges, yours first
    if (want("V13")) {
      const { ctx, p } = await open();
      await write(p, (d) => delete d.jobs.orchardline);
      await focus(p, 1500);
      ok(
        "V13 a card removed from the file outright is kept and written back, and that is recorded",
        !!(await p.evaluate(() => get("jobs", "orchardline"))) &&
          !!(await disk(p)).jobs.orchardline &&
          /on 1 card;/.test(await status(p)),
        await status(p),
      );
      await p.evaluate(() => {
        canWrite = false;
        put("jobs", "dup_id", { company: "Mine", role: "Eng", lane: "todo" });
      });
      await write(
        p,
        (d) =>
          (d.jobs.dup_id = {
            company: "Theirs",
            role: "Eng",
            lane: "todo",
            url: "https://jobs.example.com/theirs",
            revs: { company: 1, role: 1, lane: 1, url: 1 },
            changedBy: "assistant",
          }),
      );
      await p.evaluate(() => {
        canWrite = true;
        writeFile();
      });
      await wait(p, 1500);
      const dk = (await disk(p)).jobs.dup_id;
      ok(
        "V13 the same new id on both sides: your fields (never written: all dirty) are kept above the file's, its other field is taken",
        (await p.evaluate(() => store.jobs.dup_id.company)) === "Mine" &&
          dk.company === "Mine" &&
          rv(dk, "company") === 2 &&
          dk.url === "https://jobs.example.com/theirs",
        JSON.stringify(dk),
      );
      ok("V13 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V14: Restore with a second tab open, an assistant write during the restore, then an older copy
    if (want("V14")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const Ta = await mkpage(ctx, { connect: true });
      await wait(Ta, 2500);
      await Ta.evaluate(() => upd("jobs", "fernhill", { notes: "AFTER BACKUP" }));
      await wait(Ta, 1500);
      const Tb = await mkpage(ctx, {});
      await wait(Tb, 800);
      const tStale = await raw(Ta);
      await Ta.evaluate(() => {
        const orig = replaceStore;
        window.__once = true;
        replaceStore = function (src) {
          const u = orig(src);
          if (!window.__once) return u;
          window.__once = false;
          window.__get("board_data.js").then((t) => {
            const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
            const q = d.jobs.quillstone;
            d.jobs.quillstone = {
              ...q,
              location: "ASSISTANT during restore",
              revs: { ...(q.revs || {}), location: ((q.revs || {}).location || 0) + 1 },
              changedBy: "assistant",
            };
            window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
          });
          return u;
        };
      });
      await Ta.evaluate(() => openRestore());
      await wait(Ta, 1200);
      const row = Ta.locator(".drawer.restore .rrow", { hasText: /board_data_\d{4}-\d{2}-\d{2}\.js/ }).first();
      await row.getByRole("button", { name: "Restore…" }).click();
      await row.getByRole("button", { name: "Restore", exact: true }).click();
      await wait(Ta, 3000);
      const dk = (await disk(Ta)).jobs;
      ok(
        "V14 the restore wins in the file and the other tab, and the assistant's write during it is merged",
        dk.fernhill.notes === data.jobs.fernhill.notes &&
          (await Tb.evaluate(() => store.jobs.fernhill.notes)) === data.jobs.fernhill.notes &&
          dk.quillstone.location === "ASSISTANT during restore",
        JSON.stringify([dk.fernhill.notes, dk.quillstone.location]),
      );
      await write(Ta, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "STALE ASSISTANT" })), tStale);
      await focus(Ta, 1500);
      const dk2 = (await disk(Ta)).jobs;
      /* the restored card keeps the restore. quillstone: that copy bumped location from what it read, the same number
         as the write made during the restore, so on the tie the file's value (the later write) wins */
      ok(
        "V14 an older copy written back after the restore doesn't undo the restore",
        dk2.fernhill.notes === data.jobs.fernhill.notes && dk2.quillstone.location === "STALE ASSISTANT",
        JSON.stringify([dk2.fernhill.notes, dk2.quillstone.location]),
      );
      ok("V14 no errors", !Ta.errs.length && !Tb.errs.length, Ta.errs.concat(Tb.errs).join("|"));
      await ctx.close();
    }
    // ---- V15: every page write path raises the revision of exactly the fields whose value it changes (by one), marks
    //      them dirty until written, and every write to the file raises the number of each field it changes
    if (want("V15")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const LOG = `(() => { const M = window.MemFS.MemFile.prototype, cw = M.createWritable;
        window.__log = [];
        M.createWritable = async function () { const w = await cw.call(this);
          if (this.name === "board_data.js") { const wr = w.write; w.write = async (x) => { if (typeof x === "string") window.__log.push(["page", x]); return wr.call(w, x); }; }
          return w; };
        const put = window.__put; window.__put = (q, t) => { if (q === "board_data.js") window.__log.push(["other", t]); return put(q, t); }; })();`;
      const p = await mkpage(ctx, { connect: true, init: LOG });
      await wait(p, 2000);
      const Tb = await mkpage(ctx, {});
      await wait(Tb, 600);
      const fieldsOf2 = (a, z) => {
        const s = new Set();
        for (const r of [a, z])
          if (r) {
            for (const f of Object.keys(r)) if (!["revs", "updatedAt", "changedBy"].includes(f)) s.add(f);
            for (const f of Object.keys(r.revs || {})) s.add(f);
          }
        return s;
      };
      const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
      /* the difference between two copies: fields whose value changed without +1, or whose number moved without a change */
      const diff = (A0, Z, merge) => {
        const bad = [];
        let n = 0;
        for (const c of C)
          for (const id of new Set([...Object.keys(A0[c]), ...Object.keys(Z[c])]))
            for (const f of fieldsOf2(A0[c][id], Z[c][id])) {
              const a = A0[c][id],
                z = Z[c][id],
                ra = rv(a, f),
                rz = rv(z, f);
              const ch = !same(a && a[f], z && z[f]);
              if (ch) n++;
              if (rz < ra) bad.push(`${c}:${id}.${f} went down ${ra}->${rz}`);
              else if (ch && !(merge ? rz > ra : rz === ra + 1)) bad.push(`${c}:${id}.${f} changed, rev ${ra}->${rz}`);
              else if (!ch && rz !== ra && !merge) bad.push(`${c}:${id}.${f} unchanged, rev ${ra}->${rz}`);
            }
        return [bad, n];
      };
      /* a page action with saving held back: the store before and after, and the dirty fields */
      const results = [];
      const step = async (label, fn, live) => {
        if (!live)
          await p.evaluate(() => {
            canWrite = false;
            clearTimeout(saveTimer);
          });
        const a = await p.evaluate(() => JSON.parse(JSON.stringify(store)));
        await fn();
        await wait(p, live ? 3000 : 900); // fields commit after a short pause; a restore files the folders
        const [z, dirty] = await p.evaluate(() => [JSON.parse(JSON.stringify(store)), dirtyOut()]);
        const [bad, n] = diff(a, z, false);
        /* every changed field is dirty (until it is written) */
        if (!live)
          for (const c of C)
            for (const id of Object.keys(z[c]))
              for (const f of fieldsOf2(a[c][id], z[c][id]))
                if (!same(a[c][id] && a[c][id][f], z[c][id][f]) && !(dirty[c + ":" + id] || []).includes(f))
                  bad.push(`${c}:${id}.${f} changed but not dirty`);
        results.push([label, n, bad]);
        await p.evaluate(() => {
          canWrite = true;
          writeFile();
        });
        await wait(p, 1500);
      };
      const ui = (fn, arg) => () => p.evaluate(fn, arg);
      await p.evaluate(() => {
        section = "jobs";
        render();
      });
      await step(
        "drag (moveCard)",
        ui(() => moveCard("jobs", "tidewater", "interview")),
      );
      await step(
        "quick move button",
        ui(() => document.querySelector('[data-key="jobs:quillstone"] [data-f="quick"]').click()),
      );
      await step(
        "star",
        ui(() => document.querySelector('[data-key="jobs:fernhill"] [data-f="pin"]').click()),
      );
      await step(
        "unstar",
        ui(() => document.querySelector('[data-key="jobs:fernhill"] [data-f="pin"]').click()),
      );
      await step("notes field", async () => {
        await p.evaluate(() => openDrawer("jobs", "fernhill"));
        await wait(p, 400);
        await p.locator("#f-notes").fill("Typed in the notes field");
        await p.locator("#f-notes").blur();
      });
      await step(
        "location field",
        ui(() => {
          const i = document.querySelector("#f-location");
          i.value = "Typed location";
          i.dispatchEvent(new Event("input"));
          i.dispatchEvent(new Event("blur"));
        }),
      );
      await p.keyboard.press("Escape");
      await wait(p, 300);
      await p.evaluate(() => openDrawer("jobs", "brightwell_web"));
      await wait(p, 400);
      await step(
        "follow-up date",
        ui(() => {
          const i = document.querySelector("#f-followUp");
          i.value = "2030-01-15";
          i.dispatchEvent(new Event("change"));
        }),
      );
      await step(
        "call fields",
        ui(() => {
          const w = document.querySelector("#drawerRoot .callrow input[type=text]");
          w.value = "Pat Example";
          w.dispatchEvent(new Event("change"));
        }),
      );
      await step(
        "referral",
        ui(() => {
          const s = document.querySelector("#f-referral");
          s.value = "p_tom";
          s.dispatchEvent(new Event("change"));
        }),
      );
      await p.keyboard.press("Escape");
      await wait(p, 300);
      await step("closed reason", async () => {
        await p.evaluate(() => openDrawer("jobs", "marigold"));
        await wait(p, 400);
        await p.evaluate(() => document.querySelector('#drawerRoot [data-reason="Withdrew"]').click());
      });
      await p.keyboard.press("Escape");
      await wait(p, 300);
      await step(
        "remove",
        ui(() => del("jobs", "orchardline")),
      );
      await step(
        "restore from Removed",
        ui(() => upd("jobs", "orchardline", { deleted: false, removedAt: null })),
      );
      await step(
        "to-do ticked",
        ui(() => upd("todos", "t2", { done: true, doneAt: nowIso() })),
      );
      await step(
        "to-do added",
        ui(() => put("todos", "t_new", { text: "A new to-do", group: "first", done: false, from: "you" })),
      );
      await step(
        "plan step ticked",
        ui(() => togglePlan("w2b", true)),
      );
      await p.evaluate(() => moveCard("jobs", "cobaltpeak", "offer"));
      await wait(p, 1500);
      await step("Undo of a move (Ctrl+Z)", async () => {
        await p.evaluate(() => document.activeElement && document.activeElement.blur());
        await p.keyboard.press("Control+z");
      });
      /* filing a folder (the page changes "folder" after the move): checked in the file log below */
      await p.evaluate(() => moveCard("jobs", "brightwell_search", "applied"));
      await wait(p, 2500);
      /* another tab's change, an assistant edit with and without a bump, a conflict */
      await Tb.evaluate(() => upd("jobs", "quillstone", { notes: "from tab B" }));
      await wait(p, 1500);
      await write(p, (d) => (d.jobs.orchardline = A(d.jobs.orchardline, { pay: "no bump" }, false)));
      await focus(p, 1500);
      await write(p, (d) => (d.jobs.harborlight = A(d.jobs.harborlight, { location: "bumped" })));
      await focus(p, 1500);
      await p.evaluate(() => {
        upd("jobs", "fernhill", { notes: "mine, unsaved" });
        clearTimeout(saveTimer);
      });
      await write(p, (d) => (d.jobs.fernhill = A(d.jobs.fernhill, { notes: "theirs" })));
      await focus(p, 1500);
      /* Restore a backup and its Undo */
      const daily = await p.evaluate(() =>
        (window.__ls("backups") || []).find((n) => /_\d{4}-\d{2}-\d{2}\.js$/.test(n)),
      );
      const dailyText = await p.evaluate((n) => window.__get("backups/" + n), daily);
      await step(
        "Restore a backup",
        ui((t) => restoreBackup(t, "test"), dailyText),
        true,
      );
      await step(
        "its Undo",
        ui(() => document.querySelector("#toastRoot button").click()),
        true,
      );
      for (const [label, n, bad] of results)
        ok(
          `V15 ${label}: ${n} field(s) changed, each with revs + 1 and dirty; no other revs moved`,
          n > 0 && !bad.length,
          bad.join(", "),
        );
      ok(
        "V15 after the writes nothing is left dirty",
        (await p.evaluate(() => Object.keys(dirtyF).length)) === 0,
        JSON.stringify(await p.evaluate(() => dirtyOut())),
      );
      /* the file log: across page writes, a field whose value changed has a higher number, and a number moves only
         with a change (or when a write by someone else in between touched that field) */
      const log = await p.evaluate(() => window.__log);
      const bad = [];
      let prevPage = null;
      const touched = new Set();
      for (let i = 0; i < log.length; i++) {
        const z = parseBoard(log[i][1]);
        if (log[i][0] === "other") {
          if (prevPage)
            for (const c of C)
              for (const id of Object.keys(z[c]))
                for (const f of fieldsOf2(prevPage[c][id], z[c][id]))
                  if (!same(prevPage[c][id]?.[f], z[c][id][f]) || rv(prevPage[c][id], f) !== rv(z[c][id], f))
                    touched.add(`${c}:${id}.${f}`);
          continue;
        }
        if (prevPage)
          for (const c of C)
            for (const id of Object.keys(z[c]))
              for (const f of fieldsOf2(prevPage[c][id], z[c][id])) {
                const a = prevPage[c][id],
                  ra = rv(a, f),
                  rz = rv(z[c][id], f);
                const ch = !same(a && a[f], z[c][id][f]);
                if (rz < ra) bad.push(`${i} ${c}:${id}.${f} down`);
                else if (ch && !(rz > ra)) bad.push(`${i} ${c}:${id}.${f} changed, same rev`);
                else if (!ch && rz !== ra && !touched.has(`${c}:${id}.${f}`))
                  bad.push(`${i} ${c}:${id}.${f} rev moved`);
              }
        prevPage = z;
        touched.clear();
      }
      const writes = log.filter((x) => x[0] === "page").length;
      const folderMoved = log.some(
        (x) => x[0] === "page" && parseBoard(x[1]).jobs.brightwell_search.folder.startsWith("2 - Applied/"),
      );
      ok(
        `V15 every page write raises the number of each field it changes, and no other (${writes} writes checked, filing included)`,
        writes >= 15 && folderMoved && !bad.length,
        bad.join(", "),
      );
      ok("V15 no errors", !p.errs.length && !Tb.errs.length, p.errs.concat(Tb.errs).join("|"));
      await ctx.close();
    }
    // ---- V16: two rounds with the same section title, then the first is removed: no box shows or overwrites the other
    //      round's answer (fresh keys; both old answers under "Saved answers from earlier versions")
    if (want("V16")) {
      const Q = "### Who would I report to? {.ask}";
      const SEC = `## Questions to ask them\n\n${Q}\n`;
      const { ctx, p } = await open({
        extra: { "Job notes/lumenfield/prep.md": `# L\n\n${SEC}\n## What you sent them\n\nx\n\n${SEC}` },
      });
      const boxes = () => p.$$eval("#drawerRoot details.mine.ask textarea", (t) => t.map((x) => x.value));
      const reopen = async () => {
        await p.keyboard.press("Escape");
        await wait(p, 100);
        await p.keyboard.press("Escape");
        await wait(p, 300);
        await p.evaluate(() => openDrawer("jobs", "lumenfield"));
        await wait(p, 1200);
      };
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 1200);
      const tas = p.locator("#drawerRoot details.mine.ask textarea");
      await tas.nth(0).fill("ROUND 1: Dana");
      await tas.nth(1).fill("ROUND 2: Lee");
      await wait(p, 1800);
      await p.keyboard.press("Escape");
      await wait(p, 100);
      await p.keyboard.press("Escape");
      await wait(p, 300);
      await p.evaluate(
        (t) => window.__put("Job notes/lumenfield/prep.md", t),
        `# L\n\n## What you sent them\n\nx\n\n${SEC}`,
      );
      await focus(p, 600);
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 1200);
      const bx = await boxes();
      const earlier = await p.$$eval("#p-earlier .hq.earlier", (d) => d.length);
      ok(
        "V16 after the first same-titled round is removed, the remaining box is empty",
        JSON.stringify(bx) === '[""]',
        JSON.stringify(bx),
      );
      ok("V16 and both earlier answers are under earlier versions", earlier === 2, String(earlier));
      await tas.nth(0).fill("ROUND 3: skip-level");
      await wait(p, 1800);
      const md = await p.evaluate(() => window.__get("Library/My_answers.md"));
      ok(
        "V16 typing there overwrites neither earlier answer",
        ["ROUND 1: Dana", "ROUND 2: Lee", "ROUND 3: skip-level"].every((x) => md.includes(x)),
        md.slice(-300),
      );
      await reopen();
      ok(
        "V16 the new answer stays in its box",
        JSON.stringify(await boxes()) === '["ROUND 3: skip-level"]',
        JSON.stringify(await boxes()),
      );
      ok("V16 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V17: another browser, or this one after its site data was cleared (advG CRITICAL-1, g10 and g11): the
    //      revisions are in the file, so a stale copy is kept out there too, with or without bumps
    if (want("V17")) {
      for (const bump of [true, false])
        for (const where of ["site data cleared", "another browser", "the same browser"]) {
          const ctx = await b.newContext();
          let p = await mkpage(ctx, { connect: true });
          await wait(p, 2000);
          const t0 = await raw(p);
          await p.evaluate(() => upd("jobs", "fernhill", { notes: "PERSON NOTE" }));
          await wait(p, 1500);
          const t1 = await raw(p);
          let ctx2 = null;
          if (where === "site data cleared") {
            await p.evaluate(() => localStorage.clear());
            await p.close();
            p = await mkpage(ctx, {
              text: t1,
              init:
                "if(!sessionStorage.getItem('c')){sessionStorage.setItem('c','1');localStorage.clear();}" +
                folderInit(t1),
            });
            await wait(p, 2000);
          } else if (where === "another browser") {
            ctx2 = await b.newContext();
            p = await mkpage(ctx2, { text: t1, init: folderInit(t1) });
            await wait(p, 2000);
          }
          const d = parseBoard(t0);
          d.jobs.fernhill = A(d.jobs.fernhill, { location: "Remote (assistant)" }, bump);
          await p.evaluate((t) => window.__put("board_data.js", t), textOf(t0, d));
          await focus(p, 1500);
          const f = (await disk(p)).jobs.fernhill;
          ok(
            `V17 (${where}, ${bump ? "bumped" : "no bump"}) the person's saved note stays, the assistant's location is taken, recorded`,
            f.notes === "PERSON NOTE" &&
              f.location === "Remote (assistant)" &&
              /1 field on 1 card/.test(await status(p)),
            JSON.stringify([f.notes, f.location, await status(p)]),
          );
          ok(`V17 (${where}, ${bump}) no errors`, !p.errs.length, p.errs.join("|"));
          if (ctx2) await ctx2.close();
          await ctx.close();
        }
      /* three saved changes; the stale copy re-stamps every record (old-style record rev + 1 everywhere) and adds its
         own edit; a second browser reads it, then the first browser reads what the second one wrote */
      const ctx = await b.newContext();
      const p1 = await mkpage(ctx, { connect: true });
      await wait(p1, 2000);
      const t0 = await raw(p1);
      await p1.evaluate(() => {
        upd("jobs", "fernhill", { notes: "PERSON NOTE" });
        moveCard("jobs", "harborlight", "screen");
        del("jobs", "orchardline");
      });
      await wait(p1, 1500);
      const t1 = await raw(p1);
      const d = parseBoard(t0);
      for (const c of C) for (const id of Object.keys(d[c])) d[c][id] = { ...A(d[c][id], {}, false), rev: 9 };
      d.jobs.quillstone = A(d.jobs.quillstone, { location: "Remote (assistant)" });
      const ctx2 = await b.newContext();
      const p2 = await mkpage(ctx2, { text: t1, init: folderInit(t1) });
      await wait(p2, 2000);
      await p2.evaluate((t) => window.__put("board_data.js", t), textOf(t0, d));
      await focus(p2, 1500);
      const pick = (j) => [j.fernhill.notes, j.harborlight.lane, !!j.orchardline.deleted, j.quillstone.location].join();
      const want2 = "PERSON NOTE,screen,true,Remote (assistant)";
      const f2 = pick((await disk(p2)).jobs);
      ok("V17 a second browser keeps the three saved changes and takes the assistant's edit", f2 === want2, f2);
      await p1.evaluate((t) => window.__put("board_data.js", t), await raw(p2));
      await focus(p1, 1500);
      const f1 = pick((await disk(p1)).jobs);
      ok(
        "V17 and the first browser reading that file agrees, without a spurious note",
        f1 === want2 && !/Kept your version/.test(await status(p1)),
        f1 + " | " + (await status(p1)),
      );
      ok("V17 two browsers no errors", !p1.errs.length && !p2.errs.length, p1.errs.concat(p2.errs).join("|"));
      await ctx2.close();
      await ctx.close();
    }
    // ---- V18: rev collisions from a stale read with bumps (advG g2 A–F), the person's change saved
    if (want("V18")) {
      const cases = {
        "A same field": [[["fernhill", { notes: "PERSON NOTE" }]], "fernhill", { notes: "ASSISTANT NOTE" }],
        "B other field": [[["fernhill", { notes: "PERSON NOTE" }]], "fernhill", { location: "Remote (asst)" }],
        "C two edits, other field": [
          [
            ["fernhill", { notes: "PERSON NOTE" }],
            ["fernhill", { pay: "PERSON PAY" }],
          ],
          "fernhill",
          { location: "Remote (asst)" },
        ],
        "D two turns": [
          [["fernhill", { notes: "PERSON NOTE" }]],
          "fernhill",
          [{ location: "Remote (asst)" }, { pay: "asst pay" }],
        ],
        "E drag vs call": [
          "drag",
          "harborlight",
          {
            callAt: "2026-11-02T10:00",
            callType: "Hiring manager",
            callWith: "Pat",
            lane: "interview",
            followUp: "2026-11-03",
          },
        ],
        "F cleared": [[["fernhill", { notes: "PERSON NOTE" }]], "fernhill", { notes: "" }],
      };
      const expect = {
        /* the same number on both sides and the person's change saved: the file's value (the later edit) wins */
        "A same field": (r) => r.notes === "ASSISTANT NOTE",
        "B other field": (r) => r.notes === "PERSON NOTE" && r.location === "Remote (asst)",
        "C two edits, other field": (r) =>
          r.notes === "PERSON NOTE" && r.pay === "PERSON PAY" && r.location === "Remote (asst)",
        "D two turns": (r) => r.notes === "PERSON NOTE" && r.location === "Remote (asst)" && r.pay === "asst pay",
        "E drag vs call": (r) => r.lane === "interview" && r.callWith === "Pat",
        "F cleared": (r) => r.notes === "",
      };
      for (const [name, [person, id, patch]] of Object.entries(cases)) {
        const ctx = await b.newContext();
        const p = await mkpage(ctx, { connect: true });
        await wait(p, 2000);
        const t0 = await raw(p);
        if (person === "drag") await p.evaluate(() => moveCard("jobs", "harborlight", "screen"));
        else for (const [i, pt] of person) await p.evaluate(([i, pt]) => upd("jobs", i, pt), [i, pt]);
        await wait(p, 1500);
        await write(
          p,
          (d) => {
            let r = d.jobs[id];
            for (const pt of [].concat(patch)) r = A(r, pt);
            d.jobs[id] = r;
          },
          t0,
        );
        await focus(p, 1500);
        const r = (await disk(p)).jobs[id];
        const st = await p.evaluate((i) => store.jobs[i], id);
        ok(
          `V18 ${name}: as the rule says (page and file agree)`,
          expect[name](r) && JSON.stringify(st.notes) === JSON.stringify(r.notes) && st.lane === r.lane,
          JSON.stringify({ notes: r.notes, pay: r.pay, location: r.location, lane: r.lane, revs: r.revs }),
        );
        ok(`V18 ${name} no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
    // ---- V19: odd revision values from a tool (advG LOW-2, advI LOW-1): text numbers count; a number that isn't a
    //      whole number from 0 to 2^52 is invalid (set aside, see V26), never capped; anything else is 0
    if (want("V19")) {
      const { ctx, p } = await open();
      const r = await p.evaluate(() =>
        [
          { location: "2" },
          { location: -1 },
          { location: null },
          { location: "abc" },
          { location: 2.5 },
          { location: 1e16 },
          "x",
          [1],
        ].map((v) => {
          const c = clean({ company: "X", revs: v });
          return JSON.stringify([c.revs || null, BADREVS.get(c) || null]);
        }),
      );
      ok(
        "V19 revs are cleaned: whole numbers kept, invalid numbers set aside (never capped), the rest ignored",
        r.join("|") ===
          '[{"location":2},null]|[null,{"location":-1}]|[null,null]|[null,null]|[null,{"location":2.5}]|[null,{"location":10000000000000000}]|[null,null]|[null,null]',
        r.join("|"),
      );
      await write(
        p,
        (d) =>
          (d.jobs.fernhill = {
            ...A(d.jobs.fernhill, { location: "Remote (asst)" }, false),
            revs: { location: "abc" },
          }),
      );
      await focus(p, 1500);
      ok(
        "V19 an edit with an unreadable revision counts as one without a bump: applied",
        (await disk(p)).jobs.fernhill.location === "Remote (asst)",
      );
      ok("V19 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V20: browser storage full while saving to the folder is on (advH HIGH-1): the stored copy that can't be
    //      replaced is removed, so its dirty fields never come back over later saved values; the status line says so
    if (want("V20")) {
      const FULL = `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) {
        if (localStorage.getItem("__full") === "1" && /:board$/.test(k)) throw new DOMException("full", "QuotaExceededError");
        return set.call(this, k, v); }; })();`;
      const ctx = await b.newContext();
      let p = await mkpage(ctx, { connect: true, init: FULL });
      await wait(p, 1500);
      /* the first edit is stored with its dirty flag; from then on browser storage takes nothing */
      await p.evaluate(() => {
        upd("jobs", "fernhill", { notes: "N1 (first edit)" });
        localStorage.setItem("__full", "1");
      });
      await wait(p, 1200);
      await p.evaluate(() => upd("jobs", "fernhill", { notes: "N2 (latest, saved)" }));
      await wait(p, 1200);
      const t = await raw(p);
      ok(
        "V20 with storage full the later edit is saved to the file",
        parseBoard(t).jobs.fernhill.notes === "N2 (latest, saved)",
      );
      ok(
        "V20 the out-of-date stored copy (with its dirty flag) is removed",
        (await p.evaluate(() => localStorage.getItem(lsKey("board")))) === null,
      );
      ok(
        "V20 the status line says the browser isn't keeping its copy, and that saving to the folder works",
        /can't keep its backup copy.*saving to your folder still works/.test(await status(p)),
        await status(p),
      );
      ok("V20 no errors", !p.errs.length, p.errs.join("|"));
      await p.close();
      p = await mkpage(ctx, { text: t, init: FULL + folderInit(t) });
      await wait(p, 2000);
      ok(
        "V20 reopened: the latest saved value stays (page and file)",
        (await p.evaluate(() => store.jobs.fernhill.notes)) === "N2 (latest, saved)" &&
          (await disk(p)).jobs.fernhill.notes === "N2 (latest, saved)",
      );
      ok("V20 reopened no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V21: once the file is written, its dirty fields are cleared in the stored copy before anything else can wait
    //      (advH HIGH-1): a page closed after that point, or a check of the file that fails, leaves no stale flag
    if (want("V21")) {
      const BREAK = `(() => { const MF = window.MemFS.MemFile, cw = MF.prototype.createWritable;
        MF.prototype.createWritable = async function () {
          const w = await cw.call(this), f = this, close = w.close;
          w.close = async () => {
            await close();
            if (!window.__breakAfterClose || f.name !== "board_data.js") return;
            window.__breakAfterClose = 0;
            const g = f.getFile;
            f.getFile = async () => {
              f.getFile = g;
              window.__storedAtNext = localStorage.getItem(lsKey("board"));
              throw new DOMException("gone", "NotReadableError");
            };
          };
          return w;
        }; })();`;
      const { ctx, p } = await open({ init: BREAK });
      await p.evaluate(() => {
        window.__breakAfterClose = 1;
        upd("jobs", "fernhill", { notes: "Written, then the page stops" });
      });
      await wait(p, 1500);
      const r = await p.evaluate(() => {
        const j = JSON.parse(window.__storedAtNext || "null");
        return {
          stored: !!j && j.jobs.fernhill.notes === "Written, then the page stops" && !(j._dirty || {})["jobs:fernhill"],
          dirty: !!dirtyF["jobs:fernhill"],
          err: saveErr,
        };
      });
      ok(
        "V21 the stored copy is clean before the page's next step after the write",
        r.stored && (await disk(p)).jobs.fernhill.notes === "Written, then the page stops",
        JSON.stringify(r),
      );
      ok(
        "V21 a check of the file that fails after a good write isn't a failed save",
        !r.dirty && !r.err,
        JSON.stringify(r),
      );
      ok("V21 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V22: a stored copy whose dirty flag is out of date (advH HIGH-1, h2): at load, a stored dirty field whose
    //      revision the file has reached (equal or higher) takes the file's value; only a higher revision wins
    if (want("V22")) {
      for (const [label, mine, theirs, keepMine] of [
        ["lower", 1, 2, false],
        ["equal", 2, 2, false],
        ["higher", 3, 2, true],
      ]) {
        const ctx = await b.newContext();
        try {
          const d = parseBoard(boardText);
          d.jobs.fernhill = { ...d.jobs.fernhill, notes: "SAVED IN THE FILE", revs: { notes: theirs } };
          const text = withText(d);
          fs.writeFileSync(path.join(TREE, "board_data.js"), text);
          const st = parseBoard(text);
          delete st.version;
          delete st.savedAt;
          st.jobs.fernhill = { ...st.jobs.fernhill, notes: "STORED, DIRTY", revs: { notes: mine } };
          st._dirty = { "jobs:fernhill": ["notes"] };
          const p0 = await mkpage(ctx, { text });
          const key = await p0.evaluate(() => lsKey("board"));
          await p0.close();
          const p = await mkpage(ctx, {
            text,
            init:
              `if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear();
              localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(st))}); }` +
              folderInit(text),
          });
          await wait(p, 2000);
          const want3 = keepMine ? "STORED, DIRTY" : "SAVED IN THE FILE";
          const f = (await disk(p)).jobs.fernhill;
          const s = await status(p);
          ok(
            `V22 (stored revision ${label}) ${keepMine ? "the unsynced change wins and is written" : "the file's saved value stays"} (page and file)`,
            (await p.evaluate(() => store.jobs.fernhill.notes)) === want3 &&
              f.notes === want3 &&
              (!keepMine || rv(f, "notes") === mine),
            JSON.stringify([f.notes, f.revs, s]),
          );
          ok(
            `V22 (${label}) the status line ${keepMine ? "records nothing" : "says the change was replaced and where it is kept"}`,
            keepMine
              ? !/Kept your version|replaced/.test(s)
              : /Your unsaved change to 1 field was replaced by the file's newer value .*your version is in backups\/board_data_browser_\d{4}-\d{2}-\d{2}_\d{4,6}\.js\./.test(
                  s,
                ) && !/Kept your version/.test(s),
            s,
          );
          if (!keepMine) {
            const names = await backups(p, "^board_data_browser_");
            const t = names.length ? await p.evaluate((n) => window.__get("backups/" + n), names[0]) : "";
            ok(
              `V22 (${label}) the replaced value is in the backup, which Restore a backup… can read`,
              names.length === 1 &&
                parseBoard(t).jobs.fernhill.notes === "STORED, DIRTY" &&
                (await p.evaluate((x) => !!backupInfo(x), t)),
              JSON.stringify(names),
            );
          }
          ok(
            `V22 (${label}) nothing left dirty`,
            await p.evaluate(
              () =>
                !Object.keys(dirtyF).length &&
                !JSON.parse(localStorage.getItem(lsKey("board")))._dirty["jobs:fernhill"],
            ),
          );
          ok(`V22 (${label}) no errors`, !p.errs.length, p.errs.join("|"));
        } finally {
          fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
        }
        await ctx.close();
      }
    }
    // ---- V23: a tool that writes a timestamp as a revision (advH MEDIUM-1): later edits still go one above it, so an
    //      older copy written back is kept out; the status line names what was taken too (advH LOW-1)
    if (want("V23")) {
      const { ctx, p } = await open();
      const R = Date.now();
      await write(
        p,
        (d) =>
          (d.jobs.fernhill = {
            ...A(d.jobs.fernhill, { notes: "assistant note" }, false),
            revs: { ...(d.jobs.fernhill.revs || {}), notes: R },
          }),
      );
      await focus(p, 1500);
      const t0 = await raw(p);
      await p.evaluate(() => upd("jobs", "fernhill", { notes: "PERSON NOTE (saved)" }));
      await wait(p, 1200);
      ok(
        "V23 the person's edit goes one above the timestamp revision",
        rv((await disk(p)).jobs.fernhill, "notes") === R + 1,
      );
      await p.evaluate(() => setNote(""));
      await write(
        p,
        (d) =>
          (d.jobs.fernhill = {
            ...A(d.jobs.fernhill, { location: "Remote (asst)" }, false),
            revs: { ...d.jobs.fernhill.revs, location: R + 1 },
          }),
        t0,
      );
      await focus(p, 1500);
      const f = (await disk(p)).jobs.fernhill;
      ok(
        "V23 an older copy written back keeps out of the saved note; its own edit is taken (page and file)",
        f.notes === "PERSON NOTE (saved)" &&
          f.location === "Remote (asst)" &&
          (await p.evaluate(() => store.jobs.fernhill.notes)) === "PERSON NOTE (saved)",
        JSON.stringify([f.notes, f.location, f.revs]),
      );
      const s = await status(p);
      ok(
        "V23 the status line names what was kept and what was taken",
        KEPT.test(s) && /Kept your version of 1 field on 1 card; took 1 change from the file;/.test(s),
        s,
      );
      ok("V23 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V24: browser storage full while saving to the folder FAILS (advI HIGH-1): a locked data file, or a broken
    //      one. The stored copy, the only copy of the changes made since saving failed, is never removed; the status line
    //      says the latest changes aren't kept anywhere and offers a download; after a crash the earlier change comes back
    if (want("V24")) {
      const FULL = `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) {
        if (localStorage.getItem("__full") === "1" && /:board$/.test(k)) throw new DOMException("full", "QuotaExceededError");
        return set.call(this, k, v); }; })();`;
      const LOCK = `(() => { const M = window.MemFS.MemFile.prototype, cw = M.createWritable;
        M.createWritable = async function () {
          if (window.__lock && this.name === "board_data.js") throw new DOMException("locked", "NoModificationAllowedError");
          return cw.call(this); }; })();`;
      for (const what of ["locked file", "broken file"]) {
        const ctx = await b.newContext();
        let p = await mkpage(ctx, { connect: true, init: FULL + LOCK });
        await wait(p, 1500);
        const good = await raw(p);
        if (what === "locked file") await p.evaluate(() => (window.__lock = true));
        else {
          await p.evaluate((t) => window.__put("board_data.js", t.slice(0, t.length - 40)), good);
          await focus(p, 300);
        }
        await p.evaluate(() => upd("jobs", "fernhill", { notes: "E1 typed while saving fails" }));
        await wait(p, 1200);
        const s1 = await status(p);
        ok(
          `V24 (${what}) saving fails; with browser storage working the change is kept there, and the line says so`,
          /Your changes are kept in this browser/.test(s1) && !/aren't being kept/.test(s1),
          s1,
        );
        await p.evaluate(() => localStorage.setItem("__full", "1"));
        await p.evaluate(() => upd("jobs", "fernhill", { location: "E2 typed when storage is full" }));
        await wait(p, 1200);
        const stored = await p.evaluate(() => {
          const j = JSON.parse(localStorage.getItem(lsKey("board")) || "null");
          return j && j.jobs.fernhill.notes;
        });
        ok(
          `V24 (${what}) storage full too: the stored copy (with the earlier change) is not removed`,
          stored === "E1 typed while saving fails",
          String(stored),
        );
        const s2 = await status(p);
        ok(
          `V24 (${what}) the status line says the latest changes aren't kept anywhere, and offers a download`,
          /can't keep a copy either.*aren't being kept anywhere/.test(s2) &&
            !/kept in this browser|safe in this browser/.test(s2) &&
            (await p.$$("#status button")).length === 2,
          s2,
        );
        const btn = await p.$("#status button.primary");
        const dl = btn
          ? (await Promise.all([p.waitForEvent("download", { timeout: 5000 }).catch(() => null), btn.click()]))[0]
          : null;
        const dtext = dl ? fs.readFileSync(await dl.path(), "utf8") : "";
        ok(
          `V24 (${what}) "Download a backup copy" saves the board with both changes`,
          !!dl &&
            /^board_data_backup_\d{4}-\d{2}-\d{2}\.js$/.test(dl.suggestedFilename()) &&
            parseBoard(dtext).jobs.fernhill.notes === "E1 typed while saving fails" &&
            parseBoard(dtext).jobs.fernhill.location === "E2 typed when storage is full",
          dl ? dl.suggestedFilename() : "no download",
        );
        ok(`V24 (${what}) no errors`, !p.errs.length, p.errs.join("|"));
        /* the tab ends without a deliberate close (a crash, a restart); the cause is fixed and the page reopened */
        await p.close();
        p = await mkpage(ctx, { text: good, init: 'localStorage.removeItem("__full");' + FULL + folderInit(good) });
        await wait(p, 2000);
        ok(
          `V24 (${what}) reopened: the change made while saving failed is back and written`,
          (await disk(p)).jobs.fernhill.notes === "E1 typed while saving fails",
          (await disk(p)).jobs.fernhill.notes,
        );
        ok(`V24 (${what}) reopened no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
    // ---- V25: a change made with saving off that another tool also changed in the file (advI MEDIUM-1): at the next
    //      load the file's newer value wins, but the person's value is kept (in this browser, then in
    //      backups/board_data_browser_….js) and the status line says so, with saving off too
    if (want("V25")) {
      const PERSON = "PERSON typed this with saving off";
      for (const mode of ["saving off", "folder connected"]) {
        const ctx = await b.newContext();
        let p = await mkpage(ctx, {});
        await wait(p, 800);
        const t0 = await raw(p);
        await p.evaluate((x) => upd("jobs", "fernhill", { notes: x }), PERSON);
        await wait(p, 500);
        await p.close();
        /* meanwhile an assistant appends to the same notes from a fresh read, bumping as AGENTS.md asks */
        const d = parseBoard(t0);
        d.jobs.fernhill = A(d.jobs.fernhill, { notes: d.jobs.fernhill.notes + "\nRecruiter call booked (assistant)" });
        const t = textOf(t0, d);
        p = await mkpage(ctx, { text: t, init: mode === "saving off" ? SCRIPT(t) : folderInit(t) });
        await wait(p, 1800);
        const kept = () => p.evaluate(() => localStorage.getItem(lsKey("dropped")));
        const browserBackups = async () => {
          const names = await backups(p, "^board_data_browser_\\d{4}-\\d{2}-\\d{2}_\\d{4,6}\\.js$");
          return Promise.all(names.map((n) => p.evaluate((x) => window.__get("backups/" + x), n)));
        };
        ok(
          `V25 (${mode}) the file's newer value is taken`,
          /Recruiter call booked/.test(await p.evaluate(() => store.jobs.fernhill.notes)),
        );
        let s = await status(p);
        if (mode === "saving off") {
          ok(
            "V25 (saving off) the note shows now, and the person's value is kept in this browser",
            /Your unsaved change to 1 field was replaced by the file's newer value.*kept in this browser and goes to backups\/ once saving to your folder is on/.test(
              s,
            ) && (await kept()).includes(PERSON),
            s,
          );
          await p
            .getByRole("button", { name: /Turn on saving/ })
            .first()
            .click();
          await wait(p, 1200);
          s = await status(p);
          const bk = await browserBackups();
          ok(
            "V25 (saving off) once saving is on, the kept value goes to backups/ and the line says so",
            bk.length === 1 &&
              bk[0].includes(PERSON) &&
              parseBoard(bk[0]).jobs.fernhill.notes === PERSON &&
              /(your version is|now) in backups\/board_data_browser_/.test(s) &&
              (await kept()) === null,
            s,
          );
        } else {
          const bk = await browserBackups();
          ok(
            "V25 (folder connected) the person's value is in backups/ and the note names the file",
            bk.length === 1 &&
              parseBoard(bk[0]).jobs.fernhill.notes === PERSON &&
              /Your unsaved change to 1 field was replaced.*your version is in backups\/board_data_browser_/.test(s) &&
              (await kept()) === null,
            s,
          );
        }
        const x = await p.$('#status button[aria-label="Dismiss this note"]');
        if (x) await x.click();
        ok(
          `V25 (${mode}) the note can be dismissed`,
          !!x && !/replaced|backups/.test(await status(p)),
          await status(p),
        );
        ok(`V25 (${mode}) no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
    // ---- V26: revisions that aren't whole numbers from 0 to 2^52 (advI LOW-1): read as a change to the field (this
    //      browser's revision + 1), never capped, so a saved edit after them still keeps out an older copy written back
    //      later, with a valid or with the same invalid revision
    if (want("V26")) {
      for (const R of [Number.MAX_SAFE_INTEGER, 2 ** 53, 2 ** 60, 1e300, "9007199254740993", 2.5, -3]) {
        const { ctx, p } = await open();
        const k = rv((await disk(p)).jobs.fernhill, "notes");
        await write(
          p,
          (d) =>
            (d.jobs.fernhill = {
              ...A(d.jobs.fernhill, { notes: "assistant note" }, false),
              revs: { ...(d.jobs.fernhill.revs || {}), notes: R },
            }),
        );
        const tA = await raw(p); // the assistant's file, with the invalid revision
        await focus(p, 1500);
        const f1 = (await disk(p)).jobs.fernhill;
        ok(
          `V26 (${JSON.stringify(R)}) taken as a change, written back with a whole revision`,
          f1.notes === "assistant note" && rv(f1, "notes") === k + 1,
          JSON.stringify(f1.revs),
        );
        const t0 = await raw(p);
        await p.evaluate(() => upd("jobs", "fernhill", { notes: "PERSON NOTE (saved)" }));
        await wait(p, 1200);
        await p.evaluate(() => setNote(""));
        /* an older copy written back, with its own (invalid) bump of another field */
        await write(
          p,
          (d) =>
            (d.jobs.fernhill = {
              ...A(d.jobs.fernhill, { location: "Remote (asst)" }, false),
              revs: { ...d.jobs.fernhill.revs, location: typeof R === "number" ? R + 1 : R },
            }),
          t0,
        );
        await focus(p, 1500);
        let f = (await disk(p)).jobs.fernhill;
        ok(
          `V26 (${JSON.stringify(R)}) an older copy written back keeps out of the saved note; its own edit is taken`,
          f.notes === "PERSON NOTE (saved)" && f.location === "Remote (asst)",
          JSON.stringify([f.notes, f.location, f.revs]),
        );
        /* the assistant's first file, with the same invalid revision, written back again */
        await p.evaluate((x) => window.__put("board_data.js", x), tA);
        await focus(p, 1500);
        f = (await disk(p)).jobs.fernhill;
        ok(
          `V26 (${JSON.stringify(R)}) the same invalid revision written back again doesn't win over the saved note`,
          f.notes === "PERSON NOTE (saved)" && Number.isSafeInteger(rv(f, "notes")),
          JSON.stringify([f.notes, f.revs]),
        );
        ok(`V26 (${JSON.stringify(R)}) no errors`, !p.errs.length, p.errs.join("|"));
        await ctx.close();
      }
    }
  } catch (e) {
    ok("revs suite ran without crashing", false, e.stack || String(e));
  } finally {
    if (b) await b.close();
    report();
  }
})();
