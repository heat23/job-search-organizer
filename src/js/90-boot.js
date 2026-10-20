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

/* The title: appTitle when organizer.config.js sets it, otherwise "<ownerName>'s job search" when a name is set, otherwise
   the default appTitle. */
const ownTitle = (() => {
  const u = window.ORGANIZER_CONFIG;
  return !!u && typeof u === "object" && typeof u.appTitle === "string" && !!u.appTitle.trim();
})();
document.title = !ownTitle && CONFIG.ownerName ? `${CONFIG.ownerName}'s job search` : CONFIG.appTitle;
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
$("#backupBtn").addEventListener("click", downloadBackup);
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
      const r = await readFileInto();
      if (r === "bad") {
        saveErr = "bad";
        folderOk = false;
      }
      /* today's copy of the data file, even if nothing gets saved today */
      if (r === "ok") await dailyBackup(lastRaw);
      if (r !== "bad" && fileBehind()) writeFile();
      setTimeout(() => fileJobs(true), 300);
      myResume();
    }
  }
  /* saving is off: the note about changes the file replaced shows now (with saving on, recordMerge shows it) */
  if (pendingRecord && pendingRecord.stale.size) setNote(lostNote(pendingRecord.stale.size, ""));
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
      folderOk = false;
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
    if (r === "ok" && lastRaw && fileBehind()) {
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
   The other tab's copy merges with this tab's field by field, with the same rule as the data file (see "merging" in
   store.js): the higher revision wins, a tie goes to the later copy (the other tab's), and a change either tab hasn't
   written to the file yet (its dirty fields travel with the copy) is never lost. */
function mergeOtherTab(raw) {
  const m = mergeStores(store, dirtyF, normalize(raw), dirtyIn(raw && raw._dirty), false);
  store = m.store;
  dirtyF = m.dirty;
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
    persistLocal(true);
    if (dirty) {
      clearTimeout(saveTimer);
      writeFile();
    }
  }
});
window.addEventListener("pagehide", () => {
  flushPending();
  persistLocal(true);
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
