// Builds the live demo: the sample board as one self-contained page that runs in any browser, with no folder to pick.
//   node tools/build-demo.mjs   ->  _site/index.html (+ social.png), which the Pages workflow publishes
// The app itself is unchanged: src/demo/memfs.js gives it a folder in memory, src/demo/demo.js fills it.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOARD = join(ROOT, "boards", "sample");
const OUT = process.env.DEMO_OUT || join(ROOT, "_site");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Where the code lives, for the "Get it on GitHub" button. GitHub Actions sets GITHUB_REPOSITORY (owner/name).
const repo = process.env.GITHUB_REPOSITORY || "";
const repoUrl = repo ? `https://github.com/${repo}` : "";
const [owner, name] = repo.split("/");
const siteUrl = repo ? `https://${owner.toLowerCase()}.github.io/${name}/` : "";

// Every file in the sample board folder, except the page itself and its settings file.
const text = {},
  binary = {};
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(BOARD, p).split(sep).join("/");
    if (e.isDirectory()) walk(p);
    else if (rel === "organizer.html" || rel === "organizer.config.js" || e.name.startsWith(".")) continue;
    else if (/\.pdf$/i.test(e.name)) binary[rel] = readFileSync(p).toString("base64");
    else text[rel] = readFileSync(p, "utf8");
  }
})(BOARD);

const data = JSON.parse(
  text["board_data.js"].slice(text["board_data.js"].indexOf("{"), text["board_data.js"].lastIndexOf("}") + 1),
);
// tools/make-sample.mjs stamps every record "yesterday", so the sample was made the day after the most common updatedAt.
const counts = {};
for (const c of ["jobs", "hunters", "people", "todos", "plan"])
  for (const r of Object.values(data[c] || {}))
    if (r && r.updatedAt) counts[r.updatedAt.slice(0, 10)] = (counts[r.updatedAt.slice(0, 10)] || 0) + 1;
const stamp = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
const madeOn = new Date(Date.parse(stamp + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);

const lib = text["Library/_bundle.js"];
const library = JSON.parse(lib.slice(lib.indexOf("{"), lib.lastIndexOf("}") + 1));
const seed = {
  madeOn,
  files: text,
  binary,
  library,
  config: { storagePrefix: "jso-demo", demo: { repoUrl } },
};

const safe = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const script = (s) => `<script>\n${safe(s)}\n</script>`;
const loads =
  /<script src="organizer\.config\.js"><\/script>\s*<script src="board_data\.js"><\/script>\s*<script src="Library\/_bundle\.js"><\/script>/;
let html = readFileSync(join(BOARD, "organizer.html"), "utf8");
if (!loads.test(html))
  throw new Error("boards/sample/organizer.html doesn't load its data files as expected: run npm run build");
html = html.replace(
  loads,
  () =>
    script(readFileSync(join(ROOT, "src", "demo", "memfs.js"), "utf8")) +
    "\n" +
    script("window.DEMO_SEED = " + JSON.stringify(seed) + ";") +
    "\n" +
    script(readFileSync(join(ROOT, "src", "demo", "demo.js"), "utf8")),
);

// A title and preview image for when the link is shared in a chat, a post or an email.
const title = "Job Search Organizer: live demo";
const desc = pkg.description + " Try the sample board in your browser.";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const meta = [
  `<meta name="description" content="${esc(desc)}" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:title" content="${esc(title)}" />`,
  `<meta property="og:description" content="${esc(desc)}" />`,
  siteUrl ? `<meta property="og:url" content="${siteUrl}" />` : "",
  siteUrl ? `<meta property="og:image" content="${siteUrl}social.png" />` : "",
  `<meta name="twitter:card" content="summary_large_image" />`,
]
  .filter(Boolean)
  .join("\n    ");
html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>\n    ${meta}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), html);
const shot = join(ROOT, "docs", "images", "social.png");
if (existsSync(shot)) copyFileSync(shot, join(OUT, "social.png"));
console.log(
  `built: _site/index.html · ${(html.length / 1024).toFixed(0)} KB · ${Object.keys(text).length + Object.keys(binary).length} files in the demo folder · sample made ${madeOn}${repoUrl ? " · " + repoUrl : ""}`,
);
