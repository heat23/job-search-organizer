/* ================= the prep sheet =================
   A job in play (Applied through Offer, with a call booked, or marked sheet: true) and an active headhunter open in a
   wide panel: talking points on the left, your notes pad on the right, the call and stage in the header.
   It is built from the plain card panel that openDrawer made: the same fields are moved, not copied. */
const sheetOverride = {},
  scrollMem = {};
let libOpenInSheet = null,
  sheetTid = null,
  callBoxOpen = false,
  hdrOpen = false;
let cuesOnly = lsGet("cues", "") === "1";
const PILL_LABELS = CONFIG.library.pillLabels.map(([re, to]) => [new RegExp(re), to]);
const SHORT = (t) => {
  for (const [re, to] of PILL_LABELS) if (re.test(t)) return t.replace(re, to);
  return t;
};
/* The outreach guide: one "## Name, Firm" block per contact with **Connection request** and **Follow-up message** quotes.
   Keyed by the loosely compared name (normName), so "## jonah  whitfield, …" still finds Jonah Whitfield. */
function parseOutreach(md) {
  const out = {};
  for (const blk of String(md).split(/^## /m).slice(1)) {
    const name = blk.split("\n")[0].split(",")[0].trim();
    const req = (blk.match(/\*\*Connection request\*\*[^\n]*\n\n((?:>.*\n?)+)/) || [])[1];
    const msg = (blk.match(/\*\*Follow-up message\*\*[^\n]*\n\n((?:>.*\n?)+)/) || [])[1];
    out[normName(name)] = {
      req: req ? req.replace(/^>\s?/gm, "").trim() : "",
      msg: msg ? msg.replace(/^>\s?/gm, "").trim() : "",
    };
  }
  return out;
}
function hunterSections(id, x) {
  const L = CONFIG.library;
  const nav = [];
  let h = "";
  /* people whose company is this headhunter's name or firm, compared loosely (see normName) */
  const names = [x.name, x.firm].map(normName).filter(Boolean);
  const ppl = Object.entries(live("people")).filter(
    ([, p]) => normName(p.company) && names.includes(normName(p.company)),
  );
  const OD = DOCS[L.outreachDoc] && DOCS[L.outreachDoc].md ? parseOutreach(DOCS[L.outreachDoc].md) : {};
  const script = L.hunterScript
    ? sectionHtml(L.hunterScript.doc, new RegExp(L.hunterScript.heading, "i"), "h-script")
    : "";
  if (script) {
    h += script;
    nav.push(["h-script", "Call script"]);
  }
  h += `<section class="hs" id="h-people" data-title="Contacts"><h3 class="hs-h"><span>Your contacts here (${ppl.length})</span></h3>`;
  if (!ppl.length)
    h += `<p class="muted">No people on the board for this firm yet. Add them on the People tab with this firm as their company.</p>`;
  for (const [, p] of ppl) {
    const m = OD[normName(p.name)] || {};
    const ln = laneOf("people", laneKey("people", p)).name;
    h += `<div class="hq"><h4><span>${p.url && /^https?:/.test(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)} ↗</a>` : esc(p.name)}</span><span class="muted" style="font-weight:400;font-size:13px">${esc(ln)}${p.followUp ? " · follow up " + esc(fmtDate(p.followUp)) : ""}</span></h4>`;
    if (m.req)
      h += `<p class="muted" style="margin:2px 0">Connection request</p><blockquote class="say"><p>${inline(m.req)}</p></blockquote>`;
    if (m.msg)
      h += `<details class="fold"><summary>Follow-up message</summary><blockquote class="say">${blocks(m.msg.split("\n"))}</blockquote></details>`;
    h += `</div>`;
  }
  h += `</section>`;
  nav.push(["h-people", "Contacts"]);
  h += `<section class="hs" id="h-how" data-title="Firm page and sign-up"><h3 class="hs-h"><span>Firm page and sign-up: ${esc(x.name || "them")}</span></h3>${x.notes ? `<p>${inline(String(x.notes).split("\n")[0])}</p>` : ""}${x.submittedTo ? `<p><b>Submitted you for:</b> ${esc(x.submittedTo)}</p>` : ""}${safeUrl(x.firmUrl) ? `<p><a href="${esc(safeUrl(x.firmUrl))}" target="_blank" rel="noopener noreferrer">Firm page ↗</a></p>` : ""}</section>`;
  nav.push(["h-how", "Firm page"]);
  const play = L.hunterPlaybook
    ? sectionHtml(L.hunterPlaybook.doc, new RegExp(L.hunterPlaybook.heading, "i"), "h-play")
    : "";
  if (play) {
    h += play;
    nav.push(["h-play", "Playbook"]);
  }
  return { html: h, nav };
}
/* Answers saved for this job whose question is no longer on the sheet (the assistant reworded or removed it): listed,
   folded, at the end of the sheet, to copy or remove. `keys` are the answer boxes the sheet has now. */
function earlierAnswers(id, keys) {
  const pre = "prep:" + id + "::";
  const have = new Set(keys);
  return Object.entries(MY)
    .filter(([k, v]) => k.startsWith(pre) && !have.has(k) && v && v.trim())
    .sort((a, b) => a[0].localeCompare(b[0]));
}
function earlierHtml(id, keys) {
  const list = earlierAnswers(id, keys);
  if (!list.length) return "";
  const pre = "prep:" + id + "::";
  return `<section class="hs earlier" id="p-earlier" data-title="Saved answers from earlier versions"><details class="fold"><summary>Saved answers from earlier versions (${list.length})</summary><p class="muted">Answers you typed for questions that are no longer on this sheet (the question or its round was reworded or removed), and older answers the page can't place in one round for sure. They stay in Library › My_answers.md until you remove them.</p>${list
    .map(
      ([k, v]) =>
        `<div class="hq earlier" data-ek="${esc(k)}"><h4><span>${esc(k.slice(pre.length))}</span></h4><blockquote class="say"><p>${esc(v.trim()).replace(/\n/g, "<br>")}</p></blockquote><div class="eacts"><button type="button" class="btn small erm">Remove</button></div></div>`,
    )
    .join("")}</details></section>`;
}
function leaveField(node) {
  try {
    node.blur();
  } catch (e) {}
  const w = $q("#drawerRoot .drawer.prep .pleftwrap");
  if (w) {
    w.focus({ preventScroll: true });
  } else {
    const d = $q("#drawerRoot .drawer");
    if (d) d.focus({ preventScroll: true });
  }
}
function enhance(sec, d, id, x, keep) {
  const ln = laneKey(sec, x);
  const hasPrep = sec === "jobs" && validPrep(PREPTXT[id]);
  const done = !!laneOf(sec, ln).done;
  const active = sec === "jobs" ? ACTIVE_LANES.includes(ln) : sec === "hunters" && !done;
  /* sheet: true (set by the assistant) opens a job in any other lane straight to its prep sheet, once prep.md exists.
     A booked call opens the sheet too, except on a closed card (Open prep sheet still does). */
  const useSheet =
    active || (callLive(x) && !done) || (sec === "jobs" && (sheetOverride[id] || (x.sheet === true && hasPrep)));
  if (!useSheet) {
    if (hasPrep) {
      const btn = el("button", {
        class: "btn small primary",
        type: "button",
        text: "Open prep sheet",
        onclick: () => {
          sheetOverride[id] = true;
          openDrawer(sec, id, true);
        },
      });
      const db = $q(".docbtns", d);
      if (db) db.after(btn);
    }
    return;
  }
  d.classList.add("prep");
  if (!keep) {
    scrollMem[id] = 0;
    libOpenInSheet = null;
    callBoxOpen = false;
    hdrOpen = false;
  }
  const kids = [...d.children];
  const closeBtn = kids.find((n) => n.classList && n.classList.contains("close"));
  const titleDiv = $q("#dTitle", d) && $q("#dTitle", d).parentElement;
  const docbtns = $q(".docbtns", d);
  const stage = $q("#lanepick", d) && $q("#lanepick", d).closest(".field");
  const conflict = $q(".tag.warn", d);
  const dates = kids.find((n) => n.classList && n.classList.contains("two") && n.querySelector("#f-followUp"));
  const oldNotes = $q("#f-notes", d) && $q("#f-notes", d).closest(".field");
  const rest = kids.filter((n) => ![closeBtn, titleDiv, docbtns, stage, conflict, dates, oldNotes].includes(n));
  const isJob = sec === "jobs";
  /* header: title + call line always; stage, call booking and files fold into one row on narrow windows */
  const head = document.createElement("header");
  head.className = "ph";
  const strip = document.createElement("div");
  strip.className = "pstrip";
  strip.innerHTML = stripHtml(x);
  if (closeBtn) head.append(closeBtn);
  if (titleDiv) {
    titleDiv.classList.add("ptitle");
    head.append(titleDiv);
  }
  head.append(strip);
  const more = document.createElement("details");
  more.className = "hdrmore";
  more.open = window.matchMedia("(min-width:901px)").matches || hdrOpen;
  more.addEventListener("toggle", () => {
    if (window.matchMedia("(max-width:900px)").matches) hdrOpen = more.open;
  });
  const msum = document.createElement("summary");
  msum.textContent = "Stage, call, files";
  more.append(msum);
  const cb = document.createElement("details");
  cb.className = "callbox";
  cb.open = callBoxOpen;
  const csum = document.createElement("summary");
  csum.textContent = x.callAt ? "Edit the call" : "Book a call";
  cb.append(csum);
  cb.addEventListener("toggle", () => {
    callBoxOpen = cb.open;
  });
  cb.append(callRow(sec, id, x, strip, csum));
  const row = document.createElement("div");
  row.className = "prow";
  if (stage) {
    stage.classList.add("pstage");
    row.append(stage);
  }
  if (dates) {
    dates.classList.add("pnext");
    row.append(dates);
  }
  if (docbtns) row.append(docbtns);
  more.append(cb, row);
  head.append(more);
  if (conflict) head.append(conflict);
  const pills = document.createElement("div");
  pills.className = "pills";
  const left = document.createElement("div");
  left.className = "pleft";
  const bar = document.createElement("div");
  bar.className = "prepbar";
  bar.hidden = true;
  bar.innerHTML =
    '<span>This prep sheet changed on disk.</span> <button type="button" class="btn small primary">Reload it</button>';
  let nav = [],
    sheetKeys = [];
  /* redraw only the "Saved answers from earlier versions" section (after a removal, or answers read from the file) */
  function refreshEarlier() {
    if (!isJob) return;
    const cur = $q("#p-earlier", left);
    const wasOpen = !!(cur && $q("details.fold", cur) && $q("details.fold", cur).open);
    const html = earlierHtml(id, sheetKeys);
    if (cur) cur.remove();
    if (!html) return;
    left.insertAdjacentHTML("beforeend", html);
    const sec = $q("#p-earlier", left);
    if (wasOpen) $q("details.fold", sec).open = true;
    wireCopy(left);
  }
  function build() {
    const jd = isJob ? JOBDOCS[id] || {} : {};
    let lh = "";
    nav = [];
    /* answer boxes: ✎ questions get "My version", {.ask} questions "Their answer" (Library › My_answers.md, "prep:<id>::…") */
    if (isJob && validPrep(PREPTXT[id])) myMigrate();
    const dd =
      isJob && validPrep(PREPTXT[id])
        ? renderDoc(PREPTXT[id], "p-" + String(id).replace(/[^\w-]/g, "_"), { mineKey: "prep:" + id, ask: true })
        : null;
    if (isJob) {
      if (dd) {
        let body = dd.html;
        nav = dd.nav.map((n) => [n.id, n.title]);
        /* front matter "asks: a | b | c" becomes a numbered list after the first section */
        if (dd.fm.asks) {
          const asks = `<section class="hs asks" id="p-asks" data-title="What they're asking for"><h3 class="hs-h"><span>What they're asking for</span></h3><ol>${dd.fm.asks
            .split("|")
            .map((a) => `<li>${inline(a.trim())}</li>`)
            .join("")}</ol></section>`;
          const k = body.indexOf("</section>");
          body = k >= 0 ? body.slice(0, k + 10) + asks + body.slice(k + 10) : asks + body;
          nav.splice(nav.length ? 1 : 0, 0, ["p-asks", "What they're asking for"]);
        }
        lh += body;
      } else
        lh += `<section class="hs empty"><h3 class="hs-h"><span>No prep sheet yet</span></h3><p>Write one in <b>Job notes › ${esc(id)} › prep.md</b>: any Markdown with <b>## sections</b> (see the sample board). It shows up here as soon as the file exists. Until then the buttons above open your call scripts and cheat sheet.</p></section>`;
      if (jd.outreach) {
        lh += `<section class="hs" id="p-outreach" data-title="Outreach note and screening answers"><h3 class="hs-h"><span>Outreach note and screening answers</span></h3><details class="fold"><summary>Open the hiring-manager note, connection request and drafted form answers</summary>${plain(jd.outreach)}</details></section>`;
        nav.push(["p-outreach", "Outreach note and screening answers"]);
      }
      if (jd.posting) {
        lh += `<section class="hs" id="p-posting" data-title="Posting"><h3 class="hs-h"><span>The posting</span></h3><details class="fold"><summary>Open the saved posting</summary>${plain(jd.posting)}</details></section>`;
        nav.push(["p-posting", "Posting"]);
      }
      sheetKeys = dd ? dd.keys : [];
      if (dd) lh += earlierHtml(id, sheetKeys);
    } else {
      const hs = hunterSections(id, x);
      lh += hs.html;
      nav = hs.nav;
    }
    left.innerHTML = lh;
    left.prepend(bar);
    wireCopy(left);
    wireMine(left);
    left.classList.toggle("cuesonly", cuesOnly);
    const buttons = CONFIG.library.sheetButtons.filter((b) => DOCS[b.doc]);
    pills.innerHTML =
      nav
        .map(
          (n, i) =>
            `<a href="#${n[0]}"${i < 9 ? ` data-k="${i + 1}"` : ""}>${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}${esc(SHORT(n[1]))}</a>`,
        )
        .join("") +
      `<span class="psep"></span>` +
      buttons
        .map(
          (b) =>
            `<button type="button" class="plib" data-doc="${esc(b.doc)}">${b.key ? `<kbd>${esc(b.key.toUpperCase())}</kbd>` : ""}${esc(b.label)}</button>`,
        )
        .join("") +
      `<button type="button" class="pcues${cuesOnly ? " on" : ""}" title="Hide the full answers so only the cue lines show; click a question to show its answer">Hide answers</button>` +
      `<input type="search" class="pfilter" placeholder="Filter  ( / )" aria-label="Filter this sheet">`;
    const f = $q(".pfilter", pills);
    f.addEventListener("input", () => filterSheet(f.value));
    f.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        f.value = "";
        filterSheet("");
        leaveField(f);
      }
    });
    $qa(".plib", pills).forEach((b) => b.classList.toggle("on", b.dataset.doc === libOpenInSheet));
  }
  /* notes pad */
  const right = document.createElement("div");
  right.className = "pright";
  const cardNotes = x.notes && String(x.notes).trim() ? String(x.notes).trim() : "";
  const rh = document.createElement("div");
  rh.className = "prh";
  rh.innerHTML = `<b>My notes</b><span class="muted">${esc(x.company || x.name || "")}</span><button type="button" class="btn small padline">+ Dated line</button><button type="button" class="btn small pnewcall">+ New call</button>${cardNotes ? '<button type="button" class="btn small padcard" title="Copy the notes on the card into this pad">+ Card notes</button>' : ""}`;
  right.append(rh);
  const notePath = isJob ? `Job notes/${id}/my_notes.md` : `Job notes/hunters/${id}/my_notes.md`;
  const pad = makePad({ key: sec + ":" + id, path: notePath, seed: "" });
  right.append(pad.el);
  const where = document.createElement("div");
  where.className = "pwhere";
  where.textContent = "Saves to " + notePath.replace(/\//g, " › ");
  right.append(where);
  const cmore = document.createElement("details");
  cmore.className = "cardmore";
  cmore.innerHTML = "<summary>Card details: referral, edit, remove</summary>";
  for (const n of rest) cmore.append(n);
  const libPane = document.createElement("div");
  libPane.className = "plibpane";
  libPane.hidden = true;
  const leftWrap = document.createElement("div");
  leftWrap.className = "pleftwrap";
  leftWrap.tabIndex = 0;
  leftWrap.setAttribute("aria-label", "Talking points");
  leftWrap.append(libPane, left, cmore);
  const grid = document.createElement("div");
  grid.className = "pgrid";
  grid.append(leftWrap, right);
  build();
  head.append(pills);
  d.textContent = "";
  d.append(head, grid);
  const scrollTo = (t) => {
    leftWrap.scrollTo({
      top: leftWrap.scrollTop + t.getBoundingClientRect().top - leftWrap.getBoundingClientRect().top - 8,
      behavior: "smooth",
    });
  };
  function filterSheet(v) {
    const t = v.trim().toLowerCase();
    const scope = libPane.hidden ? left : libPane;
    $qa(".hs", scope).forEach((s) => {
      const qs = $qa(".hq", s);
      let any = false;
      qs.forEach((q) => {
        const hit = !t || q.textContent.toLowerCase().includes(t);
        q.hidden = !hit;
        if (hit) any = true;
      });
      const selfHit =
        !t ||
        (s.dataset.title || "").toLowerCase().includes(t) ||
        (!qs.length && s.textContent.toLowerCase().includes(t));
      if (selfHit && t) qs.forEach((q) => (q.hidden = false));
      s.hidden = !(selfHit || any);
    });
  }
  /* A guide opened inside the sheet, with a Back button, so the notes pad stays in view */
  function showLib(docId) {
    libOpenInSheet = docId;
    $qa(".plib", pills).forEach((b) => b.classList.toggle("on", b.dataset.doc === docId));
    if (!docId) {
      libPane.hidden = true;
      left.hidden = false;
      return;
    }
    const D = DOCS[docId];
    if (!D) return;
    const r = renderDoc(D.md || "", "l-" + docId, { mineKey: docId, splitBold: D.splitBold });
    libPane.innerHTML =
      `<div class="plibbar"><button type="button" class="btn small pback">← Back to ${esc(x.company || x.name || "this")} prep</button><span class="muted">${esc(D.title)} (from the Prep library)</span></div>` +
      r.html;
    wireCopy(libPane);
    wireMine(libPane);
    $q(".pback", libPane).onclick = () => showLib(null);
    libPane.hidden = false;
    left.hidden = true;
    leftWrap.scrollTop = 0;
  }
  pills.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#']");
    if (a) {
      e.preventDefault();
      showLib(null);
      const t = left.querySelector("#" + cssId(a.getAttribute("href").slice(1)));
      if (t) {
        scrollTo(t);
        t.classList.add("flash");
        setTimeout(() => t.classList.remove("flash"), 900);
      }
      if (e.detail > 0) pad.ta.focus({ preventScroll: true });
      return;
    }
    const c = e.target.closest(".pcues");
    if (c) {
      cuesOnly = !cuesOnly;
      lsSet("cues", cuesOnly ? "1" : "0");
      c.classList.toggle("on", cuesOnly);
      left.classList.toggle("cuesonly", cuesOnly);
      $qa(".hq.open", left).forEach((q) => q.classList.remove("open"));
      return;
    }
    const b = e.target.closest(".plib");
    if (b) {
      showLib(libOpenInSheet === b.dataset.doc ? null : b.dataset.doc);
      if (e.detail > 0) pad.ta.focus({ preventScroll: true });
    }
  });
  left.addEventListener("click", (e) => {
    /* Remove a saved answer from an earlier version of the sheet, after a confirm */
    const row = e.target.closest(".hq.earlier");
    if (row && e.target.closest(".eacts button")) {
      const acts = $q(".eacts", row);
      const b = e.target.closest(".eacts button");
      if (b.classList.contains("erm")) {
        acts.innerHTML =
          '<span>Remove this answer from My_answers.md?</span> <button type="button" class="btn small erm-yes">Remove</button> <button type="button" class="btn small erm-no">Keep</button>';
      } else if (b.classList.contains("erm-no")) {
        acts.innerHTML = '<button type="button" class="btn small erm">Remove</button>';
      } else if (b.classList.contains("erm-yes")) {
        mySet(row.dataset.ek, "");
        refreshEarlier();
      }
      return;
    }
    const hh = e.target.closest(".hq h4");
    if (hh && cuesOnly && !e.target.closest(".hcopy") && !e.target.closest("a"))
      hh.parentElement.classList.toggle("open");
  });
  leftWrap.addEventListener(
    "click",
    (e) => {
      if (e.target.closest(".hcopy")) setTimeout(() => pad.ta.focus({ preventScroll: true }), 0);
    },
    true,
  );
  $q(".padline", rh).onclick = () => pad.addLine();
  const pc = $q(".padcard", rh);
  if (pc) pc.onclick = () => pad.insert("── Notes from the card ──\n" + cardNotes + "\n\n");
  $q(".pnewcall", rh).onclick = () => {
    const cur = get(sec, id) || x;
    const when = cur.callAt
      ? fmtCall(cur.callAt)
      : new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    pad.insert(
      `── ${when} · ${cur.callType || "Call"} · with: ${cur.callWith || ""}\nThey asked:\n- \nWhere I stumbled:\n- \nTeam, reporting line, pay range:\n- \nNext step and date:\n- \n\n`,
    );
  };
  leftWrap.addEventListener(
    "scroll",
    () => {
      scrollMem[id] = leftWrap.scrollTop;
    },
    { passive: true },
  );
  if (keep && scrollMem[id]) leftWrap.scrollTop = scrollMem[id];
  if (libOpenInSheet) showLib(libOpenInSheet);
  /* the cursor goes to the notes pad, so what you type first is never lost */
  if (focusWithNext) {
    focusWithNext = false;
    const w = $q(".callrow input[type=text]", d);
    if (w) w.focus({ preventScroll: true });
    else pad.ta.focus({ preventScroll: true });
  } else pad.ta.focus({ preventScroll: true });
  /* prep changed on disk? adopt it on the first read; after that offer a reload instead of swapping text under you */
  {
    let pendingText = null;
    const rebuild = () => {
      const keepY = leftWrap.scrollTop;
      /* an answer box you are typing in keeps the cursor (its text is already saved) */
      const a = document.activeElement;
      const box =
        a && a.matches("details.mine textarea") && left.contains(a) ? a.closest("details.mine").dataset.k : null;
      const caret = box ? a.selectionStart : 0;
      build();
      leftWrap.scrollTop = keepY;
      if (libOpenInSheet) showLib(libOpenInSheet);
      const again = box && $qa("details.mine", left).find((n) => n.dataset.k === box);
      if (again) {
        const ta = again.querySelector("textarea");
        again.open = true;
        ta.focus({ preventScroll: true });
        try {
          ta.setSelectionRange(caret, caret);
        } catch (e) {}
      }
    };
    refreshDocs().then((ch) => {
      if (ch && d.isConnected) rebuild();
    });
    /* answers read from My_answers.md after the sheet opened can belong in "Saved answers from earlier versions" */
    const onAnswers = () => {
      if (!d.isConnected) document.removeEventListener("jso-answers", onAnswers);
      else refreshEarlier();
    };
    document.addEventListener("jso-answers", onAnswers);
    if (isJob) {
      bar.querySelector("button").onclick = () => {
        PREPTXT[id] = pendingText;
        pendingText = null;
        bar.hidden = true;
        rebuild();
      };
      const check = async () => {
        if (!d.isConnected || !FS.ok()) return;
        let ch = false;
        const r = await FS.read(`Job notes/${id}/prep.md`);
        if (r && validPrep(r.text)) {
          if (r.text !== PREPTXT[id]) {
            if (!fileSeen[id]) {
              fileSeen[id] = true;
              PREPTXT[id] = r.text;
              ch = true;
            } else {
              pendingText = r.text;
              bar.hidden = false;
            }
          } else fileSeen[id] = true;
        }
        for (const nm of ["outreach", "posting"]) {
          const r2 = await FS.read(`Job notes/${id}/${nm}.md`);
          if (r2 && r2.text !== (JOBDOCS[id] || {})[nm]) {
            (JOBDOCS[id] = JOBDOCS[id] || {})[nm] = r2.text;
            ch = true;
          }
        }
        if (ch && d.isConnected) rebuild();
      };
      if (sheetTid) clearInterval(sheetTid);
      const tid = setInterval(() => {
        if (!d.isConnected) {
          clearInterval(tid);
          return;
        }
        check();
      }, 10000);
      sheetTid = tid;
      check();
    }
  }
}

/* keys inside a sheet: type freely in the notes pad; press Esc to leave it, then use the letter and number keys */
document.addEventListener(
  "keydown",
  (e) => {
    if (quickOpen) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openQuick();
      return;
    }
    const d = $q("#drawerRoot .drawer.prep");
    const typing =
      document.activeElement &&
      document.activeElement.matches("textarea,select,input:not([type=checkbox]):not([type=radio]),[contenteditable]");
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if ((k === "h" || k === "H") && CONFIG.blurPay && (d || section === "library")) {
      e.preventDefault();
      showPay(!document.body.classList.contains("showpay"));
      return;
    }
    if (!d) {
      const drawerOpen = $q("#drawerRoot").childNodes.length > 0;
      if (drawerOpen) return;
      if (k === "g" || k === "G") {
        e.preventDefault();
        openQuick();
        return;
      }
      if (k === "/" && section === "next") {
        e.preventDefault();
        e.stopPropagation();
        openQuick();
        return;
      }
      if (k === "/" && section === "library") {
        const s = $q(".hlsearch");
        if (s) {
          e.preventDefault();
          e.stopPropagation();
          s.focus();
        }
      }
      return;
    }
    if (/^[1-9]$/.test(k)) {
      const a = $q(`.pills a[data-k="${k}"]`, d);
      if (a) {
        e.preventDefault();
        a.click();
      }
      return;
    }
    if (k === "n" || k === "N") {
      const ta = $q("#notes-pad", d);
      if (ta) {
        e.preventDefault();
        ta.focus();
      }
      return;
    }
    if (k === "/") {
      e.preventDefault();
      const f = $q(".pfilter", d);
      if (f) f.focus();
      return;
    }
    if (k === "g" || k === "G") {
      e.preventDefault();
      openQuick();
      return;
    }
    for (const b of CONFIG.library.sheetButtons)
      if (b.key && k.toLowerCase() === b.key.toLowerCase()) {
        const btn = $q(`.plib[data-doc="${cssId(b.doc)}"]`, d);
        if (btn) {
          e.preventDefault();
          btn.click();
        }
        return;
      }
  },
  true,
);
