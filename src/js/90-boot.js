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
$("#backupNotesBtn").addEventListener("click", () => backupNow(true));
$("#secondBackupBtn").addEventListener("click", pickSecond);
if (CONFIG.blurPay) document.body.classList.add("blurpay");

render();
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
      if (
        r !== "bad" &&
        (!fileCopy || collectionsOnly(store) !== collectionsOnly(fileCopy) || before !== collectionsOnly(store))
      )
        writeFile();
      setTimeout(fileJobs, 300);
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
/* Pick up changes another tool (a script, an AI assistant) made while this page was open: new prep sheets, then the data file.
   With a panel or prep sheet open, the changes are merged in the background: the notes pad stays as it is, the panel's
   fields show the merged values (except one you are typing in, see refreshDrawer), and the board is redrawn and job
   folders are filed when the panel closes. */
const panelOpen = () => $("#drawerRoot").childNodes.length > 0;
window.addEventListener("focus", async () => {
  const ref = panelOpen() && openRef ? { ...openRef } : null;
  const recBefore = ref ? JSON.stringify(get(ref.sec, ref.id) || null) : "";
  const prepBefore = ref ? PREPTXT[ref.id] : undefined;
  const syncPanel = () => {
    if (!ref || !openRef || openRef.sec !== ref.sec || openRef.id !== ref.id) return;
    if (JSON.stringify(get(ref.sec, ref.id) || null) !== recBefore || PREPTXT[ref.id] !== prepBefore) refreshDrawer();
  };
  /* an open prep sheet checks its own prep.md; a plain panel does not, so its job is scanned like the rest */
  if (FS.ok())
    await scanPrep(
      panelOpen()
        ? {
            quiet: true,
            skip: openRef && openRef.sec === "jobs" && $("#drawerRoot .drawer.prep") ? openRef.id : null,
          }
        : undefined,
    );
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
        /* a card moved by another tool gets its job folder filed by stage right away */
        setTimeout(fileJobs, 50);
      }
    } else renderStatus();
    /* The file is missing something this browser has (a tool wrote back an older or partial copy): write it back. */
    if (r === "ok" && lastRaw && collectionsOnly(normalize(parseDataText(lastRaw))) !== collectionsOnly(store)) {
      gen++;
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(writeFile, 400);
    }
  }
  syncPanel();
});
/* Keep two open copies of the page in step. */
window.addEventListener("storage", (e) => {
  if (e.key !== lsKey("board") || !e.newValue) return;
  try {
    const before = collectionsOnly(store);
    store = merge(store, normalize(JSON.parse(e.newValue)));
    if (collectionsOnly(store) !== before) {
      if (canWrite) {
        gen++;
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(writeFile, 400);
      }
      if (!$("#drawerRoot").childNodes.length) render();
    }
  } catch (x) {}
});
/* Refresh "due today" when the date changes while the page is open. */
let shownDay = TODAY();
setInterval(
  () => {
    if (TODAY() !== shownDay) {
      shownDay = TODAY();
      if (!$("#drawerRoot").childNodes.length) render();
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
