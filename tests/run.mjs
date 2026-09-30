// Runs every test file against fresh copies of boards/sample and boards/empty in temp folders, then prints one summary.
//   npm test                 all suites
//   npm test -- main         only files whose name contains "main"
import { cpSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || "";
const suites = readdirSync(join(ROOT, "tests"))
  .filter((f) => /^test_.*\.js$/.test(f) && f.includes(only))
  .sort();
let pass = 0,
  fail = 0;
const failures = [];
for (const s of suites) {
  const tree = mkdtempSync(join(tmpdir(), "jso-test-"));
  const empty = mkdtempSync(join(tmpdir(), "jso-empty-"));
  cpSync(join(ROOT, "boards", "sample"), tree, { recursive: true });
  cpSync(join(ROOT, "boards", "empty"), empty, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, "tests", s)], {
    env: { ...process.env, SAMPLE_TREE: tree, EMPTY_TREE: empty },
    encoding: "utf8",
  });
  rmSync(tree, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split("\n").filter((l) => /^(PASS|FAIL) \| /.test(l));
  const p = lines.filter((l) => l.startsWith("PASS")).length,
    f = lines.length - p;
  pass += p;
  fail += f;
  failures.push(...lines.filter((l) => l.startsWith("FAIL")).map((l) => `${s}: ${l}`));
  if (!lines.length) {
    fail++;
    failures.push(`${s}: no results\n${out}`);
  }
  console.log(
    `${s.padEnd(16)} ${String(p).padStart(3)} pass  ${String(f).padStart(2)} fail  (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
  );
  if (process.env.VERBOSE) console.log(lines.join("\n"));
}
if (failures.length) console.log("\n" + failures.join("\n"));
console.log(`\n${pass + fail} checks: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
