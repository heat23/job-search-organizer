// Takes the README screenshots and the demo animation from the sample board.
//   npm run screenshots      -> docs/images/*.png (social.png is the link preview) and demo.gif (needs ffmpeg)
// It uses the same in-memory folder as the tests, so nothing on disk is changed.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, readdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
process.env.SAMPLE_TREE = join(ROOT, "boards", "sample");
const { files, data } = require("../tests/lib.js");
// The sample's dates are relative to the day it was saved: the pictures use that day, so follow-ups aren't all weeks late.
const NOW = new Date(Date.parse(data.savedAt) + 2 * 3600e3);
const OUT = join(ROOT, "docs", "images");
const TMP = join(ROOT, "docs", ".video");
mkdirSync(OUT, { recursive: true });
const FFS = [join(ROOT, "src", "demo", "memfs.js"), join(ROOT, "tests", "ffs.js")]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
// A visible pointer for the recording (headless browsers don't draw one).
const CURSOR = `addEventListener("DOMContentLoaded",()=>{const c=document.createElement("div");c.style.cssText="position:fixed;z-index:99999;width:18px;height:18px;margin:-3px 0 0 -3px;pointer-events:none;background:no-repeat url(\\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><path d='M2 2 L2 15 L6 11 L9 17 L11 16 L8 10 L14 10 Z' fill='black' stroke='white' stroke-width='1.2'/></svg>\\");left:-40px;top:-40px";document.body.append(c);addEventListener("mousemove",e=>{c.style.left=e.clientX+"px";c.style.top=e.clientY+"px"},true)});`;

async function open(ctx, scheme = "light", cursor = false) {
  const p = await ctx.newPage();
  await p.clock.install({ time: NOW });
  await p.emulateMedia({ colorScheme: scheme });
  await p.addInitScript(FFS);
  await p.addInitScript(
    `window.__pick=window.__mk(${JSON.stringify(files())});window.__pick2=new window.__FDir("Backup");`,
  );
  if (cursor) await p.addInitScript(CURSOR);
  await p.goto("file://" + join(ROOT, "boards", "sample", "organizer.html"));
  await p.waitForTimeout(400);
  await p
    .getByRole("button", { name: /Turn on saving/ })
    .first()
    .click();
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector("#toastRoot").replaceChildren());
  return p;
}
const shot = (p, name) => p.screenshot({ path: join(OUT, name) });
async function moveTo(p, locator, steps = 18) {
  const bx = await locator.boundingBox();
  await p.mouse.move(bx.x + bx.width / 2, bx.y + Math.min(bx.height / 2, 20), { steps });
}

const b = await chromium.launch();
// ---- still screenshots
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await open(ctx);
  await p.click("#nav-jobs");
  await p.waitForTimeout(300);
  await shot(p, "board.png");
  await p.evaluate(() => openDrawer("jobs", "lumenfield"));
  await p.waitForTimeout(500);
  await p.keyboard.type(
    "Recruiter: Jordan. Team of 8, Go and Postgres.\nNext: system design round with the tech lead.",
  );
  await p.waitForTimeout(1500);
  // bring a "Their answer" box ({.ask} in prep.md) into view, with what the interviewer said
  const ask = p.locator("#drawerRoot details.mine.ask").first();
  await ask.evaluate((d) => d.scrollIntoView({ block: "center" }));
  await ask.locator("textarea").fill("Reports to the payments director. Team of six, two in Denver.");
  await p.waitForTimeout(1200);
  await p.locator("#notes-pad").focus();
  await shot(p, "prep-sheet.png");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.click("#nav-library");
  await p.waitForTimeout(400);
  await shot(p, "library.png");
  await ctx.close();
  const dark = await b.newContext({ viewport: { width: 1440, height: 860 } });
  const d = await open(dark, "dark");
  await d.click("#nav-jobs");
  await d.waitForTimeout(300);
  await shot(d, "board-dark.png");
  await dark.close();
  // the preview image when the demo link is shared (1200 x 630)
  const soc = await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const s = await open(soc);
  await s.click("#nav-jobs");
  await s.waitForTimeout(300);
  await shot(s, "social.png");
  await soc.close();
}
// ---- the demo animation
{
  rmSync(TMP, { recursive: true, force: true });
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 760 },
    recordVideo: { dir: TMP, size: { width: 1280, height: 760 } },
  });
  const p = await open(ctx, "light", true);
  await p.mouse.move(640, 300);
  await p.waitForTimeout(900);
  await moveTo(p, p.locator("#nav-jobs"));
  await p.click("#nav-jobs");
  await p.waitForTimeout(900);
  // drag a starred job from To apply to Applied
  const card = p.locator('[data-key="jobs:quillstone"]');
  const target = p.locator("section.lane").nth(1);
  await moveTo(p, card);
  const tb = await target.boundingBox();
  await p.mouse.down();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 160, { steps: 25 });
  await p.mouse.up();
  await p.waitForTimeout(1600);
  // open a job in play: the prep sheet
  const lum = p.locator('[data-key="jobs:lumenfield"]');
  await moveTo(p, lum);
  await lum.click();
  await p.waitForTimeout(900);
  await p.keyboard.type("Recruiter: Jordan. Team of 8, Go and Postgres.", { delay: 35 });
  await p.waitForTimeout(700);
  await p.keyboard.press("Escape");
  await p.keyboard.press("4");
  await p.waitForTimeout(1300);
  await moveTo(p, p.locator("#drawerRoot .plib").first());
  await p.locator("#drawerRoot .plib").first().click();
  await p.waitForTimeout(1300);
  await p.locator("#drawerRoot .plib").first().click();
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  // quick open
  await p.keyboard.press("g");
  await p.waitForTimeout(300);
  await p.keyboard.type("summit", { delay: 80 });
  await p.waitForTimeout(600);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(1500);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  // the Library
  await moveTo(p, p.locator("#nav-library"));
  await p.click("#nav-library");
  await p.waitForTimeout(700);
  await p.locator(".hlsearch").click();
  await p.keyboard.type("weakness", { delay: 80 });
  await p.waitForTimeout(1400);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(1600);
  await ctx.close();
  const vid = readdirSync(TMP).find((f) => f.endsWith(".webm"));
  renameSync(join(TMP, vid), join(TMP, "demo.webm"));
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      "1.2",
      "-i",
      join(TMP, "demo.webm"),
      "-vf",
      "fps=7,scale=820:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
      join(OUT, "demo.gif"),
    ],
    { stdio: "inherit" },
  );
  if (ff.status !== 0) console.error("ffmpeg failed: the GIF was not made (the screenshots were).");
  rmSync(TMP, { recursive: true, force: true });
}
await b.close();
console.log("wrote", readdirSync(OUT).join(", "));
