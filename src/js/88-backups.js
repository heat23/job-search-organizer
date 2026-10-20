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
