/* ================= the data store =================
   board_data.js holds five collections of records keyed by id. Two copies can exist (the file and this browser);
   they merge by each record's revision number `rev` (see "merging" below). Removed records keep deleted:true. */
const emptyStore = () => Object.fromEntries(COLLS.map((c) => [c, Object.create(null)]));
const STR = [
  "company",
  "role",
  "name",
  "firm",
  "practice",
  "text",
  "detail",
  "lane",
  "followUp",
  "keepUntil",
  "movedAt",
  "appliedAt",
  "createdAt",
  "notes",
  "url",
  "referralId",
  "submittedTo",
  "closedReason",
  "location",
  "pay",
  "ask",
  "group",
  "from",
  "resume",
  "sentResume",
  "folder",
  "changedBy",
];
function clean(r) {
  const o = { ...r };
  for (const k of STR)
    if (o[k] != null && typeof o[k] !== "string") o[k] = typeof o[k] === "object" ? "" : String(o[k]);
  if (o.folder) o.folder = canonFolder(o.folder);
  if (o.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(o.followUp)) o.followUp = isoToLocalDate(o.followUp) || null;
  if (o.keepUntil && !/^\d{4}-\d{2}-\d{2}$/.test(o.keepUntil)) o.keepUntil = null;
  if ((!o.lane || o.lane === "todo") && o.followUp) o.followUp = null;
  /* the revision number: a whole number, 0 when missing (a record written before revisions existed) */
  const n = typeof o.rev === "string" && /^\s*\d+\s*$/.test(o.rev) ? Number(o.rev) : o.rev;
  o.rev = Number.isSafeInteger(n) && n > 0 ? n : 0;
  return o;
}
const revOf = (r) => (r && r.rev) || 0;
/* A job's "folder" as the page keeps it: without a trailing "/", and with the stage folder spelled as in the settings
   ("1 - to apply/Acme" is the same folder as "1 - To apply/Acme" on macOS and Windows). */
function canonFolder(f) {
  const x = String(f).replace(/\/+$/, "");
  if (!x) return f;
  const segs = x.split("/");
  const low = (v) => v.normalize("NFC").toLowerCase();
  const st = segs.length > 1 && Object.values(CONFIG.stageFolders).find((d) => low(d) === low(segs[0]));
  if (st) segs[0] = st;
  return segs.join("/");
}
/* Top-level keys other tools add beyond the five collections are kept and written back untouched. */
let extras = Object.create(null);
function keepExtras(raw) {
  if (!raw || typeof raw !== "object") return;
  for (const k of Object.keys(raw)) if (!COLLS.includes(k) && k !== "version" && k !== "savedAt") extras[k] = raw[k];
}
function normalize(src) {
  const out = emptyStore();
  if (!src || typeof src !== "object") return out;
  const dflt = typeof src.savedAt === "string" ? src.savedAt : "1970-01-01T00:00:00Z";
  for (const c of COLLS) {
    const coll = src[c];
    if (!coll || typeof coll !== "object" || Array.isArray(coll)) continue;
    for (const id of Object.keys(coll)) {
      const r = coll[id];
      if (r && typeof r === "object" && !Array.isArray(r))
        out[c][id] = clean(r.updatedAt ? r : { ...r, updatedAt: dflt });
    }
  }
  return out;
}
/* ---- merging: revision counters ----
   Every record has a whole number `rev` (missing: 0). Whoever changes a record (this page or another tool) sets rev to
   the old rev + 1. updatedAt and changedBy are only shown (and drive the "New from assistant" tag), never compared.
   For every record the page keeps its BASE (`bases`): the record exactly as the data file held it at the last
   successful read or write, kept in browser storage next to this browser's copy (in memory only while storage is full).
   The file's record F merges with this browser's record L like this:
   - F.rev > base.rev: the file has a real new edit. Per field, whichever side changed it since the base wins; a field
     both sides changed to different values keeps your value (a conflict, recorded). The result's rev is the higher of
     the two, plus 1 when your changes still have to be written.
   - F.rev <= base.rev while F differs from the base: an older copy written back, or an edit made without a new rev.
     Every field keeps your value and is written back (recorded).
   - no base: a record new on both sides keeps yours (recorded). Without any bases (a copy stored while browser storage
     was full, or by a version before revisions), yours stays only when its rev is higher; otherwise the file's is
     taken (this browser's copy is recorded).
   - a record the file lost that has a base is kept (removing is deleted:true) and written back (recorded).
   "Recorded" means the other side's version goes to backups/ and the status line says so (recordMerge in storage.js).
   deleted and removedAt count as one field. Open tabs share the bases, and merge each other's copies (see mergeTab). */
const canon = (v) =>
  JSON.stringify(v === undefined ? null : v, (k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((q) => [q, x[q]]),
        )
      : x,
  );
const eqv = (a, b) => a === b || canon(a) === canon(b);
function sameRec(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!eqv(a[k], b[k])) return false;
  return true;
}
const META = new Set(["rev", "updatedAt", "changedBy"]);
/* the same fields, whatever the revision and stamps */
function sameContent(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!META.has(k) && !eqv(a[k], b[k])) return false;
  return true;
}
/* A "unit" is a field, except that deleted and removedAt are one unit. */
const unitOf = (f) => (f === "removedAt" ? "deleted" : f);
const unitVal = (r, u) => (u === "deleted" ? [!!r.deleted, r.removedAt || null] : r[u]);
function unitsOf(...recs) {
  const s = new Set();
  for (const r of recs) if (r) for (const f of Object.keys(r)) if (!META.has(f)) s.add(unitOf(f));
  return s;
}
const sameUnit = (a, b, u) => eqv(unitVal(a, u), unitVal(b, u));
function setUnit(out, src, u) {
  for (const f of u === "deleted" ? ["deleted", "removedAt"] : [u])
    if (src[f] !== undefined) out[f] = src[f];
    else delete out[f];
}
/* "c:id" -> the record as the data file held it at the last read or write. basesKnown: the bases cover the whole file
   (false only for a copy stored without them), so a record without a base is one the file didn't have. */
let bases = Object.create(null),
  basesKnown = false;
const splitKey = (k) => {
  const i = k.indexOf(":");
  return [k.slice(0, i), k.slice(i + 1)];
};
const hasRec = (st, c, id) => !!st[c] && Object.hasOwn(st[c], id);
/* F changed since B (F.rev > B.rev): take what it changed, keep what you changed; returns [record, conflict] */
function merge3(L, F, B) {
  const out = { ...L };
  let took = false,
    clash = false;
  for (const u of unitsOf(L, F, B)) {
    if (sameUnit(F, B, u)) continue;
    if (sameUnit(L, B, u)) {
      setUnit(out, F, u);
      took = true;
    } else if (!sameUnit(L, F, u)) clash = true;
  }
  if (sameContent(out, F)) return [F, false];
  if (took) for (const f of ["updatedAt", "changedBy"]) if (F[f] !== undefined) out[f] = F[f];
  out.rev = Math.max(revOf(F), revOf(L)) + 1;
  return [clean(out), clash];
}
/* The file's record F against this browser's L (null when it has none) with base B (see the rule above). `rec.kept`
   and `rec.took` collect the keys to record. */
function mergeFile(k, L, F, B, rec) {
  if (!L) return F;
  if (sameRec(L, F)) return L;
  /* the same fields: the file's stamps are taken only with a higher rev */
  if (sameContent(L, F)) return revOf(F) > revOf(L) ? F : L;
  if (!B) {
    if (basesKnown) {
      rec.kept.add(k);
      return L;
    }
    if (revOf(L) > revOf(F)) return L;
    rec.took.add(k);
    return F;
  }
  if (revOf(F) > revOf(B)) {
    const [out, clash] = merge3(L, F, B);
    if (clash) rec.kept.add(k);
    return out;
  }
  if (!sameContent(F, B)) rec.kept.add(k);
  return L;
}
/* The file's records `n` (normalized) merged into a copy of `st`; the bases become the file's records. */
function mergeIn(st, n, rec) {
  const next = copyStore(st);
  for (const k of Object.keys(bases)) {
    const [c, id] = splitKey(k);
    if (hasRec(next, c, id) && !hasRec(n, c, id)) rec.kept.add(k);
  }
  for (const c of COLLS)
    for (const id of Object.keys(n[c])) {
      const k = c + ":" + id,
        F = n[c][id],
        B = bases[k];
      const L = hasRec(next, c, id) ? next[c][id] : null;
      /* unchanged since the last read or write: nothing to merge */
      if (!(L && B && sameRec(B, F))) next[c][id] = mergeFile(k, L, F, B, rec);
      bases[k] = F;
    }
  basesKnown = true;
  return next;
}
/* What is written: a record that differs from its base gets a rev above the base's (your edits already raised it;
   this covers a record kept over an older copy or over an edit made without a new rev). */
function revsForWrite(snap) {
  for (const c of COLLS)
    for (const id of Object.keys(snap[c])) {
      const r = snap[c][id],
        b = bases[c + ":" + id];
      if (!b || r === b || revOf(r) > revOf(b) || sameContent(r, b)) continue;
      const r2 = { ...r, rev: revOf(b) + 1 };
      snap[c][id] = r2;
      if (store[c][id] === r) store[c][id] = r2;
    }
}
/* The data file holds `snap` now (just written). */
function setBases(snap) {
  bases = Object.create(null);
  for (const c of COLLS) for (const id of Object.keys(snap[c])) bases[c + ":" + id] = snap[c][id];
  basesKnown = true;
}
/* Tabs share one copy in browser storage: each tab writes its copy there after every change and takes the other tabs'
   copies from there. `tabBase` is that shared copy as this tab last wrote or read it, the common base for merging the
   next copy another tab writes (see mergeTab). */
let tabBase = null;
/* Another tab's record O against this tab's M, with S, the record in the shared copy before. Per field, the side that
   changed it since S wins (what this tab hasn't passed on yet stays). A field both changed goes to the copy with the
   higher rev: every edit raises it, so that is the later edit (a tie goes to the same side in every tab, so all tabs
   settle on one value). */
function mergeTab(M, O, S) {
  if (!M) return O;
  if (!O || sameRec(M, O)) return M;
  const later = revOf(O) !== revOf(M) ? (revOf(O) > revOf(M) ? O : M) : canon(O) > canon(M) ? O : M;
  if (!S) return later;
  const out = { ...M };
  for (const u of unitsOf(M, O, S)) {
    if (sameUnit(O, S, u) || sameUnit(O, M, u)) continue;
    if (sameUnit(M, S, u) || later === O) setUnit(out, O, u);
  }
  out.rev = Math.max(revOf(M), revOf(O));
  for (const f of ["updatedAt", "changedBy"])
    if (later[f] !== undefined) out[f] = later[f];
    else delete out[f];
  if (sameRec(out, O)) return O;
  if (sameRec(out, M)) return M;
  return clean(out);
}
/* The bases as kept in browser storage next to the copy `st`: 1 for a record that is the same as its base (most of
   them), otherwise the base itself. */
const boCache = new WeakMap(); // record -> [its base, what is stored]
function basesOut(st) {
  const out = {};
  for (const k of Object.keys(bases)) {
    const [c, id] = splitKey(k),
      b = bases[k];
    const r = hasRec(st, c, id) ? st[c][id] : null;
    if (!r) {
      out[k] = b;
      continue;
    }
    const hit = boCache.get(r);
    if (hit && hit[0] === b) {
      out[k] = hit[1];
      continue;
    }
    out[k] = r === b || sameRec(r, b) ? 1 : b;
    boCache.set(r, [b, out[k]]);
  }
  return out;
}
/* Stored bases back (1 means the record of `st` itself). */
function basesIn(saved, st) {
  const m = Object.create(null);
  if (!saved || typeof saved !== "object") return m;
  for (const [k, v] of Object.entries(saved)) {
    const [c, id] = splitKey(k);
    if (!COLLS.includes(c)) continue;
    if (v === 1) {
      if (hasRec(st, c, id)) m[k] = st[c][id];
    } else if (v && typeof v === "object" && !Array.isArray(v)) m[k] = clean(v);
  }
  return m;
}
const copyStore = (st) => {
  const out = emptyStore();
  for (const c of COLLS) Object.assign(out[c], st[c]);
  return out;
};
const collectionsOnly = (st) =>
  JSON.stringify(
    COLLS.map((c) =>
      Object.keys(st[c] || {})
        .sort()
        .map((k) => [k, st[c][k]]),
    ),
  );
function parseDataText(t) {
  const k = t.indexOf("window.BOARD_DATA");
  if (k < 0) throw new Error("not a board file");
  const i = t.indexOf("{", k),
    j = t.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("no data");
  return JSON.parse(t.slice(i, j + 1));
}
/* The page loads board_data.js with a <script> tag, so anything in it besides the data would run as code. Read from the
   folder, the file is only ever JSON.parse'd; this checks that nothing but comments surrounds `window.BOARD_DATA = {…};`. */
function wrapperOk(t) {
  const k = t.indexOf("window.BOARD_DATA");
  const i = t.indexOf("{", k),
    j = t.lastIndexOf("}");
  if (k < 0 || i < 0 || j < i) return false;
  /* comments are removed in one left-to-right pass, as JavaScript reads them: a "/*" inside a line comment starts
     nothing, and a line comment ends at any line break JavaScript knows (\r, U+2028 and U+2029 too) */
  const bare = (x) => x.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r\u2028\u2029]*/g, "");
  return /^\s*window\.BOARD_DATA\s*=\s*$/.test(bare(t.slice(0, i))) && /^\s*;?\s*$/.test(bare(t.slice(j + 1)));
}
const DATA_HEADER =
  "// Job Search Organizer data. The page and any tool you trust (a script, an AI assistant) may edit this file.\n" +
  '// Rules: read this file right before you write it. Every record has a revision number "rev": when you add or change\n' +
  '// a record, set its "rev" to the old value + 1 (a new record: 1). A change without a new rev is not taken.\n' +
  "// Never delete a record outright: set deleted:true and removedAt, with a new rev. Also set updatedAt and changedBy.\n";
function serialize(st) {
  return (
    DATA_HEADER +
    "window.BOARD_DATA = " +
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ...extras, ...st }, null, 1) +
    ";\n"
  );
}
keepExtras(window.BOARD_DATA);
const fileCopy = window.BOARD_DATA && typeof window.BOARD_DATA === "object" ? normalize(window.BOARD_DATA) : null;
let localCopy = null,
  saved = {};
try {
  const raw = lsGet("board", null);
  if (raw) {
    const j = JSON.parse(raw);
    localCopy = normalize(j);
    if (j && typeof j === "object") saved = j;
  }
} catch (e) {}
/* this browser's copy merged with the file as the page loaded it */
let store = copyStore(localCopy || emptyStore());
if (saved._base && typeof saved._base === "object") {
  bases = basesIn(saved._base, store);
  basesKnown = true;
}
/* what that first merge recorded: written to backups/ and shown once saving to the folder is on (see recordMerge) */
let pendingRecord = null;
if (fileCopy) {
  const rec = { kept: new Set(), took: new Set() };
  const before = store;
  store = mergeIn(store, fileCopy, rec);
  if (rec.kept.size || rec.took.size) pendingRecord = { rec, browser: before };
}
function unsyncedCount() {
  let n = 0;
  for (const c of COLLS)
    for (const id of Object.keys(store[c])) {
      const b = bases[c + ":" + id],
        r = store[c][id];
      if (!b || (b !== r && !sameContent(b, r))) n++;
    }
  return n;
}
const live = (c) => Object.fromEntries(Object.entries(store[c]).filter(([, r]) => r && !r.deleted));
const get = (c, id) => {
  if (typeof id !== "string" || !Object.hasOwn(store[c], id)) return null;
  const r = store[c][id];
  return r && !r.deleted ? r : null;
};

/* "New from …": records another tool changed since your previous visit */
let seen = null;
try {
  seen = JSON.parse(lsGet("seen", "null"));
} catch (e) {}
if (!seen || typeof seen !== "object") {
  seen = {};
  for (const c of COLLS) for (const [id, r] of Object.entries(store[c])) seen[c + ":" + id] = r.updatedAt || "";
  lsSet("seen", JSON.stringify(seen));
}
const isNewFromTool = (c, id, r) => !!r && !!r.changedBy && r.changedBy !== "you" && seen[c + ":" + id] !== r.updatedAt;
function markSeen(c, id) {
  const r = store[c][id];
  if (!r || seen[c + ":" + id] === r.updatedAt) return;
  seen[c + ":" + id] = r.updatedAt;
  lsSet("seen", JSON.stringify(seen));
}

/* ================= lanes and lookups ================= */
/* A lane id the settings don't have (a typo in board_data.js) shows in the first lane, with a console warning. */
const laneWarned = new Set();
function laneOf(sec, id) {
  const l = SECTIONS[sec].lanes.find((x) => x.id === id);
  if (l) return l;
  if (!laneWarned.has(sec + ":" + id)) {
    laneWarned.add(sec + ":" + id);
    try {
      console.warn(`Unknown lane "${id}" in ${sec}; the card is shown in "${SECTIONS[sec].lanes[0].name}".`);
    } catch (e) {}
  }
  return SECTIONS[sec].lanes[0];
}
const laneKey = (sec, x) => laneOf(sec, x.lane || "todo").id;
const isDue = (sec, x) =>
  !!x.followUp && laneKey(sec, x) !== "todo" && !laneOf(sec, x.lane || "todo").done && x.followUp <= TODAY();
function dueList() {
  const out = [];
  for (const sec of BOARDS)
    for (const [id, x] of Object.entries(live(sec))) if (isDue(sec, x)) out.push({ sec, id, x });
  out.sort((a, b) => a.x.followUp.localeCompare(b.x.followUp));
  return out;
}
function nextFollow() {
  let best = null;
  for (const sec of BOARDS)
    for (const [id, x] of Object.entries(live(sec)))
      if (
        x.followUp &&
        laneKey(sec, x) !== "todo" &&
        !laneOf(sec, laneKey(sec, x)).done &&
        x.followUp > TODAY() &&
        (!best || x.followUp < best.x.followUp)
      )
        best = { sec, id, x };
  return best;
}
function matches(sec, x) {
  if (!query) return true;
  const q = query.toLowerCase();
  const keys = sec === "todos" ? ["text", "detail"] : SECTIONS[sec].search;
  return keys.some((k) => typeof x[k] === "string" && x[k].toLowerCase().includes(q));
}
/* A headhunter who already submitted you at a company: applying there yourself can cause a fee dispute. */
function hunterConflict(company) {
  const c = String(company || "")
    .trim()
    .toLowerCase();
  if (c.length < 3) return null;
  const re = new RegExp("(^|[^a-z0-9])" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])", "i");
  for (const h of Object.values(live("hunters"))) if (h.submittedTo && re.test(h.submittedTo)) return h;
  return null;
}
function logLine(text) {
  return `${fmtDate(TODAY())}: ${text}`;
}
const personName = (pid) => {
  const p = pid && get("people", pid);
  return p ? p.name || "Someone" : null;
};
function jobsReferredBy(pid) {
  return Object.entries(live("jobs")).filter(([, j]) => j.referralId === pid);
}

/* ================= writes (every write raises rev and stamps updatedAt and who changed it) ================= */
/* A record as you just changed it: the next revision, stamped now. */
const edited = (r, patch) => ({ ...r, ...patch, rev: revOf(r) + 1, updatedAt: nowIso(), changedBy: "you" });
const has = (c, id) => Object.hasOwn(store[c], id);
function blockedEdit() {
  if (!VIEW_ONLY) return false;
  showToast("This browser can't save to your board folder. Open this page in Chrome or Edge to make changes.");
  setTimeout(render, 0);
  return true;
}
function setRec(c, id, rec) {
  store[c][id] = rec;
}
function upd(c, id, patch) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  setRec(c, id, edited(store[c][id], patch));
  persist();
}
function put(c, id, rec) {
  if (blockedEdit()) return;
  setRec(c, id, edited(has(c, id) ? store[c][id] : null, rec));
  persist();
}
function del(c, id) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  setRec(c, id, edited(store[c][id], { deleted: true, removedAt: nowIso() }));
  persist();
}
let lastUndo = null;
function moveCard(sec, id, lane) {
  if (blockedEdit()) return;
  const x = get(sec, id);
  if (!x || laneKey(sec, x) === lane) return;
  const L = laneOf(sec, lane);
  const keys = ["lane", "movedAt", "followUp", "appliedAt", "sentResume", "closedReason"];
  const before = Object.fromEntries(keys.map((k) => [k, x[k] ?? null]));
  const patch = { lane, movedAt: nowIso(), followUp: L.follow ? addDays(L.follow) : null };
  if (!L.done) patch.closedReason = null;
  if (sec === "jobs") {
    if (lane === "applied" && !x.appliedAt) {
      patch.appliedAt = nowIso();
      if (x.resume && !x.sentResume) patch.sentResume = x.resume;
    }
    if (lane === "todo") {
      patch.appliedAt = null;
      patch.sentResume = null;
    }
  }
  upd(sec, id, patch);
  render();
  if (openRef && openRef.sec === sec && openRef.id === id) openDrawer(sec, id, true);
  const undo = () => {
    upd(sec, id, before);
    render();
    if (openRef && openRef.sec === sec && openRef.id === id) openDrawer(sec, id, true);
  };
  let msg = `${SECTIONS[sec].title(x)} → ${L.name}${patch.followUp ? ` · follow up ${fmtDate(patch.followUp)}` : ""}`;
  if (sec === "jobs" && lane === "applied") {
    const h = hunterConflict(x.company);
    if (h) msg = `Heads up: ${h.name} submitted you at ${x.company}. Check with them before applying. ` + msg;
  }
  showToast(msg, undo);
}
