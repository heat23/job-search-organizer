/* ================= quick open (G or Ctrl/⌘ K): find any job, headhunter, person or guide question ================= */
const upFirst = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
let quickOpen = null;
function openLibDoc(id, anchor) {
  libDoc = id;
  libAnchor = anchor || null;
  section = "library";
  remember();
  render();
  window.scrollTo(0, 0);
}
function libIndex() {
  const out = [];
  for (const [id, D] of Object.entries(DOCS)) {
    if (!D.md) continue;
    const p = parse(D.md, { splitBold: D.splitBold });
    const used = {};
    const sid = (t) => {
      let k = "d-" + id + "-" + slug(t);
      while (used[k]) k += "x";
      used[k] = 1;
      return k;
    };
    const clean = (t) => String(t).replace(/[✎☐]/g, "").replace(/\s+/g, " ").trim();
    for (const s of p.secs) {
      const a = sid(s.title);
      out.push({
        lib: id,
        anchor: a,
        title: clean(s.title),
        sub: D.title,
        lane: "Prep library",
        hay: (clean(s.title) + " " + D.title).toLowerCase(),
      });
      for (const q of s.qs) {
        const b = sid(q.title);
        out.push({
          lib: id,
          anchor: b,
          title: clean(q.title),
          sub: D.title + " › " + clean(s.title),
          lane: "Prep library",
          hay: (clean(q.title) + " " + clean(s.title) + " " + D.title).toLowerCase(),
        });
      }
    }
  }
  return out;
}
function openQuick() {
  if (quickOpen) return;
  const prev = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "hqo";
  wrap.innerHTML = `<div class="hqscrim"></div><div class="hqbox" role="dialog" aria-label="Quick open"><input type="search" placeholder="Jump to a job, ${esc(SECTIONS.hunters.noun)}, ${esc(SECTIONS.people.noun)} or question…" aria-label="Quick open"><div class="hqlist" role="listbox"></div><div class="hqhint"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</div></div>`;
  document.body.append(wrap);
  quickOpen = wrap;
  const inp = $q("input", wrap),
    list = $q(".hqlist", wrap);
  let sel = 0,
    items = [];
  const all = [];
  for (const sec of BOARDS)
    for (const [id, x] of Object.entries(live(sec))) {
      const S = SECTIONS[sec];
      const laneId = laneKey(sec, x);
      const ln = laneOf(sec, laneId);
      all.push({
        sec,
        id,
        title: S.title(x),
        sub: S.sub(x) || "",
        lane: ln.name,
        laneId,
        done: !!ln.done,
        hay: [S.title(x), S.sub(x), x.company, x.firm, x.role, x.name].filter(Boolean).join(" ").toLowerCase(),
        call: callLive(x) ? shortCall(x.callAt) : "",
      });
    }
  let LIBX = null;
  /* booked calls first, then jobs in play, then headhunters, then everything else */
  const rank = (a) =>
    a.call
      ? 0
      : a.sec === "jobs"
        ? ["screen", "interview", "offer"].includes(a.laneId)
          ? 1
          : a.laneId === "applied"
            ? 2
            : a.done
              ? 6
              : 4
        : a.sec === "hunters"
          ? a.done
            ? 6
            : 3
          : 5;
  const firstSel = () => items.findIndex((a) => !a.note);
  const fallbacks = () =>
    CONFIG.library.sheetButtons
      .filter((b) => DOCS[b.doc])
      .map((b) => ({ lib: b.doc, title: DOCS[b.doc].title, sub: "From the Prep library", lane: "Prep library" }));
  function draw() {
    const words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const board = all
      .filter((a) => words.every((w) => a.hay.includes(w)))
      .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
      .slice(0, 10);
    let lib = [];
    if (words.length) {
      if (!LIBX) LIBX = libIndex();
      lib = LIBX.filter((a) => words.every((w) => a.hay.includes(w))).slice(0, 4);
    }
    items = board.concat(lib);
    if (!items.length)
      items = [
        {
          note: words.length
            ? `No job, ${SECTIONS.hunters.noun}, ${SECTIONS.people.noun} or question matches “${inp.value.trim()}”. Open a guide:`
            : "Type a name or a question.",
        },
        ...fallbacks(),
      ];
    if (sel >= items.length || items[sel].note) sel = Math.max(0, firstSel());
    list.innerHTML = items
      .map((a, i) =>
        a.note
          ? `<div class="hqi note" data-i="${i}">${esc(a.note)}</div>`
          : `<div class="hqi${i === sel ? " on" : ""}" role="option" data-i="${i}"><b>${esc(a.title)}</b><span>${esc(a.sub)}</span><small>${a.lib ? "" : esc(a.sec === "jobs" ? "Job" : upFirst(SECTIONS[a.sec].noun)) + " · "}<b class="hql">${esc(a.lane)}</b>${a.call ? " · 📞 " + esc(a.call) : ""}</small></div>`,
      )
      .join("");
  }
  function close(refocus) {
    wrap.remove();
    quickOpen = null;
    if (refocus !== false)
      try {
        prev && prev.isConnected && prev.focus({ preventScroll: true });
      } catch (e) {}
  }
  function go(a) {
    if (!a || a.note) {
      return;
    }
    close(false);
    if (a.lib) {
      closeDrawer();
      openLibDoc(a.lib, a.anchor);
    } else openDrawer(a.sec, a.id);
  }
  inp.addEventListener("input", () => {
    sel = 0;
    draw();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(items.length - 1, sel + 1);
      draw();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(Math.max(0, firstSel()), sel - 1);
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[sel]);
    }
  });
  list.addEventListener("click", (e) => {
    const q = e.target.closest(".hqi[data-i]");
    if (q) go(items[+q.dataset.i]);
  });
  $q(".hqscrim", wrap).onclick = () => close();
  draw();
  inp.focus();
}
