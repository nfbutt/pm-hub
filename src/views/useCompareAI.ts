// Asking a model to compare two epics, and keeping only what can be checked. A claim the
// reader cannot verify — because the words it came from are not really in the stories —
// is dropped rather than shown.
import { useEffect, useState } from "react";
import { compareEpicsWithModel, type ComparisonAnswer, type EpicSummary } from "../ai/compare";
import type { LocalSettings } from "../ai/local";
import type { Item, Project } from "../model/normalize";
import { evidenceFound } from "../model/plan/infer";
import { storiesOf } from "../model/plan/compare";

export type CompareStatus = "off" | "working" | "on" | "unreachable";

export interface CompareAnswer {
  answer: ComparisonAnswer;
  /** How many claims were dropped because they could not be checked. */
  dropped: number;
}

/** What the model is shown: the epic and its stories, with a little of each body. */
export function summarise(epic: Item, project: Project): EpicSummary {
  return {
    title: epic.title,
    stories: storiesOf(project, epic).slice(0, 25).map(s => ({
      title: s.title,
      body: (s.body ?? "").slice(0, 140).replace(/\s+/g, " ").trim(),
    })),
  };
}

export function useCompareAI(
  project: Project, a: Item | null, b: Item | null, settings: LocalSettings,
): { answer: CompareAnswer | null; status: CompareStatus } {
  const [answer, setAnswer] = useState<CompareAnswer | null>(null);
  const [status, setStatus] = useState<CompareStatus>("off");

  useEffect(() => {
    if (!settings.enabled || !a || !b || a.key === b.key) { setAnswer(null); setStatus("off"); return; }
    let dead = false;
    setStatus("working");
    setAnswer(null);
    (async () => {
      const sa = summarise(a, project);
      const sb = summarise(b, project);
      // A claim has to be checkable against the words in the two epics.
      const sources = [a, b, ...storiesOf(project, a), ...storiesOf(project, b)];
      const found = (evidence: string) => sources.some(s => evidenceFound(evidence, s));
      const got = await compareEpicsWithModel(settings, sa, sb, found).catch(() => null);
      if (dead) return;
      if (!got) { setStatus("unreachable"); return; }
      const claims = got.common.length + got.different.length;
      const kept = got.common.length + got.different.length;
      setAnswer({ answer: got, dropped: Math.max(0, claims - kept) });
      setStatus("on");
    })();
    return () => { dead = true; };
  }, [project, a, b, settings]);

  return { answer, status };
}
