// Small goals for a team working through the Epic Map: clear the overlaps, give the
// work that has no epic a home, fill a gap, and lift the score. Pure.
import type { EpicMapModel } from "./index";

export interface Quest {
  id: string;
  name: string;
  /** How much is needed to finish it. */
  goal: number;
  /** How much has been done. */
  progress: number;
  done: boolean;
}

/** The quests, and what they are called. */
export const QUEST_NAMES: Record<string, string> = {
  overlaps: "Resolve 3 overlaps",
  orphans: "Adopt every orphan",
  gap: "Fill a gap",
  score: "Raise the score by 10",
};

const orphans = (tasks: { epicKey: string | null }[]) => tasks.filter(t => !t.epicKey).length;

/**
 * How the team is doing against the quests, comparing the map as it was with the map
 * as it is now.
 */
export function quests(before: EpicMapModel, now: EpicMapModel): Quest[] {
  const cleared = Math.max(0, before.overlaps.length - now.overlaps.length);
  const loose = orphans(before.tasks), stillLoose = orphans(now.tasks);
  const filled = Math.max(0, before.gaps.length - now.gaps.length);
  const lifted = before.score !== null && now.score !== null ? now.score - before.score : 0;
  return [
    { id: "overlaps", name: QUEST_NAMES.overlaps!, goal: 3, progress: Math.min(3, cleared), done: cleared >= 3 },
    { id: "orphans", name: QUEST_NAMES.orphans!, goal: Math.max(1, loose), progress: Math.min(Math.max(1, loose), Math.max(0, loose - stillLoose)), done: loose > 0 && stillLoose === 0 },
    { id: "gap", name: QUEST_NAMES.gap!, goal: 1, progress: Math.min(1, filled), done: filled >= 1 },
    { id: "score", name: QUEST_NAMES.score!, goal: 10, progress: Math.max(0, Math.min(10, lifted)), done: lifted >= 10 },
  ];
}
