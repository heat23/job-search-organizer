/* ================= the notes pad (Job notes/<id>/my_notes.md, written only by this page) =================
   Autosaves about a second after you stop typing, and keeps a draft in this browser so nothing typed is lost while
   saving is off. It never overwrites a file it hasn't read: if the file changed on disk, the other version is saved
   beside it as my_notes.changed-on-disk-<time>.md. Changes made on disk while the pad is idle appear within 5 seconds. */
const pads = new Set();
const errText = (e) =>
  !e
    ? "error"
    : e.name === "NotFoundError"
      ? "the board folder isn't reachable"
      : e.name === "NotAllowedError"
        ? "permission was lost"
        : e.name;
function makePad(o) {
  const LK = "note:" + o.key;
  const wrap = document.createElement("div");
  wrap.className = "pad";
  const ta = document.createElement("textarea");
  ta.id = "notes-pad";
  ta.setAttribute("aria-label", "My notes");
  ta.placeholder = "Type here during the call. Esc, then 1-9 jump to a section, / filter.";
  const stat = document.createElement("div");
  stat.className = "padstat";
  stat.setAttribute("aria-live", "polite");
  wrap.append(ta, stat);
  let base = { mtime: 0, text: null },
    dirty = false,
    timer = null,
    saving = false,
    ready = false,
    statKind = "",
    diskChecked = false,
    early = false;
  const readDraft = () => {
    try {
      return JSON.parse(lsGet(LK, "null"));
    } catch (e) {
      return null;
    }
  };
  const writeDraft = (unsaved) =>
    lsSet(LK, JSON.stringify({ text: ta.value, at: Date.now(), unsaved, baseText: base.text }));
  function setStat(kind, msg, withBtn) {
    statKind = kind;
    stat.className = "padstat " + kind;
    stat.textContent = "";
    const s = document.createElement("span");
    s.textContent = msg;
    stat.append(s);
    if (withBtn) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn small";
      b.textContent = "Turn on saving";
      b.onclick = () => {
        dirHandle && !canWrite ? allowAgain() : connectFolder();
      };
      stat.append(b);
    }
  }
  const conflictName = () => o.path.replace(/my_notes\.md$/, "my_notes.changed-on-disk-" + nowStamp() + ".md");
  async function load() {
    if (VIEW_ONLY) {
      ready = true;
      setStat("bad", "This browser can't save. Open this page in Chrome or Edge.");
      return;
    }
    const draft = readDraft();
    let disk = false;
    if (FS.ok()) disk = await FS.read(o.path); // {..} | null (no file) | false (unreadable)
    diskChecked = disk !== false && FS.ok();
    const typed = early ? ta.value : "";
    if (disk) {
      base = { mtime: disk.mtime, text: disk.text };
      if (draft && draft.unsaved && draft.text !== disk.text) {
        if (draft.baseText !== disk.text) {
          try {
            await FS.write(conflictName(), disk.text);
            showToast(
              "The notes file changed on disk while you were away. Your version is kept; the other one is saved beside it.",
            );
          } catch (e) {}
        }
        ta.value = draft.text;
        dirty = true;
      } else ta.value = disk.text;
    } else {
      if (draft && draft.text) {
        ta.value = draft.text;
        dirty = !!draft.unsaved;
      } else ta.value = o.seed || "";
    }
    if (typed) {
      ta.value = typed + (ta.value ? "\n" + ta.value : "");
      dirty = true;
    }
    ready = true;
    if (dirty) {
      setStat("warn", "Saving…");
      save();
    } else if (diskChecked) setStat("ok", disk ? "Saved" : "Ready · saves as you type");
    else setStat("bad", "Not saving to your folder yet. What you type is kept in this browser.", true);
  }
  async function save() {
    clearTimeout(timer);
    if (!ready) return;
    if (saving) {
      timer = setTimeout(save, 400);
      return;
    }
    if (!FS.ok()) {
      setStat("bad", "Not saved to your folder. Kept in this browser, and it will save when saving is back on.", true);
      return;
    }
    saving = true;
    const snapshot = ta.value;
    try {
      const cur = await FS.read(o.path);
      if (cur === false) throw Object.assign(new Error("unreadable"), { name: "NotFoundError" });
      /* never overwrite a file we haven't read: keep the other version beside it */
      if (cur && cur.text !== snapshot && (!diskChecked || base.text == null || cur.text !== base.text)) {
        await FS.write(conflictName(), cur.text);
        showToast("The notes file was different on disk. Yours is saved; the other version is saved beside it.");
      }
      const mt = await FS.write(o.path, snapshot);
      base = { mtime: mt, text: snapshot };
      diskChecked = true;
      dirty = ta.value !== snapshot;
      writeDraft(dirty);
      if (dirty) {
        setStat("warn", "Saving…");
        timer = setTimeout(save, 300);
      } else setStat("ok", "Saved " + hhmm(new Date()));
    } catch (e) {
      if (e && e.name === "NotAllowedError") {
        try {
          if (dirHandle && (await dirHandle.queryPermission({ mode: "readwrite" })) !== "granted") {
            canWrite = false;
            renderBanner();
            renderStatus();
          }
        } catch (_) {}
      }
      setStat("bad", "Couldn't save: " + errText(e) + ". Your notes are kept in this browser and it will retry.", true);
    }
    saving = false;
  }
  ta.addEventListener("input", () => {
    if (!ready) {
      early = true;
      return;
    }
    dirty = true;
    writeDraft(true);
    setStat("warn", FS.ok() ? "Saving…" : "Not saved to your folder. Kept in this browser only.", !FS.ok());
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  });
  async function poll() {
    if (!wrap.isConnected && !dirty && !saving) {
      pads.delete(api);
      return;
    }
    if (ready && dirty && !saving && !FS.ok()) {
      try {
        if (dirHandle && (await dirHandle.queryPermission({ mode: "readwrite" })) === "granted") {
          canWrite = true;
          try {
            renderBanner();
            renderStatus();
          } catch (_) {}
        }
      } catch (_) {}
    }
    if (!ready || saving || !FS.ok()) return;
    if (dirty) {
      save();
      return;
    } // retry after the folder comes back
    const r = await FS.read(o.path);
    if (r === false || dirty || saving) return;
    if (!diskChecked) {
      diskChecked = true;
      if (r) {
        base = { mtime: r.mtime, text: r.text };
        if (!ta.value.trim() || ta.value === r.text) {
          ta.value = r.text;
          setStat("ok", "Saved");
        } else {
          dirty = true;
          save();
        }
      } else setStat("ok", "Ready · saves as you type");
      return;
    }
    if (!r) return;
    if (r.text !== base.text && r.mtime > base.mtime) {
      base = { mtime: r.mtime, text: r.text };
      if (ta.value !== r.text) {
        const p = ta.selectionStart;
        ta.value = r.text;
        try {
          ta.setSelectionRange(Math.min(p, r.text.length), Math.min(p, r.text.length));
        } catch (e) {}
      }
      setStat("ok", "Updated from your folder " + hhmm(new Date()));
    } else if (statKind === "bad") setStat("ok", "Saved");
  }
  const api = {
    el: wrap,
    ta,
    isDirty: () => dirty,
    flush() {
      if (dirty) {
        clearTimeout(timer);
        return save();
      }
    },
    poll,
    addLine() {
      const pre = logLine("");
      ta.value = pre + (ta.value ? "\n" + ta.value : "");
      ta.focus();
      ta.setSelectionRange(pre.length, pre.length);
      ta.dispatchEvent(new Event("input"));
    },
    insert(t) {
      ta.value = t + ta.value;
      ta.focus();
      ta.dispatchEvent(new Event("input"));
    },
  };
  pads.add(api);
  load();
  return api;
}
setInterval(() => {
  pads.forEach((p) => p.poll());
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") pads.forEach((p) => p.flush());
});
window.addEventListener("pagehide", () => {
  pads.forEach((p) => p.flush());
});
window.addEventListener("beforeunload", (e) => {
  for (const p of pads)
    if (p.isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
});
