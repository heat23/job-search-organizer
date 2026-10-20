/* ================= the data store =================
   board_data.js holds five collections of records keyed by id. Two copies can exist (the file and this browser);
   they merge record by record (see merge3 below; updatedAt is compared as a real time). Removed records keep deleted:true. */
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
/* ---- field-level three-way merge ----
   For each record the page remembers the version the data file held when it was last read or written (its base),
   also across reloads (kept with this browser's copy). Comparing the file's record with that base:
   - the file didn't change it: this browser's copy stays (and is written back if it is newer);
   - the file's record has an updatedAt OLDER than the base: it is a stale copy (a tool wrote back what it read before
     your last save), so it is ignored and the next save writes your version back. Your saved edits, Removes and
     Restores are never undone by an older copy;
   - the file changed it with the same updatedAt as the base (a tool edited a field but didn't stamp it): the fields
     it changed are taken, except a field this browser changed too (yours wins, since the file isn't newer);
   - the file changed it with a newer updatedAt: field by field, a field only the file changed takes the file's value,
     a field only this browser changed keeps yours, and a field both changed takes the value of the newer record.
   Without a base (a record never read from this file), the record with the newer updatedAt wins as a whole.
   A removal (deleted: true) is a field like any other. */
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
/* the same fields, whatever the stamp (updatedAt, changedBy) */
function sameContent(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (k !== "updatedAt" && k !== "changedBy" && !eqv(a[k], b[k])) return false;
  return true;
}
const isoAt = (ms) => new Date(ms).toISOString();
function merge3(cur, disk, base) {
  if (!cur) return disk;
  if (!disk || sameRec(cur, disk)) return cur;
  if (!base) return ts(disk) > ts(cur) ? disk : cur;
  if (sameRec(disk, base)) return cur;
  if (ts(disk) < ts(base)) return cur;
  if (sameContent(cur, disk)) return ts(disk) > ts(cur) ? disk : cur;
  const stamped = ts(disk) > ts(base);
  /* only the file changed it; an unstamped edit gets a new time so other tabs and the file take it too */
  if (sameRec(cur, base)) return stamped ? disk : { ...disk, updatedAt: isoAt(ts(disk) + 1) };
  const diskNewer = ts(disk) > ts(cur);
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(cur), ...Object.keys(disk)])) {
    if (k === "updatedAt" || k === "changedBy") continue;
    const d = disk[k],
      l = cur[k],
      b = base[k];
    const dc = !eqv(d, b),
      lc = !eqv(l, b);
    const v = dc && lc ? (diskNewer ? d : l) : dc ? d : l;
    if (v !== undefined) out[k] = v;
  }
  /* one side's values only: keep that record as it is (two tabs merging each other's copies settle at once) */
  if (sameContent(out, cur)) return cur;
  if (sameContent(out, disk) && diskNewer) return disk;
  /* later than both, so the merged record wins everywhere (other tabs, the file) */
  out.updatedAt = isoAt(Math.max(ts(cur), ts(disk)) + 1);
  const by = diskNewer ? disk.changedBy : cur.changedBy;
  if (by !== undefined) out.changedBy = by;
  return clean(out);
}
/* The base of every record: what the data file held at the last read or write ("c:id" -> record). */
let fileRecs = Object.create(null);
function setFileRecs(st) {
  fileRecs = Object.create(null);
  for (const c of COLLS) for (const id of Object.keys((st && st[c]) || {})) fileRecs[c + ":" + id] = st[c][id];
}
/* The bases kept with this browser's copy (see persistLocal): "c:id" -> 1 when the base is the record itself (most
   records, so this stays small), or the base record when this browser's copy differs from the file. */
function basesOf(st) {
  const out = {};
  for (const c of COLLS)
    for (const id of Object.keys(st[c])) {
      const b = fileRecs[c + ":" + id];
      if (b) out[c + ":" + id] = sameRec(b, st[c][id]) ? 1 : b;
    }
  return out;
}
/* A kept base back as a record (1 = the record it was kept with), or null. */
function baseFrom(v, c, id, rec) {
  if (v === 1) return rec || null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return normalize({ [c]: { [id]: v } })[c][id] || null;
}
function merge(a, b) {
  const out = emptyStore();
  for (const c of COLLS) {
    for (const id of Object.keys(a[c] || {})) out[c][id] = a[c][id];
    for (const id of Object.keys(b[c] || {})) {
      const r = b[c][id];
      const cur = out[c][id];
      if (!cur || ts(r) > ts(cur)) out[c][id] = r;
    }
  }
  return out;
}
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
    "// Rules: stamp every record you add or change with updatedAt = now (ISO time, UTC with Z); an older copy never wins.\n" +
    "// Never delete a record outright: set deleted:true and a new updatedAt. Other tools also set changedBy to their name.\n" +
    "window.BOARD_DATA = " +
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ...extras, ...st }, null, 1) +
    ";\n"
  );
}
keepExtras(window.BOARD_DATA);
const fileCopy = window.BOARD_DATA && typeof window.BOARD_DATA === "object" ? normalize(window.BOARD_DATA) : null;
let localCopy = null,
  savedBases = {};
try {
  const raw = lsGet("board", null);
  if (raw) {
    const j = JSON.parse(raw);
    localCopy = normalize(j);
    if (j && j._bases && typeof j._bases === "object") savedBases = j._bases;
  }
} catch (e) {}
/* this browser's copy merged with the file as the page loaded it (field by field where a base was kept) */
let store = merge(emptyStore(), localCopy || emptyStore());
if (fileCopy)
  for (const c of COLLS)
    for (const id of Object.keys(fileCopy[c]))
      store[c][id] = merge3(store[c][id], fileCopy[c][id], baseFrom(savedBases[c + ":" + id], c, id, store[c][id]));
/* What the data file is known to hold: changes newer than this exist only in this browser. */
let fileBase = Object.create(null);
function setFileBase(st) {
  fileBase = Object.create(null);
  for (const c of COLLS) for (const id of Object.keys((st && st[c]) || {})) fileBase[c + ":" + id] = ts(st[c][id]);
}
setFileBase(fileCopy);
setFileRecs(fileCopy);
function unsyncedCount() {
  let n = 0;
  for (const c of COLLS)
    for (const id of Object.keys(store[c])) {
      const b = fileBase[c + ":" + id];
      if (b === undefined || ts(store[c][id]) > b) n++;
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
  store[c][id] = { ...r, ...patch, updatedAt: stamp(r), changedBy: "you" };
  persist();
}
function put(c, id, rec) {
  if (blockedEdit()) return;
  const r = has(c, id) ? store[c][id] : null;
  store[c][id] = { ...rec, updatedAt: stamp(r), changedBy: "you" };
  persist();
}
function del(c, id) {
  if (blockedEdit()) return;
  if (!has(c, id)) return;
  const r = store[c][id];
  store[c][id] = { ...r, deleted: true, removedAt: nowIso(), updatedAt: stamp(r), changedBy: "you" };
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
