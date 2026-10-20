import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitHubClient } from "../github/client";
import { VIEWER_LOGIN } from "../github/queries";
import type { Baseline } from "../model/diff";
import {
  historyStore, readHistoryConfig, writeHistoryConfig, type BaselineMeta, type ChangeRecord, type HistoryConfig, type QuestRecord,
} from "../store/history";
import type { Proposal } from "../model/proposal";

export interface HistoryState {
  config: HistoryConfig;
  setConfig: (c: HistoryConfig) => void;
  baselines: BaselineMeta[];
  changes: ChangeRecord[];
  quests: QuestRecord[];
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  author: string | null;
  reload: () => void;
  saveBaseline: (b: Baseline) => Promise<void>;
  readBaseline: (id: string) => Promise<Baseline>;
  saveChange: (c: ChangeRecord) => Promise<void>;
  saveQuest: (q: QuestRecord) => Promise<void>;
  saveProposal: (p: Proposal) => Promise<void>;
}

export function useHistory(owner: string, number: number, client: GitHubClient | null): HistoryState {
  const [config, setConfigState] = useState<HistoryConfig>({ mode: "local" });
  const [baselines, setBaselines] = useState<BaselineMeta[]>([]);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [quests, setQuests] = useState<QuestRecord[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const store = useMemo(() => historyStore(config, owner, number, client), [config, owner, number, client]);

  useEffect(() => { void readHistoryConfig(owner, number).then(setConfigState); }, [owner, number]);
  useEffect(() => { if (client) client.query<{ viewer: { login: string } }>(VIEWER_LOGIN).then(d => setAuthor(d.viewer.login), () => {}); }, [client]);

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([store.listBaselines(), store.listChanges(30), store.listQuests(), store.listProposals()])
      .then(([b, c, q, p]) => { setBaselines(b); setChanges(c); setQuests(q); setProposals(p); })
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't read the plan history."))
      .finally(() => setLoading(false));
  }, [store]);
  useEffect(reload, [reload]);

  return {
    config, baselines, changes, quests, proposals, loading, error, author, reload,
    setConfig: c => { setConfigState(c); void writeHistoryConfig(owner, number, c); },
    saveBaseline: async b => { await store.saveBaseline(b); reload(); },
    readBaseline: id => store.readBaseline(id),
    saveChange: async c => { await store.saveChange(c); reload(); },
    saveQuest: async q => { await store.saveQuests(q); reload(); },
    saveProposal: async p => { await store.saveProposal(p); reload(); },
  };
}
