/* Small helpers: dates, DOM building, links. */
const localDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const TODAY = () => localDate(new Date());
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};
const nowIso = () => new Date().toISOString();
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : 0);
function fmtDate(v) {
  if (!v) return "";
  const d = String(v).length === 10 ? new Date(v + "T12:00:00") : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function isoToLocalDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  return localDate(d);
}
/* Only http(s) links are ever rendered as links. */
function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch (e) {
    return null;
  }
}
/* Company and contact names compared loosely: case, spacing and punctuation are ignored and "&" equals "and"
   ("Summit & Vale Partners" = "summit and vale partners."). Nothing else is dropped, so different names stay different. */
const normName = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (s, r = document) => r.querySelector(s);
/* el("div",{class:"x",onclick:fn,text:"hi"},child1,child2): text is always set as text, never as HTML. */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === "") continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
function lsGet(name, fallback) {
  try {
    const v = localStorage.getItem(lsKey(name));
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function lsSet(name, value) {
  try {
    localStorage.setItem(lsKey(name), value);
    return true;
  } catch (e) {
    return false;
  }
}
