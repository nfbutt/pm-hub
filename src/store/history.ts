// Where plan history lives: in this browser (default) or as files in a GitHub repo, shared
// with everyone who uses pm-hub on the project. One file per event, never edited.
import type { GitHubClient } from "../github/client";
import { createJson, exists, createFile, listDir, readJson } from "../github/contents";
import type { Baseline } from "../model/diff";
import type { Op } from "../model/ops";
import { get as idbGet, set as idbSet } from "idb-keyval";

export type HistoryConfig = { mode: "local" } | { mode: "github"; repo: string; dir: string };

export interface ChangeRecord {
  version: 1; at: string; author: string | null; scenario: string;
  steps: { label: string; status: string; message?: string; reason?: string; kind: string; key?: string }[];
  /**
   * The operations that were applied, so the change can be rolled back days later. Older
   * records do not have them and cannot be rolled back.
   */
  ops?: Op[];
  /** Draft key -> the GitHub key, for the items this change created. */
  keys?: Record<string, string>;
  /** Item key -> the ids GitHub uses, so an archived item can still be addressed. */
  ids?: Record<string, { item: string; content: string }>;
}

export interface BaselineMeta { id: string; name: string; savedAt: string; auto: boolean }

/** Quests the team has finished, kept with the rest of the plan history. */
export interface QuestRecord {
  version: 1; at: string; author: string | null;
  quests: { id: string; name: string }[];
}

export interface HistoryStore {
  config: HistoryConfig;
  listBaselines(): Promise<BaselineMeta[]>;
  readBaseline(id: string): Promise<Baseline>;
  saveBaseline(b: Baseline): Promise<void>;
  listChanges(limit?: number): Promise<ChangeRecord[]>;
  saveChange(c: ChangeRecord): Promise<void>;
  listQuests(): Promise<QuestRecord[]>;
  saveQuests(q: QuestRecord): Promise<void>;
}

export const defaultDir = (owner: string, number: number) => `.pm-hub/${owner}-${number}`;
const stamp = (iso: string) => iso.replace(/[:.]/g, "-");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "baseline";
const timed = <T>(p: Promise<T>, fallback: T) => Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), 3000))]).catch(() => fallback);

// ---------------------------------------------------------------- config

const cfgKey = (o: string, n: number) => `histcfg:${o}/${n}`;
export const readHistoryConfig = async (o: string, n: number): Promise<HistoryConfig> =>
  (await timed(idbGet<HistoryConfig>(cfgKey(o, n)), undefined)) ?? { mode: "local" };
export const writeHistoryConfig = (o: string, n: number, c: HistoryConfig) => timed(idbSet(cfgKey(o, n), c), undefined);

// ---------------------------------------------------------------- local

interface LocalData { baselines: Baseline[]; changes: ChangeRecord[]; quests: QuestRecord[] }
export function localHistory(owner: string, number: number): HistoryStore {
  const key = `history:${owner}/${number}`;
  const read = async (): Promise<LocalData> => (await timed(idbGet<LocalData>(key), undefined)) ?? { baselines: [], changes: [], quests: [] };
  const write = (d: LocalData) => timed(idbSet(key, d), undefined);
  return {
    config: { mode: "local" },
    listBaselines: async () => (await read()).baselines.map(b => ({ id: b.savedAt, name: b.name, savedAt: b.savedAt, auto: b.auto })).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    readBaseline: async id => { const b = (await read()).baselines.find(x => x.savedAt === id); if (!b) throw new Error("That baseline is gone."); return b; },
    saveBaseline: async b => { const d = await read(); d.baselines = [...d.baselines, b].slice(-40); await write(d); },
    listChanges: async (limit = 30) => (await read()).changes.slice(-limit).reverse(),
    saveChange: async c => { const d = await read(); d.changes = [...d.changes, c].slice(-200); await write(d); },
    listQuests: async () => (await read()).quests.slice(-20).reverse(),
    saveQuests: async q => { const d = await read(); d.quests = [...d.quests, q].slice(-50); await write(d); },
  };
}

// ---------------------------------------------------------------- GitHub

const README = (dir: string) => `# Plan history (pm-hub)

This folder is written by [pm-hub](https://nfbutt.github.io/pm-hub/) for the project it's named after.

- \`baselines/\`: snapshots of the plan (dates, parents, releases, lanes) to compare later plans against.
- \`changes/\`: one file per apply: what was changed on GitHub, by whom, the result of each change, and any reason given.
- \`quests/\`: one file per set of goals the team finished on the Epic Map.

Files are only ever added, never edited. Folder: \`${dir}\`.
`;

export function githubHistory(client: GitHubClient, repo: string, dir: string): HistoryStore {
  return {
    config: { mode: "github", repo, dir },
    listBaselines: async () => {
      const files = (await listDir(client, repo, `${dir}/baselines`)).filter(f => f.name.endsWith(".json"));
      return files.map(f => {
        // <iso-stamp>__<auto|manual>__<slug>.json
        const [ts, kind, name] = f.name.replace(/\.json$/, "").split("__");
        const savedAt = (ts ?? "").replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z");
        const label = (name ?? "baseline").replace(/-/g, " ");
        return { id: f.path, name: label.charAt(0).toUpperCase() + label.slice(1), savedAt, auto: kind === "auto" };
      }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    readBaseline: id => readJson<Baseline>(client, repo, id),
    saveBaseline: async b => {
      if (!(await exists(client, repo, `${dir}/README.md`))) await createFile(client, repo, `${dir}/README.md`, README(dir), "pm-hub: start plan history");
      await createJson(client, repo, `${dir}/baselines/${stamp(b.savedAt)}__${b.auto ? "auto" : "manual"}__${slug(b.name)}.json`, b, `pm-hub: baseline “${b.name}”`);
    },
    listChanges: async (limit = 30) => {
      const files = (await listDir(client, repo, `${dir}/changes`)).filter(f => f.name.endsWith(".json")).sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit);
      return Promise.all(files.map(f => readJson<ChangeRecord>(client, repo, f.path)));
    },
    saveChange: c => createJson(client, repo, `${dir}/changes/${stamp(c.at)}.json`, c, `pm-hub: applied ${c.steps.filter(s => s.status === "applied").length} change(s)`),
    listQuests: async () => {
      const files = (await listDir(client, repo, `${dir}/quests`)).filter(f => f.name.endsWith(".json")).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 20);
      return Promise.all(files.map(f => readJson<QuestRecord>(client, repo, f.path)));
    },
    saveQuests: q => createJson(client, repo, `${dir}/quests/${stamp(q.at)}.json`, q, `pm-hub: finished ${q.quests.map(x => x.name).join(", ")}`),
  };
}

export function historyStore(cfg: HistoryConfig, owner: string, number: number, client: GitHubClient | null): HistoryStore {
  return cfg.mode === "github" && client ? githubHistory(client, cfg.repo, cfg.dir) : localHistory(owner, number);
}
