// The live demo page (tools/build-demo.mjs): runs in any browser with no folder to pick, looks current on any day,
// keeps changes in the tab only, and never talks to the network.
const { mkdtempSync, rmSync, readFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ok, wait, launch, report } = require("./lib.js");

const out = mkdtempSync(path.join(tmpdir(), "jso-demo-"));
const built = spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "build-demo.mjs")], {
  env: { ...process.env, DEMO_OUT: out, GITHUB_REPOSITORY: "example/job-search-organizer" },
  encoding: "utf8",
});
const PAGE = "file://" + out + "/index.html";
const madeOn = (/sample made (\d{4}-\d{2}-\d{2})/.exec(built.stdout) || [])[1];

async function open(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.errs = [];
  p.on("pageerror", (e) => p.errs.push("pageerror: " + e.message));
  p.on("console", (m) => m.type() === "error" && p.errs.push("console: " + m.text()));
  if (opts.noFolderApi) await p.addInitScript("delete window.showDirectoryPicker");
  if (opts.at) await p.clock.setFixedTime(opts.at);
  await p.goto(PAGE);
  await wait(p, 800);
  return { ctx, p };
}
const inMemory = (p, file) =>
  p.evaluate(
    (f) =>
      window.ORGANIZER_FOLDER.at(f)
        .getFile()
        .then((x) => x.text()),
    file,
  );

(async () => {
  let b;
  try {
    ok("D0 the demo page builds", built.status === 0 && !!madeOn, (built.stderr || "").slice(0, 200));
    b = await launch();
    // ---- D1: opens ready to use, with a demo banner instead of the setup steps
    {
      const { ctx, p } = await open(b);
      const banner = await p.$eval("#banner", (e) => e.innerText);
      ok(
        "D1 demo banner, no setup step",
        /Live demo/.test(banner) && !/Turn on saving/.test(banner),
        banner.slice(0, 80),
      );
      ok(
        "D1 status says changes stay in the tab",
        /Demo: changes stay in this tab/.test(await p.$eval("#status", (e) => e.innerText)),
      );
      ok(
        "D1 Get it on GitHub links to the repository",
        (await p.$eval("#banner a", (a) => a.href)) === "https://github.com/example/job-search-organizer",
      );
      const html = readFileSync(path.join(out, "index.html"), "utf8");
      ok(
        "D1 link preview tags for sharing",
        /og:image" content="https:\/\/example\.github\.io\/job-search-organizer\/social\.png"/.test(html) &&
          /og:title/.test(html),
      );
      ok(
        "D1 opens on the Jobs board",
        await p.evaluate(() => section === "jobs" && !!document.querySelector("section.lane")),
      );
      ok("D1 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- D2: works in browsers without the folder API (Safari, Firefox)
    {
      const { ctx, p } = await open(b, { noFolderApi: true });
      ok(
        "D2 not view-only without the folder API",
        !(await p.evaluate(() => document.documentElement.classList.contains("viewonly"))),
      );
      await p.click("#nav-jobs");
      await p.evaluate(() => moveCard("jobs", "quillstone", "applied"));
      await wait(p, 1200);
      ok(
        "D2 a moved card is saved to the in-memory data file",
        /"lane": "applied"/.test((await inMemory(p, "board_data.js")).split('"quillstone"')[1].split("}")[0]),
      );
      ok("D2 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- D3: opened 90 days after the sample was made, it still looks current
    {
      const later = new Date(Date.parse(madeOn + "T12:00:00") + 90 * 864e5);
      const { ctx, p } = await open(b, { at: later });
      const r = await p.evaluate(() => ({ fu: get("jobs", "lumenfield").followUp, want: addDays(3) }));
      ok("D3 dates move with today (a follow-up 3 days out stays 3 days out)", r.fu === r.want, JSON.stringify(r));
      ok("D3 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- D4: prep sheet, notes, the résumé PDF, and a reload starts over
    {
      const { ctx, p } = await open(b);
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 600);
      ok("D4 the prep sheet opens", await p.evaluate(() => !!document.querySelector("#drawerRoot .hs")));
      await p.keyboard.type("Team of 8, Go and Postgres.");
      await wait(p, 2500);
      ok(
        "D4 notes are written to the in-memory folder",
        /Team of 8/.test(await inMemory(p, "Job notes/lumenfield/my_notes.md")),
      );
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 400);
      const pdf = await p.evaluate(async () => {
        const a = document.querySelector("#dResume");
        a.addEventListener("click", (e) => e.preventDefault(), { once: true });
        a.click();
        return {
          href: a.href,
          head: a.href.startsWith("blob:") ? (await (await fetch(a.href)).text()).slice(0, 5) : "",
        };
      });
      ok("D4 the résumé opens as a PDF from memory", pdf.head === "%PDF-", JSON.stringify(pdf));
      await p.reload();
      await wait(p, 800);
      await p.evaluate(() => openDrawer("jobs", "lumenfield"));
      await wait(p, 600);
      ok(
        "D4 a reload starts over",
        !(await p.inputValue("#notes-pad")).includes("Team of 8") &&
          !(await p.evaluate(() => window.ORGANIZER_FOLDER.at("Job notes/lumenfield/my_notes.md"))),
      );
      ok("D4 no errors", p.errs.length === 0, p.errs.join("|"));
      await ctx.close();
    }
    // ---- D5: no network requests
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const seen = [];
      ctx.on("request", (r) => seen.push(r.url()));
      const p = await ctx.newPage();
      await p.goto(PAGE);
      await wait(p, 600);
      for (const t of ["#nav-jobs", "#nav-hunters", "#nav-people", "#nav-library", "#nav-todos", "#nav-next"]) {
        await p.click(t);
        await wait(p, 120);
      }
      const remote = seen.filter((u) => !/^(file|data|blob):/.test(u));
      ok("D5 no network requests", seen.length > 0 && remote.length === 0, remote.slice(0, 3).join(", "));
      await ctx.close();
    }
  } catch (e) {
    ok("EXCEPTION", false, String(e.message).split("\n").slice(0, 3).join(" / "));
  }
  report();
  if (b) await b.close();
  rmSync(out, { recursive: true, force: true });
})();
