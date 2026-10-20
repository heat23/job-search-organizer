// Configurable lanes and call types, a focused field after a background merge, short answers in the Library search,
// loose company matching for headhunter contacts, the daily backup on a day without edits, résumé file checks, and
// tests for older behavior: the plan, Apply next, referrals, headhunter conflicts, two tabs, the removed-folder purge
// and the day rollover.
const { ok, wait, launch, mkpage, report, data, boardText, files } = require("./lib.js");

/* fire the focus handler, wait for its pass to finish (focusRun), then `ms` more for what it starts (a redraw, a save) */
const focus = async (p, ms = 1500) => {
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.evaluate(() => (typeof focusRun !== "undefined" && focusRun) || null);
  await wait(p, ms);
};
const openJob = async (p, id, sec = "jobs") => {
  await p.evaluate(([s, j]) => openDrawer(s, j), [sec, id]);
  await wait(p, 600);
};
const lane = (p, id, sec = "jobs") => p.evaluate(([s, j]) => laneKey(s, get(s, j)), [sec, id]);
/* book a call in the open prep sheet: type first, then the date (the date is what moves the card) */
async function book(p, id, type) {
  await openJob(p, id);
  await p.click("#drawerRoot .callbox > summary");
  const dt = new Date(Date.now() + 3 * 864e5);
  dt.setHours(10, 30, 0, 0);
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  await p.evaluate(
    ([t, v]) => {
      const s = document.querySelector("#drawerRoot .callrow select");
      s.value = t;
      s.dispatchEvent(new Event("change"));
      const w = document.querySelector("#drawerRoot .callrow input[type=datetime-local]");
      w.value = v;
      w.dispatchEvent(new Event("change"));
    },
    [type, local],
  );
  await wait(p, 600);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await wait(p, 200);
}
/* an assistant edits one record in board_data.js on disk (revs + 1 for each field it changes, changedBy assistant) */
async function assistantEdit(p, coll, id, patch) {
  await p.evaluate(
    ([c, i, pt]) => {
      return window.__get("board_data.js").then((t) => {
        const d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
        d[c][i] = {
          ...d[c][i],
          ...pt,
          revs: ((r, q) => {
            const v = { ...(r.revs || {}) };
            for (const k of Object.keys(q))
              if (JSON.stringify(r[k] ?? null) !== JSON.stringify(q[k] ?? null)) v[k] = (v[k] || 0) + 1;
            return v;
          })(d[c][i], pt),
          updatedAt: new Date(Date.now() + 2000).toISOString(),
          changedBy: "assistant",
        };
        window.__put("board_data.js", t.slice(0, t.indexOf("{")) + JSON.stringify(d, null, 1) + ";\n");
      });
    },
    [coll, id, patch],
  );
}
const cardTags = (p, id, sec = "jobs") =>
  p.$$eval(`[data-key="${sec}:${id}"] .tag`, (t) => t.map((x) => x.textContent));
const localDay = (iso, add) => {
  const d = new Date(iso + "T09:00:00");
  d.setDate(d.getDate() + (add || 0));
  return d;
};
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

(async () => {
  let b;
  try {
    b = await launch();
    // ---- C1: call types renamed in the settings, lane names renamed
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const config = {
        callTypes: [
          { label: "Intro call", moves: "screen" },
          { label: "Team interview", moves: "interview" },
          { label: "Coffee chat", moves: "none" },
          "Onsite loop",
        ],
        lanes: {
          jobs: [
            { id: "todo", name: "Wishlist" },
            { id: "applied", name: "Sent" },
            { id: "screen", name: "Phone screen" },
            { id: "interview", name: "Loop" },
            { id: "offer", name: "Offer" },
            { id: "closed", name: "Archive", color: "slate" },
          ],
        },
      };
      const p = await mkpage(ctx, { connect: true, config });
      await openJob(p, "lumenfield");
      const opts = await p.$$eval("#drawerRoot .callrow select option", (o) => o.map((x) => x.textContent));
      ok(
        "C1 the booking box lists the configured call type labels",
        opts.join("|") === "Call type…|Intro call|Team interview|Coffee chat|Onsite loop",
        opts.join("|"),
      );
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      await book(p, "lumenfield", "Intro call");
      let l = await lane(p, "lumenfield");
      ok("C1 booking a renamed screen type (moves: screen) moves Applied to the screen lane", l === "screen", l);
      ok(
        "C1 the stored callType is the label",
        (await p.evaluate(() => get("jobs", "lumenfield").callType)) === "Intro call",
      );
      await book(p, "tidewater", "Team interview");
      l = await lane(p, "tidewater");
      ok("C1 a renamed interview type (moves: interview) moves the screen lane to Interviewing", l === "interview", l);
      await book(p, "harborlight", "Coffee chat");
      l = await lane(p, "harborlight");
      ok("C1 moves: none books the call without moving the card", l === "applied", l);
      await book(p, "brightwell_web", "Onsite loop");
      l = await lane(p, "brightwell_web");
      ok("C1 a plain string call type still works (old rule: Onsite counts as an interview)", l === "interview", l);
      ok(
        "C1 a label from before the rename keeps its role",
        await p.evaluate(
          () =>
            callMoves("Hiring manager") === "interview" &&
            callMoves("Recruiter screen") === "screen" &&
            callMoves("Something else") === "screen",
        ),
      );
      await p.evaluate(() => {
        const t = new Date(Date.now() + 5 * 864e5);
        upd("jobs", "cobaltpeak", { callType: "Hiring manager", callAt: localDate(t) + "T14:00" });
      });
      await openJob(p, "cobaltpeak");
      ok(
        "C1 a call booked with a type no longer in the settings keeps it selected",
        (await p.$eval("#drawerRoot .callrow select", (s) => s.value)) === "Hiring manager",
      );
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      // lane names
      await p.click("#nav-jobs");
      await wait(p, 200);
      const names = await p.$$eval("section.lane", (s) => s.map((x) => x.getAttribute("aria-label")));
      ok(
        "C1 renamed lane names show on the board",
        names.join("|") === "Wishlist|Sent|Phone screen|Loop|Offer|Archive",
        names.join("|"),
      );
      await p.click('[data-key="jobs:quillstone"] [data-f="quick"]');
      await wait(p, 400);
      const q = await p.evaluate(() => get("jobs", "quillstone"));
      const toast = await p.$eval("#toastRoot", (t) => t.textContent);
      ok(
        "C1 Mark applied still moves to the applied lane, with its follow-up days kept from the default",
        q.lane === "applied" && q.followUp === (await p.evaluate(() => addDays(7))) && /→ Sent/.test(toast),
        q.lane + " " + q.followUp + " " + toast,
      );
      await p.click("#nav-next");
      await wait(p, 300);
      const harbor = await p.$eval('[data-key="due:jobs:harborlight"]', (r) => r.textContent).catch(() => "");
      ok("C1 follow-ups still come due under the renamed lane", /Sent/.test(harbor), harbor.slice(0, 120));
      const staleRow = p.locator('[data-key="due:jobs:marigold"], [data-key="due:jobs:brightwell_search"]');
      ok("C1 (closed and To-apply jobs never show as stale)", (await staleRow.count()) === 0);
      // brightwell_web is in Interviewing now; make harborlight stale-only and close it from Next up
      await p.evaluate(() =>
        upd("jobs", "harborlight", {
          followUp: addDays(3),
          callAt: "",
          movedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
        }),
      );
      await p.evaluate(() => render());
      const btn = p.locator('[data-key="due:jobs:harborlight"] button', { hasText: "Close as no reply" });
      ok("C1 a stale job still offers Close as no reply", (await btn.count()) === 1);
      if (await btn.count()) await btn.click();
      await wait(p, 300);
      const h = await p.evaluate(() => get("jobs", "harborlight"));
      ok(
        "C1 closing from Next up moves it to the closed lane with the reason",
        h.lane === "closed" && h.closedReason === "No reply",
        h.lane + " " + h.closedReason,
      );
      ok("C1 no errors or warnings", !p.errs.length && !p.warns.length, p.errs.concat(p.warns).join("|"));
      await ctx.close();
    }
    // ---- C2: settings that leave out lanes or give odd values don't break the page
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const config = {
        lanes: {
          jobs: [
            { id: "todo", name: "Wishlist" },
            { id: "applied", name: "Sent" },
            { id: "closed", name: "Done" },
          ],
          hunters: "oops",
        },
        callTypes: "Recruiter screen",
      };
      const p = await mkpage(ctx, { connect: true, config });
      await p.click("#nav-jobs");
      await wait(p, 200);
      const ids = await p.evaluate(() => SECTIONS.jobs.lanes.map((l) => l.id + ":" + l.name).join("|"));
      ok(
        "C2 missing job lanes are put back in their place with the default names",
        ids === "todo:Wishlist|applied:Sent|screen:Recruiter screen|interview:Interviewing|offer:Offer|closed:Done",
        ids,
      );
      ok(
        "C2 the closed lane keeps done: true from the default",
        await p.evaluate(() => laneOf("jobs", "closed").done === true),
      );
      ok(
        "C2 a job in a left-out lane still shows on the board",
        (await p.locator('[data-key="jobs:tidewater"]').count()) === 1,
      );
      ok(
        "C2 a lane list that isn't a list falls back to the defaults",
        (await p.evaluate(() => SECTIONS.hunters.lanes.length)) === 6,
      );
      ok(
        "C2 call types fall back to the defaults",
        (await p.evaluate(() => CALLTYPES.map((t) => t.label).join("|"))) ===
          "Recruiter screen|Hiring manager|Panel|Onsite|Headhunter call|Other",
      );
      ok(
        "C2 each problem is reported with a console warning",
        p.warns.some((w) => /missing the "screen" lane/.test(w)) &&
          p.warns.some((w) => /lanes\.hunters should be a list/.test(w)) &&
          p.warns.some((w) => /callTypes should be a list/.test(w)),
        p.warns.join(" | "),
      );
      await book(p, "harborlight", "Hiring manager");
      ok("C2 booking still moves the card", (await lane(p, "harborlight")) === "interview");
      ok("C2 no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- F: a focused field after another tool's change is merged in; Library search; headhunter contacts
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const extra = {
        "Library/1_Interviews/09_Quick_facts.md": "# Quick facts\n\n## Logistics\n\n### Notice period\n> Two weeks.\n",
      };
      const p = await mkpage(ctx, { connect: true, extra });
      await p.click("#nav-jobs");
      await openJob(p, "orchardline");
      await p.click("#f-notes");
      await wait(p, 100);
      await assistantEdit(p, "jobs", "orchardline", { notes: "Recruiter replied: hiring paused until spring." });
      await focus(p);
      const f1 = await p.evaluate(() => {
        const n = document.querySelector("#f-notes");
        return {
          v: n.value,
          focused: document.activeElement === n,
          caret: n.selectionStart === n.value.length && n.selectionEnd === n.value.length,
        };
      });
      ok(
        "F a focused field you haven't typed in takes the merged value, caret at the end",
        f1.v === "Recruiter replied: hiring paused until spring." && f1.focused && f1.caret,
        JSON.stringify(f1),
      );
      await p.keyboard.type(" Ask again in March.");
      await assistantEdit(p, "jobs", "orchardline", { notes: "ASSISTANT SECOND EDIT" });
      await focus(p, 300);
      const f2 = await p.$eval("#f-notes", (n) => n.value);
      ok(
        "F a field you are typing in keeps your text",
        f2 === "Recruiter replied: hiring paused until spring. Ask again in March.",
        f2,
      );
      await wait(p, 1500);
      ok(
        "F and your edit is saved over the other tool's",
        (await p.evaluate(() => get("jobs", "orchardline").notes)) === f2,
      );
      // typed, saved, still focused: the text you typed stays even when another change arrives
      await assistantEdit(p, "jobs", "orchardline", { notes: "ASSISTANT THIRD EDIT" });
      await focus(p, 400);
      ok(
        "F a field changed since you focused it is left alone after it saved",
        (await p.$eval("#f-notes", (n) => n.value)) === f2,
      );
      await p.keyboard.press("Escape");
      await wait(p, 200);
      // Library search: short answers are found, real answers still first
      await p.click("#nav-library");
      await wait(p, 800);
      await p.fill(".hlsearch", "notice period");
      await wait(p, 300);
      const hits = await p.$$eval("a.hit", (a) => a.map((x) => x.innerText.replace(/\n/g, " | ")));
      ok(
        "S a short answer (60 characters or less) is found by the Library search",
        hits.some((h) => /Notice period/.test(h) && /Two weeks/.test(h)),
        hits.join(" || ").slice(0, 200),
      );
      await p.fill(".hlsearch", "weakness");
      await wait(p, 300);
      const top = await p.evaluate(() => document.querySelector("a.hit").innerText);
      ok(
        "S a real answer still comes first",
        /Cheat sheet|Call scripts/.test(top) && top.length > 60,
        top.slice(0, 80),
      );
      await p.fill(".hlsearch", "");
      // headhunter contacts: company matched with different case, spacing, punctuation and & / and
      await p.evaluate(() => {
        put("people", "p_lena", { name: "Lena Ortiz", company: "  summit and VALE   partners. ", lane: "todo" });
        put("people", "p_cap", { name: "Sam Lee", company: "Summit & Vale Capital", lane: "todo" });
        upd("people", "p_jonah", { name: "jonah  WHITFIELD" });
      });
      await openJob(p, "h_summitvale", "hunters");
      const contacts = await p.$eval("#h-people", (s) => s.textContent);
      ok(
        "H contacts match the firm despite case, spacing, punctuation and “and” for “&”",
        /Your contacts here \(3\)/.test(contacts) && /Lena Ortiz/.test(contacts) && !/Sam Lee/.test(contacts),
        contacts.slice(0, 160),
      );
      ok(
        "H outreach messages match a contact whose name differs in case and spacing",
        /jonah {2}WHITFIELD/.test(contacts) && /Connection request/.test(contacts),
        contacts.slice(0, 300),
      );
      ok("F no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- D: résumé file checks
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-jobs");
      await wait(p, 500);
      const folder = data.jobs.lumenfield.folder;
      ok(
        "D with both PDFs in the folder the card shows ✓ Résumé + letter",
        (await cardTags(p, "lumenfield")).includes("✓ Résumé + letter"),
      );
      await p.evaluate((f) => window.__pick.at(f).kids.delete("Resume.pdf"), folder);
      await focus(p, 800);
      let tags = await cardTags(p, "lumenfield");
      ok("D a deleted résumé shows ✗ Résumé file missing", tags.includes("✗ Résumé file missing"), tags.join(","));
      await p.evaluate((f) => window.__pick.at(f).kids.delete("Cover_Letter.pdf"), folder);
      await focus(p, 800);
      tags = await cardTags(p, "lumenfield");
      ok("D both gone shows both missing", tags.includes("✗ Résumé and cover letter files missing"), tags.join(","));
      await p.evaluate((f) => {
        window.__put(f + "/Resume.pdf", "x");
        window.__put(f + "/Cover_Letter.pdf", "x");
      }, folder);
      await focus(p, 800);
      tags = await cardTags(p, "lumenfield");
      ok("D restoring the files brings back ✓", tags.includes("✓ Résumé + letter"), tags.join(","));
      await p.evaluate(() => window.__pick.at(get("jobs", "tidewater").folder).kids.delete("Cover_Letter.pdf"));
      await focus(p, 800);
      tags = await cardTags(p, "tidewater");
      ok("D a missing cover letter shows ✗ Cover letter file missing", tags.includes("✗ Cover letter file missing"));
      ok("D no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
      // without folder access (a fresh browser: no remembered folder), the tag reflects the fields as before, even
      // though the cover letter really is missing from the folder
      const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const fl = files();
      delete fl[data.jobs.tidewater.folder + "/Cover_Letter.pdf"];
      const p2 = await mkpage(ctx2, { files: fl });
      await p2.click("#nav-jobs");
      await wait(p2, 800);
      ok("D (the second page has no folder access)", (await p2.evaluate(() => !dirHandle && !fileChecks())) === true);
      ok(
        "D without saving on the tag is unchanged (fields only)",
        (await cardTags(p2, "tidewater")).includes("✓ Résumé + letter"),
      );
      await ctx2.close();
    }
    // ---- B: daily data backup on a day without edits, and the day rollover (fixed clock)
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const fu = data.jobs.lumenfield.followUp; // the next day is the follow-up day
      const day1 = localDay(fu, -1);
      const p = await mkpage(ctx, { clock: day1, init: "window.ORGANIZER_FOLDER = window.__pick;" });
      await wait(p, 800);
      const d1 = ymd(day1);
      const ls1 = (await p.evaluate(() => window.__ls("backups"))) || [];
      ok(
        "B at start-up, with saving on and no edits, today's data backup is taken",
        ls1.includes(`board_data_${d1}.js`),
        ls1.join(","),
      );
      ok(
        "B (nothing was saved: the data file is untouched)",
        (await p.evaluate(() => window.__get("board_data.js"))) === boardText,
      );
      await p.click("#nav-jobs");
      await wait(p, 200);
      let tags = await cardTags(p, "lumenfield");
      ok("B before the rollover the follow-up is tomorrow", !tags.includes("Follow up today"), tags.join(","));
      /* let the start-up pass (2.5 s after load) take day 1's backup first, so day 2's can only come from the rollover */
      await wait(p, 2500);
      ok(
        "B (the start-up pass has run, and no day-2 backup exists yet)",
        !((await p.evaluate(() => window.__ls("backups"))) || []).includes(`board_data_${fu}.js`) &&
          (await p.evaluate(() => startedUp)),
      );
      await p.clock.setSystemTime(localDay(fu, 0));
      await p.clock.fastForward(5 * 60 * 1000 + 1000);
      await wait(p, 600);
      tags = await cardTags(p, "lumenfield");
      ok("B the day rollover redraws the board (Follow up today)", tags.includes("Follow up today"), tags.join(","));
      const ls2 = (await p.evaluate(() => window.__ls("backups"))) || [];
      ok(
        "B the day rollover takes the new day's backup without an edit",
        ls2.includes(`board_data_${fu}.js`) && (await p.evaluate(() => window.__get("board_data.js"))) === boardText,
        ls2.join(","),
      );
      ok("B no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- P: the plan box, auto-ticking steps; star, Apply next, Mark applied; headhunter conflict; referrals
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await mkpage(ctx, { connect: true });
      await p.click("#nav-hunters");
      await wait(p, 200);
      await p.click("#planBox > summary");
      await wait(p, 100);
      const meter = () => p.$eval("#planBox .chev", (c) => c.textContent);
      ok("P the plan starts at 1 of 8 done", (await meter()) === "1 of 8 done", await meter());
      await p.click('label[for="plan-w1b"]');
      await wait(p, 300);
      ok(
        "P ticking a step saves it and updates the count",
        (await p.evaluate(() => !!get("plan", "w1b").done && !!get("plan", "w1b").doneAt)) &&
          (await meter()) === "2 of 8 done" &&
          (await p.$eval('label[for="plan-w1b"]', (l) => l.classList.contains("done"))),
      );
      await p.click('label[for="plan-w1b"]');
      await wait(p, 300);
      ok(
        "P unticking it clears it",
        (await p.evaluate(() => !get("plan", "w1b").done)) && (await meter()) === "1 of 8 done",
      );
      const auto = await p.$eval("#plan-w2a", (c) => ({
        dis: c.disabled,
        on: c.checked,
        hint: c.closest("label").textContent,
      }));
      ok(
        "P an auto step is disabled and says it ticks itself",
        auto.dis && !auto.on && /Ticks itself from the board/.test(auto.hint),
        JSON.stringify(auto),
      );
      await p.evaluate(() => moveCard("hunters", "h_ardent", "registered"));
      await wait(p, 300);
      ok(
        "P hunters_registered ticks once every tiered firm is past To register",
        await p.$eval("#plan-w2a", (c) => c.checked),
      );
      ok("P (the plan stays open across redraws)", await p.$eval("#planBox", (d) => d.open));
      await p.evaluate(() => {
        for (let i = 0; i < 5; i++) put("people", "p_extra" + i, { name: "Contact " + i, lane: "todo" });
        render();
      });
      await wait(p, 200);
      ok("P people10 ticks at ten people", await p.$eval("#plan-w3b", (c) => c.checked));
      ok("P the count includes auto steps", (await meter()) === "3 of 8 done", await meter());
      // star a job, find it in Apply next, mark it applied from there; it has a headhunter conflict
      await p.click("#nav-jobs");
      await wait(p, 200);
      let tags = await cardTags(p, "orchardline");
      ok(
        "K a To-apply job a headhunter submitted you for is tagged Submitted via <name>",
        tags.includes("Submitted via Mara Quint"),
        tags.join(","),
      );
      await p.click('[data-key="jobs:orchardline"] [data-f="pin"]');
      await wait(p, 300);
      ok(
        "A starring a job says it's in Apply next",
        /Orchardline starred: it's in Apply next on Next up/.test(await p.$eval("#toastRoot", (t) => t.textContent)),
      );
      await p.click("#nav-next");
      await wait(p, 200);
      const row = p.locator('[data-key="apply:orchardline"]');
      ok("A the starred job is listed under Apply next", (await row.count()) === 1);
      await row.locator("button", { hasText: "Mark applied" }).click();
      await wait(p, 300);
      const toast = await p.$eval("#toastRoot", (t) => t.textContent);
      ok("A Mark applied in Apply next moves it to Applied", (await lane(p, "orchardline")) === "applied");
      ok(
        "K Mark applied warns about the headhunter in the toast",
        /Heads up: Mara Quint submitted you at Orchardline/.test(toast),
        toast,
      );
      ok("A it leaves Apply next", (await p.locator('[data-key="apply:orchardline"]').count()) === 0);
      // referral: + Add a person… adds and links them
      await p.click("#nav-jobs");
      await openJob(p, "fernhill");
      await p.selectOption("#f-referral", "__new");
      await wait(p, 200);
      const pre = await p.evaluate(() => ({
        co: document.querySelector("#new-company").value,
        ask: document.querySelector("#new-ask").value,
      }));
      ok(
        "R + Add a person… opens the Add form prefilled for this job",
        pre.co === "Fernhill" && pre.ask === "Referral for Staff Software Engineer, Security",
        JSON.stringify(pre),
      );
      await p.fill("#new-name", "Riley Park");
      await p.click("#drawerRoot form button[type=submit]");
      await wait(p, 500);
      const pid = await p.evaluate(() => get("jobs", "fernhill").referralId);
      ok(
        "R the new person is linked as the referral",
        !!pid &&
          (await p.evaluate((i) => get("people", i).name, pid)) === "Riley Park" &&
          /Riley Park added and linked as your referral/.test(await p.$eval("#toastRoot", (t) => t.textContent)),
      );
      ok("R the job's panel shows the person selected", (await p.$eval("#f-referral", (s) => s.value)) === pid);
      await p.keyboard.press("Escape");
      await wait(p, 200);
      tags = await cardTags(p, "fernhill");
      ok("R the job card shows Referral: <name>", tags.includes("Referral: Riley Park"), tags.join(","));
      await p.click("#nav-people");
      await wait(p, 200);
      tags = await cardTags(p, pid, "people");
      ok("R the person's card shows Referring 1 job", tags.includes("Referring 1 job"), tags.join(","));
      await p.evaluate((i) => upd("jobs", "orchardline", { referralId: i }), pid);
      await p.evaluate(() => render());
      tags = await cardTags(p, pid, "people");
      ok("R and Referring 2 jobs with a second", tags.includes("Referring 2 jobs"), tags.join(","));
      ok("P no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
    // ---- T: two open tabs stay in step through the storage event
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const a = await mkpage(ctx, { connect: true });
      const c = await mkpage(ctx);
      await a.click("#nav-jobs");
      await c.click("#nav-jobs");
      await wait(a, 200);
      await a.click('[data-key="jobs:quillstone"] [data-f="quick"]');
      await wait(c, 700);
      ok(
        "T a move in one tab reaches the other tab's data",
        (await c.evaluate(() => laneKey("jobs", get("jobs", "quillstone")))) === "applied",
      );
      const inApplied = await c.evaluate(
        () => !!document.querySelector('section.lane[aria-label="Applied"] [data-key="jobs:quillstone"]'),
      );
      ok("T and its board is redrawn", inApplied);
      ok("T no errors", !a.errs.length && !c.errs.length, a.errs.concat(c.errs).join("|"));
      await ctx.close();
    }
    // ---- X: a removed job's folder is deleted 30 days after removal (fixed clock)
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const start = new Date("2026-11-03T10:00:00");
      const p = await mkpage(ctx, { connect: true, clock: start });
      const name = data.jobs.brightwell_search.folder.split("/").pop();
      await p.evaluate(() => {
        del("jobs", "brightwell_search");
        render();
      });
      await wait(p, 1500);
      const f1 = await p.evaluate(() => store.jobs.brightwell_search.folder);
      ok(
        "X a removed job's folder moves to 4 - Removed",
        f1 === "4 - Removed/" + name && (await p.evaluate(() => window.__ls("4 - Removed"))).includes(name),
        f1,
      );
      await p.clock.setSystemTime(new Date(start.getTime() + 29 * 864e5));
      await p.evaluate(() => fileJobs());
      await wait(p, 400);
      ok(
        "X after 29 days it is still there",
        (await p.evaluate(() => window.__ls("4 - Removed"))).includes(name) &&
          (await p.evaluate(() => store.jobs.brightwell_search.folder)) === f1,
      );
      await p.clock.setSystemTime(new Date(start.getTime() + 31 * 864e5));
      await p.evaluate(() => fileJobs());
      await wait(p, 1200);
      const r = await p.evaluate(() => store.jobs.brightwell_search);
      ok(
        "X after 30 days the folder is deleted, folder cleared and filesDeletedAt set",
        !(await p.evaluate(() => window.__ls("4 - Removed"))).includes(name) &&
          r.folder === null &&
          !!r.filesDeletedAt &&
          r.deleted === true,
        JSON.stringify({ folder: r.folder, filesDeletedAt: r.filesDeletedAt }),
      );
      const saved = await p.evaluate(() => window.__get("board_data.js"));
      ok("X the cleared folder is saved to the data file", /"filesDeletedAt"/.test(saved));
      ok("X no errors", !p.errs.length, p.errs.join("|"));
      await ctx.close();
    }
  } catch (e) {
    ok("round2 suite ran without crashing", false, e.stack || String(e));
  } finally {
    if (b) await b.close();
    report();
  }
})();
