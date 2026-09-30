/* ================= to-dos ================= */
function sortedTodos() {
  return Object.entries(live("todos")).sort(
    (a, b) =>
      (a[1].group === "later" ? 1 : 0) - (b[1].group === "later" ? 1 : 0) ||
      (a[1].order ?? 999) - (b[1].order ?? 999) ||
      String(a[1].createdAt || "").localeCompare(String(b[1].createdAt || "")),
  );
}
function todoRow(id, t, ctx) {
  const cb = el("input", { type: "checkbox", id: `td-${ctx}-${id}`, "data-f": "cb", "aria-label": "Done: " + t.text });
  cb.checked = !!t.done;
  cb.addEventListener("change", () => {
    upd("todos", id, { done: cb.checked, doneAt: cb.checked ? nowIso() : null });
    render();
    if (cb.checked)
      showToast("Done: " + t.text, () => {
        upd("todos", id, { done: false, doneAt: null });
        render();
      });
  });
  const isOpen = openTodo.has(id);
  const toggle = () => {
    if (isOpen) {
      openTodo.delete(id);
      editingTodo.delete(id);
    } else {
      openTodo.add(id);
      markSeen("todos", id);
    }
    render();
  };
  const isNew = isNewFromTool("todos", id, t);
  const meta = [];
  if (isNew) meta.push(el("span", { class: "tag new", text: "New" }));
  if (t.from === "you") meta.push(el("span", { text: "Added by you" }));
  const kids = [
    cb,
    el(
      "div",
      {
        class: "t",
        tabindex: "0",
        role: "button",
        "data-f": "t",
        "aria-expanded": String(isOpen),
        onclick: toggle,
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        },
      },
      el("span", { class: "tt", text: t.text }),
      el("span", { class: "chev", "aria-hidden": "true", text: isOpen ? "⌄" : "›" }),
    ),
    meta.length ? el("div", { class: "src" }, ...meta) : null,
  ];
  if (isOpen) {
    const det = el("div", { class: "det" });
    if (t.detail) det.append(t.detail);
    const u = safeUrl(t.url);
    if (u)
      det.append(
        document.createElement("br"),
        el("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: t.urlLabel || "Open ↗" }),
      );
    const edit = el("input", {
      type: "text",
      class: "edit-t",
      id: `tdedit-${ctx}-${id}`,
      "aria-label": "Edit this to-do",
      maxlength: "300",
      hidden: !editingTodo.has(id) || null,
    });
    edit.value = t.text;
    const save = () => {
      const v = edit.value.trim();
      const cur = get("todos", id);
      if (!cur || !v || v === cur.text) return false;
      upd("todos", id, { text: v });
      return true;
    };
    edit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        if (save()) render();
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        edit.value = t.text;
        edit.blur();
      }
    });
    edit.addEventListener("blur", () => {
      if (save()) {
        const row = edit.closest(".todo");
        const tt = row && row.querySelector(".tt");
        if (tt) tt.textContent = edit.value.trim();
      }
    });
    if (editingTodo.has(id)) det.append(el("div", { style: "margin-top:8px" }, edit));
    det.append(
      el(
        "div",
        { style: "margin-top:6px;display:flex;gap:14px;flex-wrap:wrap" },
        el("button", {
          class: "linkbtn",
          type: "button",
          text: editingTodo.has(id) ? "Done editing" : "Edit wording",
          onclick: () => {
            if (editingTodo.has(id)) {
              save();
              editingTodo.delete(id);
            } else editingTodo.add(id);
            render();
            const f = document.getElementById(edit.id);
            if (f && editingTodo.has(id)) f.focus();
          },
        }),
        el("button", {
          class: "linkbtn",
          type: "button",
          text: t.group === "later" ? "Move to Do first" : "Move to Later",
          onclick: () => {
            upd("todos", id, { group: t.group === "later" ? "first" : "later" });
            render();
          },
        }),
        el("button", {
          class: "linkbtn",
          type: "button",
          style: "color:var(--danger)",
          text: "Remove",
          onclick: () => {
            del("todos", id);
            openTodo.delete(id);
            render();
            showToast("To-do removed", () => {
              upd("todos", id, { deleted: false });
              render();
            });
          },
        }),
      ),
    );
    kids.push(det);
  }
  return el("div", { class: "todo" + (t.done ? " done" : ""), "data-key": `todo:${ctx}:${id}` }, ...kids);
}
function renderTodos(v) {
  const wrap = el("div", { class: "todos" });
  const inp = el("input", {
    type: "text",
    id: "newTodo",
    placeholder: "Add a to-do and press Enter",
    maxlength: "300",
  });
  inp.value = todoDraft;
  inp.addEventListener("input", () => {
    todoDraft = inp.value;
  });
  const add = () => {
    const n = $("#newTodo");
    const text = (n ? n.value : "").trim();
    if (!text) return;
    put("todos", newId(), {
      text,
      detail: "",
      from: "you",
      group: "first",
      done: false,
      createdAt: nowIso(),
      order: -Date.now(),
    });
    todoDraft = "";
    if (n) n.value = "";
    render();
    const m = $("#newTodo");
    if (m) m.focus();
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      add();
    }
  });
  wrap.append(
    el(
      "div",
      { class: "addrow" },
      inp,
      el("button", { class: "btn primary", type: "button", text: "Add", onclick: add }),
    ),
  );
  const all = sortedTodos().filter(([, t]) => matches("todos", t));
  const open = all.filter(([, t]) => !t.done);
  const done = all.filter(([, t]) => t.done);
  const first = open.filter(([, t]) => t.group !== "later"),
    later = open.filter(([, t]) => t.group === "later");
  if (!open.length)
    wrap.append(
      el("div", {
        class: "calm",
        text: query ? `No open to-dos match “${query}”.` : "All done. To-dos you or your tools add show up here.",
      }),
    );
  if (first.length)
    wrap.append(
      el("section", { class: "group" }, el("h3", { text: "Do first" }), ...first.map(([id, t]) => todoRow(id, t, "t"))),
    );
  if (later.length)
    wrap.append(
      el(
        "section",
        { class: "group" },
        el("h3", { text: "When you have time" }),
        ...later.map(([id, t]) => todoRow(id, t, "t")),
      ),
    );
  if (done.length) {
    done.sort((a, b) => String(b[1].doneAt || "").localeCompare(String(a[1].doneAt || "")));
    const d = el(
      "details",
      { class: "donebox", open: lsGet("doneOpen", "") === "1" || null },
      el("summary", { text: `Done (${done.length})` }),
      ...done.map(([id, t]) => todoRow(id, t, "t")),
    );
    d.addEventListener("toggle", () => lsSet("doneOpen", d.open ? "1" : "0"));
    wrap.append(d);
  }
  v.append(wrap);
}

/* ================= the plan (a checklist by week, on the Headhunters tab) ================= */
function planBox() {
  const items = Object.entries(live("plan")).sort((a, b) => a[1].week - b[1].week || a[1].order - b[1].order);
  if (!items.length) return el("span");
  const done = items.filter(([, p]) => planDone(p)).length;
  const weeks = {};
  for (const it of items) (weeks[it[1].week] = weeks[it[1].week] || []).push(it);
  const names = CONFIG.plan.weekNames || {};
  const d = el(
    "details",
    { class: "plan", id: "planBox", open: lsGet("planOpen", "") === "1" || null },
    el(
      "summary",
      {},
      CONFIG.plan.title,
      el(
        "span",
        { class: "meter", "aria-hidden": "true" },
        el("i", { style: `width:${Math.round((done / items.length) * 100)}%` }),
      ),
      el("span", { class: "chev", text: `${done} of ${items.length} done` }),
    ),
    el(
      "div",
      { class: "weeks" },
      ...Object.keys(weeks).map((w) =>
        el(
          "div",
          { class: "wk" },
          el("h4", { text: names[w] || "Week " + w }),
          ...weeks[w].map(([pid, p]) => {
            const dn = planDone(p);
            const au = isAuto(p);
            const cb = el("input", { type: "checkbox", id: "plan-" + pid, disabled: au ? true : null });
            cb.checked = dn;
            if (!au) cb.addEventListener("change", () => togglePlan(pid, cb.checked));
            return el(
              "label",
              { class: dn ? "done" : null, for: "plan-" + pid },
              cb,
              el("span", { text: p.text }),
              au
                ? el("span", { class: "hint", style: "display:block;margin:0", text: "Ticks itself from the board" })
                : null,
            );
          }),
        ),
      ),
    ),
  );
  d.addEventListener("toggle", () => lsSet("planOpen", d.open ? "1" : "0"));
  return d;
}
function togglePlan(pid, done) {
  upd("plan", pid, { done, doneAt: done ? nowIso() : null });
  render();
}
