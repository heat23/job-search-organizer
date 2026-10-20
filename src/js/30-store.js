/* ================= the data store =================
   board_data.js holds five collections of records keyed by id. Two copies can exist (the file and this browser);
   they merge field by field (see mergeFile below). Removed records keep deleted:true. */
const emptyStore = () => Object.fromEntries(COLLS.map((c) => [c, Object.create(null)]));
const ts = (r) => (r && Date.parse(r.updatedAt)) || 0;
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
/* An updatedAt more than 5 minutes ahead of this computer's clock (a typo, or local time written with Z) is read as now,
   so it can never make later edits look older. */
let capWarned = false;
function capStamp(r) {
  if (ts(r) <= Date.now() + 3e5) return r;
  if (!capWarned) {
    capWarned = true;
    try {
      console.warn(`A record's updatedAt (${r.updatedAt}) is in the future; it is read as now.`);
    } catch (e) {}
  }
  return { ...r, updatedAt: nowIso() };
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
        out[c][id] = clean(capStamp(r.updatedAt ? r : { ...r, updatedAt: dflt }));
    }
  }
  return out;
}
/* ---- merging: content-based ----
   For every record the page keeps a short history (`hist`) of the values the data file held when the page read or
   wrote it: per field, the last few values as short hashes, kept with this browser's copy. When the file's record
   differs from this browser's, field by field:
   - the file's value is one the page has seen before (and isn't yours): an older copy written back (a tool saved what
     it read before your change). Yours stays, and the next save writes it back;
   - the file's value is new: an edit made by another tool. It is taken, unless you changed that field too since the
     last read; then the later change wins (when you changed it, against the file record's updatedAt; one more than
     5 minutes ahead of this clock is read as now, see capStamp);
   - deleted and removedAt count as one field, so Remove and Restore follow the same rule.
   updatedAt only breaks ties. A record without a history (browser storage was full, or a copy from before this version)
   falls back to: the record with the newer updatedAt wins.
   Open tabs share one copy in browser storage and merge each other's copies field by field by the time this browser last
   changed each field (`ftime`), so all tabs settle on the latest change. */
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
  if (!a || !b) return a === b;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!eqv(a[k], b[k])) return false;
  return true;
}
const SKIP = new Set(["updatedAt", "changedBy"]);
/* the same fields, whatever the stamp (updatedAt, changedBy) */
function sameContent(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!SKIP.has(k) && !eqv(a[k], b[k])) return false;
  return true;
}
const isoAt = (ms) => new Date(ms).toISOString();
/* A "unit" is a field, except that deleted and removedAt are one unit. */
const unitOf = (f) => (f === "removedAt" ? "deleted" : f);
const unitVal = (r, u) => (u === "deleted" ? [!!r.deleted, r.removedAt || null] : r[u]);
function unitsOf(...recs) {
  const s = new Set();
  for (const r of recs) if (r) for (const f of Object.keys(r)) if (!SKIP.has(f)) s.add(unitOf(f));
  return s;
}
const sameUnit = (a, b, u) => eqv(unitVal(a, u), unitVal(b, u));
function setUnit(out, src, u) {
  for (const f of u === "deleted" ? ["deleted", "removedAt"] : [u])
    if (src[f] !== undefined) out[f] = src[f];
    else delete out[f];
}
/* A short hash of a unit's value (records are never changed in place, so it is cached per record). */
function h32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
const hcache = new WeakMap();
function vh(r, u) {
  if (!r) return h32(canon(unitVal({}, u)));
  let m = hcache.get(r);
  if (!m) hcache.set(r, (m = Object.create(null)));
  return m[u] || (m[u] = h32(canon(unitVal(r, u))));
}
/* hist: "c:id" -> {unit: [hashes, newest first]}; a unit missing from a known record was never set ([hash of nothing]).
   ftime: "c:id" -> {unit: time this browser last changed it}. */
const HMAX = 5;
let hist = new Map(),
  ftime = new Map();
const seenOf = (H, u) => H[u] || [vh(null, u)];
/* The data file holds `rec` now (read from it, or written to it). */
function rememberFile(k, rec) {
  const had = hist.get(k);
  const H = { ...had };
  for (const u of new Set([...unitsOf(rec), ...Object.keys(H)])) {
    const x = vh(rec, u);
    const l = had ? seenOf(H, u) : [];
    H[u] = [x, ...l.filter((y) => y !== x)].slice(0, HMAX);
  }
  hist.set(k, H);
}
/* You (or this page) changed a record: note when each field changed, for merging with other tabs. */
function touch(k, before, after) {
  const T = ftime.get(k) || {};
  const now = Date.now();
  for (const u of unitsOf(before, after)) if (!before || !sameUnit(before, after, u)) T[u] = now;
  ftime.set(k, T);
}
function setRec(c, id, rec) {
  touch(c + ":" + id, store[c][id], rec);
  store[c][id] = rec;
}
/* The file's record `disk` against this browser's `cur` (see the rule above). `stale` collects the keys of records where
   an older value in the file was overridden. */
function mergeFile(k, cur, disk, stale) {
  if (!cur) return disk;
  if (!disk || sameRec(cur, disk)) return cur;
  const H = hist.get(k);
  if (!H) return ts(disk) > ts(cur) ? disk : cur;
  const T = ftime.get(k) || {};
  const out = { ...cur };
  let took = false;
  for (const u of unitsOf(cur, disk)) {
    if (sameUnit(cur, disk, u)) continue;
    const l = seenOf(H, u);
    if (l.includes(vh(disk, u))) {
      if (stale) stale.add(k);
      continue;
    }
    if (vh(cur, u) !== l[0] && (T[u] || ts(cur)) >= ts(disk)) continue;
    setUnit(out, disk, u);
    T[u] = Date.now();
    took = true;
  }
  if (!took) return cur;
  ftime.set(k, T);
  if (sameContent(out, disk)) return disk;
  out.updatedAt = isoAt(Math.max(ts(cur), ts(disk)) + 1);
  if (disk.changedBy !== undefined) out.changedBy = disk.changedBy;
  return clean(out);
}
/* Another tab's record: per field, the later change in this browser wins (ties: the newer record). */
function mergeTab(k, cur, theirs, tT) {
  tT = tT || {};
  if (!cur) {
    if (Object.keys(tT).length) ftime.set(k, { ...tT });
    return theirs;
  }
  if (!theirs || sameRec(cur, theirs)) return cur;
  const T = ftime.get(k) || {};
  const out = { ...cur };
  let took = false;
  for (const u of unitsOf(cur, theirs)) {
    if (sameUnit(cur, theirs, u)) continue;
    const a = tT[u] || 0,
      m = T[u] || 0;
    if (a > m || (a === m && ts(theirs) > ts(cur))) {
      setUnit(out, theirs, u);
      if (a) T[u] = a;
      took = true;
    }
  }
  if (!took) return cur;
  ftime.set(k, T);
  if (sameContent(out, theirs)) return theirs;
  out.updatedAt = isoAt(Math.max(ts(cur), ts(theirs)) + 1);
  return clean(out);
}
/* The history and change times as kept in browser storage, next to the copy `st`. A record whose every field's history
   is just its current value is stored as 1 (most records); otherwise only the fields that differ are listed. Change times
   older than two days are dropped (they only matter while two tabs are open). */
const hoCache = new WeakMap(); // record -> [its history object, what is stored] (a history is replaced, never changed)
function histOut(st) {
  const out = {};
  for (const c of COLLS)
    for (const id of Object.keys(st[c])) {
      const k = c + ":" + id,
        H = hist.get(k),
        rec = st[c][id];
      if (!H) continue;
      const hit = hoCache.get(rec);
      if (hit && hit[0] === H) {
        out[k] = hit[1];
        continue;
      }
      let o = null;
      for (const u of new Set([...unitsOf(rec), ...Object.keys(H)])) {
        const l = seenOf(H, u);
        if (l.length !== 1 || l[0] !== vh(rec, u)) (o = o || {})[u] = l.join(" ");
      }
      out[k] = o || 1;
      hoCache.set(rec, [H, out[k]]);
    }
  return out;
}
function ftimeOut() {
  const out = {},
    old = Date.now() - 2 * 864e5;
  for (const [k, T] of ftime) {
    let o = null;
    for (const [u, t] of Object.entries(T)) if (t > old) (o = o || {})[u] = t.toString(36);
    if (o) out[k] = o;
    else ftime.delete(k);
  }
  return out;
}
const timesIn = (o) => {
  const T = {};
  if (o && typeof o === "object")
    for (const [u, t] of Object.entries(o)) if (parseInt(t, 36) > 0) T[u] = parseInt(t, 36);
  return T;
};
/* A stored history back, for the records of `st`. */
function histIn(saved, st) {
  const m = new Map();
  if (!saved || typeof saved !== "object") return m;
  for (const [k, v] of Object.entries(saved)) {
    const i = k.indexOf(":"),
      c = k.slice(0, i),
      id = k.slice(i + 1);
    const rec = st[c] && Object.hasOwn(st[c], id) ? st[c][id] : null;
    if (!rec) continue;
    const o = v && typeof v === "object" ? v : {};
    const H = {};
    for (const u of new Set([...unitsOf(rec), ...Object.keys(o)]))
      H[u] = typeof o[u] === "string" && o[u] ? o[u].split(" ").slice(0, HMAX) : [vh(rec, u)];
    m.set(k, H);
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
function serialize(st) {
  return (
    "// Job Search Organizer data. The page and any tool you trust (a script, an AI assistant) may edit this file.\n" +
    "// Rules: read this file right before you write it, and stamp every record you add or change with updatedAt = now (ISO, UTC with Z).\n" +
    "// Never delete a record outright: set deleted:true and a new updatedAt. Other tools also set changedBy to their name.\n" +
    "window.BOARD_DATA = " +
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ...extras, ...st }, null, 1) +
    ";\n"
  );
}
keepExtras(window.BOARD_DATA);
const fileCopy = window.BOARD_DATA && typeof window.BOARD_DATA === "object" ? normalize(window.BOARD_DATA) : null;
/* What the data file held at the last read or write ("c:id" -> record): a record that differs exists only in this browser. */
let fileRecs = Object.create(null);
function setFileRecs(st) {
  fileRecs = Object.create(null);
  for (const c of COLLS) for (const id of Object.keys((st && st[c]) || {})) fileRecs[c + ":" + id] = st[c][id];
}
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
hist = histIn(saved._hist, store);
for (const [k, v] of Object.entries(saved._ft && typeof saved._ft === "object" ? saved._ft : {}))
  ftime.set(k, timesIn(v));
/* a copy kept by an earlier version holds the record as the file had it ("bases"; 1 = the record itself) */
if (!saved._hist && saved._bases && typeof saved._bases === "object")
  for (const [k, v] of Object.entries(saved._bases)) {
    const i = k.indexOf(":"),
      c = k.slice(0, i),
      id = k.slice(i + 1);
    const cur = store[c] && Object.hasOwn(store[c], id) ? store[c][id] : null;
    const b = v === 1 ? cur : v && typeof v === "object" && cur ? normalize({ [c]: { [id]: v } })[c][id] : null;
    if (b) rememberFile(k, b);
  }
if (fileCopy)
  for (const c of COLLS)
    for (const id of Object.keys(fileCopy[c])) {
      store[c][id] = mergeFile(c + ":" + id, store[c][id], fileCopy[c][id]);
      rememberFile(c + ":" + id, fileCopy[c][id]);
    }
setFileRecs(fileCopy);
function unsyncedCount() {
  let n = 0;
  for (const c of COLLS)
    for (const id of Object.keys(store[c])) {
      const b = fileRecs[c + ":" + id],
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

/* ================= writes (every write stamps updatedAt and who changed it) ================= */
/* Always stamp later than the record's current time, so your edit wins even if a stored time runs ahead of this clock. */
const stamp = (r) => new Date(Math.max(Date.now(), ts(r) + 1)).toISOString();
const has = (c, id) => Object.hasOwn(store[c], id);
function blockedEdit() {
  if (!VIEW_ONLY) return false;
  showToast("This browser can't save to your board folder. Open this page in Chrome or Edge to make changes.");
  setTimeout(render, 0);
  return true;
}
function upd(c, id, patch) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  const r = store[c][id];
  setRec(c, id, { ...r, ...patch, updatedAt: stamp(r), changedBy: "you" });
  persist();
}
function put(c, id, rec) {
  if (blockedEdit()) return;
  const r = has(c, id) ? store[c][id] : null;
  setRec(c, id, { ...rec, updatedAt: stamp(r), changedBy: "you" });
  persist();
}
function del(c, id) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  const r = store[c][id];
  setRec(c, id, { ...r, deleted: true, removedAt: nowIso(), updatedAt: stamp(r), changedBy: "you" });
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
