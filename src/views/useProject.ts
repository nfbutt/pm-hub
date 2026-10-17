import { useCallback, useEffect, useRef, useState } from "react";
import { GitHubError, type GitHubClient } from "../github/client";
import { loadProject } from "../github/load";
import { makeFixture, DEMO_OWNER } from "../demo/fixture";
import { detectMapping, type Mapping } from "../model/mapping";
import { normalizeProject, type Project } from "../model/normalize";
import { readCachedProject, readMapping, writeCachedProject, writeMapping } from "../store/cache";

export type Source = { kind: "demo" } | { kind: "github"; client: GitHubClient; owner: string; number: number };

export interface ProjectState {
  project: Project | null;
  mapping: Mapping | null;
  loading: boolean;
  progress: { loaded: number; total: number } | null;
  error: string | null;
  refresh: () => void;
  setMapping: (m: Mapping) => void;
  resetMapping: () => void;
}

const STALE_MS = 30 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

export function demoProject(): Project {
  const f = makeFixture(today());
  return normalizeProject(DEMO_OWNER, f.meta, f.items, new Date().toISOString());
}

export function useProject(source: Source): ProjectState {
  const [project, setProject] = useState<Project | null>(null);
  const [mapping, setMappingState] = useState<Mapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const owner = source.kind === "github" ? source.owner : DEMO_OWNER;
  const number = source.kind === "github" ? source.number : 1;

  const applyProject = useCallback(async (p: Project) => {
    setProject(p);
    const saved = source.kind === "github" ? await readMapping(p.owner, p.number) : null;
    setMappingState(prev => prev ?? saved ?? detectMapping(p));
  }, [source.kind]);

  const fetchFresh = useCallback(async () => {
    if (source.kind !== "github") return;
    setLoading(true); setError(null); setProgress(null);
    try {
      const p = await loadProject(source.client, source.owner, source.number, (loaded, total) => live.current && setProgress({ loaded, total }));
      if (!live.current) return;
      await applyProject(p);
      await writeCachedProject(p);
    } catch (e) {
      if (live.current) setError(e instanceof GitHubError ? e.message : "Loading the project failed.");
    } finally {
      if (live.current) { setLoading(false); setProgress(null); }
    }
  }, [source, applyProject]);

  useEffect(() => {
    if (source.kind === "demo") { void applyProject(demoProject()); return; }
    (async () => {
      const cached = await readCachedProject(owner, number);
      if (cached && live.current) await applyProject(cached);
      if (!cached || Date.now() - Date.parse(cached.loadedAt) > STALE_MS) await fetchFresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, number, source.kind]);

  const setMapping = (m: Mapping) => {
    setMappingState(m);
    if (source.kind === "github") void writeMapping(owner, number, m);
  };
  const resetMapping = () => { if (project) setMapping(detectMapping(project)); };

  return { project, mapping, loading, progress, error, refresh: () => void fetchFresh(), setMapping, resetMapping };
}
