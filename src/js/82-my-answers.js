/* ================= "My version" answers (Library/My_answers.md, written only by this page) =================
   Every ✎ question in a guide or prep sheet gets a box for your own wording, and every {.ask} question on a prep
   sheet a "Their answer" box. Prep sheet answers are keyed "prep:<job id>::<question>". Answers are kept in this
   browser at once and written to the file about a second after you stop typing. */
const MYLK = "myAnswers";
let MY = {},
  myLoaded = false,
  myTimer = null;
const normK = (k) =>
  String(k)
    .replace(/\s*[✎☐]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
try {
  MY = JSON.parse(lsGet(MYLK, "{}")) || {};
} catch (e) {
  MY = {};
}
const myToMd = () =>
  "# My answers\nYour own versions of the example questions in the Prep library, and the answers you typed on prep sheets. The page reads and writes this file.\n\n" +
  Object.entries(MY)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `## ${k}\n${v.trim()}\n`)
    .join("\n");
function myFromMd(t) {
  const o = {};
  let k = null,
    buf = [];
  for (const l of String(t).replace(/\r/g, "").split("\n")) {
    const m = l.match(/^## (.+)$/);
    if (m) {
      if (k) o[k] = buf.join("\n").trim();
      k = normK(m[1]);
      buf = [];
    } else if (k) buf.push(l);
  }
  if (k) o[k] = buf.join("\n").trim();
  return o;
}
async function myLoad() {
  if (myLoaded || !FS.ok()) return;
  const r = await FS.read(MYPATH);
  myLoaded = true;
  if (r) {
    const disk = myFromMd(r.text);
    let changed = false;
    for (const [k, v] of Object.entries(disk))
      if (!MY[k] && v) {
        MY[k] = v;
        changed = true;
      }
    if (changed) {
      lsSet(MYLK, JSON.stringify(MY));
      $qa("details.mine").forEach(fillMine);
    }
  }
}
function mySave() {
  lsSet(MYLK, JSON.stringify(MY));
  clearTimeout(myTimer);
  myTimer = setTimeout(async () => {
    myTimer = null;
    if (!FS.ok()) return;
    try {
      if (!myLoaded) await myLoad();
      await FS.write(MYPATH, myToMd());
    } catch (e) {}
  }, 900);
}
const myFlush = () => {
  if (myTimer) {
    clearTimeout(myTimer);
    myTimer = null;
    lsSet(MYLK, JSON.stringify(MY));
    if (FS.ok()) FS.write(MYPATH, myToMd()).catch(() => {});
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") myFlush();
});
window.addEventListener("pagehide", myFlush);
const mineLabel = (det, filled) => (det.dataset.label || "My version") + (filled ? " ✓" : "");
function fillMine(det) {
  const k = det.dataset.k;
  const ta = det.querySelector("textarea");
  if (ta && document.activeElement !== ta) ta.value = MY[k] || "";
  const filled = !!(MY[k] && MY[k].trim());
  det.querySelector("summary").textContent = mineLabel(det, filled);
  /* a box opens when it gets an answer (also one read from the file after the page opened); you can fold it again */
  if (filled && !det.dataset.filled) det.open = true;
  det.dataset.filled = filled ? "1" : "";
}
function wireMine(root) {
  $qa("details.mine", root).forEach((det) => {
    fillMine(det);
    const ta = det.querySelector("textarea");
    if (ta.__w) return;
    ta.__w = 1;
    ta.addEventListener("input", () => {
      MY[det.dataset.k] = ta.value;
      det.querySelector("summary").textContent = mineLabel(det, ta.value.trim());
      mySave();
    });
  });
  myLoad();
}
