/* ================= "My version" answers (Library/My_answers.md, written only by this page) =================
   Every ✎ question in a guide or prep sheet gets a box for your own wording, and every {.ask} question on a prep
   sheet a "Their answer" box. Prep sheet answers are keyed "prep:<job id>::<question>" (see renderDoc for a question
   that is on a sheet more than once). Answers are kept in this browser at once and written to the file about a second
   after you stop typing.
   The file is never written without reading it first: every write reads the file, merges it with this browser's
   answers and only then writes. Merge rule, per key:
   - a box you changed since the last write wins (emptying it, or Remove, deletes the answer from the file);
   - an answer the file lost since this browser last read it (deleted by hand, by your assistant or from another tab)
     stays deleted: it is remembered as removed, so no other tab and no later save brings it back (a file that is
     missing altogether deletes nothing);
   - an answer only in this browser that the file never had is kept and written;
   - any other key takes the file's value.
   If the file can't be read (no permission yet, a sync client holding it), nothing is written: the answers wait in
   this browser and are written once the file can be read. A file that reads as empty, lacks its "# My answers" title,
   or lost every answer at once (a sync client or an editor caught halfway) deletes nothing: the odd file is copied to
   backups/ and the file is written again from this browser's answers. Removing every answer on purpose is done with
   "Clear all my answers" in the Prep library. Open tabs share their waiting answers and removals key by
   key (through browser storage), so one tab never drops what another typed. */
const MYLK = "myAnswers",
  MYDIRTY = "myAnswersDirty",
  MYGONE = "myAnswersGone",
  MYSEEN = "myAnswersSeen";
let MY = {},
  myLoaded = false,
  myTimer = null,
  myBusy = false,
  myAgain = false;
const normK = (k) =>
  String(k)
    .replace(/\s*[✎☐]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const myJson = (name, fallback) => {
  try {
    const v = JSON.parse(lsGet(name, "null"));
    return v && typeof v === "object" ? v : fallback;
  } catch (e) {
    return fallback;
  }
};
/* keys changed in this browser and not written yet -> the time of the change (kept across reloads until written).
   An older copy stored a plain list of keys. */
const dirtyFrom = (v) =>
  new Map(
    Array.isArray(v)
      ? v.filter((k) => typeof k === "string").map((k) => [k, 0])
      : Object.entries(v || {}).filter(([, t]) => typeof t === "number"),
  );
const timesFrom = (v) => Object.fromEntries(Object.entries(v || {}).filter(([, t]) => typeof t === "number"));
const GONE_DAYS = 180;
MY = myJson(MYLK, {});
let myDirty = dirtyFrom(myJson(MYDIRTY, null));
/* When an answer was last removed (in a box, by Remove, or from the file): key -> time. A negative time is when it
   was given an answer again (typed, or put back in the file), so another tab's older removal doesn't undo that.
   Forgotten after GONE_DAYS. */
let myGone = timesFrom(myJson(MYGONE, {}));
for (const [k, t] of Object.entries(myGone)) if (Date.now() - Math.abs(t) > GONE_DAYS * 864e5) delete myGone[k];
const isGone = (k) => myGone[k] > 0;
/* the keys the file held at the last read or write (null: not read yet by this version of the page) */
let mySeen = Array.isArray(myJson(MYSEEN, null)) ? new Set(myJson(MYSEEN, [])) : null;
/* waiting answers this tab took from another tab (key -> time), and answers this tab wrote (key -> edit time) */
const myFromTab = new Map(),
  mySent = new Map();
/* Take another tab's waiting answers and removals, key by key: the later change wins. A waiting answer taken from a
   tab that no longer lists it was written (or replaced) by that tab, so it stops waiting here too. */
function myAbsorb() {
  const theirs = myJson(MYLK, {}),
    td = dirtyFrom(myJson(MYDIRTY, null)),
    tg = timesFrom(myJson(MYGONE, {}));
  let changed = false;
  for (const [k, t] of Object.entries(tg)) {
    if (Math.abs(t) <= Math.abs(myGone[k] || 0)) continue;
    myGone[k] = t;
    if (t > 0 && (myDirty.has(k) ? myDirty.get(k) < t : k in MY)) {
      delete MY[k];
      myDirty.delete(k);
      myFromTab.delete(k);
      changed = true;
    }
  }
  for (const [k, t] of td) {
    const mine = myDirty.get(k);
    if ((mine !== undefined ? t > mine : t > (mySent.get(k) ?? -1)) && !(myGone[k] >= t)) {
      if (MY[k] !== (theirs[k] ?? "")) changed = true;
      MY[k] = typeof theirs[k] === "string" ? theirs[k] : "";
      myDirty.set(k, t);
      myFromTab.set(k, t);
    }
  }
  for (const [k, t] of [...myFromTab])
    if (!td.has(k) && myDirty.get(k) === t) {
      myDirty.delete(k);
      myFromTab.delete(k);
    }
  return changed;
}
const myKeep = () => {
  const changed = myAbsorb();
  const ok =
    lsSet(MYLK, JSON.stringify(MY)) &&
    lsSet(MYDIRTY, JSON.stringify(Object.fromEntries(myDirty))) &&
    lsSet(MYGONE, JSON.stringify(myGone));
  if (mySeen) lsSet(MYSEEN, JSON.stringify([...mySeen]));
  /* browser storage full: the status line warns while the answers aren't in the file either */
  if (ok !== myLocalOk) {
    myLocalOk = ok;
    renderStatus();
  }
  return changed;
};
/* A line in an answer that starts with "## " is written as "\## " so it is not read back as a new question
   (a line that already starts with backslashes and "## " gets one more); reading removes one backslash. */
const myEsc = (v) => v.replace(/^(\\*)## /gm, "\\$1## ");
const myUnesc = (l) => l.replace(/^\\(\\*)## /, "$1## ");
const myToMd = () =>
  "# My answers\nYour own versions of the example questions in the Prep library, and the answers you typed on prep sheets. The page reads and writes this file.\n\n" +
  Object.entries(MY)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `## ${k}\n${myEsc(v.trim())}\n`)
    .join("\n");
function myFromMd(t) {
  const o = {};
  let k = null,
    buf = [];
  for (const l of String(t).replace(/\r/g, "").split("\n")) {
    const m = l.match(/^## (.+)$/);
    if (m) {
      if (k) o[k] = buf.join("\n").trim();
      k = normK(m[1]);
      buf = [];
    } else if (k) buf.push(myUnesc(l));
  }
  if (k) o[k] = buf.join("\n").trim();
  return o;
}
/* Merge what the file holds into MY (see the rule at the top). Returns true when MY changed. When there is no file
   at all (removed, or another folder was picked), nothing counts as deleted from it: every answer is written again. */
const myHas = () => Object.values(MY).some((v) => v && v.trim());
/* The file looks wrong (see the top): empty, no title, or none of the answers it had at the last read, while this
   browser has answers. */
function myOdd(text, disk) {
  if (!myHas()) return false;
  if (!text.trim() || !/^\uFEFF?\s*# My answers/.test(text)) return true;
  return !!(mySeen && mySeen.size && ![...mySeen].some((k) => disk[k]));
}
async function myBackupOdd(text) {
  const n = Object.values(MY).filter((v) => v && v.trim()).length;
  try {
    if (text.trim())
      await FS.write(
        `backups/My_answers_odd_${TODAY()}_${new Date().toTimeString().slice(0, 5).replace(":", "")}.md`,
        text,
      );
  } catch (e) {}
  showToast(
    `${MYPATH.split("/").pop()} looked empty or cut short, so your ${n} answer${n === 1 ? " was" : "s were"} written back from this browser${text.trim() ? " (the odd file is in backups/)" : ""}.`,
  );
}
function myMerge(disk, exists) {
  myAbsorb();
  const out = {};
  for (const [k, v] of Object.entries(disk))
    if (v) {
      out[k] = v;
      /* back in the file after it was removed: put back on purpose (by hand or by your assistant) */
      if (isGone(k) && !myDirty.has(k)) myGone[k] = -Date.now();
    }
  for (const [k, v] of Object.entries(MY)) {
    if (myDirty.has(k)) out[k] = v;
    else if (k in out || !v || !v.trim() || isGone(k)) continue;
    else if (exists && mySeen && mySeen.has(k))
      myGone[k] = Date.now(); // the file lost it since the last read
    else out[k] = v; // never in the file: only in this browser, kept
  }
  if (exists) mySeen = new Set(Object.keys(disk).filter((k) => disk[k]));
  const changed = JSON.stringify(out) !== JSON.stringify(MY);
  MY = out;
  return changed;
}
/* A prep sheet's answers saved under an older key (the question alone, or with " #2" by position) move to the key of
   the question's box ("<question> @<section>", see renderDoc) only when that is certain: the question is on the sheet
   once and it is the only older answer to it. Otherwise they stay under "Saved answers from earlier versions" on the
   sheet. This runs as soon as the sheet and the file's answers are both known (so an answer moves while the sheet still
   has the round it was typed in), and before a sheet is shown. */
function myMigrate() {
  if (!myLoaded) return;
  for (const [id, md] of Object.entries(PREPTXT)) {
    const pre = "prep:" + id + "::";
    if (!validPrep(md) || !Object.keys(MY).some((k) => k.startsWith(pre) && !k.includes(" @"))) continue;
    const where = {};
    for (const s of parse(md).secs)
      for (const t of s.qs.length ? s.qs.map((q) => q.title) : [s.title]) {
        const base = pre + normK(t);
        where[base] = where[base] === undefined ? s.title : null;
      }
    for (const [base, sec] of Object.entries(where)) {
      const sk = base + " @" + normK(sec || "");
      if (sec === null || (MY[sk] || "").trim()) continue;
      const old = Object.keys(MY).filter(
        (k) =>
          (k === base || (k.startsWith(base + " #") && /^ #\d+$/.test(k.slice(base.length)))) && (MY[k] || "").trim(),
      );
      if (old.length !== 1) continue;
      mySet(sk, MY[old[0]]);
      mySet(old[0], "");
    }
  }
}
const myFill = () => {
  $qa("details.mine").forEach(fillMine);
  try {
    document.dispatchEvent(new Event("jso-answers"));
  } catch (e) {}
};
/* After a failed read or write, try again in a few seconds (while saving is on). */
let myRetryT = null;
const myRetry = () => {
  clearTimeout(myRetryT);
  myRetryT = setTimeout(myResume, 5000);
};
/* Read the file and merge it in. A read that fails ("can't read right now") changes nothing and is tried again later. */
async function myLoad() {
  if (!FS.ok()) return false;
  if (myBusy) {
    myAgain = true;
    return false;
  }
  myBusy = true;
  let odd = false;
  try {
    const r = await FS.read(MYPATH);
    if (r === false) {
      myRetry();
      return false;
    }
    const disk = r ? myFromMd(r.text) : {};
    odd = !!r && myOdd(r.text, disk);
    const changed = myMerge(disk, !!r && !odd);
    myLoaded = true;
    myKeep();
    if (changed) myFill();
    myMigrate();
  } finally {
    myBusy = false;
  }
  if (myDirty.size || myAgain || odd) {
    myAgain = false;
    myWrite();
  }
  return true;
}
/* Read, merge, then write. Nothing is written when the file can't be read first. */
async function myWrite() {
  if (!FS.ok()) return false;
  if (myBusy) {
    myAgain = true;
    return false;
  }
  myBusy = true;
  let ok = false;
  try {
    const r = await FS.read(MYPATH);
    if (r === false) {
      myRetry();
      return false;
    }
    const onDisk = r ? myFromMd(r.text) : {};
    const odd = !!r && myOdd(r.text, onDisk);
    if (odd) await myBackupOdd(r.text);
    const changed = myMerge(onDisk, !!r && !odd);
    myLoaded = true;
    const sent = new Map(myDirty),
      vals = { ...MY };
    const text = myToMd();
    /* write only when this browser has something the file lacks: an edit, or an answer only kept here */
    const needed = odd || sent.size > 0 || Object.entries(MY).some(([k, v]) => v && v.trim() && onDisk[k] !== v);
    if (needed && (!r || r.text !== text)) await FS.write(MYPATH, text);
    mySeen = new Set(Object.keys(vals).filter((k) => vals[k] && vals[k].trim()));
    /* edits typed while the write ran stay marked and are written next time */
    for (const [k, t] of sent)
      if (myDirty.get(k) === t && MY[k] === vals[k]) {
        myDirty.delete(k);
        myFromTab.delete(k);
        mySent.set(k, t);
        if (!vals[k] || !vals[k].trim()) myGone[k] = Date.now();
      }
    for (const [k, v] of Object.entries(MY)) if ((!v || !v.trim()) && !myDirty.has(k)) delete MY[k];
    myKeep();
    if (changed) myFill();
    ok = true;
  } catch (e) {
    myKeep();
    myRetry();
  } finally {
    myBusy = false;
  }
  if (myAgain) {
    myAgain = false;
    myWrite();
  }
  return ok;
}
function mySave() {
  myKeep();
  clearTimeout(myTimer);
  myTimer = setTimeout(() => {
    myTimer = null;
    myWrite();
  }, 900);
}
/* Called when saving to the folder starts or comes back: read the file, and write answers that waited in this browser. */
function myResume() {
  if (!FS.ok()) return;
  if (myDirty.size) myWrite();
  else if (!myLoaded) myLoad();
}
const myFlush = () => {
  if (myTimer) {
    clearTimeout(myTimer);
    myTimer = null;
  }
  myKeep();
  if (myDirty.size) myWrite();
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") myFlush();
});
window.addEventListener("pagehide", myFlush);
const mineLabel = (det, filled) => (det.dataset.label || "My version") + (filled ? " ✓" : "");
function fillMine(det) {
  const k = det.dataset.k;
  /* an answer saved under the question's older key (before the question was repeated) moves to this box's key */
  const alt = det.dataset.alt;
  if (alt) {
    if (!(MY[k] || "").trim() && (MY[alt] || "").trim()) {
      mySet(k, MY[alt]);
      mySet(alt, "");
    }
    delete det.dataset.alt;
  }
  const ta = det.querySelector("textarea");
  if (ta && document.activeElement !== ta) ta.value = MY[k] || "";
  const filled = !!(MY[k] && MY[k].trim());
  det.querySelector("summary").textContent = mineLabel(det, filled);
  /* a box opens when it gets an answer (also one read from the file after the page opened); you can fold it again */
  if (filled && !det.dataset.filled) det.open = true;
  det.dataset.filled = filled ? "1" : "";
}
/* Change one answer (an empty value removes it from the file on the next write). */
function mySet(k, v) {
  MY[k] = v;
  myDirty.set(k, Math.max(Date.now(), (myDirty.get(k) || 0) + 1));
  myFromTab.delete(k);
  if (v && v.trim() && myGone[k]) myGone[k] = -Date.now();
  mySave();
}
/* another tab typed, removed or wrote an answer: show it here too */
window.addEventListener("storage", (e) => {
  if (![MYLK, MYDIRTY, MYGONE].some((n) => e.key === lsKey(n))) return;
  if (myAbsorb()) myFill();
});
function wireMine(root) {
  $qa("details.mine", root).forEach((det) => {
    fillMine(det);
    const ta = det.querySelector("textarea");
    if (ta.__w) return;
    ta.__w = 1;
    ta.addEventListener("input", () => {
      mySet(det.dataset.k, ta.value);
      det.querySelector("summary").textContent = mineLabel(det, ta.value.trim());
    });
  });
  if (!myLoaded) myLoad();
}
