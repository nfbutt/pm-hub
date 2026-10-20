// Asking a model on this computer what it can see in the plan: which items really block
// each other, and which epics should ship together. Everything it says is checked
// against the plan before it is shown, and nothing is applied without a click.
import { useEffect, useMemo, useState } from "react";
import {
  chatJson, checkLinks as checkLinkAnswer, checkReleases as checkReleaseAnswer,
  promptDependencies, promptReleases, SYSTEM_DEPENDENCIES, SYSTEM_RELEASES,
  type LocalSettings, type ProposedLink,
} from "../ai/local";
import { analyze } from "../model/epicmap";
import type { Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import type { Plan } from "../model/plan/cpm";
import { checkLinks, checkReleases, groupByTheme, type CandidatePair, type LinkSuggestion, type ReleaseSuggestion } from "../model/plan/infer";
import { readChat, writeChat } from "../store/epicmap";

export type PlanStatus = "off" | "working" | "on" | "unreachable";

export interface PlanSuggestions {
  links: LinkSuggestion[];
  releases: ReleaseSuggestion[];
  status: PlanStatus;
  /** How many proposals were thrown out by the checks, and why. */
  dropped: number;
}

/** How many pairs are put to the model. Enough to be useful, few enough to stay small. */
const MAX_PAIRS = 40;
/** How much of an item's text the model is shown. */
const TEXT_LIMIT = 240;

/**
 * The pairs worth asking about: the items that look most alike, which is where real
 * dependencies turn up ("the API this needs" and "build the API").
 */
export function candidatePairs(project: Project, mapping: Mapping): CandidatePair[] {
  const model = analyze(project, mapping, { openOnly: false });
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];
  for (const e of [...model.edges].sort((a, b) => b.w - a.w)) {
    if (pairs.length >= MAX_PAIRS) break;
    const a = model.tasks[e.a], b = model.tasks[e.b];
    if (!a || !b) continue;
    const key = [a.key, b.key].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const ia = byKey.get(a.key), ib = byKey.get(b.key);
    pairs.push({
      a: a.key, b: b.key, aTitle: a.title, bTitle: b.title,
      similarity: e.w,
      shared: ia && ib ? sharedWords(ia.title, ib.title) : [],
    });
  }
  return pairs;
}

/** The words two titles have in common, for a hint about why they were paired. */
function sharedWords(a: string, b: string): string[] {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  const wa = words(a), wb = words(b);
  const out: string[] = [];
  for (const w of wa) if (wb.has(w) && !out.includes(w)) out.push(w);
  return out.slice(0, 4);
}

/**
 * Asks the model about the plan, checks everything it says, and hands back only what
 * passes. Nothing is written: the caller decides what to accept.
 */
export function usePlanSuggestions(project: Project, mapping: Mapping, plan: Plan, settings: LocalSettings): PlanSuggestions {
  const [links, setLinks] = useState<LinkSuggestion[]>([]);
  const [releases, setReleases] = useState<ReleaseSuggestion[]>([]);
  const [status, setStatus] = useState<PlanStatus>("off");
  const [dropped, setDropped] = useState(0);

  const pairs = useMemo(() => candidatePairs(project, mapping), [project, mapping]);
  const byKey = useMemo(() => new Map(project.items.map(i => [i.key, i])), [project]);

  // What is put to the model: the pairs, with enough text to quote from.
  const linkPrompt = useMemo(() => promptDependencies(pairs.map(p => {
    const a = byKey.get(p.a), b = byKey.get(p.b);
    const text = (item: Item | undefined) => item ? `${item.title}: ${(item.body ?? "").slice(0, TEXT_LIMIT)}` : "";
    return { a: p.a, b: p.b, aTitle: text(a), bTitle: text(b), shared: p.shared };
  })), [pairs, byKey]);

  const releasePrompt = useMemo(() => {
    const epics = plan.epics.size
      ? [...plan.epics.values()].map(e => ({ key: e.key, title: e.title, release: e.release }))
      : [];
    const names = [...new Set([...plan.epics.values()].map(e => e.release).filter((r): r is string => !!r))];
    return promptReleases(epics, names);
  }, [plan]);

  const signature = useMemo(() => JSON.stringify([
    settings.enabled, settings.chatModel, settings.base, linkPrompt, releasePrompt,
  ]), [settings, linkPrompt, releasePrompt]);

  useEffect(() => {
    if (!settings.enabled || !pairs.length) { setStatus("off"); return; }
    let dead = false;
    (async () => {
      setStatus("working");
      let got = 0;

      // An answer from before is as good as a fresh one.
      const cachedLinks = await readChat<{ links: ProposedLink[] }>(linkPrompt);
      const linkAnswer = cachedLinks ?? await chatJson(settings, SYSTEM_DEPENDENCIES, linkPrompt, checkLinkAnswer);
      const checkedLinks = linkAnswer ? checkLinks(project, mapping, plan, linkAnswer.links) : { accepted: [], dropped: [] };
      if (linkAnswer && !cachedLinks) { got++; void writeChat(linkPrompt, linkAnswer); }

      const cachedReleases = await readChat<{ themes: { key: string; theme: string }[] }>(releasePrompt);
      // The model labels each piece of work; pm-hub does the grouping. Asking a model to
      // group things itself means the same project comes out grouped differently every
      // time, and a roadmap that churns is worse than no roadmap.
      const releaseAnswer = cachedReleases ?? await chatJson(settings, SYSTEM_RELEASES, releasePrompt, checkReleaseAnswer);
      // An answer cached before the shape changed is not an answer any more.
      const themes = releaseAnswer && Array.isArray(releaseAnswer.themes) ? releaseAnswer.themes : null;
      const checkedReleases = themes ? checkReleases(project, mapping, groupByTheme(themes)) : { accepted: [], dropped: [] };
      if (releaseAnswer && !cachedReleases) { got++; void writeChat(releasePrompt, releaseAnswer); }

      if (dead) return;
      setLinks(checkedLinks.accepted);
      setReleases(checkedReleases.accepted);
      setDropped(checkedLinks.dropped.length + checkedReleases.dropped.length);
      setStatus(got > 0 || cachedLinks || cachedReleases ? "on" : "unreachable");
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { links, releases, status, dropped };
}
