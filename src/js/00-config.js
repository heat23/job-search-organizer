/* Settings. Everything personal lives here, so the rest of the code stays generic.
   To change a setting without rebuilding, put an `organizer.config.js` file next to the HTML page:
     window.ORGANIZER_CONFIG = { ownerName: "Alex", files: { resume: "Alex_Resume.pdf" } };
   It is merged over these defaults. Lane ids (todo, applied, screen…) are fixed; their names, colors and timings are not. */
const DEFAULT_CONFIG = {
  appTitle: "Job Search Organizer",
  /* Optional. Shown in the page title as "<name>'s job search". */
  ownerName: "",
  /* Set only by the live demo page (tools/build-demo.mjs): { repoUrl }. It shows a demo banner in place of the setup steps. */
  demo: null,
  /* Prefix for browser storage. Each board folder gets its own copy (keys include the page's path). */
  storagePrefix: "jso",
  /* Remembered start folders for Chrome's folder picker. */
  pickerIds: { board: "jso-board", secondBackup: "jso-second-backup" },
  /* Files the Résumé and Cover letter buttons open inside a job's folder. A job can override them with resumeFile / letterFile. */
  files: { resume: "Resume.pdf", coverLetter: "Cover_Letter.pdf" },
  /* Each job's documents folder moves to the folder for its stage. Several lanes can share a folder. */
  stageFolders: {
    todo: "1 - To apply",
    applied: "2 - Applied",
    screen: "2 - Applied",
    interview: "2 - Applied",
    offer: "2 - Applied",
    closed: "3 - Closed",
    removed: "4 - Removed",
  },
  /* A removed job's folder is deleted this many days after the card is removed (Restore brings it back before then). */
  removedPurgeDays: 30,
  /* Lane names, colors (gray, blue, amber, violet, green, slate) and follow-up timings in days. `done: true` lanes have no follow-ups. */
  lanes: {
    jobs: [
      { id: "todo", name: "To apply", color: "gray" },
      { id: "applied", name: "Applied", color: "blue", follow: 7 },
      { id: "screen", name: "Recruiter screen", color: "amber", follow: 5 },
      { id: "interview", name: "Interviewing", color: "violet", follow: 5 },
      { id: "offer", name: "Offer", color: "green", follow: 3 },
      { id: "closed", name: "Closed", color: "slate", done: true },
    ],
    hunters: [
      { id: "todo", name: "To register", color: "gray" },
      { id: "registered", name: "Registered", color: "slate" },
      { id: "contacted", name: "Reached out", color: "blue", follow: 10 },
      { id: "talking", name: "Talking", color: "violet", follow: 30 },
      { id: "presented", name: "Submitted me", color: "green", follow: 7 },
      { id: "paused", name: "Not now", color: "slate", done: true },
    ],
    people: [
      { id: "todo", name: "To ask", color: "gray" },
      { id: "asked", name: "Asked", color: "blue", follow: 7 },
      { id: "talking", name: "Talking", color: "violet", follow: 14 },
      { id: "helped", name: "Helped", color: "green", done: true },
      { id: "noreply", name: "No reply", color: "slate", done: true },
    ],
  },
  /* Cards with no change for this many days show up under Follow up with a one-click close. */
  stale: {
    jobs: { lanes: ["applied", "screen"], days: 21, close: "closed", reason: "No reply", label: "Close as no reply" },
    hunters: { lanes: ["contacted"], days: 30, close: "paused", label: "Move to Not now" },
    people: { lanes: ["asked"], days: 21, close: "noreply", label: "Mark no reply" },
  },
  /* Names of the Headhunters and People tabs: `label` on the tab, `short` on narrow windows, `noun` for one card
     ("+ Add headhunter"). Rename them to fit how you search, e.g. { label: "Recruiters", short: "Recruiters", noun: "recruiter" }. */
  sections: {
    hunters: { label: "Headhunters", short: "Hunters", noun: "headhunter" },
    people: { label: "People", short: "People", noun: "person" },
  },
  closedReasons: ["Rejected", "Withdrew", "Posting closed", "No reply", "Took another offer"],
  /* Call types in the booking box. `label` is what you see and what is stored on the card (callType); `moves` says where
     booking one moves a job: "screen" (from Applied to Recruiter screen), "interview" (from Applied or Recruiter screen
     to Interviewing) or "none". Rename the labels freely. A plain string still works: it moves like the old rule
     (a label with Hiring, Panel or Onsite in it counts as an interview, anything else as a screen). */
  callTypes: [
    { label: "Recruiter screen", moves: "screen" },
    { label: "Hiring manager", moves: "interview" },
    { label: "Panel", moves: "interview" },
    { label: "Onsite", moves: "interview" },
    { label: "Headhunter call", moves: "screen" },
    { label: "Other", moves: "screen" },
  ],
  /* The checklist shown on the Headhunters tab (records live in the `plan` collection). */
  plan: {
    title: "Four-week plan",
    nextUpTitle: "Headhunter plan",
    weekNames: {
      1: "Week 1 · Get ready",
      2: "Week 2 · Register and map",
      3: "Week 3 · Outreach",
      4: "Week 4 · Follow up",
    },
    doneText: "All steps done. Keep a monthly check-in with the recruiters who engaged.",
  },
  backups: {
    boardDays: 14, // daily copies of the data file in backups/
    notesDays: 60, // daily copies of your notes in backups/
    secondCopies: 5, // full copies kept in the optional second backup folder
    secondFolderPrefix: "board_backup_",
  },
  /* Records changed by another tool (changedBy is anything but "you") get a "New from …" tag until you open them. */
  assistantName: "assistant",
  /* Pay sections ({.pay} in a guide or prep sheet) can be blurred until you press H: handy when sharing your screen. */
  blurPay: false,
  /* Prep sheets and the Library. Doc ids are file names without the number prefix, lower-case, dashes for spaces. */
  library: {
    defaultDoc: "cheat-sheet",
    /* Buttons across the top of every prep sheet; `key` opens it from the keyboard. */
    sheetButtons: [
      { doc: "call-scripts", label: "Scripts", key: "s" },
      { doc: "cheat-sheet", label: "Cheat sheet", key: "c" },
    ],
    /* A headhunter's sheet borrows these sections from your guides (matched by heading). */
    hunterScript: { doc: "call-scripts", heading: "^(Headhunter|Agency recruiter) call" },
    hunterPlaybook: { doc: "cheat-sheet", heading: "^Working with (headhunters|recruiters)" },
    /* A guide with one "## Name, Firm" block per contact, holding **Connection request** and **Follow-up message** quotes. */
    outreachDoc: "recruiter-outreach",
    /* Shorter labels for common prep-sheet headings in the jump bar. */
    pillLabels: [
      ["^Why (.+)$", "Why them"],
      ["^Questions to ask them$", "Ask them"],
      ["^What you sent them$", "What you sent"],
      ["^Gaps they may probe$", "Gaps"],
      ["^Likely questions$", "Questions"],
      ["^Outreach note and screening answers$", "Outreach"],
    ],
  },
};

function mergeConfig(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === "object" &&
      !Array.isArray(base[k])
        ? mergeConfig(base[k], v)
        : v;
  }
  return out;
}
const CONFIG = mergeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), window.ORGANIZER_CONFIG);
/* Lane ids are the fixed contract the code and the data file rely on; a lane's name, color and follow-up days are
   settings. Arrays in the settings replace the defaults, so a lane list that leaves out a lane (or a call type list
   in an odd shape) is repaired here with the defaults and a console warning, rather than breaking the page. */
const CONFIG_WARNINGS = [];
function checkConfig(cfg) {
  const warn = (m) => {
    CONFIG_WARNINGS.push(m);
    try {
      console.warn("organizer.config.js: " + m);
    } catch (e) {}
  };
  /* Every setting has the type of its default: a wrong one (null, a string where a list or an object belongs, a word
     where a number belongs) falls back to the default with a warning, rather than leaving a blank page. */
  const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "list" : typeof v);
  const clone = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
  /* null where it can mean "none": no owner name, no outreach guide, and the default number of days to keep removed folders */
  const NULLABLE = ["demo", "library.hunterScript", "library.hunterPlaybook", "library.outreachDoc", "ownerName"];
  if (cfg.removedPurgeDays === null) cfg.removedPurgeDays = DEFAULT_CONFIG.removedPurgeDays;
  const OWN_CHECK = ["lanes", "callTypes", "stale", "plan.weekNames"];
  const fix = (obj, dflt, path) => {
    for (const k of Object.keys(dflt)) {
      const p = path ? path + "." + k : k;
      const d = dflt[k],
        v = obj[k];
      if (OWN_CHECK.includes(p) || d === null) continue;
      if (v === undefined) {
        obj[k] = clone(d);
        continue;
      }
      if (v === null && NULLABLE.includes(p)) continue;
      if (kind(v) !== kind(d)) {
        if (kind(d) === "number" && typeof v === "string" && v.trim() && isFinite(+v)) {
          obj[k] = +v;
          continue;
        }
        warn(`${p} should be ${kind(d) === "object" ? "an object" : "a " + kind(d)}; using the default.`);
        obj[k] = clone(d);
      } else if (kind(d) === "object") fix(v, d, p);
    }
  };
  fix(cfg, DEFAULT_CONFIG, "");
  for (const sec of ["hunters", "people"])
    for (const f of ["label", "short", "noun"])
      if (!cfg.sections[sec][f].trim()) {
        warn(`sections.${sec}.${f} is empty; using the default.`);
        cfg.sections[sec][f] = DEFAULT_CONFIG.sections[sec][f];
      }
  cfg.closedReasons = cfg.closedReasons.filter((r) => typeof r === "string" && r.trim());
  /* patterns (pillLabels, the headhunter sheet headings) must be valid regular expressions */
  const reOk = (r) => {
    try {
      new RegExp(r);
      return typeof r === "string";
    } catch (e) {
      return false;
    }
  };
  /* a RegExp literal works too (its pattern is used) */
  cfg.library.pillLabels = cfg.library.pillLabels.map((pl) =>
    Array.isArray(pl) && pl[0] instanceof RegExp ? [pl[0].source, ...pl.slice(1)] : pl,
  );
  cfg.library.pillLabels = cfg.library.pillLabels.filter((pl) => {
    const good = Array.isArray(pl) && reOk(pl[0]) && typeof pl[1] === "string";
    if (!good) warn(`library.pillLabels has an entry that isn't ["pattern", "label"]; it was skipped.`);
    return good;
  });
  for (const k of ["hunterScript", "hunterPlaybook"]) {
    const h = cfg.library[k];
    if (h && (typeof h.doc !== "string" || !reOk(h.heading))) {
      warn(`library.${k} needs a doc and a valid heading pattern; using the default.`);
      cfg.library[k] = clone(DEFAULT_CONFIG.library[k]);
    }
  }
  /* sheet buttons: a doc id and a label; a key is one character that no built-in shortcut uses */
  const TAKEN = ["n", "g", "/", "?", "1", "2", "3", "4", "5", "6", "7", "8", "9"].concat(cfg.blurPay ? ["h"] : []);
  const usedKeys = new Set();
  cfg.library.sheetButtons = cfg.library.sheetButtons
    .map((b, i) => {
      if (!b || typeof b !== "object" || typeof b.doc !== "string" || !b.doc.trim()) {
        warn(`library.sheetButtons entry ${i + 1} has no doc; it was skipped.`);
        return null;
      }
      const out = { ...b, doc: b.doc.trim() };
      if (typeof out.label !== "string" || !out.label.trim()) {
        warn(`library.sheetButtons "${out.doc}" has no label; the doc id is used.`);
        out.label = out.doc;
      }
      if (out.key == null || out.key === "") delete out.key;
      else if (typeof out.key !== "string" || out.key.length !== 1) {
        warn(`library.sheetButtons "${out.doc}" key should be one character; it has no key now.`);
        delete out.key;
      } else if (TAKEN.includes(out.key.toLowerCase()) || usedKeys.has(out.key.toLowerCase())) {
        warn(`library.sheetButtons "${out.doc}" key "${out.key}" is already taken; it has no key now.`);
        delete out.key;
      } else usedKeys.add(out.key.toLowerCase());
      return out;
    })
    .filter(Boolean);
  const lanes = cfg.lanes && typeof cfg.lanes === "object" ? cfg.lanes : {};
  cfg.lanes = { ...lanes };
  for (const sec of Object.keys(DEFAULT_CONFIG.lanes)) {
    const dflt = DEFAULT_CONFIG.lanes[sec];
    const given = Array.isArray(lanes[sec]) ? lanes[sec] : null;
    if (lanes[sec] != null && !given) warn(`lanes.${sec} should be a list; using the default lanes.`);
    const out = [];
    for (const l of given || dflt) {
      if (!l || typeof l !== "object" || typeof l.id !== "string" || !l.id) {
        warn(`lanes.${sec} has an entry without an id; it was skipped.`);
        continue;
      }
      if (out.some((o) => o.id === l.id)) continue;
      /* a lane you list keeps the default's other settings (color, follow-up days, done) unless you set them */
      const base = dflt.find((d) => d.id === l.id);
      const lane = base ? { ...base, ...l } : { ...l };
      /* follow-up days are a number ("7" works too) */
      if (lane.follow != null) {
        const n = Number(lane.follow);
        if (typeof lane.follow === "boolean" || !isFinite(n) || n < 0) {
          warn(`lanes.${sec} "${l.id}" has follow: ${JSON.stringify(lane.follow)}; it should be a number of days.`);
          if (base && base.follow != null) lane.follow = base.follow;
          else delete lane.follow;
        } else lane.follow = n;
      }
      if (typeof lane.name !== "string" || !lane.name.trim()) lane.name = base ? base.name : l.id;
      out.push(lane);
    }
    /* every default lane id is required: put a missing one back next to its neighbor */
    dflt.forEach((d, i) => {
      if (out.some((o) => o.id === d.id)) return;
      warn(`lanes.${sec} is missing the "${d.id}" lane; the default "${d.name}" lane was added back.`);
      let at = 0;
      for (let k = i - 1; k >= 0; k--) {
        const j = out.findIndex((o) => o.id === dflt[k].id);
        if (j >= 0) {
          at = j + 1;
          break;
        }
      }
      out.splice(at, 0, { ...d });
    });
    cfg.lanes[sec] = out;
  }
  /* stale: null (or false) turns the "no change in N days" nudges off; another wrong type falls back to the default */
  if (cfg.stale == null || cfg.stale === false) cfg.stale = {};
  else if (kind(cfg.stale) !== "object") {
    warn("stale should be an object; using the default.");
    cfg.stale = clone(DEFAULT_CONFIG.stale);
  }
  for (const sec of Object.keys(cfg.stale)) {
    const r = cfg.stale[sec];
    if (!r) continue;
    if (kind(r) !== "object") {
      warn(`stale.${sec} should be an object; using the default rule.`);
      cfg.stale[sec] = clone(DEFAULT_CONFIG.stale[sec]) || null;
      continue;
    }
    if (!isFinite(Number(r.days))) {
      warn(`stale.${sec}.days should be a number; using the default rule.`);
      cfg.stale[sec] = clone(DEFAULT_CONFIG.stale[sec]) || null;
      continue;
    }
    r.days = Number(r.days);
    const ids = (cfg.lanes[sec] || []).map((l) => l.id);
    if (!Array.isArray(r.lanes) || (r.close && !ids.includes(r.close))) {
      warn(`stale.${sec} names a lane that doesn't exist; using the default rule.`);
      cfg.stale[sec] = DEFAULT_CONFIG.stale[sec] || null;
    }
  }
  /* call types: strings (older settings) or { label, moves } */
  const MOVES = ["screen", "interview", "none"];
  const legacy = (label) => (/Hiring|Panel|Onsite/.test(label) ? "interview" : "screen");
  const types = Array.isArray(cfg.callTypes) ? cfg.callTypes : DEFAULT_CONFIG.callTypes;
  if (!Array.isArray(cfg.callTypes)) warn("callTypes should be a list; using the default call types.");
  cfg.callTypes = types
    .map((t) => {
      if (typeof t === "string" && t.trim()) return { label: t.trim(), moves: legacy(t) };
      if (t && typeof t === "object" && typeof t.label === "string" && t.label.trim()) {
        if (t.moves != null && !MOVES.includes(t.moves))
          warn(`callTypes "${t.label}" has moves: "${t.moves}"; use screen, interview or none.`);
        return { ...t, label: t.label.trim(), moves: MOVES.includes(t.moves) ? t.moves : legacy(t.label) };
      }
      warn("callTypes has an entry without a label; it was skipped.");
      return null;
    })
    .filter(Boolean);
  if (!cfg.callTypes.length) cfg.callTypes = DEFAULT_CONFIG.callTypes.map((t) => ({ ...t }));
  return cfg;
}
checkConfig(CONFIG);
/* The data file next to the page (index.html loads it by this name). */
const DATA_FILE = "board_data.js";

/* Browser storage is shared by every page opened from disk, so keys carry this page's folder. */
const PAGE_DIR = decodeURIComponent(location.pathname.replace(/[^/]*$/, ""));
const lsKey = (name) => `${CONFIG.storagePrefix}:${PAGE_DIR}:${name}`;
