/* ================= the Prep library tab: every guide, a search across all of them, a table of contents ================= */
let libDoc = CONFIG.library.defaultDoc,
  libAnchor = null;
function renderLibrary(v) {
  const groups = libGroups();
  if (!groups.length) {
    const m = document.createElement("p");
    m.className = "muted";
    m.style.padding = "16px";
    m.textContent =
      "No guides yet. Put Markdown files in the Library folder next to this page (the sample board has three to start from), then turn on saving.";
    v.append(m);
    return;
  }
  if (!DOCS[libDoc]) libDoc = DOCS[CONFIG.library.defaultDoc] ? CONFIG.library.defaultDoc : groups[0][1][0];
  const wrap = document.createElement("div");
  wrap.className = "hlib";
  const nav = document.createElement("nav");
  nav.className = "hlnav";
  nav.innerHTML =
    `<input type="search" class="hlsearch" placeholder="Search every guide  ( / )" aria-label="Search every guide">` +
    groups
      .map(
        ([g, ids]) =>
          `<div class="hlg">${esc(g)}</div>` +
          ids
            .map(
              (i) => `<a href="#" data-doc="${esc(i)}" class="${i === libDoc ? "on" : ""}">${esc(DOCS[i].title)}</a>`,
            )
            .join(""),
      )
      .join("");
  const read = document.createElement("article");
  read.className = "hlread";
  const toc = document.createElement("aside");
  toc.className = "hltoc";
  wrap.append(nav, read, toc);
  v.append(wrap);
  function show(docId, anchor) {
    libDoc = docId;
    $qa("a[data-doc]", nav).forEach((a) => a.classList.toggle("on", a.dataset.doc === docId));
    const D = DOCS[docId];
    if (!D) return;
    const r = renderDoc(D.md, "d-" + docId, { mineKey: docId, splitBold: D.splitBold });
    read.innerHTML = `<h1>${esc(r.title || D.title)}</h1>` + r.html;
    wireCopy(read);
    wireMine(read);
    toc.innerHTML = `<b>On this page</b>` + r.nav.map((n) => `<a href="#${n.id}">${esc(n.title)}</a>`).join("");
    if (anchor) {
      const t = read.querySelector("#" + cssId(anchor));
      if (t) setTimeout(() => t.scrollIntoView({ block: "start" }), 0);
    } else window.scrollTo(0, 0);
  }
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-doc]");
    if (a) {
      e.preventDefault();
      $q(".hlsearch", nav).value = "";
      show(a.dataset.doc);
    }
  });
  toc.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#']");
    if (a) {
      e.preventDefault();
      const t = read.querySelector("#" + cssId(a.getAttribute("href").slice(1)));
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  const srch = $q(".hlsearch", nav);
  srch.addEventListener("input", () => {
    const t = srch.value.trim().toLowerCase();
    if (!t) {
      show(libDoc);
      return;
    }
    const hits = [];
    for (const [id, D] of Object.entries(DOCS)) {
      if (!D.md) continue;
      const p = parse(D.md, { splitBold: D.splitBold });
      for (const s of p.secs) {
        const units = s.qs.length
          ? s.qs.map((q) => ({ t: q.title, body: q.lines.join(" "), pay: s.pay || q.pay }))
          : [{ t: s.title, body: s.pre.join(" "), pay: s.pay }];
        for (const u of units) {
          const plainT = (u.t + " " + u.body)
            .replace(/\*\*|\*|(^|\s)>\s?|:::\s*fold|\{\.pay\}|\|/g, " ")
            .replace(/\s+/g, " ");
          const k = plainT.toLowerCase().indexOf(t);
          if (k >= 0)
            hits.push({
              id,
              sec: s.title,
              t: u.t,
              len: u.body.length,
              real: u.body.length > 60,
              inTitle: String(u.t).toLowerCase().includes(t),
              pay: !!u.pay,
              snip: plainT.slice(Math.max(0, k - 40), k + 100),
            });
        }
      }
    }
    /* real answers first (a one-line mention or a short answer comes after), then a hit in the question itself,
       then the longer answer */
    hits.sort((a, b) => b.real - a.real || b.inTitle - a.inTitle || b.len - a.len);
    $qa("a[data-doc]", nav).forEach((a) => a.classList.remove("on"));
    const snip = (h) =>
      h.pay && CONFIG.blurPay ? `<span class="paynote-s">Pay: open it to see</span>` : `<span>…${esc(h.snip)}…</span>`;
    read.innerHTML =
      `<h1>Search: “${esc(srch.value)}”</h1>` +
      (hits.length
        ? hits
            .slice(0, 80)
            .map(
              (h) =>
                `<a class="hit" href="#" data-doc="${esc(h.id)}" data-sec="${esc(h.t)}"><b>${inline(h.t)}</b><small>${esc(DOCS[h.id].title)}${h.t !== h.sec ? " › " + esc(h.sec) : ""}</small>${snip(h)}</a>`,
            )
            .join("")
        : `<p class="muted">Nothing found.</p>`);
    toc.innerHTML = "";
  });
  srch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const a = $q("a.hit", read);
      if (a) {
        e.preventDefault();
        a.click();
      }
    }
  });
  read.addEventListener("click", (e) => {
    const a = e.target.closest("a.hit");
    if (!a) return;
    e.preventDefault();
    const id = a.dataset.doc;
    srch.value = "";
    show(id, "d-" + id + "-" + slug(a.dataset.sec));
  });
  show(libDoc, libAnchor);
  libAnchor = null;
  refreshDocs(true).then((ch) => {
    if (ch && v.isConnected && section === "library" && !srch.value) {
      v.textContent = "";
      renderLibrary(v);
    }
  });
}
/* Coming back to the window re-reads the guides, so a file you just edited or added shows up. */
window.addEventListener("focus", async () => {
  if (
    section === "library" &&
    !$("#drawerRoot").childNodes.length &&
    !($q(".hlsearch") || {}).value &&
    (await refreshDocs(true))
  )
    render();
});
