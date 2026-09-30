/* Settings. Everything personal lives here, so the rest of the code stays generic.
   To change a setting without rebuilding, put an `organizer.config.js` file next to the HTML page:
     window.ORGANIZER_CONFIG = { ownerName: "Alex", files: { resume: "Alex_Resume.pdf" } };
   It is merged over these defaults. Lane ids (todo, applied, screen…) are fixed; their names and timings are not. */
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
  closedReasons: ["Rejected", "Withdrew", "Posting closed", "No reply", "Took another offer"],
  callTypes: ["Recruiter screen", "Hiring manager", "Panel", "Onsite", "Headhunter call", "Other"],
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
const CONFIG = mergeConfig(DEFAULT_CONFIG, window.ORGANIZER_CONFIG);
/* The data file next to the page (index.html loads it by this name). */
const DATA_FILE = "board_data.js";

/* Browser storage is shared by every page opened from disk, so keys carry this page's folder. */
const PAGE_DIR = decodeURIComponent(location.pathname.replace(/[^/]*$/, ""));
const lsKey = (name) => `${CONFIG.storagePrefix}:${PAGE_DIR}:${name}`;
