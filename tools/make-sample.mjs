// Writes boards/sample/board_data.js: a small, made-up job search to explore the app with, for a fictional
// senior software engineer.
// Every company, person, link and number here is fictional. Dates are relative to the day you run this,
// so `npm run sample` makes the sample look current again. It also writes the placeholder PDFs
// in each job's stage folder, and an empty board in boards/empty.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const now = new Date();
const iso = (days, hour = 15) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const day = (days) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const T = iso(-1); // every record was last touched yesterday
const folder = (stage, company, role) => `${stage}/${company} - ${role}`;

// The persona: a senior software engineer (backend and full-stack, about seven years in) looking for their next role.
const job = (id, company, role, stage, extra) => [
  id,
  { company, role, folder: stage ? folder(stage, company, role) : undefined, ...extra },
];
const jobs = Object.fromEntries(
  [
    job("lumenfield", "Lumenfield Software", "Senior Software Engineer, Payments API", "2 - Applied", {
      location: "Remote (US)",
      pay: "Range in the posting",
      url: "https://jobs.example.com/lumenfield/senior-swe-payments-api",
      lane: "applied",
      movedAt: iso(-4),
      appliedAt: iso(-4),
      followUp: day(3),
      resume: "v3",
      sentResume: "v3",
      referralId: "p_hana",
      notes: "",
    }),
    job("harborlight", "Harborlight Bank", "Senior Backend Engineer, Mobile Banking", "2 - Applied", {
      location: "Chicago (hybrid)",
      pay: "Range in the posting",
      url: "https://jobs.example.com/harborlight/senior-backend-mobile",
      lane: "applied",
      movedAt: iso(-9),
      appliedAt: iso(-9),
      followUp: day(-2),
      resume: "v2",
      sentResume: "v2",
      notes: "",
    }),
    job("brightwell_web", "Brightwell Labs", "Senior Software Engineer, Learning Platform", "2 - Applied", {
      location: "Denver (hybrid)",
      url: "https://jobs.example.com/brightwell/senior-swe-learning-platform",
      lane: "applied",
      movedAt: iso(-24),
      appliedAt: iso(-24),
      followUp: day(-17),
      resume: "v2",
      sentResume: "v2",
      notes: "",
    }),
    job("brightwell_search", "Brightwell Labs", "Senior Software Engineer, Search", "1 - To apply", {
      location: "Remote (US)",
      url: "https://jobs.example.com/brightwell/senior-swe-search",
      lane: "todo",
      movedAt: iso(-6),
      resume: "v3",
      referralId: "p_dev",
      notes: "Ask Dev for a referral before applying.",
    }),
    job("quillstone", "Quillstone", "Senior Machine Learning Engineer", null, {
      location: "New York (on site)",
      url: "https://jobs.example.com/quillstone/senior-ml-engineer",
      lane: "todo",
      movedAt: iso(-3),
      pinned: true,
      pinnedAt: iso(-2),
      notes: "",
    }),
    job("orchardline", "Orchardline", "Senior Full-Stack Engineer", null, {
      location: "Seattle (hybrid)",
      url: "https://jobs.example.com/orchardline/senior-full-stack-engineer",
      lane: "todo",
      movedAt: iso(-5),
      notes: "",
    }),
    job("fernhill", "Fernhill", "Staff Software Engineer, Security", null, {
      location: "Boston (hybrid)",
      url: "https://jobs.example.com/fernhill/staff-swe-security",
      lane: "todo",
      movedAt: iso(-7),
      longShot: true,
      notes: "Asks for ten years; I have seven.",
    }),
    job("tidewater", "Tidewater Robotics", "Senior Software Engineer, Fleet Services", "2 - Applied", {
      location: "Pittsburgh (hybrid)",
      url: "https://jobs.example.com/tidewater/senior-swe-fleet-services",
      lane: "screen",
      movedAt: iso(-2),
      appliedAt: iso(-12),
      followUp: day(2),
      resume: "v2",
      sentResume: "v2",
      notes: "Recruiter: Sam. Next is a take-home exercise.",
    }),
    job("cobaltpeak", "Cobalt Peak Payments", "Senior Software Engineer, Ledger", "2 - Applied", {
      location: "Remote (US)",
      url: "https://jobs.example.com/cobaltpeak/senior-swe-ledger",
      lane: "interview",
      movedAt: iso(-1),
      appliedAt: iso(-20),
      followUp: day(4),
      resume: "v1",
      sentResume: "v1",
      notes: "Onsite next week: system design and two coding rounds.",
    }),
    job("marigold", "Marigold Health", "Senior Data Engineer", "3 - Closed", {
      location: "Remote (US)",
      url: "https://jobs.example.com/marigold/senior-data-engineer",
      lane: "closed",
      closedReason: "Rejected",
      movedAt: iso(-8),
      appliedAt: iso(-30),
      resume: "v1",
      sentResume: "v1",
      notes: "",
    }),
  ].map(([id, r]) => [id, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))]),
);
const hunters = {
  h_summitvale: {
    name: "Summit & Vale Partners",
    firm: "Summit & Vale Partners",
    practice: "Software engineering",
    tier: "Large",
    url: "https://summitvale.example/candidates",
    firmUrl: "https://summitvale.example/",
    linkLabel: "Candidate form ↗",
    lane: "talking",
    movedAt: iso(-6),
    followUp: day(24),
    notes: "Registered online. Their recruiter has two backend roles open this month.",
  },
  h_bluefin: {
    name: "Bluefin Search",
    firm: "Bluefin Search",
    practice: "Engineering and product",
    tier: "Mid-size",
    url: "https://bluefin.example/join",
    firmUrl: "https://bluefin.example/",
    lane: "registered",
    movedAt: iso(-10),
    notes: "Uploaded résumé through the form.",
  },
  h_ardent: {
    name: "Ardent Talent",
    firm: "Ardent Talent",
    practice: "Startups, Series A to C",
    tier: "Boutique",
    url: "https://ardent.example/",
    firmUrl: "https://ardent.example/",
    lane: "todo",
    notes: "Sign-up is by email only.",
  },
  h_mara: {
    name: "Mara Quint",
    firm: "Kestrel Talent",
    practice: "Software engineers",
    url: "https://example.com/in/mara-quint",
    lane: "contacted",
    movedAt: iso(-12),
    followUp: day(-2),
    submittedTo: "Orchardline (Senior Full-Stack Engineer)",
    notes: "Submitted me to Orchardline. Don't apply there directly.",
  },
};
const people = {
  p_jonah: {
    name: "Jonah Whitfield",
    company: "Summit & Vale Partners",
    ask: "Intro call about backend roles",
    url: "https://example.com/in/jonah-whitfield",
    lane: "asked",
    movedAt: iso(-5),
    followUp: day(2),
    notes: "",
  },
  p_elena: {
    name: "Elena Marsh",
    company: "Summit & Vale Partners",
    ask: "Intro call",
    url: "https://example.com/in/elena-marsh",
    lane: "todo",
    notes: "",
  },
  p_dev: {
    name: "Dev Okafor",
    company: "Brightwell Labs",
    ask: "Referral for Brightwell Labs, Search",
    url: "https://example.com/in/dev-okafor",
    lane: "asked",
    movedAt: iso(-3),
    followUp: day(4),
    notes: "Former teammate.",
  },
  p_hana: {
    name: "Hana Sato",
    company: "Lumenfield Software",
    ask: "Referral for Lumenfield, Payments API",
    url: "https://example.com/in/hana-sato",
    lane: "helped",
    movedAt: iso(-5),
    notes: "Referred me on the careers site.",
  },
  p_tom: {
    name: "Tom Reyes",
    company: "",
    ask: "Mock system design interview",
    lane: "talking",
    movedAt: iso(-15),
    followUp: day(-1),
    notes: "Former tech lead. Practice session every other week.",
  },
};
const todos = {
  t1: {
    text: "Do two timed coding problems before the Cobalt Peak onsite",
    detail: "One graph problem, one design-a-data-structure problem. 45 minutes each.",
    group: "first",
    from: "you",
    done: false,
    order: 0,
  },
  t2: {
    text: "Ask Dev for the Brightwell referral",
    detail: "Send the posting link and two lines on why the search team fits.",
    group: "first",
    from: "assistant",
    done: false,
    order: 1,
  },
  t3: {
    text: "Tidy up the README on your side project",
    detail: "",
    group: "later",
    from: "you",
    done: false,
    order: 2,
  },
  t4: {
    text: "Write up the payments outage story for interviews",
    detail: "",
    group: "first",
    from: "you",
    done: true,
    doneAt: iso(-2),
    order: 3,
  },
};
const plan = {
  w1a: { week: 1, order: 1, text: "Pick the roles you want: level, stack, remote or on site" },
  w1b: { week: 1, order: 2, text: "Refresh your résumé and profile; list five stories with numbers" },
  w2a: { week: 2, order: 1, text: "Register with every agency on the Headhunters tab", auto: "hunters_registered" },
  w2b: { week: 2, order: 2, text: "Practice: one system design and three coding problems" },
  w3a: { week: 3, order: 1, text: "Ask former teammates for referrals at your top companies" },
  w3b: { week: 3, order: 2, text: "Add ten people who could refer you or introduce you", auto: "people10" },
  w4a: { week: 4, order: 1, text: "Follow up once with everyone who didn't reply" },
  w4b: { week: 4, order: 2, text: "Book a mock interview with a friend before your first onsite" },
};
const stampAll = (coll, who = "you") =>
  Object.fromEntries(
    Object.entries(coll).map(([id, r]) => [id, { createdAt: iso(-14), ...r, updatedAt: T, changedBy: who }]),
  );
const data = {
  version: 1,
  savedAt: T,
  jobs: stampAll(jobs),
  hunters: stampAll(hunters),
  people: stampAll(people),
  todos: stampAll(todos),
  plan: stampAll(plan),
};
data.plan.w1a.done = true;
data.plan.w1a.doneAt = iso(-9);
const header =
  "// Job Search Organizer data. The page and any tool you trust (a script, an AI assistant) may edit this file.\n" +
  "// Rules: every record has updatedAt (ISO time, UTC with Z); when two copies differ, the newer one wins.\n" +
  "// Never delete a record outright: set deleted:true and a new updatedAt. Other tools also set changedBy to their name.\n";
const write = (board, obj) => {
  mkdirSync(join(ROOT, "boards", board), { recursive: true });
  writeFileSync(
    join(ROOT, "boards", board, "board_data.js"),
    header + "window.BOARD_DATA = " + JSON.stringify(obj, null, 1) + ";\n",
  );
};
write("sample", data);
write("empty", {
  version: 1,
  savedAt: "2026-01-01T00:00:00.000Z",
  jobs: {},
  hunters: {},
  people: {},
  todos: {},
  plan: {},
});

// A one-page placeholder PDF, so the Résumé and Cover letter buttons open something.
function pdf(title) {
  const text = `BT /F1 20 Tf 72 720 Td (${title}) Tj 0 -28 Td /F1 12 Tf (A made-up placeholder from the sample board.) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
for (const j of Object.values(jobs)) {
  if (!j.folder) continue;
  const dir = join(ROOT, "boards", "sample", j.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Resume.pdf"), pdf(`Sample resume for ${j.company}`));
  writeFileSync(join(dir, "Cover_Letter.pdf"), pdf(`Sample cover letter for ${j.company}`));
}
for (const b of ["sample", "empty"])
  for (const s of ["1 - To apply", "2 - Applied", "3 - Closed"]) {
    const d = join(ROOT, "boards", b, s);
    mkdirSync(d, { recursive: true });
    if (!existsSync(join(d, ".gitkeep"))) writeFileSync(join(d, ".gitkeep"), "");
  }
console.log(
  `sample board: ${Object.keys(jobs).length} jobs, ${Object.keys(hunters).length} headhunters, ${Object.keys(people).length} people, ${Object.keys(todos).length} to-dos, ${Object.keys(plan).length} plan steps`,
);
