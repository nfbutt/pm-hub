// A synthetic, deterministic project shaped exactly like GitHub's GraphQL responses.
// Used by the unit tests and by demo mode. Contains no real data.
import type { ProjectMetaData, RawFieldValue, RawItem } from "../github/types";

type Meta = NonNullable<NonNullable<ProjectMetaData["repositoryOwner"]>["projectV2"]>;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const day = (anchor: string, offset: number) => {
  const d = new Date(anchor + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10);
};
const ts = (date: string) => date + "T15:00:00Z";
const field = (name: string) => ({ field: { id: `F_${name.replace(/W/g, "")}`, name } });
const repoRef = (nameWithOwner: string) => ({ id: `R_${nameWithOwner.replace(/W/g, "_")}`, nameWithOwner });
const issueId = (n: number) => `I_${n}`;
const label = (name: string, color: string) => ({ id: `L_${name.replace(/W/g, "_")}`, name, color });
const user = (login: string) => ({ id: `U_${login}`, login });

export const DEMO_OWNER = "demo-co";
const REPO = "demo-co/orbit";
const REPO2 = "demo-co/orbit-api";

const EPICS = [
  { title: "Customer onboarding flow", product: "web", prio: "critical", start: -63, len: 49, done: 1.0 },
  { title: "Billing and invoices", product: "web", prio: "high", start: -35, len: 56, done: 0.55 },
  { title: "Usage-based pricing engine", product: "api", prio: "critical", start: -28, len: 70, done: 0.3 },
  { title: "Public REST API v2", product: "api", prio: "high", start: -14, len: 63, done: 0.15 },
  { title: "Audit log and exports", product: "api", prio: "medium", start: 14, len: 42, done: 0 },
  { title: "Mobile notifications", product: "mobile", prio: "medium", start: 0, len: 49, done: 0.1 },
  { title: "Offline mode", product: "mobile", prio: "low", start: 42, len: 56, done: 0 },
] as const;

// What each epic's stories are about, so the Epic Map has real wording to compare.
const TOPICS = [
  ["signup wizard steps", "welcome email sequence", "workspace setup checklist", "trial activation", "first-run product tour"],
  ["invoice PDF layout", "saved payment methods", "card checkout with Stripe", "sales tax calculation", "billing history page"],
  ["usage metering events", "price tier tables", "rating pipeline for usage", "plan limits and overage", "metered usage aggregation"],
  ["rate limiting per client", "cursor pagination", "OpenAPI schema", "webhook delivery retries", "versioned endpoints"],
  ["audit event schema", "CSV export of audit events", "retention policy for logs", "admin activity feed", "compliance report download"],
  ["push notification delivery", "APNs and FCM device tokens", "notification preferences screen", "deep links from notifications", "badge counts"],
  ["local cache of records", "sync queue on reconnect", "conflict resolution for edits", "offline banner and states", "background sync scheduling"],
];
// Stories written into the wrong epic on purpose: [epic index, story index, body]. They give the
// Epic Map overlaps, misfits and a security theme no epic owns.
const STRAYS: [number, number, string][] = [
  [1, 2, "Aggregate usage metering events into the rating pipeline so overage is priced from price tier tables."],
  [0, 3, "Collect saved payment methods and run card checkout with Stripe during the signup wizard."],
  [3, 1, "API keys with scoped token permissions, key rotation and revocation. Security review needed for secret storage."],
  [4, 0, "Permission checks and role-based access control for who can read the access log. Security sign-off required."],
  [5, 2, "Retry delivery from the sync queue on reconnect and keep a local cache of records while offline."],
];

const STORY_VERBS = ["Design", "Build", "Wire up", "Test", "Document", "Migrate", "Instrument", "Harden"];
const STORY_NOUNS = ["data model", "API endpoints", "settings page", "email templates", "background job", "permissions", "error states", "metrics", "admin view", "import path"];

function storyBody(ei: number, s: number): string {
  const stray = STRAYS.find(x => x[0] === ei && x[1] === s);
  if (stray) return stray[2];
  const t = TOPICS[ei]!;
  return `Covers ${t[s % t.length]} and ${t[(s + 2) % t.length]} for ${EPICS[ei]!.title.toLowerCase()}.`;
}

export interface Fixture { meta: Meta; items: RawItem[]; anchor: string }

/** anchor = "today" for the fixture (YYYY-MM-DD). Everything is placed relative to it. */
export function makeFixture(anchor: string): Fixture {
  const r = rng(42);
  const milestones = [0, 1, 2, 3].map(k => ({ id: `M_${k + 1}`, title: `Release ${k + 1}`, number: k + 1, dueOn: ts(day(anchor, -21 + k * 28)), state: k === 0 ? "CLOSED" : "OPEN" }));
  const sprintStart = day(anchor, -84);
  const iterations = Array.from({ length: 14 }, (_, k) => ({ id: `it${k + 1}`, title: `Sprint ${k + 1}`, startDate: day(sprintStart, k * 14), duration: 14 }));
  const iterationFor = (date: string) => [...iterations].reverse().find(it => it.startDate <= date) ?? iterations[0]!;

  const items: RawItem[] = [];
  let num = 100;
  const epicNums: number[] = [];

  EPICS.forEach((e, ei) => {
    const epicNum = ++num; epicNums.push(epicNum);
    const start = day(anchor, e.start), end = day(anchor, e.start + e.len - 1);
    const nStories = 5 + Math.floor(r() * 4);
    const doneCount = Math.round(nStories * e.done);
    const storyNums: number[] = [];

    for (let s = 0; s < nStories; s++) {
      const n = ++num; storyNums.push(n);
      const sStart = day(anchor, e.start + Math.floor((s / nStories) * e.len));
      const sEnd = day(anchor, e.start + Math.floor(((s + 1) / nStories) * e.len) - 1);
      const closed = s < doneCount;
      const closedAt = closed ? ts(day(anchor, Math.min(-1, e.start + Math.floor(((s + 1) / nStories) * e.len) - Math.floor(r() * 5)))) : null;
      const created = ts(day(anchor, Math.min(e.start - 7 - Math.floor(r() * 10), -1)));
      const ms = milestones.find(m => m.dueOn >= ts(sEnd)) ?? milestones[3]!;
      const it = iterationFor(sStart);
      const fv: RawFieldValue[] = [
        { __typename: "ProjectV2ItemFieldSingleSelectValue", name: closed ? "Done" : s === doneCount ? "In Progress" : "Todo", optionId: closed ? "st3" : s === doneCount ? "st2" : "st1", ...field("Status") },
        { __typename: "ProjectV2ItemFieldIterationValue", title: it.title, startDate: it.startDate, duration: it.duration, iterationId: it.id, ...field("Sprint") },
      ];
      if (s % 3 !== 2) fv.push({ __typename: "ProjectV2ItemFieldDateValue", date: sStart, ...field("Start date") }, { __typename: "ProjectV2ItemFieldDateValue", date: sEnd, ...field("Target date") });
      const blockedBy = s > 0 && s % 2 === 0 ? [{ id: issueId(storyNums[s - 1]!), number: storyNums[s - 1]!, state: s - 1 < doneCount ? "CLOSED" : "OPEN", repository: repoRef(REPO) }] : [];
      items.push({
        id: `item-${n}`, type: "ISSUE", isArchived: false, fieldValues: { nodes: fv },
        content: {
          __typename: "Issue", id: issueId(n), number: n, title: `${STORY_VERBS[(s + ei) % STORY_VERBS.length]} ${STORY_NOUNS[(s * 3 + ei) % STORY_NOUNS.length]}`,
          body: storyBody(ei, s),
          url: `https://github.com/${REPO}/issues/${n}`, state: closed ? "CLOSED" : "OPEN", stateReason: closed ? "COMPLETED" : null,
          createdAt: created, closedAt, updatedAt: closedAt ?? ts(day(anchor, -Math.floor(r() * 40))),
          repository: repoRef(ei % 3 === 2 ? REPO2 : REPO),
          labels: { nodes: [label("type: story", "c5def5"), label(`product: ${e.product}`, "0e8a16")] },
          assignees: { nodes: [user(["ana", "ben", "chen", "dee", "eli"][(s + ei) % 5]!)] },
          milestone: ms, issueType: { name: "Task" },
          parent: { id: issueId(epicNum), number: epicNum, repository: repoRef(REPO) },
          subIssuesSummary: { total: 0, completed: 0 },
          blockedBy: { nodes: ei % 3 === 2 ? blockedBy.map(b => ({ ...b, repository: repoRef(REPO2) })) : blockedBy },
        },
      });
    }

    const epicBlockedBy = ei === 3 ? [{ id: issueId(epicNums[2]!), number: epicNums[2]!, state: "OPEN", repository: repoRef(REPO) }]
      : ei === 4 ? [{ id: issueId(epicNums[3]!), number: epicNums[3]!, state: "OPEN", repository: repoRef(REPO) }] : [];
    items.push({
      id: `item-${epicNum}`, type: "ISSUE", isArchived: false,
      fieldValues: { nodes: [
        { __typename: "ProjectV2ItemFieldSingleSelectValue", name: e.done === 1 ? "Done" : e.done > 0 ? "In Progress" : "Todo", optionId: "x", ...field("Status") },
        { __typename: "ProjectV2ItemFieldDateValue", date: start, ...field("Start date") },
        { __typename: "ProjectV2ItemFieldDateValue", date: end, ...field("Target date") },
        { __typename: "ProjectV2ItemFieldSingleSelectValue", name: e.prio[0]!.toUpperCase() + e.prio.slice(1), optionId: "p", ...field("Priority") },
      ] },
      content: {
        __typename: "Issue", id: issueId(epicNum), number: epicNum, title: e.title, body: `${e.title}: ${TOPICS[ei]!.join(", ")}.`, url: `https://github.com/${REPO}/issues/${epicNum}`,
        state: e.done === 1 ? "CLOSED" : "OPEN", stateReason: e.done === 1 ? "COMPLETED" : null,
        createdAt: ts(day(anchor, e.start - 21)), closedAt: e.done === 1 ? ts(day(anchor, e.start + e.len - 2)) : null, updatedAt: ts(day(anchor, -2)),
        repository: repoRef(REPO),
        labels: { nodes: [label("type: epic", "5319e7"), label(`product: ${e.product}`, "0e8a16")] },
        assignees: { nodes: [] }, milestone: null, issueType: { name: "Epic" }, parent: null,
        subIssuesSummary: { total: nStories, completed: doneCount },
        blockedBy: { nodes: epicBlockedBy },
      },
    });
  });

  // A few loose items: a draft, an undated issue with no owner, a merged PR.
  items.push(
    { id: "item-draft-1", type: "DRAFT_ISSUE", isArchived: false, fieldValues: { nodes: [] },
      content: { __typename: "DraftIssue", title: "Explore SSO for enterprise tier", body: "SAML and OIDC single sign-on, enforced login policies and session security for enterprise workspaces.", createdAt: ts(day(anchor, -5)), updatedAt: ts(day(anchor, -5)), assignees: { nodes: [] } } },
    { id: "item-loose-1", type: "ISSUE", isArchived: false, fieldValues: { nodes: [] },
      content: { __typename: "Issue", number: ++num, title: "Flaky checkout test on CI", url: `https://github.com/${REPO}/issues/${num}`, state: "OPEN", stateReason: null,
        createdAt: ts(day(anchor, -50)), closedAt: null, updatedAt: ts(day(anchor, -45)), repository: { nameWithOwner: REPO },
        labels: { nodes: [{ name: "bug", color: "d73a4a" }] }, assignees: { nodes: [] }, milestone: null, issueType: { name: "Bug" },
        parent: null, subIssuesSummary: { total: 0, completed: 0 }, blockedBy: { nodes: [] } } },
    { id: "item-pr-1", type: "PULL_REQUEST", isArchived: false, fieldValues: { nodes: [] },
      content: { __typename: "PullRequest", number: ++num, title: "Add invoice PDF renderer", url: `https://github.com/${REPO}/pull/${num}`, state: "MERGED",
        createdAt: ts(day(anchor, -12)), closedAt: ts(day(anchor, -9)), updatedAt: ts(day(anchor, -9)), repository: { nameWithOwner: REPO },
        labels: { nodes: [] }, assignees: { nodes: [{ login: "ben" }] }, milestone: milestones[1]! } },
    { id: "item-archived", type: "ISSUE", isArchived: true, fieldValues: { nodes: [] },
      content: { __typename: "DraftIssue", title: "Archived idea", createdAt: ts(day(anchor, -90)), updatedAt: ts(day(anchor, -90)), assignees: { nodes: [] } } },
  );

  const meta: Meta = {
    id: "PVT_demo", number: 1, title: "Orbit roadmap (demo)", url: "https://github.com/orgs/demo-co/projects/1",
    shortDescription: "Synthetic sample project. No real data.", closed: false, updatedAt: ts(anchor), items: { totalCount: items.length },
    fields: { nodes: [
      { __typename: "ProjectV2Field", id: "f-title", name: "Title", dataType: "TITLE" },
      { __typename: "ProjectV2SingleSelectField", id: "f-status", name: "Status", dataType: "SINGLE_SELECT", options: [
        { id: "st1", name: "Todo", color: "GRAY" }, { id: "st2", name: "In Progress", color: "YELLOW" }, { id: "st3", name: "Done", color: "GREEN" }] },
      { __typename: "ProjectV2SingleSelectField", id: "f-prio", name: "Priority", dataType: "SINGLE_SELECT", options: [
        { id: "p0", name: "Critical", color: "RED" }, { id: "p1", name: "High", color: "ORANGE" }, { id: "p2", name: "Medium", color: "BLUE" }, { id: "p3", name: "Low", color: "GRAY" }] },
      { __typename: "ProjectV2Field", id: "f-start", name: "Start date", dataType: "DATE" },
      { __typename: "ProjectV2Field", id: "f-target", name: "Target date", dataType: "DATE" },
      { __typename: "ProjectV2IterationField", id: "f-sprint", name: "Sprint", dataType: "ITERATION", configuration: {
        duration: 14, startDay: 1,
        iterations: iterations.filter(i => i.startDate > day(anchor, -14)),
        completedIterations: iterations.filter(i => i.startDate <= day(anchor, -14)) } },
      { __typename: "ProjectV2Field", id: "f-ms", name: "Milestone", dataType: "MILESTONE" },
    ] },
  };
  return { meta, items, anchor };
}
