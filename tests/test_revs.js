// The merge protocol: revision counters. Every record has `rev`; whoever changes a record sets rev = old rev + 1, and the
// page keeps each record's base (the record as the file held it at the last read or write). A file record with a higher
// rev than its base is a real edit (merged field by field; a field both sides changed keeps the person's value). Any
// lower rev (an older copy written back) or a record missing from the file keeps the
// person's version, saves the file's version to backups/ and says so in the status line; a record with the base's rev
// but other fields is an edit made on the current file without a new rev, and is applied (except fields you changed).
// Clocks play no part.
// The scenarios come from the adversarial reviews (stale write-backs, re-stamped whole files, A→B→A toggles, clock skew,
// conflicts, unbumped edits, two tabs, storage full or cleared, Restore and Undo with folders, migration).
//   ONLY=V1,V5 node tests/test_revs.js   runs only those blocks (SAMPLE_TREE must be set, see run.mjs)
const fs = require("fs");
const path = require("path");
const { ok, wait, launch, mkpage, report, boardText, parseBoard, data, TREE } = require("./lib.js");

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
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
/* An assistant writes the file: `mutate(d)` changes what it read (the file now, or `t0`, a copy it read earlier). */
async function write(p, mutate, t0) {
  const t = t0 || (await raw(p));
  const d = parseBoard(t);
  mutate(d);
  await p.evaluate((x) => window.__put("board_data.js", x), textOf(t, d));
}
/* an assistant's change to record r: rev + 1 as AGENTS.md asks (bump false: without it), stamped with `at` */
const A = (r, patch, bump = true, at = new Date().toISOString()) => ({
  ...r,
  ...patch,
  ...(bump ? { rev: (r.rev || 0) + 1 } : {}),
  updatedAt: at,
  changedBy: "assistant",
});
const withText = (d) => textOf(boardText, d);
const KEPT =
  /Kept your version of (\d+) cards?; the file's version is saved in backups\/board_data_kept_\d{4}-\d{2}-\d{2}_\d{4,6}\.js\./;

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
    // ---- V1: an older copy written back never undoes what you saved, however it is stamped
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
        /* it writes back what it read, with its own change to quillstone (rev + 1) and, in the same stale copy, a change
           to harborlight (rev + 1 from what it read: no higher than the person's) */
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
          `V1 (${variant}) the assistant's edit to another card is taken`,
          st.quillstone.location === "Remote (assistant)" && dk.quillstone.location === "Remote (assistant)",
        );
        /* with notes typed, that copy has the same rev as your save (Remove and Restore also file the folder, so a higher
           one): its own new field is taken, its older values are not */
        if (variant === "notes typed")
          ok(
            "V1 (notes typed) the copy's new field on the same card is taken, its older values are not",
            st.harborlight.pay === "Stale copy's pay" && dk.harborlight.pay === "Stale copy's pay",
          );
        if (variant === "notes typed") {
          const s = await status(p);
          ok("V1 the status line says so and names the backup", KEPT.test(s) && /of 1 card;/.test(s), s);
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
      /* whole-file rewrites of an older read: every record re-stamped with revs kept, or rev + 1 on every record */
      for (const how of ["every record re-stamped, revs kept", "rev + 1 on every record"]) {
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
            for (const c of ["jobs", "hunters", "people", "todos", "plan"])
              for (const id of Object.keys(d[c])) d[c][id] = A(d[c][id], {}, how.startsWith("rev"));
            d.jobs.quillstone.location = "Remote (assistant)";
            if (!how.startsWith("rev")) d.jobs.quillstone.rev++;
          },
          t0,
        );
        await focus(p, 1500);
        const pick = (j) => [j.fernhill.notes, j.harborlight.lane, !!j.orchardline.deleted, j.quillstone.location];
        const want1 = JSON.stringify(["PERSON NOTE", "screen", true, "Remote (assistant)"]);
        const st = pick(await p.evaluate(() => store.jobs)),
          dk = pick((await disk(p)).jobs);
        ok(
          `V1 a whole older copy with ${how}: your three saved edits stay and its own edit is taken (page and file)`,
          JSON.stringify(st) === want1 && JSON.stringify(dk) === want1,
          JSON.stringify({ st, dk }),
        );
        ok(`V1 (${how}) recorded`, /Kept your version of 3 cards/.test(await status(p)), await status(p));
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
    // ---- V3: an assistant that bumps rev can set a field back to an earlier value, again and again
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
    // ---- V5: you and the assistant change the same field: yours is kept, recorded; other fields merge
    if (want("V5")) {
      const { ctx, p } = await open();
      await p.evaluate(() => {
        upd("jobs", "fernhill", { notes: "Mine" });
        upd("jobs", "orchardline", { notes: "Mine too" });
        clearTimeout(saveTimer);
      });
      await write(p, (d) => {
        d.jobs.fernhill = A(d.jobs.fernhill, { notes: "Theirs", location: "Austin (assistant)" });
        d.jobs.orchardline = A(d.jobs.orchardline, { pay: "$190k (assistant)" });
      });
      await focus(p, 1500);
      const f = await p.evaluate(() => store.jobs.fernhill),
        o = await p.evaluate(() => store.jobs.orchardline);
      const fd = (await disk(p)).jobs.fernhill;
      ok(
        "V5 the field you both changed keeps your value; the assistant's other field is taken (page and file)",
        f.notes === "Mine" &&
          f.location === "Austin (assistant)" &&
          fd.notes === "Mine" &&
          fd.location === "Austin (assistant)",
        JSON.stringify([f.notes, f.location, fd.notes, fd.location]),
      );
      ok(
        "V5 different fields of one card: both kept",
        o.notes === "Mine too" && o.pay === "$190k (assistant)",
        JSON.stringify([o.notes, o.pay]),
      );
      const s = await status(p);
      const kb = await backups(p, "^board_data_kept_");
      const kt = kb.length ? await p.evaluate((n) => window.__get("backups/" + n), kb[0]) : "";
      ok(
        "V5 the conflict is recorded (status line, the file's version in backups/)",
        KEPT.test(s) && /of 1 card;/.test(s) && kt.includes('"Theirs"'),
        s,
      );
      ok("V5 the written rev is above the assistant's", fd.rev > data.jobs.fernhill.rev + 1, String(fd.rev));
      ok("V5 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- V6: an edit without a new rev: applied when made on the current file (except fields you changed, recorded),
    //      never when it is an older copy
    if (want("V6")) {
      const { ctx, p } = await open();
      const rev0 = (await disk(p)).jobs.orchardline.rev;
      await write(p, (d) => (d.jobs.orchardline = A(d.jobs.orchardline, { pay: "$190k (no rev)" }, false)));
      await focus(p, 1500);
      const dk = (await disk(p)).jobs.orchardline;
      ok(
        "V6 an assistant edit on the current file without a new rev is applied, and written back with rev + 1",
        (await p.evaluate(() => store.jobs.orchardline.pay)) === "$190k (no rev)" &&
          dk.pay === "$190k (no rev)" &&
          dk.rev === rev0 + 1,
        JSON.stringify([dk.pay, dk.rev, rev0]),
      );
      ok("V6 and nothing is recorded", !/Kept your version/.test(await status(p)), await status(p));
      /* you changed notes (not written yet); the assistant changes notes and pay without a new rev */
      await p.evaluate(() => {
        upd("jobs", "fernhill", { notes: "Mine, unsaved" });
        clearTimeout(saveTimer);
      });
      await write(
        p,
        (d) => (d.jobs.fernhill = A(d.jobs.fernhill, { notes: "Theirs (no rev)", pay: "$180k (no rev)" }, false)),
      );
      await focus(p, 1500);
      const f = (await disk(p)).jobs.fernhill;
      ok(
        "V6 without a new rev, a field you changed keeps your value and the other field is taken",
        f.notes === "Mine, unsaved" && f.pay === "$180k (no rev)",
        JSON.stringify([f.notes, f.pay]),
      );
      ok("V6 that conflict is recorded", KEPT.test(await status(p)), await status(p));
      /* an older copy written back without new revs, after your saved edit: not applied */
      const t0 = await raw(p);
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "Saved after the read" }));
      await wait(p, 1200);
      await write(p, (d) => (d.jobs.quillstone = A(d.jobs.quillstone, { location: "From the older copy" }, false)), t0);
      await focus(p, 1500);
      const dk2 = (await disk(p)).jobs;
      ok(
        "V6 an older copy without new revs never undoes your saved edit (its edit on an untouched card is applied)",
        dk2.harborlight.notes === "Saved after the read" && dk2.quillstone.location === "From the older copy",
        JSON.stringify([dk2.harborlight.notes, dk2.quillstone.location]),
      );
      /* a stamp-only rewrite (updatedAt and changedBy only, same revs) is quietly ignored: nothing to keep */
      await p.evaluate(() => setNote(""));
      await write(p, (d) => (d.jobs.lumenfield = A(d.jobs.lumenfield, {}, false)));
      await focus(p, 1200);
      ok(
        "V6 a record only re-stamped (same rev, same fields) records nothing",
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
          JSON.stringify([qa, qb, qd].map((q) => [q.notes, q.location, q.rev])),
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
          const C = await mkpage(ctx, { text: f1, init: "window.ORGANIZER_FOLDER = window.__pick;" });
          await wait(C, 2000);
          const r = await C.evaluate(() => [
            store.jobs.quillstone.location,
            store.jobs.quillstone.notes,
            store.jobs.harborlight.notes,
          ]);
          const dk = (await disk(C)).jobs;
          ok(
            "V7 after a reload with the folder, all three changes are in the page and the file",
            r.join("|") === "Remote (assistant)|typed in tab A|typed in tab B" &&
              dk.quillstone.notes === "typed in tab A" &&
              dk.harborlight.notes === "typed in tab B" &&
              dk.quillstone.location === "Remote (assistant)",
            r.join("|"),
          );
          ok("V7 reload no errors", !C.errs.length, C.errs.join("|"));
        } finally {
          fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
        }
        await ctx.close();
      }
    }
    // ---- V8: browser storage full: the bases stay in memory with a one-time note; after a reload without them, a
    //      card that differs keeps the copy with the higher rev (the file's when equal, this browser's copy saved)
    if (want("V8")) {
      const { ctx, p } = await open({
        init: `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) {
          if (window.__full && String(v).includes('"_base"')) throw new DOMException("full", "QuotaExceededError");
          return set.call(this, k, v); }; })();`,
      });
      const t0 = await raw(p);
      await p.evaluate(() => (window.__full = 1));
      await p.evaluate(() => upd("jobs", "harborlight", { notes: "Storage is full" }));
      await wait(p, 1200);
      const ls = await p.evaluate(() => JSON.parse(localStorage.getItem(lsKey("board"))));
      ok(
        "V8 the status line says the bases are kept in memory",
        /Browser storage is full/.test(await status(p)),
        await status(p),
      );
      ok(
        "V8 the copy is kept without its bases and the edit is saved to the file",
        ls.jobs.harborlight.notes === "Storage is full" &&
          !ls._base &&
          (await disk(p)).jobs.harborlight.notes === "Storage is full",
      );
      await write(p, () => {}, t0);
      await focus(p, 1500);
      ok(
        "V8 the bases in memory still keep an older copy out",
        (await disk(p)).jobs.harborlight.notes === "Storage is full",
      );
      ok("V8 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      /* a copy stored without bases, then a reload */
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const p1 = await mkpage(ctx2, {});
        await p1.evaluate(() => {
          persistLocal = () => true; // so closing this page doesn't store its own copy again
          const st = JSON.parse(localStorage.getItem(lsKey("board")));
          delete st._base;
          const q = st.jobs.quillstone,
            f = st.jobs.fernhill;
          st.jobs.quillstone = { ...q, notes: "Unsynced, rev higher", rev: q.rev + 1 };
          st.jobs.fernhill = { ...f, notes: "Unsynced, same rev" };
          localStorage.setItem(lsKey("board"), JSON.stringify(st));
        });
        await p1.close();
        const d = parseBoard(boardText);
        d.jobs.harborlight = A(d.jobs.harborlight, { location: "Remote (assistant)" });
        const text = withText(d);
        fs.writeFileSync(path.join(TREE, "board_data.js"), text);
        const p2 = await mkpage(ctx2, { text, init: "window.ORGANIZER_FOLDER = window.__pick;" });
        await wait(p2, 2500);
        const st = await p2.evaluate(() => [
          store.jobs.quillstone.notes,
          store.jobs.fernhill.notes,
          store.jobs.harborlight.location,
        ]);
        const dk = (await disk(p2)).jobs;
        ok(
          "V8 without bases: your change with the higher rev stays, the file's newer edit is taken, an equal rev takes the file's",
          st[0] === "Unsynced, rev higher" &&
            st[1] === data.jobs.fernhill.notes &&
            st[2] === "Remote (assistant)" &&
            dk.quillstone.notes === "Unsynced, rev higher" &&
            dk.harborlight.location === "Remote (assistant)",
          JSON.stringify(st),
        );
        const bb = await backups(p2, "^board_data_browser_");
        const bt = bb.length ? await p2.evaluate((n) => window.__get("backups/" + n), bb[0]) : "";
        ok(
          "V8 this browser's version of the cards that took the file's is saved in backups/ and the status line says so",
          bt.includes("Unsynced, same rev") && /Took the file's version of 2 cards/.test(await status(p2)),
          await status(p2),
        );
        ok("V8 reload no errors", !p2.errs.length, p2.errs.join("|"));
      } finally {
        fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
      }
      await ctx2.close();
    }
    // ---- V9: browser storage cleared while the page is open
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
          "V9 after a clear, the bases in memory still keep an older copy out and take a real edit",
          dk.harborlight.notes === "Saved before the clear" && dk.quillstone.location === "Remote (assistant)",
          JSON.stringify([dk.harborlight.notes, dk.quillstone.location]),
        );
        ok(
          "V9 and the copy with its bases is back in browser storage",
          await p.evaluate(() => {
            const j = JSON.parse(localStorage.getItem(lsKey("board")) || "{}");
            return !!j._base && j.jobs.harborlight.notes === "Saved before the clear";
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
          "V9 a change waiting in this browser is stored again when the page is hidden",
          await p.evaluate(() => (localStorage.getItem(lsKey("board")) || "").includes("ONLY IN THIS BROWSER")),
        );
        await ctx.close();
      }
      {
        /* a reload with browser storage empty: the file is the base, nothing on disk is reverted or rewritten */
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
    // ---- V10: Restore a backup… and its Undo: revs, and every job folder filed by its restored stage
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
      });
      await wait(p, 2000);
      const moved = await where("Brightwell Labs - Senior Software Engineer, Search");
      const revBefore = await p.evaluate(() => store.jobs.brightwell_search.rev);
      await p.evaluate(() => openRestore());
      await wait(p, 1200);
      const row = p.locator(".drawer.restore .rrow", { hasText: /board_data_\d{4}-\d{2}-\d{2}\.js/ }).first();
      await row.getByRole("button", { name: "Restore…" }).click();
      await row.getByRole("button", { name: "Restore", exact: true }).click();
      await wait(p, 3000);
      const bs = await p.evaluate(() => store.jobs.brightwell_search);
      const dk = (await disk(p)).jobs;
      ok(
        "V10 the restored records get the next rev (page and file)",
        bs.lane === "todo" &&
          bs.rev === revBefore + 1 &&
          dk.brightwell_search.rev === revBefore + 1 &&
          dk.newco.deleted === true,
        JSON.stringify([bs.lane, bs.rev, revBefore, dk.newco.deleted]),
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
      await p.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(p, 3000);
      ok(
        "V10 Undo puts the cards and both folders back",
        (await p.evaluate(() => [store.jobs.brightwell_search.lane, !!store.jobs.newco.deleted].join())) ===
          "applied,false" &&
          (await where("Brightwell Labs - Senior Software Engineer, Search")).join() === "2 - Applied" &&
          (await where("NewCo - Eng")).join() === "1 - To apply",
        JSON.stringify([await where("Brightwell Labs - Senior Software Engineer, Search"), await where("NewCo - Eng")]),
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
    // ---- V12: migration: data and a browser copy from before revisions
    if (want("V12")) {
      const old = parseBoard(boardText);
      for (const c of ["jobs", "hunters", "people", "todos", "plan"])
        for (const r of Object.values(old[c])) delete r.rev;
      const oldText = textOf(boardText, old);
      for (const variant of ["in sync", "the old copy differs"]) {
        const ctx = await b.newContext();
        try {
          const p1 = await mkpage(ctx, {});
          await p1.evaluate(
            ([o, v]) => {
              persistLocal = () => true;
              const st = JSON.parse(JSON.stringify(o));
              delete st.version;
              delete st.savedAt;
              if (v !== "in sync") st.jobs.fernhill.notes = "Unsynced in the old version";
              st._hist = { "jobs:fernhill": 1 };
              st._ft = {};
              localStorage.setItem(lsKey("board"), JSON.stringify(st));
            },
            [old, variant],
          );
          await p1.close();
          fs.writeFileSync(path.join(TREE, "board_data.js"), oldText);
          const p = await mkpage(ctx, { text: oldText, init: "window.ORGANIZER_FOLDER = window.__pick;" });
          await wait(p, 2500);
          if (variant === "in sync") {
            ok("V12 old data in sync: nothing is written at load", (await raw(p)) === oldText);
            ok(
              "V12 the bases are stored from the first read",
              await p.evaluate(() => !!JSON.parse(localStorage.getItem(lsKey("board")))._base && basesKnown),
            );
            await p.evaluate(() => upd("jobs", "harborlight", { notes: "First edit" }));
            await wait(p, 1200);
            const dk = (await disk(p)).jobs;
            ok(
              "V12 the first edit writes rev 1 for that card and rev 0 for the rest",
              dk.harborlight.rev === 1 && dk.harborlight.notes === "First edit" && dk.fernhill.rev === 0,
              JSON.stringify([dk.harborlight.rev, dk.fernhill.rev]),
            );
          } else {
            const bb = await backups(p, "^board_data_browser_");
            ok(
              "V12 an old copy that differs from the file: the file's is taken and the old copy is saved in backups/",
              (await p.evaluate(() => store.jobs.fernhill.notes)) === data.jobs.fernhill.notes &&
                bb.length === 1 &&
                (await p.evaluate((n) => window.__get("backups/" + n), bb[0])).includes("Unsynced in the old version"),
            );
          }
          ok(`V12 ${variant} no errors`, !p.errs.length, p.errs.join("|"));
        } finally {
          fs.writeFileSync(path.join(TREE, "board_data.js"), boardText);
        }
        await ctx.close();
      }
    }
    // ---- V13: a record deleted from the file by hand is kept; the same new id on both sides keeps yours
    if (want("V13")) {
      const { ctx, p } = await open();
      await write(p, (d) => delete d.jobs.orchardline);
      await focus(p, 1500);
      ok(
        "V13 a card removed from the file outright is kept and written back, and that is recorded",
        !!(await p.evaluate(() => get("jobs", "orchardline"))) &&
          !!(await disk(p)).jobs.orchardline &&
          /Kept your version of 1 card/.test(await status(p)),
      );
      await p.evaluate(() => {
        canWrite = false;
        put("jobs", "dup_id", { company: "Mine", role: "Eng", lane: "todo" });
      });
      await write(
        p,
        (d) => (d.jobs.dup_id = { company: "Theirs", role: "Eng", lane: "todo", rev: 1, changedBy: "assistant" }),
      );
      await p.evaluate(() => {
        canWrite = true;
        writeFile();
      });
      await wait(p, 1500);
      const dk = (await disk(p)).jobs.dup_id;
      ok(
        "V13 the same new id on both sides keeps yours, with a rev above the file's",
        (await p.evaluate(() => store.jobs.dup_id.company)) === "Mine" && dk.company === "Mine" && dk.rev === 2,
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
          orig(src);
          if (!window.__once) return;
          window.__once = false;
          window.__get("board_data.js").then((t) => {
            const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
            const q = d.jobs.quillstone;
            d.jobs.quillstone = { ...q, location: "ASSISTANT during restore", rev: q.rev + 1, changedBy: "assistant" };
            window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
          });
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
      /* the restored card keeps the restore. quillstone: that copy raised the rev it read, so it has the same rev as the
         write made during the restore and counts as an edit on the current file (two assistant writes: the later wins) */
      ok(
        "V14 an older copy written back after the restore doesn't undo the restore",
        dk2.fernhill.notes === data.jobs.fernhill.notes && dk2.quillstone.location === "STALE ASSISTANT",
        JSON.stringify([dk2.fernhill.notes, dk2.quillstone.location]),
      );
      ok("V14 no errors", !Ta.errs.length && !Tb.errs.length, Ta.errs.concat(Tb.errs).join("|"));
      await ctx.close();
    }
    // ---- V15: every change the page writes raises rev (edits, filing a folder, another tab's change, Restore, Undo,
    //      an edit taken without a new rev), so an older copy always has a lower rev than the base
    if (want("V15")) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const LOG = `(() => { const M = window.MemFS.MemFile.prototype, cw = M.createWritable;
        window.__log = [];
        M.createWritable = async function () { const w = await cw.call(this);
          if (this.name === "board_data.js") { const wr = w.write; w.write = async (x) => { if (typeof x === "string") window.__log.push(["page", x]); return wr.call(w, x); }; }
          return w; };
        const put = window.__put; window.__put = (q, t) => { if (q === "board_data.js") window.__log.push(["other", t]); return put(q, t); }; })();`;
      const Ta = await mkpage(ctx, { connect: true, init: LOG });
      await wait(Ta, 1500);
      const Tb = await mkpage(ctx, {});
      await wait(Tb, 600);
      await Ta.evaluate(() => upd("jobs", "fernhill", { notes: "an edit" }));
      await wait(Ta, 1200);
      await Ta.evaluate(() => moveCard("jobs", "brightwell_search", "applied")); // files its folder: folder changes too
      await wait(Ta, 2000);
      await Tb.evaluate(() => upd("jobs", "quillstone", { notes: "from tab B" }));
      await wait(Ta, 1500);
      await write(Ta, (d) => (d.jobs.orchardline = A(d.jobs.orchardline, { pay: "no rev" }, false)));
      await focus(Ta, 1500);
      await Ta.evaluate(() => openRestore());
      await wait(Ta, 1200);
      const row = Ta.locator(".drawer.restore .rrow", { hasText: /board_data_\d{4}-\d{2}-\d{2}\.js/ }).first();
      await row.getByRole("button", { name: "Restore…" }).click();
      await row.getByRole("button", { name: "Restore", exact: true }).click();
      await wait(Ta, 3000);
      await Ta.locator("#toastRoot button", { hasText: "Undo" }).click();
      await wait(Ta, 3000);
      const log = await Ta.evaluate(() => window.__log);
      const bad = [];
      const C = ["jobs", "hunters", "people", "todos", "plan"];
      const body = (r) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(r)
              .filter(([k]) => !["rev", "updatedAt", "changedBy"].includes(k))
              .sort(),
          ),
        );
      for (let i = 1; i < log.length; i++) {
        if (log[i][0] !== "page") continue;
        const a = parseBoard(log[i - 1][1]),
          z = parseBoard(log[i][1]);
        for (const c of C)
          for (const [id, r] of Object.entries(z[c])) {
            const o = a[c][id];
            if (o && body(o) !== body(r) && !(r.rev > o.rev)) bad.push(`${i} ${c}:${id} ${o.rev}->${r.rev}`);
            if (o && r.rev < o.rev) bad.push(`${i} ${c}:${id} went down ${o.rev}->${r.rev}`);
          }
      }
      const writes = log.filter((x) => x[0] === "page").length;
      ok(
        `V15 every record a page write changed has a higher rev (${writes} writes checked)`,
        writes >= 6 && !bad.length,
        bad.join(", "),
      );
      ok("V15 no errors", !Ta.errs.length && !Tb.errs.length, Ta.errs.concat(Tb.errs).join("|"));
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
  } catch (e) {
    ok("revs suite ran without crashing", false, e.stack || String(e));
  } finally {
    if (b) await b.close();
    report();
  }
})();
