// Test hooks on top of the in-memory folder (src/demo/memfs.js, loaded first).
// window.__pick is the board folder the picker returns; window.__pick2 is the second backup folder.
(function () {
  const { MemFile, MemDir, fromFiles } = window.MemFS;
  /* window.__failWrites makes every write fail, as when Chrome withdraws permission; __writes counts saves */
  const write = MemFile.prototype.createWritable;
  MemFile.prototype.createWritable = async function () {
    if (window.__failWrites) throw new DOMException("fail", "NotAllowedError");
    const w = await write.call(this);
    const close = w.close;
    w.close = async () => {
      await close();
      window.__writes = (window.__writes || 0) + 1;
    };
    return w;
  };
  MemDir.prototype.queryPermission = async () => window.__perm || "granted";
  MemDir.prototype.requestPermission = async () => (window.__perm = "granted");

  window.__FDir = MemDir;
  window.__mk = (files) => fromFiles("My Job Search", files, Date.now() - 86400000);
  const walk = (p) => window.__pick.at(p);
  window.__get = async (p) => {
    const f = walk(p);
    return f && f.kind === "file" ? await (await f.getFile()).text() : null;
  };
  window.__mtime = (p) => (walk(p) || {}).mtime || 0;
  window.__put = (p, t) => {
    const cur = walk(p);
    if (cur && cur.kind === "file") {
      cur.data = new Blob([t]);
      cur.mtime = Date.now() + 5;
      return;
    }
    const parts = p.split("/");
    let d = window.__pick;
    for (const part of parts.slice(0, -1)) {
      if (!d.kids.has(part)) d.kids.set(part, new MemDir(part));
      d = d.kids.get(part);
    }
    const n = parts[parts.length - 1];
    d.kids.set(n, new MemFile(n, t, Date.now()));
  };
  window.__ls = (p) => {
    const d = walk(p);
    return d && d.kind === "directory" ? [...d.kids.keys()] : null;
  };
  window.__count = (p) => {
    const c = (d) => (d.kind === "file" ? 1 : [...d.kids.values()].reduce((a, k) => a + c(k), 0));
    const d = walk(p);
    return d ? c(d) : 0;
  };
  window.showDirectoryPicker = async (o) => (o && /backup/i.test(o.id || "") ? window.__pick2 : window.__pick);
})();
