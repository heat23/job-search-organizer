// Start-up for the live demo page (built by tools/build-demo.mjs). It runs before the app and:
//   1. fills a folder in memory with the sample board (window.DEMO_SEED), so the app runs in any browser;
//   2. moves every date in the sample so it looks current on the day you open it;
//   3. starts from a clean copy on each visit, and opens the résumé PDFs from the in-memory folder.
(function () {
  const seed = window.DEMO_SEED;
  const prefix = seed.config.storagePrefix + ":";

  /* 1. a clean start: forget anything an earlier visit left in this browser */
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
  } catch (e) {}
  try {
    if (indexedDB.databases)
      indexedDB.databases().then((dbs) => {
        for (const d of dbs) if (d.name && d.name.startsWith(prefix)) indexedDB.deleteDatabase(d.name);
      });
  } catch (e) {}

  /* open on the Jobs board: it shows what the app is at a glance */
  try {
    const dir = decodeURIComponent(location.pathname.replace(/[^/]*$/, ""));
    localStorage.setItem(prefix + dir + ":section", "jobs");
  } catch (e) {}

  /* 2. shift the sample's dates by the days since it was made */
  const dayMs = 864e5;
  const utcDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const now = new Date();
  const shift = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - utcDay(seed.madeOn)) / dayMs);
  const moveDates = (text) =>
    text.replace(/\b(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?/g, (m, d, t) => {
      const moved = new Date(utcDay(d) + shift * dayMs).toISOString().slice(0, 10);
      return moved + (t || "");
    });
  const files = { ...seed.files };
  files["board_data.js"] = moveDates(files["board_data.js"]);
  const t = files["board_data.js"];
  window.BOARD_DATA = JSON.parse(t.slice(t.indexOf("{", t.indexOf("window.BOARD_DATA")), t.lastIndexOf("}") + 1));
  window.ORGANIZER_LIBRARY = seed.library;
  window.ORGANIZER_CONFIG = seed.config;

  /* the folder: text files as they are, PDFs from base64 */
  for (const [p, b64] of Object.entries(seed.binary)) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    files[p] = new Blob([bytes], { type: "application/pdf" });
  }
  const yesterday = Date.now() - dayMs;
  const folder = window.MemFS.fromFiles("Sample job search", files, yesterday);
  const backup = new window.MemFS.MemDir("Backup drive");
  window.ORGANIZER_FOLDER = folder;
  window.showDirectoryPicker = async (o) => (o && /backup/i.test(o.id || "") ? backup : folder);

  /* 3. résumé and cover-letter links open the PDF from the in-memory folder (the link is pointed at it just before it opens) */
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const src = a.dataset.file || a.getAttribute("href");
      if (!/\.pdf$/i.test(src)) return;
      const f = folder.at(decodeURIComponent(src));
      if (!f || f.kind !== "file") return;
      a.dataset.file = src;
      a.href = URL.createObjectURL(new Blob([f.data], { type: "application/pdf" }));
    },
    true,
  );
})();
