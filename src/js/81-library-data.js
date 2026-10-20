/* ================= guides and prep sheets: where they come from =================
   Library/**.md          guides (a subfolder is a group in the Library tab)
   Job notes/<id>/prep.md  a job's prep sheet (any Markdown with ## sections)
   Job notes/<id>/outreach.md, posting.md  shown folded at the end of the sheet
   With saving on, files are read live from your folder. Before that, Library/_bundle.js (made by `npm run bundle`)
   is the fallback, so the sample board works straight from a download. */
const FS = {
  ok() {
    try {
      return !!(dirHandle && canWrite);
    } catch (e) {
      return false;
    }
  },
  async dir(path, create) {
    let d = dirHandle;
    for (const seg of String(path).split("/").filter(Boolean))
      d = await d.getDirectoryHandle(seg, { create: !!create });
    return d;
  },
  /* {text,mtime} | null when the file does not exist | false when the folder can't be read right now */
  async read(path) {
    try {
      const parts = path.split("/");
      const name = parts.pop();
      const d = await this.dir(parts.join("/"));
      const f = await (await d.getFileHandle(name)).getFile();
      return { text: await f.text(), mtime: f.lastModified };
    } catch (e) {
      return e && e.name === "NotFoundError" ? null : false;
    }
  },
  async write(path, text) {
    const parts = path.split("/");
    const name = parts.pop();
    const d = await this.dir(parts.join("/"), true);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    const f = await fh.getFile();
    return f.lastModified;
  },
  async list(path) {
    const out = [];
    try {
      const d = await this.dir(path);
      for await (const [n, h] of d.entries()) out.push([n, h.kind]);
    } catch (e) {}
    return out;
  },
};
const MYPATH = "Library/My_answers.md";
const DOCS = {}; // id -> {title, path, group, splitBold, md}
const PREPTXT = {}; // job id -> prep.md text
const JOBDOCS = {}; // job id -> {outreach, posting}
/* "Library/Interviews/01_Call_scripts.md" -> "call-scripts" */
const docIdOf = (path) =>
  slug(
    path
      .split("/")
      .pop()
      .replace(/\.md$/i, "")
      .replace(/^[\d\s._-]+/, ""),
  );
const isGuidePath = (p) => /^Library\/([^/]+\/)?[^/_][^/]*\.md$/i.test(p) && p !== MYPATH && !/\/README\.md$/i.test(p);
/* A prep sheet needs at least one "## section". */
const validPrep = (t) => typeof t === "string" && /^## \S/m.test(t);
function ingest(path, text) {
  if (isGuidePath(path)) {
    const id = docIdOf(path);
    const p = parse(text);
    const parts = path.split("/");
    const cur = DOCS[id];
    if (cur && cur.md === text && cur.path === path) return false;
    DOCS[id] = {
      title: p.fm.title || p.title || id,
      path,
      group: parts.length > 2 ? parts[1].replace(/^[\d\s._-]+/, "").replace(/_/g, " ") : "Guides",
      splitBold: p.fm.split === "bold",
      md: text,
    };
    return true;
  }
  const m = path.match(/^Job notes\/([^/]+)\/(prep|outreach|posting)\.md$/);
  if (m && m[1] !== "hunters") {
    if (m[2] === "prep") {
      if (PREPTXT[m[1]] === text) return false;
      PREPTXT[m[1]] = text;
      return true;
    }
    const jd = (JOBDOCS[m[1]] = JOBDOCS[m[1]] || {});
    if (jd[m[2]] === text) return false;
    jd[m[2]] = text;
    return true;
  }
  return false;
}
(function loadBundle() {
  const B = window.ORGANIZER_LIBRARY;
  if (B && B.files && typeof B.files === "object")
    for (const [p, t] of Object.entries(B.files)) if (typeof t === "string") ingest(p, t);
})();
/* Library groups in folder order, guides in file-name order (number prefixes set the order). */
function libGroups() {
  const ids = Object.keys(DOCS).sort((a, b) => DOCS[a].path.localeCompare(DOCS[b].path));
  const top = ids.filter((i) => DOCS[i].group === "Guides"),
    rest = ids.filter((i) => DOCS[i].group !== "Guides");
  const groups = new Map();
  if (top.length) groups.set("Guides", top);
  for (const i of rest) {
    if (!groups.has(DOCS[i].group)) groups.set(DOCS[i].group, []);
    groups.get(DOCS[i].group).push(i);
  }
  return [...groups.entries()];
}
/* Re-read every guide in the folder (new ones included). Runs when a sheet or the Library opens (at most every 3
   seconds unless forced), once saving is on, and when you come back to the window. A read already running is shared.
   docsVer counts the changes to the guides; libLoaded: a read of the folder's guides has finished (until then an empty
   Library says "Loading guides…": the bundle may be missing, out of date or from another tool). */
let libReadAt = 0,
  docsRead = null,
  docsVer = 0,
  libLoaded = false;
function refreshDocs(force) {
  if (!FS.ok()) return Promise.resolve(false);
  if (docsRead) return docsRead;
  if (!force && Date.now() - libReadAt < 3000) return Promise.resolve(false);
  libReadAt = Date.now();
  docsRead = readDocs().finally(() => {
    docsRead = null;
    libLoaded = true;
  });
  return docsRead;
}
async function readDocs() {
  let changed = false;
  const paths = [];
  for (const [n, k] of await FS.list("Library")) {
    if (k === "file" && /\.md$/i.test(n)) paths.push("Library/" + n);
    else if (k === "directory")
      for (const [n2, k2] of await FS.list("Library/" + n))
        if (k2 === "file" && /\.md$/i.test(n2)) paths.push(`Library/${n}/${n2}`);
  }
  for (const p of paths)
    if (isGuidePath(p)) {
      const r = await FS.read(p);
      if (r && ingest(p, r.text)) changed = true;
    }
  if (changed) docsVer++;
  return changed;
}
/* New or changed prep sheets written into the folder since the bundle was made.
   opts.quiet: don't redraw the board (a panel is open); opts.skip: a job whose open sheet checks its own prep.md. */
let prepScanned = false;
const fileSeen = {};
async function scanPrep(opts) {
  opts = opts || {};
  if (!FS.ok()) return false;
  let changed = false;
  for (const [nm, kind] of await FS.list("Job notes")) {
    if (kind !== "directory" || nm === "hunters" || nm === opts.skip) continue;
    const r = await FS.read(`Job notes/${nm}/prep.md`);
    if (r && validPrep(r.text) && r.text !== PREPTXT[nm]) {
      PREPTXT[nm] = r.text;
      fileSeen[nm] = true;
      changed = true;
    }
  }
  prepScanned = true;
  if (changed) myMigrate();
  if (!opts.quiet && (changed || Object.keys(PREPTXT).length === 0)) {
    try {
      render();
    } catch (e) {}
  }
  return changed;
}
