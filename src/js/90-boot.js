/* ================= public hooks and start-up ================= */
/* The board calls into the prep features through this object; tests and the browser console can use it too. */
const Prep = {
  enhance,
  leaveField,
  renderUpcoming,
  renderLibrary,
  cardTags,
  renderDoc,
  parse,
  backupNow,
  snapshotNotes,
  scanPrep,
  refreshDocs,
  toText,
  docs: DOCS,
  prep: PREPTXT,
  _pads: pads,
  _FS: FS,
};
window.Prep = Prep;

document.title = CONFIG.ownerName ? `${CONFIG.ownerName}'s job search` : CONFIG.appTitle;
$("#appTitle").textContent = document.title;
$("#addBtn").addEventListener("click", () => openAdd(section === "next" ? "jobs" : section));
$("#search").addEventListener("input", (e) => {
  query = e.target.value.trim();
  render();
});
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.target.value = "";
    query = "";
    render();
    e.target.blur();
  }
});
$("#keysBtn").addEventListener("click", openKeys);
$("#backupBtn").addEventListener("click", () => {
  const blob = new Blob([serialize(store)], { type: "text/javascript" });
  const a = el("a", {
    href: URL.createObjectURL(blob),
    download: `${DATA_FILE.replace(/\.js$/, "")}_backup_${TODAY()}.js`,
  });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
});
$("#restoreBtn").addEventListener("click", openRestore);
$("#backupNotesBtn").addEventListener("click", () => backupNow(true));
$("#secondBackupBtn").addEventListener("click", pickSecond);
if (CONFIG.blurPay) document.body.classList.add("blurpay");

render();
/* this browser's copy, merged with the file, is kept at once (another open tab takes it from there) */
persistLocal();
if (!fileCopy && !localCopy && !FS_OK)
  showToast(`Couldn't find ${DATA_FILE} next to this page. Keep both files in the same folder.`);
(async () => {
  if (!FS_OK) return;
  /* A page that embeds the app can hand it a folder (the live demo uses one in memory); otherwise use the remembered one. */
  const h = window.ORGANIZER_FOLDER || (await idbGet("dir"));
  if (h) {
    dirHandle = h;
    try {
      canWrite = (await h.queryPermission({ mode: "readwrite" })) === "granted";
    } catch (e) {
      canWrite = false;
    }
    if (canWrite) {
      const before = collectionsOnly(store);
      const r = await readFileInto();
      if (r === "bad") {
        saveErr = "bad";
      }
      /* today's copy of the data file, even if nothing gets saved today */
      if (r === "ok") await dailyBackup(lastRaw);
      if (
        r !== "bad" &&
        (!fileCopy || collectionsOnly(store) !== collectionsOnly(fileCopy) || before !== collectionsOnly(store))
      )
        writeFile();
      setTimeout(() => fileJobs(true), 300);
      myResume();
    }
  }
  render();
})();
/* Once saving is on, the prep features start (new prep sheets, daily note backups), then every 20 minutes. */
const startTimer = setInterval(() => {
  if (FS.ok() && !startedUp) {
    startedUp = true;
    clearInterval(startTimer);
    startup();
    setInterval(startup, 20 * 60 * 1000);
  }
}, 2500);
/* Pick up changes another tool (a script, an AI assistant) made while this page was open: the data file first, then new
   prep sheets (reading the data file first keeps the time in which an edit typed in the panel could race it short).
   With a panel or prep sheet open, the changes are merged in the background: the notes pad stays as it is, the panel's
   fields show the merged values (except one you are typing in, see refreshDrawer), and the board is redrawn and job
   folders are filed when the panel closes. `focusRun` is the running pass (tests wait for it). */
const panelOpen = () => $("#drawerRoot").childNodes.length > 0;
let focusRun = null;
async function onFocus() {
  const ref = panelOpen() && openRef ? { ...openRef } : null;
  let recBefore = ref ? JSON.stringify(get(ref.sec, ref.id) || null) : "";
  let prepBefore = ref ? PREPTXT[ref.id] : undefined;
  const syncPanel = () => {
    if (!ref || !openRef || openRef.sec !== ref.sec || openRef.id !== ref.id) return;
    const rec = JSON.stringify(get(ref.sec, ref.id) || null);
    if (rec !== recBefore || PREPTXT[ref.id] !== prepBefore) {
      recBefore = rec;
      prepBefore = PREPTXT[ref.id];
      refreshDrawer();
    }
  };
  if (dirHandle && canWrite && !writing) {
    const before = collectionsOnly(store);
    const r = await readFileInto();
    if (r === "bad") {
      saveErr = "bad";
      renderStatus();
      syncPanel();
      return;
    }
    if (r === "ok" && saveErr === "bad") {
      saveErr = "";
      if (dirty) writeFile();
    }
    if (collectionsOnly(store) !== before) {
      persistLocal();
      if (panelOpen()) {
        fileOnClose = true;
        renderStatus();
      } else {
        render();
        /* a card moved by another tool gets its job folder filed by stage right away (every job is checked) */
        setTimeout(() => fileJobs(true), 50);
      }
    } else renderStatus();
    /* The file is missing something this browser has (a tool wrote back an older or partial copy, or a record was merged
       field by field): write it back. */
    if (r === "ok" && lastRaw && collectionsOnly(normalize(parseDataText(lastRaw))) !== collectionsOnly(store)) {
      gen++;
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(writeFile, 400);
    }
    syncPanel();
  }
  /* an open prep sheet checks its own prep.md; a plain panel does not, so its job is scanned like the rest */
  if (FS.ok()) {
    await scanPrep(
      panelOpen()
        ? {
            quiet: true,
            skip: openRef && openRef.sec === "jobs" && $("#drawerRoot .drawer.prep") ? openRef.id : null,
          }
        : undefined,
    );
    scanFolders(true);
  }
  syncPanel();
}
window.addEventListener("focus", () => {
  focusRun = onFocus();
});
/* Keep two open copies of the page in step. An open panel shows the other tab's change like a change from the folder.
   The other tab's records merge field by field: the field this browser changed last wins (see mergeTab), so every tab
   settles on the latest change. The values the other tab saw in the file are added to this tab's history. */
function mergeOtherTab(raw) {
  const theirs = normalize(raw);
  const tf = raw && raw._ft && typeof raw._ft === "object" ? raw._ft : {};
  const next = copyStore(store);
  for (const c of COLLS)
    for (const id of Object.keys(theirs[c])) {
      const k = c + ":" + id;
      next[c][id] = mergeTab(k, next[c][id], theirs[c][id], timesIn(tf[k]));
    }
  store = next;
  const at = new Map();
  for (const [k, H] of histIn(raw && raw._hist, theirs, at)) {
    seenAt.set(k, Math.max(seenAt.get(k) || 0, at.get(k)));
    const had = hist.get(k);
    if (!had) hist.set(k, H);
    else {
      const mine = { ...had };
      for (const [u, l] of Object.entries(H))
        mine[u] = [...seenOf(had, u), ...l.filter((x) => !seenOf(had, u).includes(x))].slice(0, HMAX);
      hist.set(k, mine);
    }
  }
}
window.addEventListener("storage", (e) => {
  if (e.key !== lsKey("board") || !e.newValue) return;
  try {
    const before = collectionsOnly(store);
    const recBefore = openRef ? JSON.stringify(get(openRef.sec, openRef.id) || null) : "";
    mergeOtherTab(JSON.parse(e.newValue));
    if (collectionsOnly(store) !== before) {
      persistLocal();
      if (canWrite) {
        gen++;
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(writeFile, 400);
      }
      if (!panelOpen()) render();
      else if (openRef && JSON.stringify(get(openRef.sec, openRef.id) || null) !== recBefore) refreshDrawer();
    }
  } catch (x) {}
});
/* Refresh "due today" when the date changes while the page is open, and take the new day's data backup. */
let shownDay = TODAY();
setInterval(
  () => {
    if (TODAY() !== shownDay) {
      shownDay = TODAY();
      if (!$("#drawerRoot").childNodes.length) render();
      backupToday();
    }
  },
  5 * 60 * 1000,
);
/* Save right away when you leave the tab or close it. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushPending();
    if (dirty) {
      clearTimeout(saveTimer);
      writeFile();
    }
  }
});
window.addEventListener("pagehide", () => {
  flushPending();
  persistLocal();
});
window.addEventListener("beforeunload", (e) => {
  flushPending();
  if (!VIEW_ONLY && canWrite && dirty) {
    clearTimeout(saveTimer);
    writeFile();
    e.preventDefault();
    e.returnValue = "";
  }
});
