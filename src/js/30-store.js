/* ================= the data store =================
   board_data.js holds five collections of records keyed by id. Two copies can exist (the file and this browser);
   they merge field by field by each record's revisions `revs` (see "merging" below). Removed records keep deleted:true. */
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
  /* per-field revisions (see "merging" below); a record-level "rev" from an earlier version means nothing now */
  delete o.rev;
  if (o.revs !== undefined) {
    const bad = {};
    const rs = cleanRevs(o.revs, bad);
    if (Object.keys(rs).length) o.revs = rs;
    else delete o.revs;
    if (Object.keys(bad).length) BADREVS.set(o, bad);
  }
  return o;
}
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
/* ---- merging: per-field revisions ----
   A record may carry `revs`, {field: n}; a field not listed counts as 0. Whoever changes a field (this page or another
   tool) sets revs[field] to its old value + 1. updatedAt and changedBy are only shown (and drive the "New from …" tag),
   never compared, so clocks play no part. This browser's copy also keeps, per record, its DIRTY fields: the fields
   changed here and not yet written to the data file (`dirtyF`, stored with the copy and shared by open tabs). A field is
   clean again once a write of it succeeded, unless it changed again meanwhile.
   Another copy R (the data file, or another tab's copy) merges into this copy L field by field:
   - the higher revision wins. On a tie with different values R wins (from the file that is an edit made without a bump,
     written back with revs + 1; from another tab it is the later copy).
   - an unsynced change is never lost: when the winning value isn't dirty and the losing one is, the dirty value stays,
     with revs = the higher of the two + 1, so it wins everywhere once written.
   - except a dirty flag stored with this browser's copy as the page loads: the copy can be out of date (the page closed
     after writing the file but before clearing the flag, or browser storage stopped taking new copies). Until the
     first read of the data file, such a field whose revision the file has reached (equal or higher) with a different
     value takes the file's value: the file already holds that change or a newer one. Only a stored dirty field with a
     revision above the file's (a change never written) wins. The value replaced is kept (see keepDropped below).
   - deleted and removedAt are fields like any other. A record only one side has is kept.
   Against the file, a value of yours kept over a different file value is recorded when the file's revision is as high as
   yours or higher (you and another tool changed the same field), or lower while yours isn't dirty (an older copy was
   written back). "Recorded" means the file as it was goes to backups/ and the status line says so, one line per merge
   (recordMerge in storage.js). */
/* the highest revision read as written: 2^52 (about 4.5e15), so a tool that writes a timestamp in milliseconds or
   microseconds as a revision still works, and every later + 1 stays an exact whole number (up to 2^53) */
const MAXREV = 2 ** 52;
const META = new Set(["revs", "updatedAt", "changedBy"]);
const rv = (r, f) => (r && r.revs && Object.hasOwn(r.revs, f) ? r.revs[f] : 0);
/* revs as kept: whole numbers from 0 to MAXREV (a number written as text is read as that number; 0 is the same as no
   entry). Any other number (a fraction, a negative number, a nanosecond timestamp, anything at 2^53 or above) is invalid:
   it goes into `bad` ({field: what was written}) and is read as a change to the field (see fixRevs), never capped. Anything
   that isn't a number counts as 0. */
function cleanRevs(v, bad) {
  const out = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [f, x] of Object.entries(v)) {
    if (f === "__proto__") continue;
    const n = typeof x === "string" && /^\s*\d+\s*$/.test(x) ? Number(x) : x;
    if (typeof n !== "number") continue;
    if (Number.isSafeInteger(n) && n >= 0 && n <= MAXREV) {
      if (n >= 1) out[f] = n;
    } else if (bad) bad[f] = x;
  }
  return out;
}
/* record (as normalize returned it) -> its invalid revisions, see cleanRevs */
const BADREVS = new WeakMap();
/* "c:id\tfield" -> {sig, rev}: the revision an invalid one was read as, so the same copy read again (an older copy written
   back) gets the same revision, not a new one above this browser's */
const badSeen = new Map();
/* R (from the file or another tab) with each invalid revision read as L's revision of the field + 1: a change made
   after L's (as a tool that bumps would have written it). The same invalid number and value seen again for that field
   keeps the revision it got the first time, and a number equal to L's (this page wrote it) stays L's. */
function fixRevs(L, R, k) {
  const bad = R && BADREVS.get(R);
  if (!bad) return R;
  const revs = { ...(R.revs || {}) };
  for (const [f, x] of Object.entries(bad)) {
    const lr = rv(L, f),
      key = k + "\t" + f,
      sig = canon(x) + "\t" + canon(R[f]),
      seen = badSeen.get(key);
    let n;
    if (x === lr) n = lr;
    else if (seen && seen.sig === sig) n = seen.rev;
    else {
      n = lr + 1;
      badSeen.set(key, { sig, rev: n });
    }
    if (n) revs[f] = n;
  }
  const out = { ...R };
  if (Object.keys(revs).length) out.revs = revs;
  else delete out.revs;
  return out;
}
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
/* the same fields and revisions, whatever the stamps */
function sameContent(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (k !== "updatedAt" && k !== "changedBy" && !eqv(a[k], b[k])) return false;
  return true;
}
/* every field the records have or have a revision for */
function fieldsOf(...recs) {
  const s = new Set();
  for (const r of recs)
    if (r) {
      for (const f of Object.keys(r)) if (!META.has(f)) s.add(f);
      if (r.revs) for (const f of Object.keys(r.revs)) s.add(f);
    }
  return s;
}
const splitKey = (k) => {
  const i = k.indexOf(":");
  return [k.slice(0, i), k.slice(i + 1)];
};
const hasRec = (st, c, id) => !!st[c] && Object.hasOwn(st[c], id);
/* "c:id" -> {field: 1}: the fields changed in this browser and not yet written to the data file */
let dirtyF = Object.create(null);
function dirtyIn(v) {
  const m = Object.create(null);
  if (!v || typeof v !== "object" || Array.isArray(v)) return m;
  for (const [k, fs] of Object.entries(v)) {
    if (!COLLS.includes(splitKey(k)[0]) || !fs || typeof fs !== "object") continue;
    const d = {};
    for (const f of Array.isArray(fs) ? fs : Object.keys(fs)) if (typeof f === "string" && f !== "__proto__") d[f] = 1;
    if (Object.keys(d).length) m[k] = d;
  }
  return m;
}
const dirtyOut = () => Object.fromEntries(Object.entries(dirtyF).map(([k, d]) => [k, Object.keys(d)]));
const copyDirty = (m) => Object.fromEntries(Object.entries(m).map(([k, d]) => [k, { ...d }]));
function markDirty(k, f) {
  (dirtyF[k] = dirtyF[k] || {})[f] = 1;
}
/* R merged into L (see the rule above). Ld and Rd: their dirty fields; file: R is the data file; Ls: {field: rev} of
   L's dirty fields as stored when the page loaded (see loadedDirty). Returns the record, its dirty fields (or null), the
   fields to record, the fields taken from R and the stored dirty fields found out of date. */
function mergeRec(L, Ld, R, Rd, file, Ls, k) {
  R = fixRevs(L, R, k);
  if (!L) return { rec: R, dirty: Rd || null, kept: [], taken: [], stale: [], dropped: {} };
  if (sameRec(L, R)) {
    const d = {};
    if (Ld && Rd) for (const f of Object.keys(Ld)) if (Rd[f]) d[f] = 1;
    return { rec: L, dirty: Object.keys(d).length ? d : null, kept: [], taken: [], stale: [], dropped: {} };
  }
  const out = { ...L },
    revs = { ...(L.revs || {}) },
    dirty = {},
    kept = [],
    taken = [],
    stale = [],
    dropped = {};
  let took = false;
  for (const f of fieldsOf(L, R)) {
    const lr = rv(L, f),
      rr = rv(R, f),
      rd = !!(Rd && Rd[f]);
    let ld = !!(Ld && Ld[f]);
    /* a dirty flag from the stored copy, on a value unchanged since the load, that the file has caught up with: stale */
    if (ld && file && Ls && Object.hasOwn(Ls, f) && Ls[f] === lr && rr >= lr && !eqv(L[f], R[f])) {
      ld = false;
      stale.push(f);
      /* this browser's value is replaced: a copy of it is kept (see keepDropped in storage.js) */
      dropped[f] = L[f] === undefined ? null : L[f];
    }
    let fromR = false,
      n,
      d;
    if (eqv(L[f], R[f])) {
      n = Math.max(lr, rr);
      d = lr > rr ? ld : rr > lr ? rd : ld && rd;
    } else {
      const rWins = rr >= lr;
      if (rWins ? !rd && ld : !ld && rd) {
        /* the losing side holds an unsynced change: it stays, above both */
        fromR = !rWins;
        n = Math.max(lr, rr) + 1;
        d = true;
        if (file) kept.push(f);
      } else {
        fromR = rWins;
        n = rWins ? (file && rr === lr ? rr + 1 : rr) : lr;
        d = rWins ? rd : ld;
        /* the file holds an older value of a field that isn't waiting to be written: an older copy written back */
        if (file && !rWins && !ld) kept.push(f);
      }
    }
    if (fromR) {
      if (R[f] === undefined) delete out[f];
      else out[f] = R[f];
      took = true;
      taken.push(f);
    }
    if (n) revs[f] = n;
    else delete revs[f];
    if (d) dirty[f] = 1;
  }
  if (took)
    for (const f of ["updatedAt", "changedBy"])
      if (R[f] !== undefined) out[f] = R[f];
      else delete out[f];
  if (Object.keys(revs).length) out.revs = revs;
  else delete out.revs;
  const D = Object.keys(dirty).length ? dirty : null;
  /* nothing taken: your stamps stay (a copy only re-stamped changes nothing) */
  return { rec: took && sameContent(out, R) ? R : sameRec(out, L) ? L : out, dirty: D, kept, taken, stale, dropped };
}
/* The copy `n` (normalized; nd: its dirty fields, null for the data file) merged into a copy of `st` (sd: its dirty
   fields; ls: the stored dirty revisions still to check, see loadedDirty). Returns the merged copy, its dirty fields and
   the sets of "c:id\tfield" to record (file merges only), taken from `n`, and found stale. */
function mergeStores(st, sd, n, nd, file, ls) {
  const next = copyStore(st),
    dirty = Object.create(null),
    rec = new Set(),
    taken = new Set(),
    stale = new Set(),
    dropped = [];
  for (const k of Object.keys(sd)) dirty[k] = sd[k];
  for (const c of COLLS) {
    for (const id of Object.keys(n[c])) {
      const k = c + ":" + id;
      const m = mergeRec(hasRec(next, c, id) ? next[c][id] : null, sd[k], n[c][id], nd && nd[k], file, ls && ls[k], k);
      next[c][id] = m.rec;
      if (m.dirty) dirty[k] = m.dirty;
      else delete dirty[k];
      for (const f of m.kept) rec.add(k + "\t" + f);
      for (const f of m.taken) taken.add(k + "\t" + f);
      for (const f of m.stale) stale.add(k + "\t" + f);
      for (const [f, v] of Object.entries(m.dropped)) dropped.push({ c, id, f, v });
    }
    /* a record the file lost (removing is deleted:true) is kept and written back; recorded unless it was never written */
    if (file)
      for (const id of Object.keys(next[c]))
        if (!hasRec(n, c, id)) {
          const k = c + ":" + id,
            d = sd[k] || {},
            fs = [...fieldsOf(next[c][id])];
          if (fs.some((f) => !d[f])) for (const f of fs) rec.add(k + "\t" + f);
        }
  }
  return { store: next, dirty, rec, taken, stale, dropped };
}
/* After a successful write of `snap`: the fields that were dirty in it (sd) are clean, unless they changed since. */
function cleanWritten(snap, sd) {
  for (const k of Object.keys(sd)) {
    const [c, id] = splitKey(k);
    const s = hasRec(snap, c, id) ? snap[c][id] : null,
      r = hasRec(store, c, id) ? store[c][id] : null,
      d = dirtyF[k];
    if (!d) continue;
    if (s && r) for (const f of Object.keys(sd[k])) if (d[f] && rv(s, f) === rv(r, f) && eqv(s[f], r[f])) delete d[f];
    if (!r || !Object.keys(d).length) delete dirtyF[k];
  }
}
/* A browser copy stored by a version before per-field revisions is merged once the way that version did: per record,
   the newer updatedAt wins. The fields where this browser's winning record differs from the file become new edits (the
   file's revision + 1) and dirty, so they are written and never lost, even when saving was never turned on. */
const tsOf = (r) => (r && Date.parse(r.updatedAt)) || 0;
function legacyMerge(st, n) {
  for (const c of COLLS) {
    for (const id of Object.keys(n[c])) {
      const F = n[c][id],
        L = hasRec(st, c, id) ? st[c][id] : null;
      if (!L || !(tsOf(L) > tsOf(F))) {
        st[c][id] = F;
        continue;
      }
      const revs = { ...(F.revs || {}) };
      for (const f of fieldsOf(L, F))
        if (!eqv(L[f], F[f])) {
          revs[f] = rv(F, f) + 1;
          markDirty(c + ":" + id, f);
        }
      st[c][id] = { ...L, revs };
    }
    for (const id of Object.keys(st[c]))
      if (!hasRec(n, c, id)) {
        const revs = {};
        for (const f of fieldsOf(st[c][id])) {
          revs[f] = rv(st[c][id], f) + 1;
          markDirty(c + ":" + id, f);
        }
        st[c][id] = { ...st[c][id], revs };
      }
  }
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
  "// Rules: read this file right before you write it. When you change a field of a record, add 1 to that record's\n" +
  '// "revs" entry for the field (create "revs" or the entry if missing: it becomes 1). Never copy an old file back.\n' +
  "// Never delete a record outright: set deleted:true and removedAt (and bump their revs). Also set updatedAt and changedBy.\n";
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
dirtyF = dirtyIn(saved._dirty);
/* "c:id" -> {field: rev}: the dirty fields stored with this browser's copy and their revisions, checked against the data
   file until its first read from the folder (see the rule above) */
let loadedDirty = Object.create(null);
for (const k of Object.keys(dirtyF)) {
  const [c, id] = splitKey(k);
  if (!hasRec(store, c, id)) continue;
  loadedDirty[k] = {};
  for (const f of Object.keys(dirtyF[k])) loadedDirty[k][f] = rv(store[c][id], f);
}
/* a copy stored by a version before per-field revisions (it has no _dirty): merged by that version's rule, once, at
   the first read of the data file (see legacyMerge) */
let legacyLocal = !!localCopy && (!Object.hasOwn(saved, "_dirty") || saved._legacy === 1);
/* This browser's values that the rule above replaced with the file's newer ones (a change made with saving off that
   another tool or browser also changed in the file): {c, id, f, v, at}. Kept here and in browser storage (the newest 50)
   until they are written to backups/board_data_browser_<date>_<HHMM>.js (flushDropped in storage.js). */
let dropped = [];
try {
  const j = JSON.parse(lsGet("dropped", "[]"));
  if (Array.isArray(j))
    dropped = j.filter(
      (x) => x && typeof x === "object" && COLLS.includes(x.c) && typeof x.id === "string" && typeof x.f === "string",
    );
} catch (e) {}
function keepDropped(list) {
  const at = nowIso();
  for (const x of list) dropped.push({ ...x, at });
  dropped = dropped.slice(-50);
  lsSet("dropped", JSON.stringify(dropped));
}
/* The data file's records `n` (normalized) merged into this browser's copy; returns {rec, taken, stale} (see
   mergeStores) for recordMerge. */
function mergeFileIn(n) {
  if (legacyLocal) {
    legacyMerge(store, n);
    legacyLocal = false;
  }
  const m = mergeStores(store, dirtyF, n, null, true, loadedDirty);
  store = m.store;
  dirtyF = m.dirty;
  /* the values this browser lost to the file's newer ones are kept (in backups/, or in this browser until then) */
  if (m.dropped.length) keepDropped(m.dropped);
  return { rec: m.rec, taken: m.taken, stale: m.stale };
}
/* what that first merge recorded: written to backups/ and shown once saving to the folder is on (see recordMerge) */
let pendingRecord = null;
if (fileCopy) {
  const m = mergeFileIn(fileCopy);
  if (m.rec.size || m.stale.size) pendingRecord = m;
}
/* the cards with a change that isn't in the data file yet */
function unsyncedCount() {
  let n = 0;
  for (const k of Object.keys(dirtyF)) {
    const [c, id] = splitKey(k);
    if (hasRec(store, c, id)) n++;
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

/* ================= writes: each field that changes gets its revision raised and counts as dirty ================= */
const has = (c, id) => Object.hasOwn(store[c], id);
function blockedEdit() {
  if (!VIEW_ONLY) return false;
  showToast("This browser can't save to your board folder. Open this page in Chrome or Edge to make changes.");
  setTimeout(render, 0);
  return true;
}
/* `patch` applied to record c:id (a new record when there is none): every field whose value changes gets revs + 1 and is
   dirty until it is written; the record is stamped. Returns the fields that changed. */
function applyEdit(c, id, patch) {
  const r = has(c, id) ? store[c][id] : null;
  const out = { ...r },
    revs = { ...((r && r.revs) || {}) },
    changed = [];
  for (const f of Object.keys(patch)) {
    const v = patch[f];
    if (META.has(f) || f === "rev" || f === "__proto__" || (r ? eqv(r[f], v) : v === undefined)) continue;
    if (v === undefined) delete out[f];
    else out[f] = v;
    revs[f] = rv(r, f) + 1;
    markDirty(c + ":" + id, f);
    changed.push(f);
  }
  if (!changed.length && r) return changed;
  out.revs = revs;
  out.updatedAt = nowIso();
  out.changedBy = "you";
  store[c][id] = out;
  return changed;
}
function upd(c, id, patch) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  applyEdit(c, id, patch);
  persist();
}
function put(c, id, rec) {
  if (blockedEdit()) return;
  applyEdit(c, id, rec);
  persist();
}
function del(c, id) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  applyEdit(c, id, { deleted: true, removedAt: nowIso() });
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
