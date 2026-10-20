/* The three boards (jobs, headhunters, people): their lanes, card text, fields and search keys. */
const laneList = (sec) => CONFIG.lanes[sec].map((l) => ({ ...l, color: `var(--l-${l.color || "gray"})` }));
const SECTIONS = {
  jobs: {
    label: "Jobs",
    short: "Jobs",
    noun: "job",
    lanes: laneList("jobs"),
    title: (j) => j.company || "New job",
    sub: (j) => j.role,
    meta: (j) => j.location || "",
    dmeta: (j) => [j.location, j.pay].filter(Boolean).join(" · "),
    linkLabel: () => "Open posting ↗",
    search: ["company", "role", "location", "notes", "closedReason"],
    edit: [
      ["company", "Company"],
      ["role", "Role"],
      ["url", "Posting link"],
      ["location", "Location"],
      ["pay", "Pay range"],
    ],
    addFields: [
      ["url", "Posting link", "Paste the link from the job board or the company site"],
      ["company", "Company"],
      ["role", "Role"],
    ],
    facts: (j) => [
      ["Résumé sent", j.sentResume, true],
      ["Files", j.folder || null, true],
    ],
    extra: [{ key: "appliedAt", label: "Date applied", type: "dateIso" }],
    closedReasons: CONFIG.closedReasons,
    notesHint: "Who you talked to, what they asked, next steps…",
    empty: { todo: "Nothing waiting.", _: "" },
  },
  hunters: {
    label: CONFIG.sections.hunters.label,
    short: CONFIG.sections.hunters.short,
    noun: CONFIG.sections.hunters.noun,
    lanes: laneList("hunters"),
    title: (h) => h.name || "Untitled",
    sub: (h) => (h.firm && h.firm !== h.name ? h.firm + (h.practice ? " · " + h.practice : "") : h.practice),
    meta: () => "",
    dmeta: (h) => (h.tier ? `${h.tier} firm` : ""),
    linkLabel: (h) => h.linkLabel || "Open ↗",
    search: ["name", "firm", "practice", "notes", "submittedTo", "tier"],
    edit: [
      ["name", "Person or firm"],
      ["firm", "Firm"],
      ["practice", "Practice"],
      ["url", "Profile or contact link"],
    ],
    addFields: [
      ["name", "Person or firm", true],
      ["firm", "Firm (if a person)"],
      ["url", "Profile or contact link"],
    ],
    facts: (h) => [["Firm page", h.firmUrl]],
    extra: [
      {
        key: "submittedTo",
        label: "Roles they submitted me for",
        type: "text",
        hint: "Only one firm per role, and don't apply to these roles yourself. Name the company so the Jobs tab can warn you.",
      },
    ],
    notesHint: "Who you spoke with, their live searches, how often to check in…",
    empty: { todo: "Add a firm or a partner.", _: "" },
  },
  people: {
    label: CONFIG.sections.people.label,
    short: CONFIG.sections.people.short,
    noun: CONFIG.sections.people.noun,
    lanes: laneList("people"),
    title: (p) => p.name || "Someone",
    sub: (p) => [p.company, p.ask].filter(Boolean).join(" · "),
    meta: () => "",
    dmeta: () => "",
    linkLabel: () => "Profile ↗",
    search: ["name", "company", "ask", "notes"],
    edit: [
      ["name", "Name"],
      ["company", "Company"],
      ["url", "Profile link"],
    ],
    addFields: [
      ["name", "Name", true],
      ["company", "Company"],
      ["ask", "What you're asking for", "Referral, intro to a headhunter, advice…"],
      ["url", "Profile link"],
    ],
    facts: () => [],
    extra: [{ key: "ask", label: "What I'm asking for", type: "text" }],
    notesHint: "How you know them, what you asked, what they said…",
    empty: { todo: "Add someone who could refer you or introduce you to a recruiter.", _: "" },
  },
};
const BOARDS = ["jobs", "hunters", "people"];
const COLLS = ["jobs", "hunters", "people", "todos", "plan"];
const SEC_ORDER = ["next", "todos", "jobs", "hunters", "people", "library"];
const TAB_NAMES = { next: ["Next up", "Next"], todos: ["To-dos", "To-dos"], library: ["Prep library", "Prep"] };
/* Lanes where a job is in play: its card opens the prep sheet. */
const ACTIVE_LANES = ["applied", "screen", "interview", "offer"];
