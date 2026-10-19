/* ================= calls: book them on a card, see them on Next up =================
   Fields on a job or headhunter: callAt (local time, "YYYY-MM-DDTHH:MM"), callType, callWith, callLink.
   Booking moves the card forward (a recruiter call to Recruiter screen, a later round to Interviewing)
   and sets the follow-up to the day after the call. */
const CALLTYPES = CONFIG.callTypes;
const parseCall = (v) => {
  if (typeof v !== "string" || !v) return NaN;
  return Date.parse(/^\d{4}-\d\d-\d\d$/.test(v) ? v + "T09:00" : v);
};
const z2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (v) => {
  const t = parseCall(v);
  if (isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}T${z2(d.getHours())}:${z2(d.getMinutes())}`;
};
const fmtCall = (iso) => {
  if (!iso) return "";
  const t = parseCall(iso);
  if (isNaN(t)) return String(iso);
  const d = new Date(t);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ", " + hhmm(d);
};
const shortCall = (iso) => {
  const t = parseCall(iso);
  if (isNaN(t)) return "";
  const d = new Date(t);
  return d.toLocaleDateString([], { weekday: "short" }) + " " + hhmm(d);
};
/* A call counts as upcoming until six hours after it starts. */
const callLive = (x) => !!(x && parseCall(x.callAt) > Date.now() - 6 * 36e5);
function upcoming() {
  const out = [];
  for (const sec of ["jobs", "hunters"])
    for (const [id, x] of Object.entries(live(sec)))
      if (callLive(x) && !laneOf(sec, laneKey(sec, x)).done) out.push([sec, id, x]);
  return out.sort((a, b) => parseCall(a[2].callAt) - parseCall(b[2].callAt));
}
function stripHtml(x) {
  return (
    (x.callAt
      ? `<span class="pcall">📞 ${esc(x.callType || "Call")} · <b>${esc(fmtCall(x.callAt))}</b></span>`
      : `<span class="pcall muted">No call booked</span>`) +
    (x.callWith ? `<span>${esc(x.callWith)}</span>` : "") +
    (x.callLink
      ? `<span>${/^https?:\/\//.test(x.callLink) ? `<a href="${esc(x.callLink)}" target="_blank" rel="noopener noreferrer">Meeting link ↗</a>` : esc(x.callLink)}</span>`
      : "") +
    (x.resume ? `<span class="muted">Résumé ${esc(x.resume)}</span>` : "")
  );
}
let focusWithNext = false;
function callRow(sec, id, x, strip, summary) {
  const row = document.createElement("div");
  row.className = "callrow";
  const mk = (t, c) => {
    const e = document.createElement(t);
    if (c) e.className = c;
    return e;
  };
  const type = mk("select");
  type.setAttribute("aria-label", "Call type");
  type.innerHTML =
    '<option value="">Call type…</option>' +
    CALLTYPES.map((t) => `<option${x.callType === t ? " selected" : ""}>${esc(t)}</option>`).join("");
  const when = mk("input");
  when.type = "datetime-local";
  when.value = toLocalInput(x.callAt);
  when.setAttribute("aria-label", "Call date and time");
  const who = mk("input");
  who.type = "text";
  who.placeholder = "With (name, profile)";
  who.value = x.callWith || "";
  who.setAttribute("aria-label", "Who you're talking to");
  const link = mk("input");
  link.type = "text";
  link.placeholder = "Meeting link or phone";
  link.value = x.callLink || "";
  link.setAttribute("aria-label", "Meeting link");
  const commit = () => {
    const cur = get(sec, id);
    if (!cur) return;
    /* only the fields you changed are written; a stored time in another format is left alone until you edit it */
    const now = { callType: type.value, callAt: when.value, callWith: who.value, callLink: link.value };
    const patch = {};
    for (const k of Object.keys(now)) {
      const was = k === "callAt" ? toLocalInput(cur.callAt) : cur[k] || "";
      if (now[k] !== was) patch[k] = now[k];
    }
    if (!Object.keys(patch).length) return;
    const typeChanged = "callType" in patch,
      dateChanged = "callAt" in patch;
    upd(sec, id, patch);
    render();
    const laneBefore = laneKey(sec, get(sec, id));
    let followed = false;
    if (get(sec, id).callAt && (dateChanged || typeChanged)) {
      focusWithNext = true;
      autoMove(sec, id, get(sec, id).callType);
      followed = setFollowAfter(sec, id, get(sec, id).callAt);
    }
    const laneAfter = laneKey(sec, get(sec, id));
    if (followed && openRef && openRef.sec === sec && openRef.id === id) {
      focusWithNext = true;
      openDrawer(sec, id, true);
      return;
    }
    if (laneAfter === laneBefore) {
      focusWithNext = false;
      strip.innerHTML = stripHtml(get(sec, id));
      summary.textContent = get(sec, id).callAt ? "Edit the call" : "Book a call";
    }
  };
  [type, when, who, link].forEach((e) => e.addEventListener("change", commit));
  /* so the panel can bring them up to date after another tool changes the call (see refreshDrawer) */
  [
    [type, "callType"],
    [when, "callAt"],
    [who, "callWith"],
    [link, "callLink"],
  ].forEach(([e, k]) => (e.dataset.fkey = k));
  when.dataset.fkind = "local";
  row.append(type, when, who, link);
  if (x.callAt) {
    const clr = mk("button", "btn small");
    clr.type = "button";
    clr.textContent = "Clear call";
    clr.onclick = () => {
      upd(sec, id, { callType: "", callAt: "", callWith: "", callLink: "" });
      render();
      openDrawer(sec, id, true);
    };
    row.append(clr);
  }
  return row;
}
/* the follow-up date becomes the day after the call (moving the card alone would set an unrelated date) */
function setFollowAfter(sec, id, callAt) {
  const x = get(sec, id);
  if (!x) return false;
  const ln = laneKey(sec, x);
  if (ln === "todo" || laneOf(sec, ln).done) return false;
  const t = parseCall(callAt);
  if (isNaN(t)) return false;
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  const f = `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
  if (x.followUp === f) return false;
  upd(sec, id, { followUp: f });
  render();
  const prev = x.followUp || null;
  showToast(`Follow-up set for ${fmtDate(f)}, the day after your call.`, () => {
    upd(sec, id, { followUp: prev });
    render();
  });
  return true;
}
function autoMove(sec, id, type) {
  const x = get(sec, id);
  if (!x) return;
  const ln = laneKey(sec, x);
  if (sec === "jobs") {
    const later = /Hiring|Panel|Onsite/.test(type || "");
    if (later && (ln === "applied" || ln === "screen")) moveCard(sec, id, "interview");
    else if (!later && ln === "applied") moveCard(sec, id, "screen");
  } else if (sec === "hunters" && ["todo", "registered", "contacted"].includes(ln)) moveCard(sec, id, "talking");
}
/* Next up: the list of booked calls */
function renderUpcoming(v) {
  const list = upcoming();
  if (!list.length) return;
  const box = el("div", { class: "hup" }, el("div", { class: "hup-h", text: "Upcoming calls" }));
  for (const [sec, id, x] of list)
    box.append(
      el(
        "div",
        { class: "hup-r" },
        el("span", { class: "hup-t", text: fmtCall(x.callAt) }),
        el(
          "span",
          { class: "hup-w" },
          el("b", { text: SECTIONS[sec].title(x) }),
          SECTIONS[sec].sub(x) ? " · " + SECTIONS[sec].sub(x) : "",
        ),
        el("span", { class: "hup-k", text: x.callType || "Call" }),
        el("button", {
          class: "btn small primary",
          type: "button",
          text: "Open prep",
          onclick: () => openDrawer(sec, id),
        }),
      ),
    );
  v.append(box);
}
/* Tags on board cards: a booked call (not on a closed card), or a job in play without a prep sheet */
function cardTags(sec, id, x) {
  const out = [];
  if (callLive(x) && !laneOf(sec, laneKey(sec, x)).done)
    out.push(
      el("span", {
        class: "tag hcall",
        title: "Call booked: open the card for its prep sheet",
        text: "📞 " + shortCall(x.callAt),
      }),
    );
  else if (
    sec === "jobs" &&
    ACTIVE_LANES.includes(laneKey("jobs", x)) &&
    !validPrep(PREPTXT[id]) &&
    (prepScanned || Object.keys(PREPTXT).length > 0)
  )
    out.push(
      el("span", {
        class: "tag hprep",
        title: `No prep sheet yet: add Job notes/${id}/prep.md`,
        text: "No prep sheet",
      }),
    );
  return out;
}
