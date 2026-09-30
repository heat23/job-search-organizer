// Shared test helpers. The tests open a COPY of boards/sample (made by run.mjs) and give the page a fake
// folder in memory (src/demo/memfs.js with the hooks in ffs.js) in place of Chrome's folder picker, so nothing on disk is ever changed.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const TREE = process.env.SAMPLE_TREE;
if (!TREE) throw new Error("SAMPLE_TREE is not set: run the tests with `npm test`");
const PAGE = "file://" + TREE + "/organizer.html";
const FFS = ["../src/demo/memfs.js", "ffs.js"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");

/* Every text file in the board folder, keyed by its path relative to the folder */
function readTree(dir, base = "") {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) Object.assign(out, readTree(p, rel));
    else if (/\.(md|js|txt|html)$/.test(e.name)) out[rel] = fs.readFileSync(p, "utf8");
  }
  return out;
}
const boardText = fs.readFileSync(path.join(TREE, "board_data.js"), "utf8");
const parseBoard = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
const data = parseBoard(boardText);

/* The files the fake folder starts with: the tree, plus a placeholder résumé in each job's folder */
function files(extra, text) {
  const f = readTree(TREE);
  f["board_data.js"] = text || boardText;
  for (const v of Object.values(data.jobs)) if (v.folder && !v.deleted) f[v.folder + "/Resume.pdf"] = "x";
  return Object.assign(f, extra || {});
}

const results = [];
const ok = (name, cond, extra) => results.push([cond ? "PASS" : "FAIL", name, extra || ""]);
const wait = (p, ms) => p.waitForTimeout(ms);
const esc2 = async (p) => {
  await p.keyboard.press("Escape");
  await wait(p, 60);
  await p.keyboard.press("Escape");
  await wait(p, 120);
};

async function launch() {
  return chromium.launch();
}
/* A page on the sample board. connect: click "Turn on saving" (the fake picker returns the fake folder). */
async function mkpage(ctx, opts = {}) {
  const p = await ctx.newPage();
  p.errs = [];
  p.on("pageerror", (e) => p.errs.push("pageerror: " + e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) p.errs.push("console: " + m.text());
  });
  await p.addInitScript(FFS);
  /* settings as if they came from organizer.config.js (the file's own assignment is ignored) */
  if (opts.config)
    await p.addInitScript(
      `Object.defineProperty(window,"ORGANIZER_CONFIG",{get:()=>(${JSON.stringify(opts.config)}),set:()=>{}});`,
    );
  await p.addInitScript(
    `window.__pick=window.__mk(${JSON.stringify(opts.files || files(opts.extra, opts.text))});window.__pick2=new window.__FDir(${JSON.stringify(opts.second || "Backup")});`,
  );
  await p.goto(opts.url || PAGE);
  await wait(p, 500);
  if (opts.connect) {
    await p
      .getByRole("button", { name: /Turn on saving/ })
      .first()
      .click();
    await wait(p, 700);
  }
  return p;
}
function report() {
  for (const r of results) console.log(r.join(" | "));
  const pass = results.filter((r) => r[0] === "PASS").length;
  const fail = results.length - pass;
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
}
module.exports = {
  TREE,
  PAGE,
  readTree,
  files,
  data,
  boardText,
  parseBoard,
  ok,
  results,
  wait,
  esc2,
  launch,
  mkpage,
  report,
};
