// Builds the app: src/index.html + src/css/*.css + src/js/*.js -> one self-contained organizer.html,
// copied into every board folder under boards/. No framework and no runtime dependencies.
//
//   node tools/build.mjs           build
//   node tools/build.mjs --check   fail if a committed organizer.html is out of date (used by CI)
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT_NAME = "organizer.html";
const CSS_ORDER = ["board.css", "prep.css"];
const check = process.argv.includes("--check");

// Script files run in name order (00-config.js first, 90-boot.js last) as one classic script,
// so the page also works when opened straight from disk (ES modules are blocked on file:// URLs).
const jsFiles = readdirSync(join(SRC, "js"))
  .filter((f) => f.endsWith(".js"))
  .sort();
const js = jsFiles.map((f) => `/* ---- ${f} ---- */\n` + readFileSync(join(SRC, "js", f), "utf8")).join("\n");
const script = '"use strict";\n' + js;

// Every top-level name must be declared once: a second `function x` would silently replace the first.
const ast = acorn.parse(script, { ecmaVersion: "latest", sourceType: "script" });
const seen = new Map();
const add = (name, node) => {
  if (seen.has(name))
    throw new Error(`"${name}" is declared twice at the top level (${seen.get(name)} and offset ${node.start})`);
  seen.set(name, `offset ${node.start}`);
};
for (const node of ast.body) {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") add(node.id.name, node);
  if (node.type === "VariableDeclaration")
    for (const d of node.declarations) {
      const names = [];
      const collect = (p) => {
        if (!p) return;
        if (p.type === "Identifier") names.push(p.name);
        else if (p.type === "ObjectPattern") p.properties.forEach((q) => collect(q.value || q.argument));
        else if (p.type === "ArrayPattern") p.elements.forEach(collect);
        else if (p.type === "RestElement") collect(p.argument);
        else if (p.type === "AssignmentPattern") collect(p.left);
      };
      collect(d.id);
      names.forEach((n) => add(n, d));
    }
}

const css = CSS_ORDER.map((f) => readFileSync(join(SRC, "css", f), "utf8")).join("\n");
let html = readFileSync(join(SRC, "index.html"), "utf8");
const inject = (marker, text) => {
  if (html.split(marker).length !== 2) throw new Error(`marker ${marker} must appear exactly once in src/index.html`);
  html = html.replace(marker, () => text);
};
inject("<!-- @inline-css -->", `<style>\n${css}\n</style>`);
inject("<!-- @inline-js -->", `<script>\n${script.replace(/<\/script/gi, "<\\/script")}\n</script>`);

const sha = createHash("sha256").update(html).digest("hex").slice(0, 12);
const boards = readdirSync(join(ROOT, "boards"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(ROOT, "boards", d.name));
let stale = 0;
for (const dir of boards) {
  const out = join(dir, OUT_NAME);
  if (check) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== html) {
      console.error(`out of date: ${out.slice(ROOT.length + 1)} (run npm run build)`);
      stale++;
    }
  } else writeFileSync(out, html);
}
if (stale) process.exit(1);
console.log(
  `${check ? "up to date" : "built"}: ${OUT_NAME} · ${jsFiles.length} scripts · ${seen.size} top-level names · ${(html.length / 1024).toFixed(0)} KB · sha256 ${sha} · ${boards.length} board folders`,
);
