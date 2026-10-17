import type { Row } from "./schedule";

const COLUMNS = ["key", "title", "lane", "order", "start", "end", "source", "moved", "state", "url"] as const;

export function rowsToCsv(groups: { lane: string; rows: Row[] }[]): string {
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [COLUMNS.join(",")];
  for (const g of groups) g.rows.filter(r => r.depth === 0).forEach((r, i) => {
    lines.push([r.item.key, r.item.title, g.lane, i + 1, r.bar?.start ?? "", r.bar?.end ?? "", r.bar?.source ?? "", r.moved ? "yes" : "no", r.item.state, r.item.url ?? ""].map(q).join(","));
  });
  return lines.join("\n");
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
