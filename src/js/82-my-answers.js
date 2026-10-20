/* ================= "My version" answers (Library/My_answers.md, written only by this page) =================
   Every ✎ question in a guide or prep sheet gets a box for your own wording, and every {.ask} question on a prep
   sheet a "Their answer" box. Prep sheet answers are keyed "prep:<job id>::<question>". Answers are kept in this
   browser at once and written to the file about a second after you stop typing.
   The file is never written without reading it first: every write reads the file, merges it with this browser's
   answers and only then writes. Merge rule: every key from both sides is kept; a box you changed since the last read
   wins; any other key takes the file's value. If the file can't be read (no permission yet, a sync client holding it),
   nothing is written: the answers wait in this browser and are written once the file can be read. */
const MYLK = "myAnswers",
  MYDIRTY = "myAnswersDirty";
let MY = {},
  myLoaded = false,
  myTimer = null,
  myBusy = false,
  myAgain = false;
/* keys changed in this browser since the file was last read and written (kept across reloads until written) */
let myDirty = new Set();
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
MY = myJson(MYLK, {});
myDirty = new Set(Array.isArray(myJson(MYDIRTY, null)) ? myJson(MYDIRTY, []) : []);
const myKeep = () => {
  lsSet(MYLK, JSON.stringify(MY));
  lsSet(MYDIRTY, JSON.stringify([...myDirty]));
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
/* Merge what the file holds into MY (see the rule at the top). Returns true when MY changed. */
function myMerge(disk) {
  const out = {};
  for (const [k, v] of Object.entries(disk)) if (v) out[k] = v;
  for (const [k, v] of Object.entries(MY)) {
    if (myDirty.has(k)) out[k] = v;
    else if (!(k in out) && v && v.trim()) out[k] = v; // only in this browser: kept
  }
  const changed = JSON.stringify(out) !== JSON.stringify(MY);
  MY = out;
  return changed;
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
  try {
    const r = await FS.read(MYPATH);
    if (r === false) {
      myRetry();
      return false;
    }
    const changed = myMerge(r ? myFromMd(r.text) : {});
    myLoaded = true;
    myKeep();
    if (changed) myFill();
  } finally {
    myBusy = false;
  }
  if (myDirty.size || myAgain) {
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
    const changed = myMerge(onDisk);
    myLoaded = true;
    const sent = new Set(myDirty);
    const text = myToMd();
    /* write only when this browser has something the file lacks: an edit, or an answer only kept here */
    const needed = sent.size > 0 || Object.entries(MY).some(([k, v]) => v && v.trim() && onDisk[k] !== v);
    if (needed && (!r || r.text !== text)) await FS.write(MYPATH, text);
    for (const k of sent) if (myDirty.has(k)) myDirty.delete(k);
    /* edits typed while the write ran stay marked and are written next time */
    for (const [k, v] of Object.entries(MY)) if (!v || !v.trim()) delete MY[k];
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
  myDirty.add(k);
  mySave();
}
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
