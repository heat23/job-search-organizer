/* ================= saving to your folder (File System Access API: Chrome and Edge) =================
   You pick the folder this page lives in once; Chrome remembers the permission. Every change is kept in this
   browser at once and written to the data file 400 ms later. Before the first write of each day, the file
   as it was goes to backups/. */
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
let localOk = true;
function persistLocal() {
  localOk = lsSet("board", JSON.stringify(store));
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
let lastRaw = "";
async function readFileInto() {
  if (!dirHandle) return "none";
  let t;
  lastRaw = "";
  try {
    const fh = await dirHandle.getFileHandle(DATA_FILE);
    t = await (await fh.getFile()).text();
  } catch (e) {
    return "missing";
  }
  lastRaw = t;
  if (!t.trim()) return "missing";
  try {
    const raw = parseDataText(t);
    extras = Object.create(null);
    keepExtras(raw);
    const n = normalize(raw);
    for (const c of COLLS)
      for (const id of Object.keys(n[c])) {
        const k = c + ":" + id;
        fileBase[k] = Math.max(fileBase[k] || 0, ts(n[c][id]));
      }
    store = merge(store, n);
    return "ok";
  } catch (e) {
    return "bad";
  }
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
      const fh = await dirHandle.getFileHandle(DATA_FILE, { create: true });
      const w = await fh.createWritable();
      await w.write(serialize(store));
      await w.close();
      setFileBase(store);
      persistLocal();
      lastSaved = new Date();
      saveErr = "";
      if (gen === g) dirty = false;
      setTimeout(fileJobs, 50);
    }
  } catch (e) {
    if (e && e.name === "NotFoundError") {
      dirHandle = null;
      canWrite = false;
      saveErr = "";
      await idbSet("dir", null);
      showToast("Couldn't find your board folder. It may have been moved. Click Turn on saving and pick it again.");
    } else {
      saveErr = "write";
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
    const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "_\\d{4}-\\d{2}-\\d{2}\\.js$");
    const names = [];
    for await (const [n, h] of bdir.entries()) if (h.kind === "file" && re.test(n)) names.push(n);
    names.sort();
    for (const n of names.slice(0, Math.max(0, names.length - CONFIG.backups.boardDays)))
      try {
        await bdir.removeEntry(n);
      } catch (e) {}
  } catch (e) {}
}

/* ================= filing each job's documents folder by stage =================
   A job's folder lives in <board folder>/<stage folder>/<job folder>. When a card changes lane the page moves the folder
   (copy every file, check sizes, then remove the old copy) and updates "folder", so the Résumé and Cover letter buttons keep working.
   A folder found anywhere else in the board folder (for example at the top level, where a new package lands) is filed the same way. */
const STAGE_DIR = CONFIG.stageFolders;
const REMOVED_DIR = CONFIG.stageFolders.removed,
  PURGE_DAYS = CONFIG.removedPurgeDays;
const STAGE_DIRS = [...new Set(Object.values(STAGE_DIR))];
function splitFolder(f) {
  const p = String(f || "").split("/");
  return p.length > 1 && STAGE_DIRS.includes(p[0])
    ? { stage: p[0], name: p.slice(1).join("/") }
    : { stage: "", name: String(f || "") };
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
async function copyFolder(src, dst) {
  for await (const [n, h] of src.entries()) {
    if (h.kind === "file") {
      const f = await h.getFile();
      const o = await dst.getFileHandle(n, { create: true });
      const w = await o.createWritable();
      await w.write(f);
      await w.close();
      if ((await (await dst.getFileHandle(n)).getFile()).size !== f.size) throw new Error("copy check failed: " + n);
    } else await copyFolder(h, await dst.getDirectoryHandle(n, { create: true }));
  }
}
async function moveDir(from, to) {
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
async function fileJobs() {
  if (!dirHandle || !canWrite || VIEW_ONLY) return;
  if (filing) {
    fileAgain = true;
    return;
  }
  filing = true;
  const moved = [],
    failed = [];
  try {
    for (const [id, x] of Object.entries(store.jobs)) {
      if (!x || !x.folder) continue;
      const want = x.deleted ? REMOVED_DIR : STAGE_DIR[laneKey("jobs", x)];
      if (!want) continue;
      const { stage, name } = splitFolder(x.folder);
      /* A removed card's files wait in the removed folder (Restore brings them back), then are deleted for good. */
      if (x.deleted && stage === REMOVED_DIR) {
        const since = Date.parse(x.removedAt || x.updatedAt || "");
        if (since && Date.now() - since > PURGE_DAYS * 864e5) {
          try {
            await (await dirAt(REMOVED_DIR)).removeEntry(name, { recursive: true });
          } catch (e) {
            if (!e || e.name !== "NotFoundError") {
              failed.push(x.company || name);
              continue;
            }
          }
          const r = store.jobs[id];
          store.jobs[id] = { ...r, folder: null, filesDeletedAt: nowIso(), updatedAt: stamp(r), changedBy: "you" };
          persist();
        }
        continue;
      }
      if (stage === want) continue;
      const target = want + "/" + name;
      try {
        let from = null;
        for (const c of [x.folder, ...STAGE_DIRS.map((s) => s + "/" + name)])
          if (c !== target && (await hasDir(c))) {
            from = c;
            break;
          }
        const there = await hasDir(target);
        if (from && there) {
          failed.push(x.company || name);
          continue;
        }
        if (from) {
          await moveDir(from, target);
          moved.push(x.company || name);
        } else if (!there) {
          failed.push(x.company || name);
          continue;
        }
        const r = store.jobs[id];
        store.jobs[id] = { ...r, folder: target, updatedAt: stamp(r), changedBy: "you" };
        persist();
      } catch (e) {
        failed.push(x.company || name);
      }
    }
  } finally {
    filing = false;
  }
  if (moved.length || failed.length) render();
  if (failed.length && !lastUndo)
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
    await writeFile();
    if (!saveErr)
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
  const sig = [FS_OK, localOk, !!dirHandle, canWrite, saveErr, dirty, lastSaved && lastSaved.getTime(), bannerUp].join(
    "|",
  );
  if (sig === statusSig) return;
  statusSig = sig;
  s.textContent = "";
  s.className = "status";
  const dot = () => el("span", { class: "sdot" });
  if (!FS_OK) return;
  if (!localOk && (!dirHandle || !canWrite)) {
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
    );
    return;
  }
  if (saveErr === "bad") {
    s.classList.add("bad");
    s.append(
      dot(),
      `${DATA_FILE} has an error, so it wasn't overwritten. Your changes are safe in this browser. Fix the file or copy one back from backups/.`,
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
