// A folder that lives in memory, with the parts of Chrome's File System Access API the page uses
// (getDirectoryHandle, getFileHandle, entries, removeEntry, createWritable, permissions).
// The live demo runs on it, so it works in any browser, and the tests build on it (tests/ffs.js).
(function () {
  class MemFile {
    constructor(name, data, mtime) {
      this.kind = "file";
      this.name = name;
      this.data = data instanceof Blob ? data : new Blob([data]);
      this.mtime = mtime || Date.now();
    }
    async getFile() {
      return new File([this.data], this.name, { lastModified: this.mtime });
    }
    async createWritable() {
      const chunks = [];
      return {
        write: async (d) => {
          chunks.push(d);
        },
        close: async () => {
          this.data = new Blob(chunks);
          this.mtime = Math.max(Date.now(), this.mtime + 1);
        },
      };
    }
    async isSameEntry(other) {
      return other === this;
    }
  }
  class MemDir {
    constructor(name) {
      this.kind = "directory";
      this.name = name;
      this.kids = new Map();
    }
    async getDirectoryHandle(name, opts = {}) {
      let k = this.kids.get(name);
      if (!k) {
        if (!opts.create) throw new DOMException(name, "NotFoundError");
        k = new MemDir(name);
        this.kids.set(name, k);
      }
      if (k.kind !== "directory") throw new DOMException(name, "TypeMismatchError");
      return k;
    }
    async getFileHandle(name, opts = {}) {
      let k = this.kids.get(name);
      if (!k) {
        if (!opts.create) throw new DOMException(name, "NotFoundError");
        k = new MemFile(name, "");
        this.kids.set(name, k);
      }
      if (k.kind !== "file") throw new DOMException(name, "TypeMismatchError");
      return k;
    }
    async *entries() {
      for (const e of [...this.kids.entries()]) yield e;
    }
    async removeEntry(name, opts = {}) {
      const k = this.kids.get(name);
      if (!k) throw new DOMException(name, "NotFoundError");
      if (k.kind === "directory" && k.kids.size && !opts.recursive)
        throw new DOMException(name, "InvalidModificationError");
      this.kids.delete(name);
    }
    async resolve(handle) {
      const find = (d, path) => {
        for (const [n, k] of d.kids) {
          if (k === handle) return [...path, n];
          if (k.kind === "directory") {
            const r = find(k, [...path, n]);
            if (r) return r;
          }
        }
        return null;
      };
      return find(this, []);
    }
    async queryPermission() {
      return "granted";
    }
    async requestPermission() {
      return "granted";
    }
    async isSameEntry(other) {
      return other === this;
    }
    /* the handle at a path like "Job notes/acme/prep.md", or null */
    at(path) {
      let d = this;
      for (const part of String(path).split("/").filter(Boolean)) {
        d = d.kind === "directory" ? d.kids.get(part) : null;
        if (!d) return null;
      }
      return d;
    }
  }
  /* A folder filled from { "path/to/file": text or Blob } */
  function fromFiles(name, files, mtime) {
    const root = new MemDir(name);
    for (const [path, data] of Object.entries(files)) {
      const parts = path.split("/");
      let d = root;
      for (const part of parts.slice(0, -1)) {
        if (!d.kids.has(part)) d.kids.set(part, new MemDir(part));
        d = d.kids.get(part);
      }
      const n = parts[parts.length - 1];
      d.kids.set(n, new MemFile(n, data, mtime));
    }
    return root;
  }
  window.MemFS = { MemFile, MemDir, fromFiles };
})();
