/* ================= the card panel (drawer) =================
   Jobs in play and headhunters get the wide prep sheet (see prep-sheet.js), which rearranges this panel. */
const pending = {};
function flushPending() {
  for (const k of Object.keys(pending)) {
    clearTimeout(pending[k].t);
    const fn = pending[k].fn;
    delete pending[k];
    fn();
  }
}
function refreshDrawerHead() {
  if (!openRef) return;
  const { sec, id } = openRef;
  const x = get(sec, id);
  if (!x) return;
  const S = SECTIONS[sec];
  const h = $("#dTitle");
  if (h) h.textContent = S.title(x);
  const s = $("#dSub");
  if (s) {
    s.textContent = S.sub(x) || "";
    s.hidden = !S.sub(x);
  }
  const a = $("#dLink");
  const u = safeUrl(x.url);
  if (a) {
    a.hidden = !u;
    if (u) a.href = u;
  }
}
/* Another tool (an AI assistant) changed the open record and the change was merged in the background: bring the panel's
   fields up to date, so a later edit can't write the old text back over the newer value. A field with an unsaved edit,
   or one you have typed in since you focused it, is left as it is: your typing wins there. A focused field you haven't
   changed takes the new value (caret at the end). The notes pad and the answer boxes keep their own files and are not
   touched. A plain panel whose stage changed (or whose prep sheet just appeared) is rebuilt when nothing in it is
   being edited. */
const focusVal = new WeakMap();
document.addEventListener("focusin", (e) => {
  const n = e.target;
  if (n && n.dataset && n.dataset.fkey) focusVal.set(n, n.value);
});
const untouched = (n) => !pending[n.dataset.fkey] && focusVal.has(n) && focusVal.get(n) === n.value;
function fieldValue(n, x) {
  const k = n.dataset.fkey,
    kind = n.dataset.fkind;
  if (kind === "iso") return isoToLocalDate(x[k]);
  if (kind === "local") return toLocalInput(x[k]);
  if (kind === "ref") return x[k] && get("people", x[k]) ? x[k] : "";
  return x[k] || "";
}
function refreshDrawer() {
  if (!openRef) return;
  const { sec, id } = openRef;
  const x = get(sec, id);
  const d = $("#drawerRoot .drawer");
  if (!x || !d || d.tagName === "FORM") return;
  refreshDrawerHead();
  const a = document.activeElement;
  const editing =
    Object.keys(pending).length > 0 || !!(a && d.contains(a) && a.matches("input,textarea,select,[contenteditable]"));
  const ln = laneKey(sec, x);
  if (!d.classList.contains("prep") && !editing && (d.dataset.lane !== ln || d.dataset.prep !== prepFlag(sec, id))) {
    openDrawer(sec, id, true);
    return;
  }
  d.querySelectorAll("[data-fkey]").forEach((n) => {
    if (pending[n.dataset.fkey] || (n === a && !untouched(n))) return;
    const v = fieldValue(n, x);
    if (n.dataset.fkind === "ref" && v && ![...n.options].some((o) => o.value === v)) {
      const p = get("people", v);
      n.lastElementChild.before(
        el("option", { value: v, text: [p.name || "Someone", p.company].filter(Boolean).join(" · ") }),
      );
    }
    if (n.value === v) return;
    n.value = v;
    if (n === a) {
      focusVal.set(n, n.value);
      try {
        n.setSelectionRange(n.value.length, n.value.length);
      } catch (e) {}
    }
  });
  d.querySelectorAll("#lanepick button").forEach((b) => b.setAttribute("aria-pressed", String(b.id === "lp-" + ln)));
  d.querySelectorAll("[data-reason]").forEach((c) =>
    c.setAttribute("aria-pressed", String(x.closedReason === c.dataset.reason)),
  );
  const strip = d.querySelector(".pstrip");
  if (strip) strip.innerHTML = stripHtml(x);
}
const prepFlag = (sec, id) => (sec === "jobs" && validPrep(PREPTXT[id]) ? "1" : "");
function textField(sec, id, key, label, opts = {}) {
  const x = get(sec, id);
  const fid = "f-" + key;
  const inp = opts.area
    ? el("textarea", { id: fid, placeholder: opts.placeholder || "" })
    : el("input", { type: key === "url" ? "url" : "text", id: fid, placeholder: opts.placeholder || "" });
  inp.value = x[key] || "";
  inp.dataset.fkey = key;
  const saved = el("div", { class: "saved", "aria-live": "polite" });
  const commit = () => {
    const cur = get(sec, id);
    if (!cur) return;
    let v = inp.value;
    if (key === "url") {
      v = v.trim();
      if (v && !safeUrl(v) && safeUrl("https://" + v)) v = "https://" + v;
    }
    if (cur[key] === v || (!cur[key] && !v)) {
      saved.textContent = "";
      return;
    }
    upd(sec, id, { [key]: v });
    saved.textContent = "Saved";
    refreshDrawerHead();
    render();
  };
  inp.addEventListener("input", () => {
    saved.textContent = "Saving…";
    if (pending[key]) clearTimeout(pending[key].t);
    pending[key] = {
      fn: commit,
      t: setTimeout(() => {
        delete pending[key];
        commit();
      }, 600),
    };
  });
  inp.addEventListener("blur", () => {
    if (pending[key]) {
      clearTimeout(pending[key].t);
      delete pending[key];
      commit();
    }
  });
  return el(
    "div",
    { class: "field" },
    el("label", { for: fid, text: label }),
    inp,
    opts.hint ? el("div", { class: "hint", text: opts.hint }) : null,
    saved,
  );
}
function dateField(sec, id, key, label, iso) {
  const x = get(sec, id);
  const inp = el("input", { type: "date", id: "f-" + key });
  inp.value = iso ? isoToLocalDate(x[key]) : x[key] || "";
  inp.dataset.fkey = key;
  if (iso) inp.dataset.fkind = "iso";
  inp.addEventListener("change", () => {
    const v = inp.value ? (iso ? new Date(inp.value + "T12:00:00").toISOString() : inp.value) : null;
    upd(sec, id, { [key]: v });
    render();
  });
  return el("div", { class: "field" }, el("label", { for: "f-" + key, text: label }), inp);
}
let lastFocusKey = null,
  forceEdit = false,
  addBackTo = null,
  prepFailed = false;
function openDrawer(sec, id, keepFocus) {
  flushPending();
  const S = SECTIONS[sec];
  const x = get(sec, id);
  if (!x) return;
  const wasOpen = $("#drawerRoot").childNodes.length > 0;
  if (!wasOpen && !lastFocusKey) lastFocusKey = focusKey();
  const scrollTop = wasOpen && $(".drawer") ? $(".drawer").scrollTop : 0;
  const focusedId = wasOpen && document.activeElement ? document.activeElement.id : null;
  openRef = { sec, id };
  markSeen(sec, id);
  const editOpen = forceEdit || (wasOpen && $("#drawerRoot details.edit") ? $("#drawerRoot details.edit").open : false);
  forceEdit = false;
  const root = $("#drawerRoot");
  root.textContent = "";
  const ln = laneKey(sec, x);
  const L = laneOf(sec, ln);
  const url = safeUrl(x.url);
  const dates = el("div", { class: "two" });
  for (const f of S.extra.filter((f) => f.type === "dateIso"))
    if (ln !== "todo" && (x[f.key] || ln === "applied")) dates.append(dateField(sec, id, f.key, f.label, true));
  if (!L.done && ln !== "todo") dates.append(dateField(sec, id, "followUp", "Next step on", false));
  const notesField = textField(sec, id, "notes", "Notes", { area: true, placeholder: S.notesHint });
  const addLine = el("button", {
    class: "linkbtn",
    type: "button",
    text: "+ Add dated line",
    onclick: () => {
      const ta = $("#f-notes");
      if (!ta) return;
      const pre = logLine("");
      ta.value = pre + (ta.value ? "\n" + ta.value : "");
      ta.focus();
      ta.setSelectionRange(pre.length, pre.length);
      ta.dispatchEvent(new Event("input"));
    },
  });
  const nl = notesField.querySelector("label");
  if (nl) {
    const row = el("div", { class: "lblrow" });
    nl.before(row);
    row.append(nl, addLine);
  }
  const facts = el("dl", { class: "facts" });
  for (const [k, v, mono] of S.facts(x))
    if (v)
      facts.append(
        el("dt", { text: k }),
        el(
          "dd",
          { class: mono ? "mono" : null },
          safeUrl(v) ? el("a", { href: safeUrl(v), target: "_blank", rel: "noopener noreferrer", text: "Open ↗" }) : v,
        ),
      );
  const removeWrap = el("div", { class: "confirm" });
  const showRemove = () => {
    removeWrap.textContent = "";
    removeWrap.append(
      el("button", {
        class: "danger",
        type: "button",
        text: "Remove from board",
        onclick: () => {
          removeWrap.textContent = "";
          removeWrap.append(
            el("span", {
              text:
                `Remove ${[S.title(x), S.sub(x)].filter(Boolean).join(" · ")}?` +
                (sec === "jobs" && x.folder
                  ? ` Its résumé and cover letter move to “${REMOVED_DIR}” and are deleted after ${PURGE_DAYS} days.`
                  : ""),
            }),
            el("button", {
              class: "btn small",
              type: "button",
              text: "Remove",
              onclick: () => {
                const t = S.title(x);
                flushPending();
                del(sec, id);
                closeDrawer();
                render();
                showToast(t + " removed", () => {
                  upd(sec, id, { deleted: false, removedAt: null });
                  render();
                });
              },
            }),
            el("button", { class: "btn small", type: "button", text: "Keep", onclick: showRemove }),
          );
        },
      }),
    );
  };
  showRemove();
  let reasons = null;
  if (S.closedReasons && L.done)
    reasons = el(
      "div",
      { class: "field" },
      el("span", { class: "lbl", text: "Why closed" }),
      el(
        "div",
        { class: "chips" },
        ...S.closedReasons.map((r) =>
          el("button", {
            class: "chip",
            type: "button",
            "aria-pressed": String(x.closedReason === r),
            "data-reason": r,
            text: r,
            onclick: () => {
              const cur = get(sec, id) || x;
              upd(sec, id, { closedReason: cur.closedReason === r ? null : r });
              render();
              openDrawer(sec, id, true);
            },
          }),
        ),
      ),
    );
  let conflict = null;
  if (sec === "jobs") {
    const h = hunterConflict(x.company);
    if (h)
      conflict = el(
        "div",
        { class: "tag warn", style: "padding:6px 8px;font-size:12.5px" },
        `${h.name} submitted you at ${x.company} (${h.submittedTo}). Check with them before applying here yourself.`,
      );
  }
  let referral = null;
  if (sec === "jobs") {
    const people = Object.entries(live("people")).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
    const sel = el(
      "select",
      { id: "f-referral", "data-fkey": "referralId", "data-fkind": "ref" },
      el("option", { value: "", text: "No one yet" }),
      ...people.map(([pid, p]) =>
        el("option", { value: pid, text: [p.name || "Someone", p.company].filter(Boolean).join(" · ") }),
      ),
      el("option", { value: "__new", text: "+ Add a person…" }),
    );
    sel.value = x.referralId && get("people", x.referralId) ? x.referralId : "";
    sel.addEventListener("change", () => {
      if (sel.value === "__new") {
        sel.value = (get("jobs", id) || x).referralId || "";
        openAdd("people", { company: x.company, ask: "Referral for " + (x.role || x.company) }, { linkJob: id });
        return;
      }
      upd("jobs", id, { referralId: sel.value || null });
      render();
      if (sel.value) showToast(`${personName(sel.value)} linked as your referral at ${x.company}.`);
    });
    referral = el(
      "div",
      { class: "field" },
      el("label", { for: "f-referral", text: "Referral" }),
      sel,
      ln === "todo" ? el("div", { class: "hint", text: "A referral before you apply counts most." }) : null,
    );
  }
  if (sec === "people") {
    const refs = jobsReferredBy(id);
    if (refs.length)
      referral = el(
        "div",
        { class: "field" },
        el("span", { class: "lbl", text: "Referring you for" }),
        ...refs.map(([jid, j]) =>
          el(
            "div",
            {},
            el("button", {
              class: "linkbtn",
              type: "button",
              text: [j.company, j.role].filter(Boolean).join(" · "),
              onclick: () => openDrawer("jobs", jid),
            }),
          ),
        ),
      );
  }
  const editBox = el(
    "details",
    { class: "edit", open: editOpen || null },
    el("summary", { text: "Edit details" }),
    ...S.edit.map(([k, lab]) => textField(sec, id, k, lab)),
  );
  const d = el(
    "aside",
    {
      class: "drawer",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "dTitle",
      tabindex: "-1",
      "data-lane": ln,
      "data-prep": prepFlag(sec, id),
    },
    el("button", { class: "close", type: "button", "aria-label": "Close", text: "×", onclick: closeDrawer }),
    el(
      "div",
      {},
      el("h2", { id: "dTitle", text: S.title(x) }),
      el("div", { class: "sub", id: "dSub", hidden: !S.sub(x) || null, text: S.sub(x) || "" }),
      S.dmeta(x) ? el("div", { class: "sub", text: S.dmeta(x) }) : null,
    ),
    el(
      "div",
      { class: "docbtns" },
      el("a", {
        class: "btn",
        id: "dLink",
        hidden: !url || null,
        href: url || "#",
        target: "_blank",
        rel: "noopener noreferrer",
        text: S.linkLabel(x),
      }),
      ...(sec === "jobs"
        ? (() => {
            const d = docsOf(x);
            return [
              d.resume
                ? el("a", {
                    class: "btn",
                    id: "dResume",
                    href: d.resume,
                    target: "_blank",
                    rel: "noopener",
                    text: "Résumé (PDF) ↗",
                  })
                : null,
              d.letter
                ? el("a", {
                    class: "btn",
                    id: "dLetter",
                    href: d.letter,
                    target: "_blank",
                    rel: "noopener",
                    text: "Cover letter (PDF) ↗",
                  })
                : null,
            ];
          })()
        : []),
    ),
    conflict,
    el(
      "div",
      { class: "field" },
      el("span", { class: "lbl", text: "Stage" }),
      el(
        "div",
        { class: "lanepick", id: "lanepick" },
        ...S.lanes.map((l) =>
          el(
            "button",
            {
              type: "button",
              id: "lp-" + l.id,
              "aria-pressed": String(ln === l.id),
              onclick: () => moveCard(sec, id, l.id),
            },
            el("span", { class: "dot", style: `background:${l.color}` }),
            l.name,
          ),
        ),
      ),
    ),
    reasons,
    dates.childNodes.length ? dates : null,
    ...S.extra.filter((f) => f.type === "text").map((f) => textField(sec, id, f.key, f.label, { hint: f.hint })),
    referral,
    notesField,
    facts.childNodes.length ? el("div", {}, el("span", { class: "lbl", text: "Details" }), facts) : null,
    editBox,
    removeWrap,
  );
  root.append(el("div", { class: "scrim", onclick: closeDrawer }), d);
  /* The prep sheet: if it ever fails, fall back to this plain panel instead of showing nothing. */
  if ((sec === "jobs" || sec === "hunters") && !prepFailed) {
    try {
      Prep.enhance(sec, d, id, x, !!(keepFocus && wasOpen));
    } catch (e) {
      console.error(e);
      prepFailed = true;
      try {
        return openDrawer(sec, id, keepFocus);
      } finally {
        prepFailed = false;
      }
    }
  }
  if (VIEW_ONLY)
    d.querySelectorAll("input,textarea,select,.lanepick button,.chip,.danger,.lblrow .linkbtn").forEach((n) => {
      n.disabled = true;
    });
  /* a prep sheet keeps the cursor in the notes pad */
  if (keepFocus && wasOpen) {
    d.scrollTop = scrollTop;
    const f = focusedId && document.getElementById(focusedId);
    if (f) f.focus({ preventScroll: true });
    else if (!d.classList.contains("prep")) d.focus({ preventScroll: true });
  } else
    setTimeout(() => {
      if (!d.classList.contains("prep")) d.focus();
    }, 0);
}
function closeDrawer() {
  const form = $("#drawerRoot form");
  if (form && form.dataset.sec) saveAddDraft(form.dataset.sec);
  const back = form ? addBackTo : null;
  addBackTo = null;
  flushPending();
  openRef = null;
  $("#drawerRoot").textContent = "";
  render();
  /* changes picked up from the folder while the panel was open: file the moved job folders now */
  if (fileOnClose) {
    fileOnClose = false;
    setTimeout(fileJobs, 50);
  }
  if (back && get(back.sec, back.id)) {
    openDrawer(back.sec, back.id);
    return;
  }
  restoreFocus(lastFocusKey);
  lastFocusKey = null;
}

/* ================= keyboard ================= */
document.addEventListener("keydown", (e) => {
  const drawerOpen = $("#drawerRoot").childNodes.length > 0;
  const typing = document.activeElement.matches(
    "textarea,select,input:not([type=checkbox]):not([type=radio]),[contenteditable]",
  );
  /* Esc: in a prep sheet the first press leaves a text box, the second closes the panel */
  if (e.key === "Escape" && drawerOpen) {
    e.preventDefault();
    if (typing && $("#drawerRoot").contains(document.activeElement) && document.activeElement.closest(".drawer.prep")) {
      Prep.leaveField(document.activeElement);
      return;
    }
    closeDrawer();
    return;
  }
  if (drawerOpen && e.key === "Tab") {
    const box = $("#drawerRoot .drawer");
    const f = [...box.querySelectorAll("a[href],button,input,textarea,select,summary")].filter(
      (n) => !n.disabled && n.offsetParent !== null,
    );
    if (f.length) {
      const first = f[0],
        last = f[f.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === box || !box.contains(a))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (a === last || !box.contains(a))) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing && lastUndo) {
    e.preventDefault();
    const u = lastUndo;
    $("#toastRoot").textContent = "";
    lastUndo = null;
    u();
  }
  if (e.key === "/" && !drawerOpen && !typing && section !== "next") {
    e.preventDefault();
    $("#search").focus();
  }
  if (drawerOpen || typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "?") {
    e.preventDefault();
    openKeys();
    return;
  }
  if ((e.key === "n" || e.key === "N") && section !== "todos" && section !== "library") {
    e.preventDefault();
    openAdd(section === "next" ? "jobs" : section);
    return;
  }
  if (/^[1-6]$/.test(e.key)) {
    const s = SEC_ORDER[Number(e.key) - 1];
    if (s && s !== section) {
      e.preventDefault();
      goSection(s);
    }
  }
});
function openKeys() {
  lastFocusKey = focusKey();
  const root = $("#drawerRoot");
  root.textContent = "";
  openRef = null;
  const sheetKeys = CONFIG.library.sheetButtons
    .filter((b) => b.key)
    .map((b) => `${b.key.toUpperCase()} ${b.label.toLowerCase()}`)
    .join(" · ");
  const rows = [
    ["1 – 6", `Switch tabs: Next up, To-dos, Jobs, ${SECTIONS.hunters.label}, ${SECTIONS.people.label}, Prep library`],
    ["G or Ctrl/⌘ K", `Quick open: jump to any job, ${SECTIONS.hunters.noun}, ${SECTIONS.people.noun} or guide`],
    [
      "In a prep sheet",
      `The cursor starts in your notes. Esc, then 1–9 jump to a section · ${sheetKeys} · N back to notes · / filter${CONFIG.blurPay ? " · H show pay" : ""} · Esc again closes`,
    ],
    ["/", "Search this tab (on Next up: quick open)"],
    ...(CONFIG.blurPay ? [["H", "In the Prep library and prep sheets: show or blur pay sections"]] : []),
    ["N", `Add a job, ${SECTIONS.hunters.noun} or ${SECTIONS.people.noun}`],
    ["Enter", "Open the selected card"],
    ["Esc", "Close a panel or clear search"],
    ["Ctrl/⌘ + Z", "Undo the last change"],
    ["?", "Show these shortcuts"],
  ];
  const d = el(
    "aside",
    { class: "drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "kTitle", tabindex: "-1" },
    el("button", { class: "close", type: "button", "aria-label": "Close", text: "×", onclick: closeDrawer }),
    el("h2", { id: "kTitle", text: "Keyboard shortcuts" }),
    el(
      "dl",
      { class: "facts" },
      ...rows.flatMap(([k, v]) => [el("dt", {}, el("kbd", { text: k })), el("dd", { text: v })]),
    ),
  );
  root.append(el("div", { class: "scrim", onclick: closeDrawer }), d);
  setTimeout(() => d.focus(), 0);
}

/* ================= add form (keeps what you typed if you close it) ================= */
const cap = (t) => (t ? t.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");
/* Applicant-tracking links usually carry the company name: fill it in for you. */
function companyFromUrl(u) {
  try {
    const x = new URL(u);
    const h = x.hostname.replace(/^www\./, "").toLowerCase();
    const seg = x.pathname.split("/").filter(Boolean);
    if (/greenhouse\.io$/.test(h)) {
      if (seg[0] === "embed") return cap(x.searchParams.get("for") || "");
      return cap(seg[0] || "");
    }
    if (/lever\.co$|ashbyhq\.com$|workable\.com$|smartrecruiters\.com$/.test(h)) return cap(seg[0] || "");
    if (/myworkdayjobs\.com$/.test(h)) return cap(h.split(".")[0]);
    return "";
  } catch (e) {
    return "";
  }
}
const noCompanyInLink = (u) => {
  try {
    return /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter)\.com$/.test(new URL(u).hostname.toLowerCase());
  } catch (e) {
    return false;
  }
};
function saveAddDraft(sec) {
  const vals = {};
  let any = false;
  $("#drawerRoot")
    .querySelectorAll("[data-add]")
    .forEach((i) => {
      vals[i.dataset.add] = i.value;
      if (i.value.trim()) any = true;
    });
  addDraft[sec] = any ? vals : null;
}
function openAdd(secArg, prefill, opts) {
  const sec = typeof secArg === "string" ? secArg : section;
  if (!BOARDS.includes(sec)) return;
  flushPending();
  const S = SECTIONS[sec];
  const linkJob = (opts && opts.linkJob) || null;
  const backTo = openRef ? { ...openRef } : null;
  addBackTo = backTo;
  if (!backTo) lastFocusKey = { id: "addBtn" };
  openRef = null;
  const root = $("#drawerRoot");
  root.textContent = "";
  const draft = prefill || addDraft[sec] || {};
  const inputs = {};
  const fields = S.addFields.map(([key, label, req, ph]) => {
    const i = el("input", {
      type: key === "url" ? "url" : "text",
      id: "new-" + key,
      "data-add": key,
      placeholder: typeof req === "string" ? req : ph || (key === "url" ? "https://…" : ""),
    });
    i.value = draft[key] || "";
    inputs[key] = i;
    return el("div", { class: "field" }, el("label", { for: "new-" + key, text: label }), i);
  });
  const notes = el("textarea", { id: "new-notes", "data-add": "notes", style: "min-height:90px" });
  notes.value = draft.notes || "";
  const err = el("div", { class: "saved", role: "alert" });
  const reqF = S.addFields.find((f) => f[2] === true);
  const req = reqF ? reqF[0] : S.addFields[0][0];
  const coHint = el("div", {
    class: "hint",
    hidden: true,
    text: "This link doesn't include the company. Type it here.",
  });
  if (sec === "jobs" && inputs.company) inputs.company.after(coHint);
  if (sec === "jobs" && inputs.url)
    inputs.url.addEventListener("input", () => {
      const u = inputs.url.value.trim();
      if (!inputs.company.value.trim() || inputs.company.dataset.auto === "1") {
        const c = companyFromUrl(u);
        inputs.company.value = c;
        inputs.company.dataset.auto = c ? "1" : "";
      }
      coHint.hidden = !(noCompanyInLink(u) && !inputs.company.value.trim());
    });
  if (inputs.company)
    inputs.company.addEventListener("input", () => {
      inputs.company.dataset.auto = "";
    });
  const form = el(
    "form",
    {
      class: "drawer",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Add a " + S.noun,
      "data-sec": prefill ? "" : sec,
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        if (sec === "jobs") {
          if (!inputs.url.value.trim() && !inputs.company.value.trim()) {
            err.textContent = "Paste the posting link, or type the company.";
            inputs.url.focus();
            return;
          }
          if (!inputs.company.value.trim() && !companyFromUrl(inputs.url.value.trim())) {
            coHint.hidden = false;
            err.textContent = "Type the company name.";
            inputs.company.focus();
            return;
          }
        } else {
          const main = inputs[req].value.trim();
          if (!main) {
            err.textContent = "Fill in the first field.";
            inputs[req].focus();
            return;
          }
        }
        if (inputs.url) {
          const raw = inputs.url.value.trim();
          if (raw && !safeUrl(raw) && !safeUrl("https://" + raw)) {
            err.textContent = "That link doesn't look right. Paste the full address, starting with https://";
            inputs.url.focus();
            return;
          }
        }
        const doc = {
          lane: "todo",
          notes: notes.value.trim(),
          createdAt: nowIso(),
          addedAt: nowIso(),
          movedAt: nowIso(),
        };
        for (const k in inputs) doc[k] = inputs[k].value.trim();
        if (doc.url && !safeUrl(doc.url)) doc.url = "https://" + doc.url;
        if (sec === "jobs" && !doc.company) doc.company = companyFromUrl(doc.url);
        const nid = newId();
        put(sec, nid, doc);
        addDraft[sec] = null;
        form.dataset.sec = "";
        addBackTo = null;
        if (linkJob && get("jobs", linkJob)) {
          upd("jobs", linkJob, { referralId: nid });
          closeDrawer();
          render();
          openDrawer("jobs", linkJob);
          showToast(`${doc.name} added and linked as your referral.`);
          return;
        }
        closeDrawer();
        if (section === "next" && sec === "jobs") section = "jobs";
        activeLane[sec] = "todo";
        remember();
        render();
        window.scrollTo(0, 0);
        let msg = S.title(doc) + " added";
        if (sec === "jobs") {
          const h = hunterConflict(doc.company);
          if (h) msg += `. Heads up: ${h.name} submitted you at ${doc.company}.`;
        }
        showToast(msg);
      },
    },
    el("button", { class: "close", type: "button", "aria-label": "Close", text: "×", onclick: closeDrawer }),
    el("h2", { text: "Add a " + S.noun }),
    linkJob ? el("div", { class: "hint", text: "They'll be linked as your referral for this job." }) : null,
    ...fields,
    el("div", { class: "field" }, el("label", { for: "new-notes", text: "Notes" }), notes),
    el(
      "div",
      { style: "display:flex;gap:8px" },
      el("button", { class: "btn primary", type: "submit", text: "Add" }),
      el("button", {
        class: "btn",
        type: "button",
        text: "Cancel",
        onclick: () => {
          addDraft[sec] = null;
          form.dataset.sec = "";
          closeDrawer();
        },
      }),
    ),
    err,
  );
  root.append(el("div", { class: "scrim", onclick: closeDrawer }), form);
  setTimeout(() => inputs[sec === "jobs" ? "url" : req].focus(), 30);
}
