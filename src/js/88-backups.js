/* ================= backups =================
   1. Every day, the first save (or start-up, on a day without edits) copies the data file into backups/ (see storage.js).
   2. Every day, your notes (every my_notes.md under Job notes, and Library/My_answers.md) are copied into backups/notes_<date>/.
   3. Optional: a second folder somewhere else (an external drive, a synced folder) gets a full copy of the board folder
      once a day. It can't be inside the board folder itself. */
const BK_DAY = "bkDay",
  BK2_DAY = "bk2Day";
async function writeTo(dst, name, text) {
  const fh = await dst.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
/* one snapshot per day; a manual "Back up now" adds another. A folder only counts as done once its _complete.txt exists. */
async function snapshotNotes(manual) {
  if (!FS.ok()) return { ok: false, n: 0 };
  let n = 0;
  const day = TODAY();
  try {
    const src = [];
    let jn = null;
    try {
      jn = await FS.dir("Job notes");
    } catch (e) {}
    if (jn)
      for await (const [nm, h] of jn.entries()) {
        if (h.kind !== "directory") continue;
        if (nm === "hunters") {
          for await (const [n2, h2] of h.entries()) if (h2.kind === "directory") src.push([h2, "hunters__" + n2]);
        } else src.push([h, nm]);
      }
    const files = [];
    for (const [dh, prefix] of src)
      for await (const [nm, h] of dh.entries())
        if (h.kind === "file" && /^my_notes.*\.md$/.test(nm)) files.push([h, prefix + "__" + nm]);
    const my = await FS.read(MYPATH);
    if (!files.length && !my) return { ok: true, n: 0, empty: true };
    const bk = await FS.dir("backups", true);
    let name = "notes_" + day,
      done = false;
    try {
      const d0 = await bk.getDirectoryHandle(name);
      try {
        await d0.getFileHandle("_complete.txt");
        done = true;
      } catch (e) {}
    } catch (e) {}
    if (done && !manual) return { ok: true, n: 0, kept: true };
    if (done && manual) name = name + "_" + new Date().toTimeString().slice(0, 5).replace(":", "");
    const dst = await bk.getDirectoryHandle(name, { create: true });
    for (const [h, fname] of files) {
      await writeTo(dst, fname, await (await h.getFile()).text());
      n++;
    }
    if (my) {
      await writeTo(dst, "My_answers.md", my.text);
      n++;
    }
    await writeTo(dst, "_complete.txt", new Date().toISOString());
    const dirs = [];
    for await (const [nm, h] of bk.entries())
      if (h.kind === "directory" && /^notes_\d{4}-\d{2}-\d{2}(_\d{4})?$/.test(nm)) dirs.push(nm);
    dirs.sort();
    for (const nm of dirs.slice(0, Math.max(0, dirs.length - CONFIG.backups.notesDays)))
      try {
        await bk.removeEntry(nm, { recursive: true });
      } catch (e) {}
    lsSet(BK_DAY, day);
    return { ok: true, n };
  } catch (e) {
    return { ok: false, n, err: e };
  }
}
async function copyTreeForBackup(src, dst, skip, depth) {
  let c = 0;
  depth = depth || 0;
  if (depth > 8) return c;
  for await (const [nm, h] of src.entries()) {
    if (h.kind === "directory") {
      if (depth === 0 && (skip.includes(nm) || nm.startsWith(CONFIG.backups.secondFolderPrefix))) continue;
      c += await copyTreeForBackup(h, await dst.getDirectoryHandle(nm, { create: true }), skip, depth + 1);
    } else {
      const f = await h.getFile();
      const fh = await dst.getFileHandle(nm, { create: true });
      const w = await fh.createWritable();
      await w.write(await f.arrayBuffer());
      await w.close();
      c++;
    }
  }
  return c;
}
const secondFolder = async () => {
  try {
    return await idbGet("second");
  } catch (e) {
    return null;
  }
};
/* the second folder must be somewhere else: never the board folder itself or anything inside it */
async function unsafeTarget(h) {
  try {
    if (await h.isSameEntry(dirHandle)) return true;
  } catch (e) {}
  try {
    if (typeof dirHandle.resolve === "function" && (await dirHandle.resolve(h))) return true;
  } catch (e) {}
  return false;
}
async function secondBackup(h, manual) {
  if (!h || !FS.ok()) return { ok: false };
  try {
    if (await unsafeTarget(h)) return { ok: false, unsafe: true };
    let p = "granted";
    try {
      p = await h.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && manual) p = await h.requestPermission({ mode: "readwrite" });
    } catch (e) {}
    if (p !== "granted") return { ok: false, perm: true };
    const day = TODAY();
    const dst = await h.getDirectoryHandle(CONFIG.backups.secondFolderPrefix + day, { create: true });
    const n = await copyTreeForBackup(dirHandle, dst, ["backups"], 0);
    const re = new RegExp(
      "^" + CONFIG.backups.secondFolderPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\d{4}-\\d{2}-\\d{2}$",
    );
    const names = [];
    for await (const [nm, k] of h.entries()) if (k.kind === "directory" && re.test(nm)) names.push(nm);
    names.sort();
    for (const nm of names.slice(0, Math.max(0, names.length - CONFIG.backups.secondCopies)))
      try {
        await h.removeEntry(nm, { recursive: true });
      } catch (e) {}
    lsSet(BK2_DAY, day);
    return { ok: true, n, name: h.name };
  } catch (e) {
    return { ok: false, err: e };
  }
}
const bkStatus = (msg) => {
  const s = $q("#backupStatus");
  if (s) s.textContent = msg;
};
const second2msg = (r) =>
  r.ok
    ? ` Second copy in “${r.name}” at ${hhmm(new Date())} (${r.n} files). It holds all your notes, so keep that folder private.`
    : r.unsafe
      ? " That second folder is inside your board folder, so it was not used. Choose a different folder."
      : r.perm
        ? " The second copy needs a click: press Back up notes now."
        : " The second copy failed.";
async function backupNow(manual) {
  const r = await snapshotNotes(true);
  let msg = r.ok
    ? r.empty
      ? "No notes to back up yet. They appear as soon as you type in a notes pad."
      : `Backed up ${r.n} note file${r.n === 1 ? "" : "s"} at ${hhmm(new Date())}.`
    : FS.ok()
      ? "Backup failed. Nothing was lost."
      : "Turn on saving to back up.";
  const h = await secondFolder();
  if (h) msg += second2msg(await secondBackup(h, manual));
  else msg += " No second folder chosen yet.";
  bkStatus(msg);
  return r.ok;
}
async function pickSecond() {
  try {
    const h = await window.showDirectoryPicker({ id: CONFIG.pickerIds.secondBackup, mode: "readwrite" });
    if (await unsafeTarget(h)) {
      bkStatus(
        "That folder is inside your board folder. Choose a different one, such as an external drive or a synced folder.",
      );
      return;
    }
    await idbSet("second", h);
    bkStatus(
      "Second folder chosen: “" +
        h.name +
        "”. Backing up… (It will hold everything in your board folder: choose a folder that isn't shared.)",
    );
    await backupNow(true);
  } catch (e) {
    if (!e || e.name !== "AbortError") bkStatus("Couldn't open that folder.");
  }
}
/* Once saving is on: pick up new prep sheets, take today's backups, and repeat every 20 minutes. */
let startedUp = false;
async function startup() {
  if (!FS.ok()) return;
  await scanPrep();
  await backupToday();
  const day = TODAY();
  const last = lsGet(BK_DAY, "");
  let msg = "";
  if (last !== day) {
    const r = await snapshotNotes(false);
    if (r.ok && r.empty) msg = "No notes to back up yet.";
    else if (r.ok && !r.kept) msg = `Notes backed up today (${r.n} file${r.n === 1 ? "" : "s"}).`;
    else if (r.ok) msg = "Notes backed up today.";
  } else msg = "Notes backed up today.";
  const h = await secondFolder();
  const l2 = lsGet(BK2_DAY, "");
  if (h && l2 !== day) {
    const r2 = await secondBackup(h, false);
    msg += second2msg(r2);
  } else if (!h) msg += " No second folder chosen yet.";
  if (msg) bkStatus(msg);
}

/* ================= Restore a backup… =================
   Lists backups/board_data_*.js (the daily copies, the versions a merge kept out, the copies saved before a restore),
   or takes any .js file you pick. After a confirm, the data file as it is now goes to
   backups/board_data_before_restore_<time>.js, then every field of the backup that differs from the board's becomes a
   new edit (its revision goes up), so it wins everywhere: the file, other tabs, the next merge. Cards added since the
   backup are removed (Restore brings one back). Then every job folder is filed by stage again. The toast (only the
   toast, not Ctrl+Z) can undo it: Undo puts back the fields the restore changed that haven't changed since, and keeps
   later changes. Copying an old file over board_data.js does not restore anything: its revisions are not newer, so the
   page keeps your version (and saves the copied file in backups/). */
const plural = (n, noun) => `${n} ${n === 1 ? noun : noun === "person" ? "people" : noun + "s"}`;
function backupInfo(text) {
  try {
    const data = normalize(parseDataText(text));
    const n = (c) => Object.values(data[c]).filter((r) => !r.deleted).length;
    const counts = [...BOARDS.map((c) => plural(n(c), SECTIONS[c].noun)), plural(n("todos"), "to-do")].join(", ");
    return { data, counts };
  } catch (e) {
    return null;
  }
}
async function backupList() {
  const out = [];
  try {
    const bdir = await dirHandle.getDirectoryHandle("backups");
    const base = DATA_FILE.replace(/\.js$/, "") + "_";
    for await (const [name, h] of bdir.entries())
      if (h.kind === "file" && name.startsWith(base) && name.endsWith(".js")) {
        const f = await h.getFile();
        out.push({ name, time: f.lastModified, text: await f.text() });
      }
  } catch (e) {}
  return out.sort((a, b) => b.time - a.time);
}
const whenLabel = (t) =>
  new Date(t).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
/* The board's records set to `src`'s (see the top). Returns, for Undo, each changed field with its value before and its
   revision after. */
function replaceStore(src) {
  const undo = [];
  for (const c of COLLS)
    for (const id of new Set([...Object.keys(store[c]), ...Object.keys(src[c])])) {
      const old = has(c, id) ? store[c][id] : null;
      const r = Object.hasOwn(src[c], id) ? src[c][id] : null;
      let patch;
      if (r) {
        patch = {};
        for (const f of fieldsOf(old, r)) patch[f] = r[f];
        /* a card removed again by the restore: its files wait the full time in the removed folder again */
        if (r.deleted && old && !old.deleted) patch.removedAt = nowIso();
      } else if (old && !old.deleted) patch = { deleted: true, removedAt: nowIso() };
      else continue;
      for (const f of applyEdit(c, id, patch)) undo.push([c, id, f, old ? old[f] : undefined, rv(store[c][id], f)]);
    }
  persist();
  render();
  if (openRef) refreshDrawer();
  return undo;
}
/* Undo of a restore: each field it changed goes back, unless it changed again since (that later change is kept).
   Returns how many were kept. */
function undoRestore(list) {
  const patches = new Map();
  let later = 0;
  for (const [c, id, f, v, n] of list) {
    if (!has(c, id) || rv(store[c][id], f) !== n) {
      later++;
      continue;
    }
    const k = c + ":" + id;
    if (!patches.has(k)) patches.set(k, [c, id, {}]);
    patches.get(k)[2][f] = v;
  }
  for (const [c, id, p] of patches.values()) applyEdit(c, id, p);
  persist();
  render();
  if (openRef) refreshDrawer();
  return later;
}
/* after a restore or its undo: write it, then file every job folder by its restored stage and list the folders again */
async function afterReplace() {
  await writeFile();
  await fileJobs(true);
  scanFolders(true);
}
async function restoreBackup(text, label) {
  if (!dirHandle || !canWrite) {
    showToast("Turn on saving to your folder first, so the restored board can be saved.");
    return false;
  }
  const info = backupInfo(text);
  if (!info) {
    showToast("That file isn't a board backup (it has no window.BOARD_DATA = {…}). Nothing was changed.");
    return false;
  }
  /* take in what the file holds now, and keep a copy of it */
  if ((await readFileInto()) === "bad") {
    showToast(`${DATA_FILE} has an error right now. Nothing was changed.`);
    return false;
  }
  try {
    if (lastRaw.trim()) {
      const stamp2 = TODAY() + "_" + new Date().toTimeString().slice(0, 8).replace(/:/g, "");
      await writeTo(
        await dirHandle.getDirectoryHandle("backups", { create: true }),
        `${DATA_FILE.replace(/\.js$/, "")}_before_restore_${stamp2}.js`,
        lastRaw,
      );
    }
  } catch (e) {
    showToast("Couldn't save a copy of the current board first, so nothing was restored.");
    return false;
  }
  const undo = replaceStore(info.data);
  await afterReplace();
  showToast(
    `Restored the copy from ${label} (${info.counts}). Your board as it was is in backups/.`,
    async () => {
      const later = undoRestore(undo);
      await afterReplace();
      showToast(
        later
          ? `Restore undone. Kept ${later} change${later === 1 ? "" : "s"} made since the restore.`
          : "Restore undone.",
      );
    },
    true,
  );
  return true;
}
async function openRestore() {
  if (VIEW_ONLY) return blockedEdit();
  if (!dirHandle || !canWrite) {
    showToast("Turn on saving to your folder first: backups are kept in its backups/ folder.");
    return;
  }
  lastFocusKey = focusKey();
  const root = $("#drawerRoot");
  root.textContent = "";
  openRef = null;
  const list = el("div", { class: "rlist" }, el("p", { class: "muted", text: "Looking in backups/…" }));
  const pick = el("input", { type: "file", accept: ".js,text/javascript", class: "rpick", hidden: true });
  const d = el(
    "aside",
    { class: "drawer restore", role: "dialog", "aria-modal": "true", "aria-labelledby": "rTitle", tabindex: "-1" },
    el("button", { class: "close", type: "button", "aria-label": "Close", text: "×", onclick: closeDrawer }),
    el("h2", { id: "rTitle", text: "Restore a backup" }),
    el("p", {
      class: "muted",
      text: "Pick the copy to go back to. Your board as it is now is saved to backups/ first, and you can undo right after.",
    }),
    list,
    el(
      "p",
      {},
      el("button", { class: "btn small", type: "button", text: "Choose a file…", onclick: () => pick.click() }),
      pick,
    ),
  );
  root.append(el("div", { class: "scrim", onclick: closeDrawer }), d);
  setTimeout(() => d.focus(), 0);
  /* one row per copy; Restore… asks first */
  const row = (title, sub, text) => {
    const info = backupInfo(text);
    const acts = el("div", { class: "racts" });
    const idle = () => {
      acts.textContent = "";
      acts.append(
        info
          ? el("button", { class: "btn small", type: "button", text: "Restore…", onclick: ask })
          : el("span", { class: "muted", text: "can't be read" }),
      );
    };
    const ask = () => {
      acts.textContent = "";
      acts.append(
        el("span", { text: "Replace your board with this copy?" }),
        el("button", {
          class: "btn small primary",
          type: "button",
          text: "Restore",
          onclick: async () => {
            if (await restoreBackup(text, title)) closeDrawer();
          },
        }),
        el("button", { class: "btn small", type: "button", text: "Cancel", onclick: idle }),
      );
    };
    idle();
    return el(
      "div",
      { class: "rrow" },
      el("div", {}, el("b", { text: title }), el("small", { text: sub + (info ? " · " + info.counts : "") })),
      acts,
    );
  };
  pick.addEventListener("change", async () => {
    const f = pick.files && pick.files[0];
    if (!f) return;
    const text = await f.text();
    list.prepend(row(f.name, "chosen file", text));
    pick.value = "";
  });
  const items = await backupList();
  list.textContent = "";
  if (!items.length) list.append(el("p", { class: "muted", text: "No backups in backups/ yet." }));
  for (const b of items) list.append(row(whenLabel(b.time), b.name, b.text));
}
