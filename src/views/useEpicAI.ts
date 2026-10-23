// Asking a model about epics: which wait for which, which release each belongs in, and why
// two of them overlap. Each question is asked when the person asks it — a model on this
// computer can take minutes — and an answer from before is shown straight away. Every
// answer is checked against the plan before anything is shown.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  briefOf, checkEpicLinkAnswer, checkPlacementAnswer, promptEpicLinks, promptPlacement,
  SYSTEM_EPIC_LINKS, SYSTEM_PLACEMENT,
} from "../ai/epics";
import { chatJson, checkOverlapWhy, promptOverlapWhy, SYSTEM_OVERLAP, type LocalSettings } from "../ai/local";
import { checkEpicLinks, type EpicGraph, type EpicLinkHint, type ProposedEpicLink } from "../model/epiclinks";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Plan } from "../model/plan/cpm";
import { checkPlacements, fittingReleases, listReleases, workOf, type PlacementSuggestion, type ProposedPlacement, type ReleaseBoard } from "../model/releases";
import { readChat, writeChat } from "../store/epicmap";

/** `nothing`: the model is on, but there is no question worth asking it. */
export type AskStatus = "off" | "nothing" | "idle" | "working" | "done" | "failed";

export interface Asked<T> {
  items: T[];
  status: AskStatus;
  /** How many proposals the checks threw out. */
  dropped: number;
  /** Why they were thrown out: each reason once, most common first. */
  reasons: string[];
  /** What went wrong, in the server's words when it said. */
  error: string | null;
  /** True when what is shown is an answer from before. */
  cached: boolean;
  ask: () => void;
}

/**
 * What an answer is remembered by: the question and the model that answered it, so a
 * better model is never shown a smaller one's answer.
 */
const cacheKey = (settings: LocalSettings, prompt: string) => `${settings.base}|${settings.chatModel}
${prompt}`;

/** Runs one question: the cached answer first, then the model when asked. */
function useAsk<A, T>(settings: LocalSettings, system: string, prompt: string | null, shape: (v: unknown) => v is A, accept: (answer: A) => { items: T[]; dropped: string[] }): Asked<T> {
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<AskStatus>(settings.enabled ? "idle" : "off");
  const [dropped, setDropped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  const show = useCallback((answer: A, fromCache: boolean) => {
    const r = accept(answer);
    setItems(r.items); setDropped(r.dropped); setCached(fromCache); setStatus("done");
  }, [accept]);

  // What was answered before, for this exact question.
  useEffect(() => {
    if (!settings.enabled || !prompt) { setStatus(settings.enabled ? "nothing" : "off"); setItems([]); return; }
    let dead = false;
    setStatus("idle"); setError(null);
    void readChat<A>(cacheKey(settings, prompt)).then(hit => { if (!dead && hit && shape(hit)) show(hit, true); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, settings.base, settings.chatModel, prompt]);

  const ask = useCallback(() => {
    if (!settings.enabled || !prompt) return;
    setStatus("working"); setError(null);
    chatJson(settings, system, prompt, shape)
      .then(answer => {
        if (!answer) { setStatus("failed"); setError("The model did not give an answer pm-hub could read."); return; }
        void writeChat(cacheKey(settings, prompt), answer);
        show(answer, false);
      })
      .catch(e => { setStatus("failed"); setError(e instanceof Error ? e.message : "The model did not answer."); });
  }, [settings, system, prompt, shape, show]);

  const reasons = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of dropped) tally.set(r, (tally.get(r) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => (n > 1 ? `${r} (${n})` : r));
  }, [dropped]);
  return { items, status, dropped: dropped.length, reasons, error, cached, ask };
}

/** Which epics wait for which, according to a model, checked against the plan. */
export function useEpicLinkAI(project: Project, mapping: Mapping, plan: Plan, graph: EpicGraph, settings: LocalSettings): Asked<EpicLinkHint> {
  const prompt = useMemo(() => {
    if (graph.nodes.length < 2) return null;
    const byKey = new Map(project.items.map(i => [i.key, i]));
    const briefs = graph.nodes.map(n => {
      const e = byKey.get(n.key)!;
      return briefOf(e, workOf(project, mapping, e, byKey).filter(w => w.state === "open"));
    });
    return promptEpicLinks(briefs, graph.edges.map(e => ({ from: e.from, to: e.to })));
  }, [project, mapping, graph]);
  const accept = useCallback((a: { links: ProposedEpicLink[] }) => {
    const r = checkEpicLinks(project, mapping, plan, graph, a.links);
    return { items: r.accepted, dropped: r.dropped.map(d => d.reason) };
  }, [project, mapping, plan, graph]);
  return useAsk(settings, SYSTEM_EPIC_LINKS, prompt, checkEpicLinkAnswer, accept);
}

/** Where a model would put the epics that have no release, or the wrong one, checked against the dependencies. */
export function usePlacementAI(project: Project, mapping: Mapping, plan: Plan, board: ReleaseBoard, settings: LocalSettings, today: string): Asked<PlacementSuggestion> {
  const prompt = useMemo(() => {
    const releases = listReleases(project, mapping).filter(r => !r.closed);
    if (!releases.length) return null;
    const byKey = new Map(project.items.map(i => [i.key, i]));
    const epics = board.columns.flatMap(c => c.epics.filter(e => e.open).map(e => ({
      key: e.key, title: e.title, release: c.release?.title ?? null, finishes: e.end,
      waitsFor: plan.links.filter(l => l.to === e.key).map(l => l.from),
      problem: !c.release ? "it is in no release"
        : e.late ? `it finishes ${e.end}, after ${c.release.title} is due (${c.release.due})`
        : e.waitsFor.length ? `it waits for ${e.waitsFor.map(w => w.title).join(", ")}, which ships later`
        : null,
      options: fittingReleases(project, mapping, plan, byKey.get(e.key)!).filter(r => r.title !== c.release?.title).map(r => r.title),
    })));
    // A choice is only a choice with two options: one is a fix on the board, none needs a new release.
    const ask = epics.map(e => (e.problem && e.options.length < 2 ? { ...e, problem: null } : e));
    if (!ask.some(e => e.problem)) return null;
    return promptPlacement({ releases: releases.map(r => ({ title: r.title, due: r.due })), epics: ask, today });
  }, [project, mapping, plan, board, today]);
  const accept = useCallback((a: { placements: ProposedPlacement[] }) => {
    const r = checkPlacements(project, mapping, plan, a.placements);
    return { items: r.accepted, dropped: r.dropped.map(d => d.reason) };
  }, [project, mapping, plan]);
  return useAsk(settings, SYSTEM_PLACEMENT, prompt, checkPlacementAnswer, accept);
}

/** One sentence on why two epics overlap, asked for when a pair is opened. */
export function useOverlapWhy(project: Project, mapping: Mapping, settings: LocalSettings) {
  const [answers, setAnswers] = useState<Map<string, string | null>>(new Map());
  const [working, setWorking] = useState<string | null>(null);
  const explain = useCallback(async (a: string, b: string, shared: string[]) => {
    const id = `${a}|${b}`;
    if (!settings.enabled || answers.has(id)) return;
    const byKey = new Map(project.items.map(i => [i.key, i]));
    const ea = byKey.get(a), eb = byKey.get(b);
    if (!ea || !eb) return;
    const titles = (e: typeof ea) => workOf(project, mapping, e, byKey).filter(w => w.state === "open").map(w => w.title);
    const prompt = promptOverlapWhy(ea.title, eb.title, shared, titles(ea), titles(eb));
    setWorking(id);
    let text: string | null = null;
    try {
      const hit = await readChat<{ explanation: string }>(cacheKey(settings, prompt));
      const answer = hit && checkOverlapWhy(hit) ? hit : await chatJson(settings, SYSTEM_OVERLAP, prompt, checkOverlapWhy);
      if (answer) { text = answer.explanation; void writeChat(cacheKey(settings, prompt), answer); }
    } catch { /* the overlap is still shown, with its shared words */ }
    setAnswers(m => new Map(m).set(id, text));
    setWorking(null);
  }, [project, mapping, settings, answers]);
  return { answers, working, explain };
}
