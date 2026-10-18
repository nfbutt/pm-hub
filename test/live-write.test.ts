// Real writes against a throwaway sandbox project, then a full revert. Skipped unless asked:
//   PM_HUB_TOKEN=$(gh auth token) PM_HUB_SANDBOX=owner/number npx vitest run test/live-write.test.ts --silent=false
// Refuses to run on any project not titled "pm-hub sandbox".
import { describe, expect, it } from "vitest";
import { buildSteps, checkStep, execute, fetchCurrent, fetchRepoMeta, involvedKeys, type RepoMeta } from "../src/github/apply";
import { createClient } from "../src/github/client";
import { loadProject } from "../src/github/load";
import { addBlocker, moveToParent, newItem, removeBlocker, setAssignees, setLane, setMilestone, setOption, setState, setTitle } from "../src/model/edits";
import { detectMapping, laneOf } from "../src/model/mapping";
import type { Project } from "../src/model/normalize";
import { datesOp, describe as describeOp, inverse, netOps, remapKeys, type Op } from "../src/model/ops";

const token = process.env.PM_HUB_TOKEN;
const target = process.env.PM_HUB_SANDBOX ?? "";

async function run(client: ReturnType<typeof createClient>, base: Project, ops: Op[], reasons: Record<number, string> = {}) {
  const net = netOps(ops);
  const steps = buildSteps(net, k => base.items.find(i => i.key === k)?.title ?? k);
  const current = await fetchCurrent(client, base, involvedKeys(net));
  const repos = new Map<string, RepoMeta>();
  for (const r of new Set(base.items.map(i => i.repo).filter((x): x is string => !!x))) repos.set(r, await fetchRepoMeta(client, r));
  for (const s of steps) { if (s.status !== "ready") continue; const c = checkStep(s.op, "key" in s.op ? current.get(s.op.key) : undefined); s.status = c.status; s.message = c.theirs; }
  steps.forEach((s, i) => { if (reasons[i]) s.reason = reasons[i]; });
  const before = steps.map(s => `${s.status}: ${s.label}${s.message ? ` (${s.message})` : ""}`);
  return { ...(await execute(client, base, steps, current, repos)), before };
}

describe.skipIf(!token || !target)("live writes on the sandbox", () => {
  it("applies one change of every kind, reads it back, then reverts it all", async () => {
    const client = createClient(token!);
    const [owner, num] = target.split("/");
    const base = await loadProject(client, owner!, Number(num));
    expect(base.title, "refusing to write to a project that isn't the sandbox").toBe("pm-hub sandbox");
    const m = detectMapping(base);
    const t = (title: string) => base.items.find(i => i.title.startsWith(title))!;
    const epicA = t("Epic A"), epicB = t("Epic B"), a1 = t("A1"), a2 = t("A2"), b1 = t("B1");
    const sprintA = { title: "Sprint A", number: 1, dueOn: null, state: "OPEN", repo: a1.repo!, id: null };

    const create = newItem(base, m, "A3: Refunds (pm-hub test)", { parentKey: epicA.key });
    const ops: Op[] = [
      datesOp(epicA, m, "2026-11-02", "2026-12-04"),
      ...setOption(base, a1, "Priority", "High"),
      ...setOption(base, a1, "Status", "In Progress"),
      ...setTitle(b1, "B1: Weekly export (CSV)"),
      ...moveToParent(base, a2, epicB.key),
      ...setLane(base, m, b1, "alpha"),
      ...setMilestone(a1, sprintA),
      ...setAssignees(a1, [owner!]),
      ...addBlocker(base, b1, a1.key),
      ...removeBlocker(a2, a1.key),
      ...setState(a1, "closed", "NOT_PLANNED"),
      ...create,
    ];
    expect(new Set(ops.map(o => o.kind)).size, "every kind of change").toBe(11);

    const res = await run(client, base, ops, { 0: "sandbox test: checking the reason comment" });
    console.log("preflight:", res.before);
    console.log("apply:", res.steps.map(s => `${s.status}: ${s.label}${s.message ? ` (${s.message})` : ""}`));
    expect(res.steps.filter(s => s.status !== "applied").map(s => `${s.label}: ${s.message}`)).toEqual([]);

    // Read it back from GitHub.
    const after = await loadProject(client, owner!, Number(num));
    const g = (key: string) => after.items.find(i => i.key === key)!;
    expect(g(epicA.key).fields["End Date"]).toMatchObject({ date: "2026-12-04" });
    expect(g(a1.key).fields["Priority"]).toMatchObject({ name: "High" });
    expect(g(a1.key)).toMatchObject({ state: "closed", stateReason: "NOT_PLANNED", assignees: [owner] });
    expect(g(a1.key).milestone?.title).toBe("Sprint A");
    expect(g(b1.key).title).toBe("B1: Weekly export (CSV)");
    expect(laneOf(g(b1.key), m)).toBe("alpha");
    expect(g(b1.key).blockedBy.map(b => b.key)).toContain(a1.key);
    expect(g(a2.key).parentKey).toBe(epicB.key);
    expect(g(a2.key).blockedBy.map(b => b.key)).not.toContain(a1.key);
    const created = [...res.created.values()][0]!;
    const createdKey = `${a1.repo}#${created.number}`;
    expect(g(createdKey)).toMatchObject({ title: "A3: Refunds (pm-hub test)", parentKey: epicA.key });

    // Revert: inverse ops against the new state, newest first, created item mapped to its real key.
    const keyMap = new Map([[(create[0] as Extract<Op, { kind: "create" }>).key, createdKey]]);
    const revertOps = res.steps.filter(s => s.status === "applied").map(s => remapKeys(inverse(s.op), keyMap)).reverse();
    console.log("revert:", revertOps.map(o => describeOp(o, k => after.items.find(i => i.key === k)?.title ?? k)));
    const rev = await run(client, after, revertOps);
    // GitHub's built-in project workflow sets Status to Done when an issue closes, after our
    // write. The pre-apply check sees that and flags the Status revert as a conflict instead
    // of overwriting it blindly, which is the behaviour we want.
    const notApplied = rev.steps.filter(s => s.status !== "applied");
    expect(notApplied.every(s => s.status === "conflict" && s.op.kind === "setField" && s.op.field === "Status"), notApplied.map(s => `${s.label}: ${s.message}`).join("; ")).toBe(true);

    const back = await loadProject(client, owner!, Number(num));
    const b = (key: string) => back.items.find(i => i.key === key);
    expect(b(a1.key)).toMatchObject({ state: "open", assignees: a1.assignees, title: a1.title });
    expect(b(a1.key)!.fields["Priority"]?.kind === "single" ? (b(a1.key)!.fields["Priority"] as { name: string }).name : null).toBe(a1.fields["Priority"]?.kind === "single" ? (a1.fields["Priority"] as { name: string }).name : null);
    expect(b(b1.key)!.title).toBe(b1.title);
    expect(laneOf(b(b1.key)!, m)).toBe(laneOf(b1, m));
    expect(b(a2.key)!.parentKey).toBe(epicA.key);
    expect(b(a2.key)!.blockedBy.map(x => x.key)).toContain(a1.key);
    expect(b(b1.key)!.blockedBy.map(x => x.key)).not.toContain(a1.key);
    expect(b(epicA.key)!.fields["End Date"] ?? null).toEqual(epicA.fields["End Date"] ?? null);
    expect(b(createdKey), "created test item removed from the project").toBeUndefined();
    console.log("rate limit left:", client.state.rateLimit?.remaining);
  }, 300_000);
});
