/* ================= ui state ================= */
let openRef = null,
  dragRef = null,
  query = "";
const openTodo = new Set();
const editingTodo = new Set();
let todoDraft = "";
const addDraft = {};
let section = "next";
const activeLane = { jobs: "todo", hunters: "todo", people: "todo" };
try {
  const s = lsGet("section", null);
  if (SEC_ORDER.includes(s)) section = s;
  Object.assign(activeLane, JSON.parse(lsGet("lanes", "{}")));
} catch (e) {}
const remember = () => {
  lsSet("section", section);
  lsSet("lanes", JSON.stringify(activeLane));
};
function goSection(s) {
  if (s === section) return;
  flushPending();
  section = s;
  query = "";
  $("#search").value = "";
  remember();
  render();
  window.scrollTo(0, 0);
}

/* ================= toast with undo (hover pauses it; Ctrl/⌘+Z undoes) ================= */
let toastTimer = null;
function showToast(msg, undo) {
  const root = $("#toastRoot");
  root.textContent = "";
  clearTimeout(toastTimer);
  lastUndo = undo || null;
  const hide = () => {
    root.textContent = "";
    lastUndo = null;
  };
  const t = el(
    "div",
    { class: "toast" },
    el("span", { text: msg }),
    undo
      ? el("button", {
          type: "button",
          text: "Undo",
          onclick: () => {
            const u = lastUndo;
            hide();
            if (u) u();
          },
        })
      : null,
  );
  const arm = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, msg.length > 90 ? 10000 : 6500);
  };
  t.addEventListener("mouseenter", () => clearTimeout(toastTimer));
  t.addEventListener("mouseleave", arm);
  t.addEventListener("focusin", () => clearTimeout(toastTimer));
  t.addEventListener("focusout", arm);
  root.append(t);
  arm();
}

/* ================= render (the whole view is rebuilt; focus and scroll are put back) ================= */
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  if (a.id && !/^td-/.test(a.id)) return { id: a.id };
  const host = a.closest("[data-key]");
  if (!host) return null;
  const all = [...document.querySelectorAll("[data-key]")];
  const i = all.indexOf(host);
  return {
    key: host.dataset.key,
    f: a.dataset.f || null,
    next: all[i + 1] ? all[i + 1].dataset.key : null,
    prev: all[i - 1] ? all[i - 1].dataset.key : null,
  };
}
function restoreFocus(k) {
  if (!k) return;
  if (k.id) {
    const n = document.getElementById(k.id);
    if (n && n !== document.activeElement) {
      n.focus({ preventScroll: true });
      if (n.setSelectionRange && typeof n.value === "string")
        try {
          n.setSelectionRange(n.value.length, n.value.length);
        } catch (e) {}
    }
    return;
  }
  const shown = (n) => n.getClientRects().length > 0 && !n.closest("details:not([open])");
  const find = (key) => key && [...document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`)].find(shown);
  const host = find(k.key) || find(k.next) || find(k.prev);
  if (!host) return;
  const target =
    (k.f && host.querySelector(`[data-f="${CSS.escape(k.f)}"]`)) ||
    host.querySelector('[data-f="cb"],[data-f="open"]') ||
    host;
  if (target.tabIndex < 0 && !target.matches("a,button,input,textarea")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
function render() {
  const inDrawer = document.activeElement && $("#drawerRoot").contains(document.activeElement);
  const fk = inDrawer ? null : focusKey();
  const b = $(".board");
  const sl = b ? b.scrollLeft : 0;
  const y = window.scrollY;
  renderInner();
  renderBanner();
  renderStatus();
  const b2 = $(".board");
  if (b2) b2.scrollLeft = sl;
  window.scrollTo(0, y);
  if (!inDrawer) restoreFocus(fk);
}
function renderInner() {
  const due = dueList();
  const nav = $("#nav");
  nav.textContent = "";
  for (const s of SEC_ORDER) {
    const [long, short] = TAB_NAMES[s] || [SECTIONS[s].label, SECTIONS[s].short];
    let badge = null;
    if (s === "next") {
      const n = followRows(due).length;
      if (n) badge = el("span", { class: "badge", title: "Follow-ups due", text: String(n) });
    } else if (s === "todos") {
      const open = Object.entries(live("todos")).filter(([, t]) => !t.done);
      const nw = open.filter(([id, t]) => isNewFromTool("todos", id, t)).length;
      if (nw) badge = el("span", { class: "badge new", text: `${nw} new` });
      else if (open.length) badge = el("span", { class: "badge plain count", text: String(open.length) });
    } else if (s !== "library")
      badge = el("span", { class: "badge plain count", text: String(Object.keys(live(s)).length) });
    nav.append(
      el(
        "button",
        { type: "button", "aria-current": section === s ? "page" : null, id: "nav-" + s, onclick: () => goSection(s) },
        el("span", { class: "long", text: long }),
        el("span", { class: "short", text: short }),
        badge,
      ),
    );
  }
  const addBtn = $("#addBtn");
  const addSec = BOARDS.includes(section) ? section : section === "next" ? "jobs" : null;
  addBtn.hidden = !addSec;
  if (addSec) addBtn.textContent = "+ Add " + SECTIONS[addSec].noun;
  $("#search").hidden = section === "next" || section === "library";
  const v = $("#view");
  v.textContent = "";
  if (section === "next") {
    try {
      Prep.renderUpcoming(v);
    } catch (e) {
      console.error(e);
    }
    renderNext(v, due);
  } else if (section === "todos") renderTodos(v);
  else if (section === "library") {
    try {
      Prep.renderLibrary(v);
    } catch (e) {
      v.textContent = "The Prep library could not be shown: " + e.message;
    }
  } else renderBoard(v, section);
}

/* ================= Next up: follow-ups, stale cards, starred jobs, top to-dos, the plan ================= */
const STALE = CONFIG.stale;
function staleList() {
  const out = [];
  for (const sec of BOARDS) {
    const r = STALE[sec];
    if (!r) continue;
    for (const [id, x] of Object.entries(live(sec))) {
      const ln = laneKey(sec, x);
      if (!r.lanes.includes(ln)) continue;
      if (x.keepUntil && x.keepUntil > TODAY()) continue;
      const d = daysSince(x.movedAt);
      if (d >= r.days) out.push({ sec, id, x, d });
    }
  }
  return out.sort((a, b) => b.d - a.d);
}
function applyNextList() {
  return Object.entries(live("jobs"))
    .filter(([, x]) => laneKey("jobs", x) === "todo" && x.pinned)
    .sort(
      (a, b) =>
        String(a[1].pinnedAt || "").localeCompare(String(b[1].pinnedAt || "")) ||
        String(a[1].company).localeCompare(b[1].company),
    );
}
const justAdded = (x) => !!x.addedAt && Date.now() - Date.parse(x.addedAt) < 36 * 3600e3;
/* Plan steps that the boards can answer tick themselves. */
function autoDone(a) {
  if (a === "hunters_registered") {
    const firms = Object.values(live("hunters")).filter((h) => h.tier);
    return firms.length > 0 && firms.every((h) => laneKey("hunters", h) !== "todo");
  }
  if (a === "people10") return Object.keys(live("people")).length >= 10;
  return false;
}
const AUTO = { hunters_registered: 1, people10: 1 };
const isAuto = (p) => typeof p.auto === "string" && Object.hasOwn(AUTO, p.auto);
const planDone = (p) => !!p.done || (isAuto(p) && autoDone(p.auto));
function openRow(sec, id, x, label) {
  return el("span", {
    class: "what",
    tabindex: "0",
    role: "button",
    "data-f": "open",
    text: label || SECTIONS[sec].title(x),
    onclick: () => openDrawer(sec, id),
    onkeydown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDrawer(sec, id);
      }
    },
  });
}
function followRows(due) {
  const rows = new Map();
  for (const d of due) rows.set(d.sec + ":" + d.id, { ...d, due: true });
  for (const st of staleList()) {
    const k = st.sec + ":" + st.id;
    rows.set(k, { ...(rows.get(k) || st), stale: true, d: st.d });
  }
  return [...rows.values()].sort((a, b) =>
    a.due && b.due ? a.x.followUp.localeCompare(b.x.followUp) : a.due ? -1 : b.due ? 1 : b.d - a.d,
  );
}
function renderNext(v, due) {
  const wrap = el("div", { class: "next" });
  const jobs = Object.entries(live("jobs"));
  const toApply = jobs.filter(([, x]) => laneKey("jobs", x) === "todo").length;
  const waiting = jobs
    .filter(([, x]) => ACTIVE_LANES.includes(laneKey("jobs", x)))
    .sort((a, b) => String(a[1].movedAt || "").localeCompare(String(b[1].movedAt || "")));
  wrap.append(el("div", { class: "summary" }, el("b", { text: String(toApply) }), " to apply"));
  if (waiting.length) {
    const det = el(
      "details",
      { class: "waiting", open: lsGet("waitOpen", "") === "1" || null },
      el(
        "summary",
        {},
        "Waiting on ",
        el("b", { text: String(waiting.length) }),
        waiting.length === 1 ? " job" : " jobs",
      ),
      el(
        "div",
        { class: "wlist" },
        ...waiting.map(([id, x]) => {
          const L = laneOf("jobs", laneKey("jobs", x));
          return el(
            "div",
            { class: "wrow", "data-key": `wait:${id}` },
            openRow("jobs", id, x),
            el("span", { class: "why", text: `${L.name} · ${daysSince(x.movedAt)} days` }),
          );
        }),
      ),
    );
    det.addEventListener("toggle", () => lsSet("waitOpen", det.open ? "1" : "0"));
    wrap.append(det);
  }

  const rows = followRows(due);
  const g = el("section", { class: "group" }, el("h3", { text: "Follow up" }));
  if (!rows.length) {
    const nf = nextFollow();
    g.append(
      el("div", {
        class: "calm",
        text: nf
          ? `Nothing due today. Next: ${SECTIONS[nf.sec].title(nf.x)} on ${fmtDate(nf.x.followUp)}.`
          : "Nothing due. Marking a job applied, a headhunter reached out or a person asked sets a follow-up date for you.",
      }),
    );
  }
  for (const r of rows) {
    const { sec, id, x } = r;
    const L = laneOf(sec, laneKey(sec, x));
    const R = STALE[sec];
    const late = r.due ? Math.round((new Date(TODAY() + "T12:00:00") - new Date(x.followUp + "T12:00:00")) / 864e5) : 0;
    const why = [
      SECTIONS[sec].sub(x),
      x.movedAt ? `${L.name} ${fmtDate(x.movedAt)}` : L.name,
      r.stale ? `no change in ${r.d} days` : late > 0 ? `${late} day${late > 1 ? "s" : ""} late` : "due today",
    ]
      .filter(Boolean)
      .join(" · ");
    const url = sec !== "jobs" && !(sec === "hunters" && x.tier) ? safeUrl(x.url) : null;
    const logBtn = el("button", {
      class: "btn small",
      type: "button",
      text: "Log follow-up",
      title: "Adds a dated line to your notes and sets the next follow-up",
      onclick: () => {
        const before = { followUp: x.followUp || null, notes: x.notes || "", keepUntil: x.keepUntil || null };
        const nd = addDays(L.follow || 7);
        upd(sec, id, {
          followUp: nd,
          keepUntil: addDays(14),
          notes: logLine("Followed up.") + (x.notes ? "\n" + x.notes : ""),
        });
        render();
        showToast(`Logged. Next follow-up ${fmtDate(nd)}.`, () => {
          upd(sec, id, before);
          render();
        });
      },
    });
    const snooze = el("button", {
      class: "btn small",
      type: "button",
      text: "Snooze a week",
      onclick: () => {
        const old = x.followUp,
          f = addDays(7);
        upd(sec, id, { followUp: f });
        render();
        showToast(`Moved to ${fmtDate(f)}`, () => {
          upd(sec, id, { followUp: old });
          render();
        });
      },
    });
    const close = el("button", {
      class: "btn small",
      type: "button",
      text: R ? R.label : "Close",
      onclick: () => {
        moveCard(sec, id, R.close);
        if (R.reason) {
          upd(sec, id, { closedReason: R.reason });
          render();
        }
      },
    });
    const keep = el("button", {
      class: "btn small",
      type: "button",
      text: "Keep waiting",
      title: "Ask again in 2 weeks",
      onclick: () => {
        const old = { keepUntil: x.keepUntil || null, followUp: x.followUp || null };
        upd(sec, id, { keepUntil: addDays(14), followUp: r.due ? addDays(14) : x.followUp || null });
        render();
        showToast("I'll check again in 2 weeks.", () => {
          upd(sec, id, old);
          render();
        });
      },
    });
    const acts = r.stale ? (r.due ? [logBtn, close] : [close, keep]) : [logBtn, snooze];
    g.append(
      el(
        "div",
        { class: "item", "data-key": `due:${sec}:${id}` },
        el(
          "div",
          {},
          sec !== "jobs" ? el("span", { class: "kind", text: SECTIONS[sec].noun }) : null,
          openRow(sec, id, x),
        ),
        el("div", { class: "why", text: why }),
        el(
          "div",
          { class: "acts" },
          url
            ? el("a", {
                class: "btn small",
                href: url,
                target: "_blank",
                rel: "noopener noreferrer",
                text: SECTIONS[sec].linkLabel(x),
              })
            : null,
          ...acts,
        ),
      ),
    );
  }
  wrap.append(g);

  const starred = applyNextList();
  if (toApply) {
    const ag = el("section", { class: "group" }, el("h3", { text: "Apply next" }));
    if (!starred.length)
      ag.append(
        el(
          "div",
          { class: "calm" },
          "Star the jobs you'll apply to next on the ",
          el("button", { class: "linkbtn", type: "button", text: "Jobs tab", onclick: () => goSection("jobs") }),
          " and they'll wait here.",
        ),
      );
    for (const [id, x] of starred) {
      const url = safeUrl(x.url);
      ag.append(
        el(
          "div",
          { class: "item", "data-key": `apply:${id}` },
          el("div", {}, openRow("jobs", id, x)),
          el("div", { class: "why", text: [x.role, x.location].filter(Boolean).join(" · ") }),
          el(
            "div",
            { class: "acts" },
            url
              ? el("a", {
                  class: "btn small",
                  href: url,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  text: "Open posting ↗",
                })
              : null,
            el("button", {
              class: "btn small",
              type: "button",
              text: "Mark applied",
              onclick: () => moveCard("jobs", id, "applied"),
            }),
          ),
        ),
      );
    }
    wrap.append(ag);
  }

  const openTodos = sortedTodos().filter(([, t]) => !t.done);
  const firsts = openTodos.filter(([, t]) => t.group !== "later").slice(0, 3);
  if (firsts.length) {
    const tg = el("section", { class: "group" }, el("h3", { text: "Top to-dos" }));
    for (const [id, t] of firsts) tg.append(todoRow(id, t, "n"));
    const rest = openTodos.length - firsts.length;
    if (rest > 0)
      tg.append(
        el(
          "div",
          { style: "margin-top:8px" },
          el("button", {
            class: "linkbtn",
            type: "button",
            text: `See all to-dos (${rest} more)`,
            onclick: () => goSection("todos"),
          }),
        ),
      );
    wrap.append(tg);
  }
  const items = Object.entries(live("plan"));
  if (items.length) {
    const left = items.filter(([, p]) => !planDone(p)).sort((a, b) => a[1].week - b[1].week || a[1].order - b[1].order);
    const pg = el("section", { class: "group" }, el("h3", { text: CONFIG.plan.nextUpTitle }));
    if (!left.length) pg.append(el("div", { class: "calm", text: CONFIG.plan.doneText }));
    else {
      const [pid, p] = left[0];
      pg.append(
        el(
          "div",
          { class: "item", "data-key": "plan-next" },
          el("div", {}, el("span", { class: "kind", text: "Week " + p.week }), el("span", { text: p.text })),
          el("div", { class: "why", text: `${items.length - left.length} of ${items.length} steps done` }),
          el(
            "div",
            { class: "acts" },
            isAuto(p)
              ? null
              : el("button", {
                  class: "btn small",
                  type: "button",
                  "data-f": "done",
                  text: "Mark done",
                  onclick: () => {
                    togglePlan(pid, true);
                    showToast("Plan step done", () => togglePlan(pid, false));
                  },
                }),
            el("button", {
              class: "btn small",
              type: "button",
              text: "See plan",
              onclick: () => {
                lsSet("planOpen", "1");
                goSection("hunters");
              },
            }),
          ),
        ),
      );
    }
    wrap.append(pg);
  }
  v.append(wrap);
}

/* ================= the boards (lanes with drag and drop; one lane at a time on narrow windows) ================= */
function sortedCards(sec, lane) {
  const list = Object.entries(live(sec)).filter(([, x]) => laneKey(sec, x) === lane && matches(sec, x));
  if (lane === "todo")
    list.sort(
      (a, b) =>
        (justAdded(b[1]) ? 1 : 0) - (justAdded(a[1]) ? 1 : 0) ||
        (b[1].pinned ? 1 : 0) - (a[1].pinned ? 1 : 0) ||
        (a[1].longShot ? 1 : 0) - (b[1].longShot ? 1 : 0) ||
        (a[1].order ?? 99) - (b[1].order ?? 99) ||
        String(SECTIONS[sec].title(a[1])).localeCompare(SECTIONS[sec].title(b[1])),
    );
  else list.sort((a, b) => String(b[1].movedAt || "").localeCompare(String(a[1].movedAt || "")));
  return list;
}
function renderBoard(v, sec) {
  const S = SECTIONS[sec];
  if (sec === "hunters" && !query) v.append(planBox());
  const counts = {};
  for (const l of S.lanes) counts[l.id] = 0;
  let shown = 0;
  for (const x of Object.values(live(sec)))
    if (matches(sec, x)) {
      counts[laneKey(sec, x)]++;
      shown++;
    }
  if (query && !shown) v.append(el("p", { class: "nohit", text: `Nothing matches “${query}”.` }));
  if (!S.lanes.some((l) => l.id === activeLane[sec])) activeLane[sec] = S.lanes[0].id;
  let shownLane = activeLane[sec];
  if (query && !counts[shownLane]) {
    const hit = S.lanes.find((l) => counts[l.id]);
    if (hit) shownLane = hit.id;
  }
  const tabs = el("div", { class: "tabs", role: "group", "aria-label": "Stages" });
  for (const l of S.lanes)
    tabs.append(
      el(
        "button",
        {
          class: "tab",
          "aria-pressed": String(l.id === shownLane),
          type: "button",
          onclick: () => {
            activeLane[sec] = l.id;
            remember();
            render();
          },
        },
        el("span", { class: "dot", style: `background:${l.color}` }),
        l.name,
        el("span", { class: "n", text: String(counts[l.id]) }),
      ),
    );
  const board = el("div", {
    class: "board",
    style: `grid-template-columns:repeat(${S.lanes.length},minmax(170px,1fr))`,
  });
  for (const l of S.lanes) {
    const cards = el("div", { class: "cards" });
    const list = sortedCards(sec, l.id);
    if (!list.length) {
      const t = query ? "No matches." : (S.empty[l.id] ?? S.empty._);
      if (t) cards.append(el("div", { class: "empty", text: t }));
    }
    /* Every card always shows. Long shots sit at the bottom of "To apply" under a divider. */
    const longN =
      sec === "jobs" && l.id === "todo" ? list.filter(([, x]) => x.longShot && !x.pinned && !justAdded(x)).length : 0;
    let divided = false;
    for (const [id, x] of list) {
      if (longN && !divided && x.longShot && !x.pinned && !justAdded(x)) {
        divided = true;
        cards.append(el("div", { class: "lane-div", text: `Long shots (${longN})` }));
      }
      cards.append(card(sec, id, x));
    }
    /* Removed cards stay recoverable: listed under the last lane with a Restore button. */
    if (l.id === S.lanes[S.lanes.length - 1].id && !query) {
      const gone = Object.entries(store[sec])
        .filter(([, x]) => x && x.deleted)
        .sort((a, b) => String(b[1].updatedAt || "").localeCompare(String(a[1].updatedAt || "")));
      if (gone.length) {
        const box = el(
          "details",
          { class: "removed" },
          el("summary", { text: `Removed cards (${gone.length})` }),
          sec === "jobs"
            ? el("div", {
                class: "rnote",
                text: `Their files wait in “${REMOVED_DIR}” for ${PURGE_DAYS} days, then are deleted. Restore brings a card and its files back.`,
              })
            : null,
        );
        for (const [id, x] of gone)
          box.append(
            el(
              "div",
              { class: "rrow" },
              el("span", { text: [S.title(x), S.sub(x)].filter(Boolean).join(" · ") }),
              el("button", {
                class: "btn small",
                type: "button",
                text: "Restore",
                onclick: () => {
                  upd(sec, id, { deleted: false, removedAt: null });
                  render();
                  showToast(S.title(x) + " restored");
                },
              }),
            ),
          );
        cards.append(box);
      }
    }
    const lane = el(
      "section",
      {
        class: "lane" + (l.id === shownLane ? " active" : ""),
        "aria-label": l.name,
        ondragover: (e) => {
          if (dragRef && dragRef.sec === sec) {
            e.preventDefault();
            lane.classList.add("drop");
          }
        },
        ondragleave: (e) => {
          if (!lane.contains(e.relatedTarget)) lane.classList.remove("drop");
        },
        ondrop: (e) => {
          e.preventDefault();
          lane.classList.remove("drop");
          if (dragRef && dragRef.sec === sec) moveCard(sec, dragRef.id, l.id);
          dragRef = null;
        },
      },
      el(
        "div",
        { class: "lane-h" },
        el("span", { class: "dot", style: `background:${l.color}` }),
        el("span", { class: "name", text: l.name }),
        el("span", { class: "n", text: String(counts[l.id]) }),
      ),
      cards,
    );
    board.append(lane);
  }
  v.append(tabs, board);
}
/* A job's tailored résumé and cover letter live in its folder (see filing). noResume / noLetter mark a package without one;
   resumeFile / letterFile override the file names from the settings. */
function docsOf(x) {
  if (!x || !x.folder) return { resume: null, letter: null };
  const base = String(x.folder).split("/").map(encodeURIComponent).join("/") + "/";
  return {
    resume: x.noResume ? null : base + encodeURIComponent(x.resumeFile || CONFIG.files.resume),
    letter: x.noLetter ? null : base + encodeURIComponent(x.letterFile || CONFIG.files.coverLetter),
  };
}
/* With saving on, the page also checks that the PDFs are really in the folder. Each folder is listed once and cached,
   and listed again when you come back to the window and after job folders are filed, so drawing the board never waits
   for the disk. Without folder access the tag only reflects the fields, as before. */
const folderFiles = new Map(); // folder path -> Set of file names, or null when the folder isn't there
let folderScanT = null,
  folderScanning = false,
  folderScanAgain = false;
async function scanFolders(fresh) {
  if (!dirHandle || !canWrite || VIEW_ONLY) return;
  if (folderScanning) {
    folderScanAgain = true;
    return;
  }
  folderScanning = true;
  let changed = false;
  try {
    const want = new Set(
      Object.values(live("jobs"))
        .map((x) => x.folder)
        .filter((f) => typeof f === "string" && f),
    );
    for (const f of want) {
      if (!fresh && folderFiles.has(f)) continue;
      let names = null;
      try {
        const d = await dirAt(f);
        names = new Set();
        for await (const [n, h] of d.entries()) if (h.kind === "file") names.add(n);
      } catch (e) {
        if (!e || e.name !== "NotFoundError") continue; // can't read it right now: keep what we knew
      }
      const old = folderFiles.get(f);
      const same =
        folderFiles.has(f) &&
        (old === names || (old && names && old.size === names.size && [...names].every((n) => old.has(n))));
      folderFiles.set(f, names);
      if (!same) changed = true;
    }
  } finally {
    folderScanning = false;
  }
  /* with a panel open the board is redrawn when it closes */
  if (changed && !$("#drawerRoot").childNodes.length) render();
  if (folderScanAgain) {
    folderScanAgain = false;
    scanFolders(true);
  }
}
const fileChecks = () => !!(dirHandle && canWrite && !VIEW_ONLY);
function docsTag(x, ln) {
  const d = docsOf(x);
  if (fileChecks() && x.folder) {
    if (!folderFiles.has(x.folder)) {
      clearTimeout(folderScanT);
      folderScanT = setTimeout(() => scanFolders(false), 0);
    } else {
      const have = folderFiles.get(x.folder);
      const rMiss = !!d.resume && !(have && have.has(x.resumeFile || CONFIG.files.resume));
      const lMiss = !!d.letter && !(have && have.has(x.letterFile || CONFIG.files.coverLetter));
      if (rMiss || lMiss) {
        if (laneOf("jobs", ln).done) return null;
        const what = rMiss && lMiss ? "Résumé and cover letter files" : rMiss ? "Résumé file" : "Cover letter file";
        return el("span", {
          class: "tag docmiss",
          title: `Not found in ${x.folder}`,
          text: `✗ ${what} missing`,
        });
      }
    }
  }
  if (d.resume && d.letter)
    return el("span", {
      class: "tag docok",
      title: "Tailored résumé and cover letter are ready (open them from the card)",
      text: "✓ Résumé + letter",
    });
  if (laneOf("jobs", ln).done) return null;
  const miss = !d.resume && !d.letter ? "No résumé or letter" : !d.resume ? "No résumé" : "No cover letter";
  return el("span", { class: "tag docmiss", title: "The tailored package isn't complete yet", text: "✗ " + miss });
}
function card(sec, id, x) {
  const S = SECTIONS[sec];
  const tags = [];
  const ln = laneKey(sec, x);
  const url = sec === "hunters" && x.tier && ln !== "todo" ? null : safeUrl(x.url);
  if (isNewFromTool(sec, id, x)) tags.push(el("span", { class: "tag new", text: "New from " + CONFIG.assistantName }));
  else if (ln === "todo" && justAdded(x)) tags.push(el("span", { class: "tag new", text: "Just added" }));
  if (isDue(sec, x)) {
    const late = Math.round((new Date(TODAY() + "T12:00:00") - new Date(x.followUp + "T12:00:00")) / 864e5);
    tags.push(
      el("span", {
        class: "tag fu",
        text: late > 0 ? `Follow up · ${late} day${late > 1 ? "s" : ""} late` : "Follow up today",
      }),
    );
  } else if (x.followUp && ln !== "todo" && !laneOf(sec, ln).done)
    tags.push(el("span", { class: "tag", title: "Next follow-up", text: "Follow up " + fmtDate(x.followUp) }));
  if (x.closedReason && laneOf(sec, ln).done) tags.push(el("span", { class: "tag", text: x.closedReason }));
  if (sec === "hunters" && x.submittedTo)
    tags.push(
      el("span", { class: "tag", title: "Roles they submitted me for", text: "Submitted for: " + x.submittedTo }),
    );
  if (sec === "jobs" && x.longShot && !laneOf(sec, ln).done)
    tags.push(el("span", { class: "tag", title: "Marked as a long shot", text: "Long shot" }));
  if (sec === "jobs") {
    const dt = docsTag(x, ln);
    if (dt) tags.push(dt);
  }
  if (sec === "jobs" || sec === "hunters") {
    try {
      tags.push(...Prep.cardTags(sec, id, x));
    } catch (e) {}
  }
  if (sec === "jobs" && personName(x.referralId))
    tags.push(el("span", { class: "tag", title: "Referral", text: "Referral: " + personName(x.referralId) }));
  if (sec === "people") {
    const n = jobsReferredBy(id).length;
    if (n) tags.push(el("span", { class: "tag", text: n === 1 ? "Referring 1 job" : `Referring ${n} jobs` }));
  }
  if (sec === "jobs" && ln === "todo") {
    const h = hunterConflict(x.company);
    if (h)
      tags.push(
        el("span", {
          class: "tag warn",
          title: "A headhunter submitted you at this company",
          text: "Submitted via " + h.name,
        }),
      );
  }
  const meta = S.meta(x);
  const sub = S.sub(x);
  let quick = null;
  const nextLane = {
    jobs: { todo: "applied" },
    hunters: { todo: "registered", registered: "contacted" },
    people: { todo: "asked" },
  }[sec][ln];
  const quickLabel = {
    applied: "Mark applied",
    registered: "Mark registered",
    contacted: "Mark reached out",
    asked: "Mark asked",
  };
  if (nextLane) {
    const L = laneOf(sec, nextLane);
    quick = el("button", {
      class: "quick",
      type: "button",
      "data-f": "quick",
      title: `Move to ${L.name}`,
      text: quickLabel[nextLane] || L.name,
      onclick: (e) => {
        e.stopPropagation();
        moveCard(sec, id, nextLane);
      },
    });
  }
  const pin =
    sec === "jobs" && ln === "todo"
      ? el("button", {
          class: "pin",
          type: "button",
          "data-f": "pin",
          "aria-pressed": String(!!x.pinned),
          "aria-label": x.pinned ? "Unstar" : "Star to apply first",
          title: x.pinned ? "Starred: shown first" : "Star to apply first",
          text: x.pinned ? "★" : "☆",
          onclick: (e) => {
            e.stopPropagation();
            upd("jobs", id, { pinned: !x.pinned, pinnedAt: x.pinned ? null : nowIso() });
            render();
            if (!x.pinned) showToast(`${x.company} starred: it's in Apply next on Next up.`);
          },
        })
      : null;
  const c = el(
    "article",
    {
      class: "card",
      tabindex: "0",
      draggable: "true",
      "data-key": `${sec}:${id}`,
      "data-f": "card",
      "aria-label": [S.title(x), sub].filter(Boolean).join(", "),
      onclick: (e) => {
        if (e.target.closest("a,button")) return;
        openDrawer(sec, id);
      },
      onkeydown: (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === c) {
          e.preventDefault();
          openDrawer(sec, id);
        }
      },
      ondragstart: (e) => {
        dragRef = { sec, id };
        c.classList.add("dragging");
        try {
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
        } catch (z) {}
      },
      ondragend: () => {
        c.classList.remove("dragging");
        dragRef = null;
        document.querySelectorAll(".lane.drop").forEach((n) => n.classList.remove("drop"));
      },
    },
    el("div", { class: "co" }, el("span", { text: S.title(x) }), pin),
    sub ? el("div", { class: "role", text: sub }) : null,
    meta ? el("div", { class: "meta", text: meta }) : null,
    url || tags.length || quick
      ? el(
          "div",
          { class: "row" },
          url
            ? el("a", { class: "post", href: url, target: "_blank", rel: "noopener noreferrer", text: S.linkLabel(x) })
            : null,
          ...tags,
          quick,
        )
      : null,
    x.notes ? el("div", { class: "note", text: x.notes }) : null,
  );
  return c;
}
