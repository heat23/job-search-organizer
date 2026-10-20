/* ================= saving to your folder (File System Access API: Chrome and Edge) =================
   You pick the folder this page lives in once; Chrome remembers the permission. Every change is kept in this
   browser at once and written to the data file 400 ms later. Each day the file as it was goes to backups/: before the
   first write of the day, or at start-up, on a new day and every 20 minutes when nothing was written yet. */
const FS_OK = typeof window.showDirectoryPicker === "function";
const VIEW_ONLY = !FS_OK;
if (VIEW_ONLY) document.documentElement.classList.add("viewonly");
let filing = false,
  fileAgain = false,
  fileOnClose = false;
let dirHandle = null,
  canWrite = false,
  saveTimer = null,
  lastSaved = null,
  saveErr = "",
  dirty = false,
  writing = false;
let localOk = true,
  myLocalOk = true;
/* This browser's copy is kept together with the merge history (see hist in store.js), in one entry so another tab always
   gets a matching pair. When browser storage is full the copy is kept without its history (after a reload, records then
   merge by the newer updatedAt until there is room again), and the status line says so once. */
let lastLocal = "",
  statusNote = "",
  histNoted = false;
function setNote(msg) {
  statusNote = msg;
  statusSig = "";
  renderStatus();
}
function persistLocal() {
  let text;
  try {
    text = JSON.stringify({ ...store, _hist: histOut(store), _ft: ftimeOut() });
  } catch (e) {
    text = JSON.stringify(store);
  }
  if (text === lastLocal) return localOk;
  let full = lsSet("board", text);
  localOk = full || lsSet("board", JSON.stringify(store));
  if (localOk) lastLocal = text;
  if (localOk && !full && !histNoted) {
    histNoted = true;
    setNote(
      "Browser storage is full, so this page kept your board without its merge history: until there is room, the newer copy of a changed card wins.",
    );
  }
  return localOk;
}
let gen = 0;
function persist() {
  gen++;
  dirty = true;
  persistLocal();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeFile, 400);
  if (!canWrite) renderBanner();
  renderStatus();
}
let lastRaw = "",
  lastMeta = "",
  syncedText = "";
const metaOf = (f) => f.lastModified + ":" + f.size;
async function readFileInto() {
  if (!dirHandle) return "none";
  let t;
  lastRaw = "";
  lastMeta = "";
  try {
    const fh = await dirHandle.getFileHandle(DATA_FILE);
    const f = await fh.getFile();
    lastMeta = metaOf(f);
    t = await f.text();
  } catch (e) {
    return "missing";
  }
  lastRaw = t;
  if (!t.trim()) return "missing";
  /* the same text as at the last read or write: nothing to merge */
  if (t === syncedText) return "ok";
  const stale = new Set();
  try {
    const raw = parseDataText(t);
    extras = Object.create(null);
    keepExtras(raw);
    const n = normalize(raw);
    const next = copyStore(store);
    for (const c of COLLS)
      for (const id of Object.keys(n[c])) {
        const k = c + ":" + id,
          r = n[c][id];
        /* unchanged since the last read or write: nothing to merge */
        if (fileRecs[k] && sameRec(fileRecs[k], r)) continue;
        next[c][id] = mergeFile(k, next[c][id], r, stale);
        rememberFile(k, r);
        fileRecs[k] = r;
      }
    store = next;
    persistLocal();
    checkWrapper(t);
    syncedText = t;
  } catch (e) {
    return "bad";
  }
  if (stale.size) await keepOlder(t, stale.size);
  return "ok";
}
/* The file held older values that this page kept your newer ones over (see mergeFile): the file as it was goes to
   backups/ once a day, and the status line says so. */
async function keepOlder(raw, n) {
  if (dirHandle && canWrite)
    try {
      const bdir = await dirHandle.getDirectoryHandle("backups", { create: true });
      const name = `${DATA_FILE.replace(/\.js$/, "")}_older_${TODAY()}.js`;
      let exists = true;
      try {
        await bdir.getFileHandle(name);
      } catch (e) {
        exists = false;
      }
      if (!exists) {
        const w = await (await bdir.getFileHandle(name, { create: true })).createWritable();
        await w.write(raw);
        await w.close();
      }
    } catch (e) {}
  setNote(`Kept your newer changes to ${n} card${n === 1 ? "" : "s"}; the file's older copy is in backups/.`);
}
let wrapperWarned = "";
function checkWrapper(t) {
  if (wrapperOk(t) || wrapperWarned === t) return;
  wrapperWarned = t;
  const m = `${DATA_FILE} holds something besides the data: text before or after window.BOARD_DATA = {…};. The page loads that file as a script, so check which tool wrote it. The next save writes a clean copy.`;
  try {
    console.warn(m);
  } catch (e) {}
  showToast(m);
}
async function writeFile() {
  if (!dirHandle || !canWrite) {
    renderStatus();
    return;
  }
  if (writing) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeFile, 300);
    return;
  }
  writing = true;
  try {
    const g = gen;
    const r = await readFileInto();
    if (r === "bad") {
      saveErr = "bad";
    } else {
      await dailyBackup(lastRaw);
      /* What is written is a copy taken now: an edit made while the file is being written is not in the file, so it
         must not count as what the file holds. Right before writing, the file is checked again: when another tool
         wrote it since the read, it is merged first (up to three times). */
      let snap, w, fh;
      for (let tries = 0; ; tries++) {
        snap = copyStore(store);
        fh = await dirHandle.getFileHandle(DATA_FILE, { create: true });
        w = await fh.createWritable();
        if (tries >= 3 || !lastMeta || metaOf(await fh.getFile()) === lastMeta) break;
        try {
          await w.abort();
        } catch (e) {}
        if ((await readFileInto()) === "bad") throw new Error("bad");
      }
      const text = serialize(snap);
      await w.write(text);
      await w.close();
      syncedText = text;
      lastMeta = metaOf(await fh.getFile());
      for (const c of COLLS)
        for (const id of Object.keys(snap[c]))
          if (fileRecs[c + ":" + id] !== snap[c][id]) rememberFile(c + ":" + id, snap[c][id]);
      setFileRecs(snap);
      persistLocal();
      lastSaved = new Date();
      saveErr = "";
      if (gen === g && collectionsOnly(store) === collectionsOnly(snap)) dirty = false;
      else {
        /* changed while writing (an edit, another tab's copy): write again */
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(writeFile, 400);
      }
      setTimeout(fileJobs, 50);
      myResume();
    }
  } catch (e) {
    if (e && e.name === "NotFoundError") {
      dirHandle = null;
      canWrite = false;
      saveErr = "";
      await idbSet("dir", null);
      showToast("Couldn't find your board folder. It may have been moved. Click Turn on saving and pick it again.");
    } else {
      saveErr = e && e.message === "bad" ? "bad" : "write";
      if (e && e.name === "NotAllowedError") canWrite = false;
    }
  }
  writing = false;
  render();
}
let backedUpDay = null;
/* Before the first save of each day, keep the file exactly as it was (including anything another tool wrote). */
async function dailyBackup(rawBefore) {
  const day = TODAY();
  if (backedUpDay === day || !dirHandle || !canWrite || !rawBefore || !rawBefore.trim()) return;
  try {
    const bdir = await dirHandle.getDirectoryHandle("backups", { create: true });
    const base = DATA_FILE.replace(/\.js$/, "");
    const name = `${base}_${day}.js`;
    let exists = true;
    try {
      await bdir.getFileHandle(name);
    } catch (e) {
      exists = false;
    }
    if (!exists) {
      const fh = await bdir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(rawBefore);
      await w.close();
    }
    backedUpDay = day;
    /* the daily copies, the older copies kept by a merge and the copies saved before a restore: the newest few of each */
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const kinds = ["", "older_", "before_restore_"].map(
      (k) => new RegExp("^" + esc + "_" + k + "\\d{4}-\\d{2}-\\d{2}[\\d_]*\\.js$"),
    );
    const names = kinds.map(() => []);
    for await (const [n, h] of bdir.entries())
      if (h.kind === "file") kinds.forEach((re, i) => re.test(n) && names[i].push(n));
    for (const list of names) {
      list.sort();
      for (const n of list.slice(0, Math.max(0, list.length - CONFIG.backups.boardDays)))
        try {
          await bdir.removeEntry(n);
        } catch (e) {}
    }
  } catch (e) {}
}

/* A day with no edits still gets its backup (called at start-up, when the date changes and every 20 minutes). */
async function backupToday() {
  if (!dirHandle || !canWrite || writing || backedUpDay === TODAY()) return;
  let t = "";
  try {
    t = await (await (await dirHandle.getFileHandle(DATA_FILE)).getFile()).text();
    parseDataText(t);
  } catch (e) {
    return; // no file yet, or a broken one: the next good save takes the backup
  }
  await dailyBackup(t);
}

/* ================= filing each job's documents folder by stage =================
   A job's folder lives in <board folder>/<stage folder>/<job folder>. When a card changes lane the page moves the folder
   (copy every file, check sizes, then remove the old copy) and updates "folder", so the Résumé and Cover letter buttons keep working.
   The folder is looked for at its "folder" path and under each stage folder by its name (where a tool or a person may
   have moved it); a folder anywhere else is not searched for. */
const STAGE_DIR = CONFIG.stageFolders;
const REMOVED_DIR = CONFIG.stageFolders.removed,
  PURGE_DAYS = CONFIG.removedPurgeDays;
const STAGE_DIRS = [...new Set(Object.values(STAGE_DIR))];
function splitFolder(f) {
  const c = canonFolder(String(f || ""));
  const p = c.split("/");
  return p.length > 1 && STAGE_DIRS.includes(p[0])
    ? { stage: p[0], name: p.slice(1).join("/") }
    : { stage: "", name: c };
}
/* Folders at the top of the board that are never a job's folder (a job's "folder" naming one of them would move it). */
const RESERVED_DIRS = ["Library", "Job notes", "backups"];
const sameName = (a, b) => String(a).normalize("NFC").toLowerCase() === String(b).normalize("NFC").toLowerCase();
/* Why a job's "folder" value can't be a job folder, or "" when it can. Checked before anything is moved or linked:
   it must be a relative path inside the board, not a stage folder, Library, Job notes or backups, nor the board itself. */
/* The board's own files: a "folder" naming one of them would move it. Other names with a dot ("Acme - Node.js") are
   folders like any other. */
const BOARD_FILES = [DATA_FILE, "organizer.config.js", "organizer.html", "index.html", "AGENTS.md", "CLAUDE.md"];
function badFolder(f) {
  if (typeof f !== "string" || !f.trim()) return "it's empty";
  if (/^[\\/]|^[A-Za-z]:|^~/.test(f)) return "it's an absolute path";
  f = canonFolder(f);
  if (f.includes("\\")) return "it has a backslash (use / between folders)";
  const segs = f.split("/");
  if (segs.some((x) => !x.trim() || x === "." || x === "..")) return "it has an empty, . or .. part";
  if (RESERVED_DIRS.some((r) => sameName(r, segs[0]))) return `it points into ${segs[0]}/`;
  if (segs.length === 1 && BOARD_FILES.some((n) => sameName(n, segs[0]))) return "it names one of the board's files";
  const { name } = splitFolder(f);
  const first = name.split("/")[0];
  if (STAGE_DIRS.some((d) => sameName(d, f) || sameName(d, first))) return "it names a stage folder, not a job folder";
  return "";
}
async function dirAt(path, create) {
  let d = dirHandle;
  for (const part of String(path).split("/").filter(Boolean))
    d = await d.getDirectoryHandle(part, { create: !!create });
  return d;
}
async function hasDir(path) {
  try {
    await dirAt(path);
    return true;
  } catch (e) {
    return false;
  }
}
/* Copies src into dst. The list of entries is taken first, and a folder that is the destination itself is skipped, so a
   copy can never walk into the copy it is making. */
async function copyFolder(src, dst, root) {
  root = root || dst;
  const list = [];
  for await (const e of src.entries()) list.push(e);
  for (const [n, h] of list) {
    if (h.kind === "file") {
      const f = await h.getFile();
      const o = await dst.getFileHandle(n, { create: true });
      const w = await o.createWritable();
      await w.write(f);
      await w.close();
      if ((await (await dst.getFileHandle(n)).getFile()).size !== f.size) throw new Error("copy check failed: " + n);
    } else {
      let self = false;
      try {
        self = await h.isSameEntry(root);
      } catch (e) {}
      if (self) throw new Error("a folder can't be copied into itself");
      await copyFolder(h, await dst.getDirectoryHandle(n, { create: true }), root);
    }
  }
}
const inside = (to, from) => to === from || to.startsWith(from + "/");
async function moveDir(from, to) {
  if (inside(to, from) || inside(from, to)) throw new Error("a folder can't move into itself");
  const parts = to.split("/"),
    name = parts.pop();
  const src = await dirAt(from);
  const parent = await dirAt(parts.join("/"), true);
  let clash = true;
  try {
    await parent.getDirectoryHandle(name);
  } catch (e) {
    clash = false;
  }
  if (clash) throw new Error("already there");
  await copyFolder(src, await parent.getDirectoryHandle(name, { create: true }));
  const fp = from.split("/"),
    fname = fp.pop();
  await (await dirAt(fp.join("/"))).removeEntry(fname, { recursive: true });
}
/* Filing works on the jobs whose stage or folder changed since they were last filed (one save never lists every folder).
   fileJobs(true) checks every job: at start-up, when another tool changed the data file, and when a panel closes after
   such a change. Removed jobs' folders are checked for deletion once a day. */
const filedSig = new Map();
const fileSig = (x) => [x.deleted ? 1 : 0, laneKey("jobs", x), x.folder || ""].join("|");
let purgedDay = "",
  fileFull = false;
const badWarned = new Set();
/* A move that failed is tried again on the next filing pass (after the next save); its message shows once. */
const failWarned = new Map();
async function fileJobs(full) {
  if (!dirHandle || !canWrite || VIEW_ONLY) return;
  if (full === true) fileFull = true;
  if (filing) {
    fileAgain = true;
    return;
  }
  filing = true;
  const all = fileFull;
  fileFull = false;
  const purge = all || purgedDay !== TODAY();
  const moved = [],
    failed = [],
    bad = [],
    rescan = [];
  const fail = (id, x, nm) => {
    filedSig.delete(id);
    const sig = fileSig(x);
    if (failWarned.get(id) === sig) return;
    failWarned.set(id, sig);
    failed.push(x.company || nm);
  };
  try {
    for (const [id, x] of Object.entries(store.jobs)) {
      if (!x || !x.folder) {
        filedSig.delete(id);
        continue;
      }
      const sig = fileSig(x);
      const removedWaiting = x.deleted && splitFolder(x.folder).stage === REMOVED_DIR;
      if (!all && filedSig.get(id) === sig && !(purge && removedWaiting)) continue;
      filedSig.set(id, sig);
      const why = badFolder(x.folder);
      if (why) {
        const k = id + "|" + x.folder;
        if (!badWarned.has(k)) {
          badWarned.add(k);
          bad.push(`${x.company || id} (“${x.folder}”: ${why})`);
        }
        continue;
      }
      const want = x.deleted ? REMOVED_DIR : STAGE_DIR[laneKey("jobs", x)];
      if (!want) continue;
      const { stage, name } = splitFolder(x.folder);
      /* A removed card's files wait in the removed folder (Restore brings them back), then are deleted for good. */
      if (removedWaiting) {
        if (!purge) continue;
        const since = Date.parse(x.removedAt || x.updatedAt || "");
        if (since && Date.now() - since > PURGE_DAYS * 864e5) {
          try {
            await (await dirAt(REMOVED_DIR)).removeEntry(name, { recursive: true });
          } catch (e) {
            if (!e || e.name !== "NotFoundError") {
              fail(id, x, name);
              continue;
            }
          }
          const r = store.jobs[id];
          setRec("jobs", id, { ...r, folder: null, filesDeletedAt: nowIso(), updatedAt: stamp(r), changedBy: "you" });
          filedSig.delete(id);
          persist();
        }
        continue;
      }
      if (stage === want) {
        failWarned.delete(id);
        continue;
      }
      const target = want + "/" + name;
      try {
        let from = null;
        for (const c of [x.folder, ...STAGE_DIRS.map((s) => s + "/" + name)])
          if (c !== target && !inside(target, c) && !inside(c, target) && (await hasDir(c))) {
            from = c;
            break;
          }
        const there = await hasDir(target);
        if (from && there) {
          fail(id, x, name);
          continue;
        }
        if (from) {
          await moveDir(from, target);
          moved.push(x.company || name);
        } else if (!there) {
          fail(id, x, name);
          continue;
        }
        const r = store.jobs[id];
        setRec("jobs", id, { ...r, folder: target, updatedAt: stamp(r), changedBy: "you" });
        filedSig.set(id, fileSig(store.jobs[id]));
        failWarned.delete(id);
        rescan.push(target);
        persist();
      } catch (e) {
        fail(id, x, name);
      }
    }
    if (purge) purgedDay = TODAY();
  } finally {
    filing = false;
  }
  if (moved.length || failed.length || bad.length) render();
  /* only the folders that moved are listed again (every folder is listed when you come back to the window) */
  if (rescan.length) scanFolders(true, rescan);
  if (bad.length)
    showToast(
      `Didn't move the folder for ${bad.join("; ")}. A job's "folder" must be its own folder, such as “${STAGE_DIR.todo}/Acme - Engineer”. Nothing was moved.`,
    );
  else if (failed.length && !lastUndo)
    showToast(`Couldn't file the folder for ${failed.join(", ")}. Nothing was lost; check the stage folders.`);
  else if (moved.length > 1 && !lastUndo) showToast(`Filed ${moved.length} job folders by stage.`);
  if (fileAgain) {
    fileAgain = false;
    setTimeout(fileJobs, 50);
  }
}

/* ================= folder permission ================= */
/* Handles are stored per board folder, so a sample board and your real board never share one. */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(lsKey("handles"), 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const q = d.transaction("kv").objectStore("kv").get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}
async function idbSet(k, v) {
  try {
    const d = await idb();
    await new Promise((res) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").put(v, k);
      t.oncomplete = res;
      t.onerror = res;
    });
  } catch (e) {}
}
async function connectFolder() {
  if (!FS_OK) return;
  try {
    const h = await window.showDirectoryPicker({ id: CONFIG.pickerIds.board, mode: "readwrite" });
    let fresh = false;
    try {
      await h.getFileHandle(DATA_FILE);
    } catch (e) {
      /* A new board: an empty folder is fine, the data file is created. A folder with other files needs the page next to it. */
      let other = false;
      for await (const [n] of h.entries())
        if (!n.startsWith(".")) {
          other = true;
          break;
        }
      if (other) {
        showToast(
          `Pick the folder this page is in (the one that holds ${DATA_FILE}), or an empty folder to start a new board.`,
        );
        return;
      }
      fresh = true;
    }
    dirHandle = h;
    canWrite = true;
    await idbSet("dir", h);
    const warned = wrapperWarned;
    await writeFile();
    /* a warning about the data file (see checkWrapper) stays up instead of this message */
    if (!saveErr && wrapperWarned === warned)
      showToast(
        fresh
          ? `Saving is on. ${DATA_FILE} was created in “${h.name}”; keep this page in that folder.`
          : "Saving to your folder is on. Job folders now move by themselves when a job changes stage.",
      );
  } catch (e) {
    if (!e || e.name !== "AbortError") showToast("Couldn't open that folder. Try again.");
  }
}
async function allowAgain() {
  if (!dirHandle) return connectFolder();
  try {
    const p = await dirHandle.requestPermission({ mode: "readwrite" });
    canWrite = p === "granted";
    if (canWrite) await writeFile();
    else renderStatus();
  } catch (e) {
    connectFolder();
  }
}
/* Ask for permission again on your first click, so saving resumes without a separate step. */
document.addEventListener(
  "pointerdown",
  function ask() {
    if (!FS_OK || canWrite) {
      document.removeEventListener("pointerdown", ask, true);
      return;
    }
    if (dirHandle && !canWrite) {
      document.removeEventListener("pointerdown", ask, true);
      allowAgain();
    }
  },
  true,
);
let statusSig = "";
function renderStatus() {
  const s = $("#status");
  if (!s) return;
  const bannerUp = !!$("#banner .banner");
  const sig = [
    FS_OK,
    localOk,
    myLocalOk,
    !!dirHandle,
    canWrite,
    saveErr,
    dirty,
    lastSaved && lastSaved.getTime(),
    bannerUp,
    statusNote,
  ].join("|");
  if (sig === statusSig) return;
  statusSig = sig;
  s.textContent = "";
  s.className = "status";
  const dot = () => el("span", { class: "sdot" });
  if (!FS_OK) return;
  const extra = () => (statusNote ? el("span", { class: "snote", text: statusNote }) : "");
  if ((!localOk || !myLocalOk) && (!dirHandle || !canWrite)) {
    s.classList.add("bad");
    s.append(
      dot(),
      "This browser couldn't save your last change. Turn on saving to your folder so nothing is lost.",
      el("button", {
        class: "btn small",
        type: "button",
        text: dirHandle ? "Resume saving" : "Turn on saving to your folder",
        onclick: dirHandle ? allowAgain : connectFolder,
      }),
    );
    return;
  }
  if (!dirHandle) {
    if (bannerUp) return;
    s.classList.add("warn");
    s.append(
      dot(),
      "Not saved to your folder yet",
      el("button", { class: "btn small", type: "button", text: "Turn on saving", onclick: connectFolder }),
      extra(),
    );
    return;
  }
  if (!canWrite) {
    if (bannerUp) return;
    s.classList.add("warn");
    s.append(
      dot(),
      "Saving to your folder is paused.",
      el("button", { class: "btn small", type: "button", text: "Resume saving", onclick: allowAgain }),
      extra(),
    );
    return;
  }
  if (saveErr === "bad") {
    s.classList.add("bad");
    s.append(
      dot(),
      `${DATA_FILE} has an error, so it wasn't overwritten. Your changes are safe in this browser. Fix the file, or use Restore a backup… at the bottom of the page.`,
      el("button", { class: "btn small", type: "button", text: "Try again", onclick: writeFile }),
    );
    return;
  }
  if (saveErr) {
    s.classList.add("bad");
    s.append(
      dot(),
      "Couldn't save to your folder. Your changes are kept in this browser.",
      el("button", { class: "btn small", type: "button", text: "Try again", onclick: writeFile }),
    );
    return;
  }
  s.classList.add("ok");
  if (CONFIG.demo) {
    s.append(dot(), "Demo: changes stay in this tab");
    return;
  }
  s.append(
    dot(),
    dirty
      ? "Saving…"
      : lastSaved
        ? `Saved to your folder at ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Saving to your folder",
    extra(),
  );
}

function renderBanner() {
  const b = $("#banner");
  if (!b) return;
  b.textContent = "";
  if (CONFIG.demo) {
    if (lsGet("demoHidden", "")) return;
    b.append(
      el(
        "div",
        { class: "banner demob", role: "region", "aria-label": "Live demo" },
        el(
          "div",
          {},
          el("strong", { text: "Live demo. " }),
          "A made-up senior engineer's job search, running in your browser. In real use, your AI assistant keeps the board and prep sheets up to date; here you can drag a card, open a job to see its prep sheet, or type in the notes. Nothing is uploaded, and reloading starts over.",
        ),
        el(
          "div",
          { class: "acts" },
          CONFIG.demo.repoUrl
            ? el("a", { class: "btn primary small", href: CONFIG.demo.repoUrl, text: "Get it on GitHub" })
            : null,
          el("button", {
            class: "btn small",
            type: "button",
            text: "Hide",
            onclick: () => {
              lsSet("demoHidden", "1");
              renderBanner();
            },
          }),
        ),
      ),
    );
    return;
  }
  if (VIEW_ONLY) {
    b.append(
      el(
        "div",
        { class: "banner warnb", role: "region", "aria-label": "View only" },
        el(
          "div",
          {},
          el("strong", { text: "View only in this browser. " }),
          "It can't save to a folder on your computer. To make changes, open this page in Chrome or Edge on a desktop computer.",
        ),
      ),
    );
    return;
  }
  if (dirHandle && canWrite) return;
  const n = unsyncedCount();
  if (dirHandle && !canWrite) {
    if (!n) return;
    b.append(
      el(
        "div",
        { class: "banner warnb", role: "region", "aria-label": "Saving paused" },
        el(
          "div",
          {},
          el("strong", { text: `${n} change${n > 1 ? "s" : ""} not in your folder yet. ` }),
          "Allow saving so they're kept.",
        ),
        el(
          "div",
          { class: "acts" },
          el("button", { class: "btn primary small", type: "button", text: "Resume saving", onclick: allowAgain }),
        ),
      ),
    );
    return;
  }
  const later = lsGet("bannerLater", "");
  if (!n && later === TODAY()) return;
  b.append(
    el(
      "div",
      { class: "banner" + (n ? " warnb" : ""), role: "region", "aria-label": "Set up saving" },
      n
        ? el(
            "div",
            {},
            el("strong", { text: `${n} change${n > 1 ? "s are" : " is"} only in this browser. ` }),
            "Turn on saving so they're kept in your folder. When asked, pick the folder this page is in.",
          )
        : el(
            "div",
            {},
            el("strong", { text: "One step to finish setup. " }),
            "Turn on saving so your changes are kept in files on your computer. When asked, pick the folder this page is in.",
          ),
      el(
        "div",
        { class: "acts" },
        el("button", {
          class: "btn primary small",
          type: "button",
          text: "Turn on saving",
          onclick: () => (dirHandle ? allowAgain() : connectFolder()),
        }),
        n
          ? null
          : el("button", {
              class: "btn small",
              type: "button",
              text: "Later",
              onclick: () => {
                lsSet("bannerLater", TODAY());
                renderBanner();
                statusSig = "";
                renderStatus();
              },
            }),
      ),
    ),
  );
}
