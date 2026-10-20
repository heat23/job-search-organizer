/* ================= Markdown for guides and prep sheets =================
   A small subset, plus four markers:
     ✎  an answer you haven't confirmed yet (shows a "My version" box in guides and prep sheets)
     ☐  a fact you still need to find out
     *<…>*  an example answer: shown in a different color, left out when you copy
     ::: fold Title … :::  a collapsible block ("::: fold + Title" starts open)
     {.pay} at the end of a ## or ### heading marks a pay section (optionally blurred until you press H)
     {.ask} anywhere in a ### heading of a prep sheet adds an open "Their answer" box (stripped everywhere else)
   Structure: "# Title", "## Section" (a card), "### Question" (a block inside the card). */
const $q = (s, r) => (r || document).querySelector(s),
  $qa = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "s";
const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
const hhmm = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const cssId = (s) => String(s).replace(/([^\w-])/g, "\\$1");

/* Inline markup. Input is escaped first, so a guide can never inject HTML; only http(s) links become links. */
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/\*([^*]+)\*/g, (m, t) =>
    t.startsWith("&lt;") ? `<em class="ex" title="Example only: don't say as written">${t}</em>` : `<em>${t}</em>`,
  );
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s
    .replace(/☐/g, '<span class="todo-mark" title="A fact you still need to get">☐</span>')
    .replace(/✎/g, '<span class="ex-mark" title="Not confirmed yet: examples only">✎</span>');
  return s;
}
function blocks(lines) {
  let h = "",
    i = 0;
  const para = [];
  const flush = () => {
    if (para.length) {
      h += `<p>${para.map(inline).join("<br>")}</p>`;
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^:::\s*fold\s*/.test(l)) {
      flush();
      let t = l.replace(/^:::\s*fold\s*/, "");
      const openIt = /^\+\s/.test(t);
      t = t.replace(/^\+\s+/, "");
      const inner = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) inner.push(lines[i++]);
      i++;
      h += `<details class="fold"${openIt ? " open" : ""}><summary>${inline(t)}</summary>${blocks(inner)}</details>`;
      continue;
    }
    if (/^\s*\|/.test(l)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      if (body.length)
        h += `<div class="tbl"><table><thead><tr>${cells(body[0])
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .slice(1)
          .map(
            (r) =>
              `<tr>${cells(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`;
      continue;
    }
    if (/^>/.test(l)) {
      flush();
      const inner = [];
      while (i < lines.length && /^>/.test(lines[i])) inner.push(lines[i++].replace(/^>\s?/, ""));
      h += `<blockquote class="say">${blocks(inner)}</blockquote>`;
      continue;
    }
    if (/^\s*[-*] /.test(l)) {
      flush();
      let items = "";
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        let t = lines[i++].replace(/^\s*[-*] /, "");
        t = t.replace(/^\[ \] /, "☐ ").replace(/^\[x\] /i, "☑ ");
        items += `<li>${inline(t)}</li>`;
      }
      h += `<ul>${items}</ul>`;
      continue;
    }
    if (/^\s*\d+\. /.test(l)) {
      flush();
      let items = "";
      while (i < lines.length && /^\s*\d+\. /.test(lines[i]))
        items += `<li>${inline(lines[i++].replace(/^\s*\d+\. /, ""))}</li>`;
      h += `<ol>${items}</ol>`;
      continue;
    }
    if (/^#{1,6} /.test(l)) {
      flush();
      h += `<h5>${inline(l.replace(/^#+ /, ""))}</h5>`;
      i++;
      continue;
    }
    if (/^---+\s*$/.test(l)) {
      flush();
      i++;
      continue;
    }
    if (!l.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(l);
    i++;
  }
  flush();
  return h;
}
const ASK_RE = /\{\.ask\}/;
/* split/join, not a regex with \s* on both sides: that one takes seconds on a heading with a long run of spaces */
const stripAsk = (t) => String(t).split("{.ask}").join(" ").replace(/\s+/g, " ").trim();
/* A doc = optional front matter, "# title", "## sections" (cards), "### questions" (blocks).
   With `split: bold` in the front matter, a whole-line **bold** also starts a question (for long answer docs). */
function parse(md, opts) {
  opts = opts || {};
  let lines = String(md || "")
    .replace(/\r/g, "")
    .split("\n");
  const fm = {};
  if (lines[0] === "---") {
    let j = 1;
    while (j < lines.length && lines[j] !== "---") {
      const m = lines[j].match(/^(\w+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2];
      j++;
    }
    lines = lines.slice(j + 1);
  }
  let title = "";
  const intro = [];
  const secs = [];
  let cur = null,
    q = null;
  for (const l of lines) {
    if (/^# /.test(l) && !title) {
      title = l.slice(2).trim();
      continue;
    }
    if (/^## /.test(l)) {
      let t = stripAsk(l.slice(3).trim());
      const pay = /\{\.pay\}\s*$/.test(t);
      t = t.replace(/\s*\{\.pay\}\s*$/, "");
      cur = { title: t, pay, pre: [], qs: [] };
      q = null;
      secs.push(cur);
      continue;
    }
    if (/^### /.test(l) && cur) {
      let qt = l.slice(4).trim();
      const qask = ASK_RE.test(qt);
      qt = stripAsk(qt);
      const qpay = /\{\.pay\}\s*$/.test(qt);
      qt = qt.replace(/\s*\{\.pay\}\s*$/, "");
      q = { title: qt, lines: [], sub: !!opts.splitBold, pay: qpay, ask: qask };
      cur.qs.push(q);
      continue;
    }
    if (opts.splitBold && cur && /^\*\*[^*].*\*\*(\s*(✎.*|☐.*))?\s*$/.test(l)) {
      q = { title: l.replace(/^\*\*|\*\*(\s*(✎.*|☐.*))?\s*$/g, "") + (/(✎|☐)/.test(l) ? " ✎" : ""), lines: [] };
      cur.qs.push(q);
      continue;
    }
    if (q) q.lines.push(l);
    else if (cur) cur.pre.push(l);
    else intro.push(l);
  }
  return { fm, title, intro, secs };
}
const COPY =
  '<button class="hcopy" type="button" title="Copy the cues and answers in this block (examples left out)">Copy all</button>';
const PAYNOTE = () => (CONFIG.blurPay ? '<span class="paynote">Pay · press H to show</span>' : "");
const MINE = (k) =>
  `<details class="mine" data-k="${esc(k)}"><summary>My version</summary><textarea rows="4" placeholder="Write your own answer here. It saves to Library › My_answers.md."></textarea></details>`;
/* {.ask} on a prep sheet question: a box for what THEY answered, open from the start (same file, same saving) */
const ASKBOX = (k) =>
  `<details class="mine ask" data-k="${esc(k)}" data-label="Their answer" open><summary>Their answer</summary><textarea rows="3" placeholder="Type what they said. It saves to Library › My_answers.md."></textarea></details>`;
/* opts.mineKey turns on the answer boxes (saved as "<mineKey>::<question>"); opts.ask turns {.ask} questions into
   "Their answer" boxes (prep sheets only: in a guide the marker is just dropped). The same question twice in one doc
   gets its own box: the first keeps the plain key, a later one "<mineKey>::<question> #2" (#3…). The keys of every box
   are returned in `keys`. */
function renderDoc(md, prefix, opts) {
  opts = opts || {};
  const d = parse(md, opts);
  const used = {};
  const sid = (t) => {
    let s = prefix + "-" + slug(t);
    while (used[s]) s += "x";
    used[s] = 1;
    return s;
  };
  const keys = [],
    kseen = {};
  const keyOf = (t) => {
    const base = opts.mineKey + "::" + normK(t);
    kseen[base] = (kseen[base] || 0) + 1;
    return kseen[base] > 1 ? base + " #" + kseen[base] : base;
  };
  const box = (k, ask) => {
    keys.push(k);
    return ask ? ASKBOX(k) : MINE(k);
  };
  let h = d.intro.some((x) => x.trim()) ? `<div class="hintro">${blocks(d.intro)}</div>` : "";
  const nav = [];
  const hasMine = (t, k) => !!(opts.mineKey && (/✎/.test(t) || (MY[k] || "").trim()));
  for (const s of d.secs) {
    const id = sid(s.title);
    nav.push({ id, title: s.title, pay: s.pay });
    h += `<section class="hs${s.pay ? " pay" : ""}" id="${id}" data-title="${esc(s.title)}"><h3 class="hs-h"><span>${inline(s.title)}</span>${s.pay ? PAYNOTE() : ""}${COPY}</h3>${blocks(s.pre)}`;
    if (!s.qs.length && opts.mineKey) {
      const k = keyOf(s.title);
      if (hasMine(s.title, k)) h += box(k);
    }
    for (const qq of s.qs) {
      let bx = "";
      if (opts.mineKey) {
        const k = keyOf(qq.title);
        if (qq.ask && opts.ask) bx = box(k, true);
        else if (hasMine(qq.title, k)) bx = box(k);
      }
      h += `<div class="hq${qq.sub ? " sub" : ""}${qq.pay ? " pay" : ""}" id="${sid(qq.title)}"><h4><span>${inline(qq.title)}</span>${COPY}</h4>${blocks(qq.lines)}${bx}</div>`;
    }
    h += `</section>`;
  }
  if (!d.secs.length && h)
    h = `<section class="hs" id="${prefix}-all" data-title="${esc(d.title || "")}">${h.replace(/^<div class="hintro">|<\/div>$/g, "")}</section>`;
  return { fm: d.fm, title: d.title, html: h, nav, keys };
}
/* One "## section" of a guide, found by a heading pattern (used by the headhunter sheet). */
function sectionHtml(docId, re, id) {
  const D = DOCS[docId];
  if (!D || !D.md) return "";
  const p = parse(D.md, { splitBold: D.splitBold });
  const s = p.secs.find((x) => re.test(x.title));
  if (!s) return "";
  let h = `<section class="hs${s.pay ? " pay" : ""}" id="${id}"><h3 class="hs-h"><span>${inline(s.title)}</span>${COPY}</h3>${blocks(s.pre)}`;
  for (const q of s.qs)
    h += `<div class="hq${q.pay ? " pay" : ""}"><h4><span>${inline(q.title)}</span>${COPY}</h4>${blocks(q.lines)}</div>`;
  return h + "</section>";
}
/* outreach.md and posting.md are plain notes, not cards: headings become bold lines, "Source:" lines are hidden */
function plain(md) {
  const ls = String(md || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^Source:/.test(l))
    .map((l) => (/^#{1,6} /.test(l) ? "**" + l.replace(/^#+ /, "") + "**" : l));
  return blocks(ls);
}
/* Plain text with real line breaks, built from the page structure (innerText on a detached clone flattens it) */
function toText(node, skipExamples) {
  let out = "";
  const walk = (n, ctx) => {
    if (n.nodeType === 3) {
      out += n.textContent;
      return;
    }
    if (n.nodeType !== 1) return;
    const t = n.tagName;
    if (
      n.classList.contains("hcopy") ||
      n.classList.contains("paynote") ||
      n.classList.contains("mine") ||
      t === "H3" ||
      t === "H4"
    )
      return;
    if (t === "BR") {
      out += "\n";
      return;
    }
    if (t === "LI") {
      if (skipExamples && n.querySelector("em.ex")) return;
      out += ctx.ol ? ++ctx.i + ". " : "- ";
      n.childNodes.forEach((c) => walk(c, ctx));
      out += "\n";
      return;
    }
    if (t === "OL" || t === "UL") {
      const c = { ol: t === "OL", i: 0 };
      n.childNodes.forEach((k) => walk(k, c));
      out += "\n";
      return;
    }
    if (t === "P") {
      n.childNodes.forEach((c) => walk(c, ctx));
      out += "\n\n";
      return;
    }
    if (t === "TR") {
      [...n.children].forEach((c, i) => {
        out += (i ? " | " : "") + c.textContent.trim();
      });
      out += "\n";
      return;
    }
    n.childNodes.forEach((c) => walk(c, ctx));
    if (t === "BLOCKQUOTE" || t === "DIV" || t === "DETAILS") out += "\n";
  };
  walk(node, {});
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const payHidden = () => CONFIG.blurPay && !document.body.classList.contains("showpay");
function showPay(on) {
  document.body.classList.toggle("showpay", !!on);
}
function wireCopy(root) {
  for (const b of $qa("blockquote.say", root))
    if (!b.querySelector(":scope>.qcopy")) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "hcopy qcopy";
      c.textContent = "Copy answer";
      c.setAttribute("aria-label", "Copy this answer");
      b.prepend(c);
    }
  $qa(".hcopy:not(.qcopy)", root).forEach((b) => b.setAttribute("aria-label", "Copy this section"));
  if (root.__wired) return;
  root.__wired = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".hcopy");
    if (b && root.contains(b)) {
      e.stopPropagation();
      const isQuote = b.classList.contains("qcopy");
      const box = isQuote ? b.parentElement : b.closest(".hq,.hs");
      if (!box) return;
      if (box.closest(".pay") && payHidden()) {
        showPay(true);
        return;
      }
      const txt = toText(box, !isQuote);
      const lab = b.dataset.lab || b.textContent;
      b.dataset.lab = lab;
      const done = () => {
        b.textContent = "Copied";
        b.classList.add("ok");
        setTimeout(() => {
          b.textContent = lab;
          b.classList.remove("ok");
        }, 1100);
      };
      try {
        navigator.clipboard.writeText(txt).then(done, () => copyFallback(txt, done, b));
      } catch (_) {
        copyFallback(txt, done, b);
      }
      return;
    }
    if ((e.target.closest(".hs.pay") || e.target.closest(".hq.pay")) && payHidden()) showPay(true);
  });
}
/* `btn` is the Copy button (the temporary text box takes the focus, so it can't be found by focus afterwards) */
function copyFallback(t, done, btn) {
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {}
  ta.remove();
  if (ok) done();
  else {
    const bb = btn || $q(".hcopy.ok,.hcopy:focus");
    if (bb) {
      const o = bb.textContent;
      bb.textContent = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "")
        ? "Press ⌘C"
        : "Press Ctrl+C";
      setTimeout(() => (bb.textContent = o), 1800);
    }
  }
}
