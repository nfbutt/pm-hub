import { isEpic, releaseOf, type Mapping } from "./mapping";
import type { Item, Project } from "./normalize";
import type { Row, Schedule } from "./schedule";

const COLUMNS = ["key", "title", "lane", "order", "start", "end", "source", "moved", "state", "url"] as const;

export function rowsToCsv(groups: { lane: string; rows: Row[] }[]): string {
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [COLUMNS.join(",")];
  for (const g of groups) g.rows.filter(r => r.depth === 0).forEach((r, i) => {
    lines.push([r.item.key, r.item.title, g.lane, i + 1, r.bar?.start ?? "", r.bar?.end ?? "", r.bar?.source ?? "", r.moved ? "yes" : "no", r.item.state, r.item.url ?? ""].map(q).join(","));
  });
  return lines.join("\n");
}

/**
 * The whole plan as CSV: every epic and every story, with what blocks what and which
 * release it is in. This is the export to take somewhere else; the Gantt's own export is
 * the arrangement of the chart.
 */
export function planToCsv(project: Project, mapping: Mapping, schedule: Schedule): string {
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ["key,type,title,epic,start,end,release,state,blocked by,url"];
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const epicOf = (i: Item): Item | null => {
    const seen = new Set<string>();
    for (let k = i.parentKey; k && !seen.has(k); k = byKey.get(k)?.parentKey ?? null) {
      const p = byKey.get(k);
      if (p && isEpic(p, mapping)) return p;
      seen.add(k);
    }
    return null;
  };
  for (const i of project.items) {
    if (i.kind !== "issue" && i.kind !== "draft") continue;
    const bar = schedule.bars.get(i.key);
    const epic = epicOf(i);
    lines.push([
      i.key, isEpic(i, mapping) ? "epic" : "story", i.title, epic?.title ?? "",
      bar?.start ?? "", bar?.end ?? "", releaseOf(i, mapping)?.title ?? "", i.state,
      i.blockedBy.map(b => b.key).join(" "), i.url ?? "",
    ].map(q).join(","));
  }
  return lines.join("\n");
}

/** The whole plan as Markdown, for pasting into a document. */
export function planToMarkdown(project: Project, mapping: Mapping, schedule: Schedule): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const out = ["| Item | Type | Epic | Start | End | Release | Blocked by |", "|---|---|---|---|---|---|---|"];
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const epicOf = (i: Item): Item | null => {
    const seen = new Set<string>();
    for (let k = i.parentKey; k && !seen.has(k); k = byKey.get(k)?.parentKey ?? null) {
      const p = byKey.get(k);
      if (p && isEpic(p, mapping)) return p;
      seen.add(k);
    }
    return null;
  };
  for (const i of project.items) {
    if (i.kind !== "issue" && i.kind !== "draft") continue;
    const bar = schedule.bars.get(i.key);
    const title = i.url ? `[${esc(i.title)}](${i.url})` : esc(i.title);
    out.push(`| ${title} | ${isEpic(i, mapping) ? "epic" : "story"} | ${esc(epicOf(i)?.title ?? "")} | ${bar?.start ?? "—"} | ${bar?.end ?? "—"} | ${esc(releaseOf(i, mapping)?.title ?? "")} | ${i.blockedBy.map(b => esc(b.key)).join(", ")} |`);
  }
  return out.join("\n");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

export function rowsToMarkdown(groups: { lane: string; rows: Row[] }[]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const out = ["| Epic | Lane | Start | End | Notes |", "|---|---|---|---|---|"];
  for (const g of groups) for (const r of g.rows.filter(r => r.depth === 0)) {
    const title = r.item.url ? `[${esc(r.item.title)}](${r.item.url})` : esc(r.item.title);
    out.push(`| ${title} | ${esc(g.lane)} | ${r.bar?.start ?? "—"} | ${r.bar?.end ?? "—"} | ${r.moved ? "moved in draft" : ""} |`);
  }
  return out.join("\n");
}
