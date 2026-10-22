// Asking a model on the user's own machine to help with the Epic Map: embeddings for the
// items, a name for each epic's mix of work, a sentence about each overlap, and ideas for
// epics that are missing. Everything is optional: when the model is off, unreachable or
// slow, pm-hub carries on with its own analysis.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  chatJson, checkCategoryMix, checkGapIdeas, checkOverlapWhy, embed,
  promptCategoryMix, promptGapIdeas, promptOverlapWhy,
  SYSTEM_CATEGORY_MIX, SYSTEM_GAP_IDEAS, SYSTEM_OVERLAP,
  type GapIdea, type LocalSettings,
} from "../ai/local";
import type { EpicMapModel } from "../model/epicmap";
import { categoryName } from "../model/epicmap/categories";
import type { Item, Project } from "../model/normalize";
import { readChat, readVector, writeChat, writeVector } from "../store/epicmap";

export type LocalStatus = "off" | "working" | "on" | "unreachable";

export interface LocalVectors {
  /** One embedding per item, keyed by item key. Empty when the model is off. */
  vectors: Map<string, number[]>;
  status: LocalStatus;
}

/** What the model is given to work with: the title, and the body when there is one. */
const embedText = (i: Item) => `${i.title}\n${i.body ?? ""}`.trim();

/** Embeddings for every item in the project, from the cache where possible. */
export function useLocalVectors(project: Project, settings: LocalSettings): LocalVectors {
  const [vectors, setVectors] = useState<Map<string, number[]>>(new Map());
  const [status, setStatus] = useState<LocalStatus>("off");

  const items = useMemo(() => project.items.filter(i => i.kind === "issue" || i.kind === "draft"), [project]);
  // What the vectors are for. The effect runs when this changes, not every time the
  // plan is edited: reading the cache for every item is not free.
  const signature = useMemo(() => items.map(i => `${i.key}\u0000${embedText(i)}`).join("\u0001"), [items]);
  const latest = useRef({ items, settings });
  latest.current = { items, settings };

  useEffect(() => {
    if (!settings.enabled) { setVectors(new Map()); setStatus("off"); return; }
    let dead = false;
    (async () => {
      setStatus("working");
      const list = latest.current.items;
      const found = new Map<string, number[]>();
      const missing: { item: Item; text: string }[] = [];
      for (const item of list) {
        const text = embedText(item);
        const hit = await readVector(text);
        if (hit) found.set(item.key, hit);
        else missing.push({ item, text });
      }
      if (dead) return;
      if (missing.length) {
        const got = await embed(settings, missing.map(m => m.text));
        if (dead) return;
        if (got) {
          missing.forEach((m, i) => { found.set(m.item.key, got[i]!); void writeVector(m.text, got[i]!); });
          setStatus("on");
        } else {
          setStatus("unreachable");
        }
      } else {
        setStatus("on");
      }
      setVectors(found);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, settings.enabled, settings.base, settings.embedModel]);

  return { vectors, status };
}

export interface LocalChat {
  /** What the model calls an epic's mix of work, by epic key. */
  mixes: Map<string, string>;
  /** Why two epics overlap, by "a|b". */
  whys: Map<string, string>;
  /** Epics the model thinks are missing. */
  ideas: GapIdea[];
  status: LocalStatus;
}

/**
 * What the model says about the map: a name for each epic's mix, a sentence for each
 * overlap, and ideas for the epics that are missing. Answers are kept, so the model is
 * only asked once for the same question.
 */
export function useLocalChat(project: Project, model: EpicMapModel, settings: LocalSettings): LocalChat {
  const [mixes, setMixes] = useState<Map<string, string>>(new Map());
  const [whys, setWhys] = useState<Map<string, string>>(new Map());
  const [ideas, setIdeas] = useState<GapIdea[]>([]);
  const [status, setStatus] = useState<LocalStatus>("off");

  const byKey = useMemo(() => new Map(project.items.map(i => [i.key, i])), [project]);
  // The questions to ask, and the answers to look for. A string, so the effect only runs
  // again when the map itself has really changed.
  const questions = useMemo(() => {
    const epicTitles = model.epics.map(e => e.title);
    const histogram = model.categories.map(c => [categoryName(c.id), c.tasks] as [string, number]);
    const loose = model.tasks.filter(t => !t.epicKey).map(t => t.title);
    const mixPrompts = model.epics.map(e => ({
      key: e.key,
      prompt: promptCategoryMix(e.title, e.taskKeys.map(k => byKey.get(k)?.title ?? k), [...e.mix].map(([k, v]) => [categoryName(k), Math.round(v * 100)])),
    }));
    const overlapPrompts = model.overlaps.slice(0, 6).map(o => ({
      key: `${o.a}|${o.b}`,
      prompt: promptOverlapWhy(
        byKey.get(o.a)?.title ?? o.a, byKey.get(o.b)?.title ?? o.b, o.shared,
        model.tasks.filter(t => t.epicKey === o.a).map(t => t.title),
        model.tasks.filter(t => t.epicKey === o.b).map(t => t.title),
      ),
    }));
    const gapPrompt = promptGapIdeas(epicTitles, histogram, loose);
    return { mixPrompts, overlapPrompts, gapPrompt };
  }, [model, byKey]);

  const signature = useMemo(() => JSON.stringify([
    settings.enabled, settings.chatModel, settings.base,
    questions.mixPrompts.map(p => p.prompt), questions.overlapPrompts.map(p => p.prompt), questions.gapPrompt,
  ]), [settings, questions]);

  useEffect(() => {
    if (!settings.enabled) { setMixes(new Map()); setWhys(new Map()); setIdeas([]); setStatus("off"); return; }
    let dead = false;
    (async () => {
      setStatus("working");
      const mixAnswers = new Map<string, string>();
      const whyAnswers = new Map<string, string>();
      let gapAnswers: GapIdea[] = [];
      let got = 0;

      // An answer from before is as good as a fresh one: the model is only asked once.
      const ask = async (system: string, prompt: string): Promise<unknown | null> => {
        const cached = await readChat<unknown>(prompt);
        if (cached) { got++; return cached; }
        try {
          const answer = await chatJson(settings, system, prompt, (v): v is unknown => typeof v === "object" && v !== null);
          if (answer) { got++; void writeChat(prompt, answer); }
          return answer;
        } catch {
          // The model said why: a wrong key, an unknown model. Remember it as "no".
          return null;
        }
      };

      await Promise.all(questions.mixPrompts.map(async p => {
        const answer = await ask(SYSTEM_CATEGORY_MIX, p.prompt) as { name?: string } | null;
        if (answer && checkCategoryMix(answer)) mixAnswers.set(p.key, answer.name);
      }));
      await Promise.all(questions.overlapPrompts.map(async p => {
        const answer = await ask(SYSTEM_OVERLAP, p.prompt) as { explanation?: string } | null;
        if (answer && checkOverlapWhy(answer)) whyAnswers.set(p.key, answer.explanation);
      }));
      const gapAnswer = await chatJson(settings, SYSTEM_GAP_IDEAS, questions.gapPrompt, checkGapIdeas).catch(() => null);
      if (gapAnswer && checkGapIdeas(gapAnswer)) {
        gapAnswers = gapAnswer.ideas.slice(0, 3);
        got++;
        void writeChat(questions.gapPrompt, gapAnswer);
      }
      if (dead) return;
      setMixes(mixAnswers);
      setWhys(whyAnswers);
      setIdeas(gapAnswers);
      setStatus(got > 0 ? "on" : "unreachable");
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { mixes, whys, ideas, status };
}
