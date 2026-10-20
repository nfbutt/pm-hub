// What someone means when they say it. A phrase becomes an intention, and an intention
// becomes ordinary operations — the same ones a mouse click makes, so it undoes the same
// way and is reviewed the same way.
//
// The grammar is tried first, because a model's command execution tops out around
// three-quarters success and its mistakes are missing and wrong arguments. So: parse what
// can be parsed, ask about what is missing, and never invent it.
import { parseDate } from "./dates";

/** Today, for the date expressions. Set once per session. */
let TODAY = new Date().toISOString().slice(0, 10);
/** Tells the parser which day "today" is. */
export function setToday(day: string) { TODAY = day; }

export type Intent =
  /** Move an item's dates by a number of days. */
  | { action: "shift"; target: string; days: number }
  /** Put an item's end date on a day someone named. */
  | { action: "setDate"; target: string; date: string }
  /** Put an item in a release. */
  | { action: "release"; target: string; value: string }
  /** Move an item to another swimlane. */
  | { action: "lane"; target: string; value: string }
  | { action: "close"; target: string; reason: "COMPLETED" | "NOT_PLANNED" }
  | { action: "reopen"; target: string }
  /** Make an item wait for another. */
  | { action: "block"; target: string; blocker: string }
  | { action: "unblock"; target: string; blocker: string }
  /** Fold one epic into another. */
  | { action: "merge"; target: string; into: string }
  /** Take an item out of the project. */
  | { action: "archive"; target: string }
  /** Set who owns an item. */
  | { action: "owner"; target: string; value: string }
  /** Create something. */
  | { action: "create"; title: string; under?: string; epic?: boolean }
  /** Take back the last change. */
  | { action: "undo" };

export interface ParsedCommand {
  intent: Intent;
  /** What still has to be worked out, when the phrase was not enough. */
  missing?: { slot: Slot; question: string };
  /** The phrase, for the transcript. */
  text: string;
}

/** The part of a command that can still be missing. */
export type Slot = "target" | "value" | "blocker" | "into";

/** Fills in a slot the phrase left out, so the command can be tried again. */
export function fillSlot(intent: Intent, slot: Slot, text: string): Intent {
  switch (slot) {
    case "target": return "target" in intent ? ({ ...intent, target: text } as Intent) : intent;
    case "blocker": return intent.action === "block" ? { ...intent, blocker: text } : intent;
    case "into": return intent.action === "merge" ? { ...intent, into: text } : intent;
    case "value": return intent.action === "release" ? { ...intent, value: text } : intent;
  }
}

/** The words a slot is waiting for, so the item can be looked up. */
export function slotPhrase(intent: Intent, slot: Slot): string {
  if (slot === "target") return "target" in intent ? intent.target : "";
  if (slot === "blocker") return intent.action === "block" ? intent.blocker : "";
  if (slot === "into") return intent.action === "merge" ? intent.into : "";
  return intent.action === "release" ? intent.value : "";
}

/** How long "two weeks" is, in days. */
const UNITS: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7, fortnight: 14, month: 30, months: 30 };
const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
/** The words that mean "later" and "earlier". */
const LATER = new Set(["later", "forward", "forwards", "out", "after"]);
const EARLIER = new Set(["earlier", "back", "backwards", "before"]);
/** Words that carry no meaning in a phrase. */
const FILLER = new Set(["the", "a", "an", "my", "of", "to", "on", "in", "into", "under", "and", "that", "this", "please", "it", "its", "then",
  "epic", "epics", "story", "stories", "task", "tasks", "issue", "issues"]);

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean);

/**
 * How many days a phrase is asking to move something by, and which way.
 * "two weeks later" is +14; "a week earlier" is -7.
 */
export function parseShift(phrase: string): number | null {
  const w = tokens(phrase);
  for (let i = 0; i < w.length; i++) {
    const unit = UNITS[w[i]!];
    if (!unit) continue;
    let count = 1;
    if (i > 0) {
      const before = w[i - 1]!;
      const n = Number(before);
      if (!Number.isNaN(n) && n > 0) count = n;
      else if (COUNT_WORDS[before]) count = COUNT_WORDS[before]!;
    }
    const after = w.slice(i + 1);
    const dir = after.find(x => LATER.has(x)) ? 1 : after.find(x => EARLIER.has(x)) ? -1 : 1;
    return dir * count * unit;
  }
  return null;
}

/**
 * What a phrase is asking for, parsed without a model. The actions are the ones the app
 * already knows how to make; anything else is left to the model.
 */
export function parseIntent(phrase: string): ParsedCommand | null {
  const w = tokens(phrase);
  if (!w.length) return null;
  const text = phrase.trim();
  const used = new Set<number>();
  /** The words that were not part of the command: they name the thing. */
  const rest = () => w.filter((x, i) => !used.has(i) && !FILLER.has(x)).join(" ");
  const at = (...names: string[]) => w.findIndex(x => names.includes(x));

  if (w.length <= 4 && (w[0] === "undo" || w[0] === "revert" || (w[0] === "take" && w[1] === "that" && w[2] === "back"))) {
    return { intent: { action: "undo" }, text };
  }

  // "merge X into Y"
  const merge = at("merge");
  if (merge >= 0) {
    used.add(merge);
    const into = w.findIndex((x, i) => i > merge && x === "into");
    if (into > 0) {
      for (let i = merge + 1; i < into; i++) used.add(i);
      used.add(into);
      const first = w.slice(merge + 1, into).filter(x => !FILLER.has(x)).join(" ");
      for (let i = into + 1; i < w.length; i++) used.add(i);
      const second = w.slice(into + 1).filter(x => !FILLER.has(x)).join(" ");
      return {
        intent: { action: "merge", target: first, into: second },
        missing: !first ? { slot: "target", question: "Which epic should be merged?" }
          : !second ? { slot: "into", question: "Merge it into which epic?" } : undefined,
        text,
      };
    }
  }

  // "make X blocked by Y" / "X waits for Y"
  const blockAt = w.findIndex(x => ["blocked", "blocks", "waits", "depends"].includes(x));
  if (blockAt >= 0) {
    for (let i = 0; i < blockAt; i++) used.add(i);
    let connector = blockAt;
    if (["blocked", "waits", "depends"].includes(w[blockAt]!)) {
      // "blocked by", "waits for", "depends on"
      const next = w[blockAt + 1];
      if (next && ["by", "for", "on"].includes(next)) { used.add(blockAt + 1); connector = blockAt + 1; }
    }
    const first = w.slice(0, blockAt).filter(x => !FILLER.has(x) && !["make", "let"].includes(x)).join(" ");
    for (let i = connector + 1; i < w.length; i++) used.add(i);
    const second = w.slice(connector + 1).filter(x => !FILLER.has(x)).join(" ");
    return {
      intent: { action: "block", target: first, blocker: second },
      missing: !first ? { slot: "target", question: "Which item is blocked?" }
        : !second ? { slot: "blocker", question: "What is it waiting for?" } : undefined,
      text,
    };
  }

  // "unblock X" / "remove the blocker on X"
  const unblock = at("unblock");
  if (unblock >= 0) {
    for (let i = 0; i <= unblock; i++) used.add(i);
    const target = rest();
    return { intent: { action: "unblock", target, blocker: "" }, missing: target ? undefined : { slot: "target", question: "Which item?" }, text };
  }

  // "close X" / "mark X as done" / "reopen X"
  const close = at("close", "reopen", "re-open", "finish", "complete", "mark");
  if (close >= 0) {
    const reopening = w[close] === "reopen" || w[close] === "re-open";
    for (let i = 0; i <= close; i++) used.add(i);
    for (let i = close + 1; i < w.length; i++) {
      if (["done", "not", "planned", "as", "complete", "finished"].includes(w[i]!)) used.add(i);
    }
    const target = rest();
    const reason = /\bnot planned\b/.test(text.toLowerCase()) ? "NOT_PLANNED" : "COMPLETED";
    return {
      intent: reopening ? { action: "reopen", target } : { action: "close", target, reason },
      missing: target ? undefined : { slot: "target", question: "Which item?" },
      text,
    };
  }

  // "remove X from the project" / "archive X"
  const archive = at("archive", "delete");
  const remove = at("remove", "take");
  if (archive >= 0 || (remove >= 0 && w.slice(remove).includes("project"))) {
    const start = archive >= 0 ? archive : remove;
    for (let i = start; i < w.length; i++) {
      if (["from", "the", "project", "out", "of"].includes(w[i]!)) used.add(i);
    }
    const target = rest();
    return { intent: { action: "archive", target }, missing: target ? undefined : { slot: "target", question: "Which item?" }, text };
  }

  // "assign X to ana" / "give X to ana"
  const assign = at("assign", "owner", "owns", "give", "own");
  if (assign >= 0) {
    for (let i = 0; i <= assign; i++) used.add(i);
    const to = w.indexOf("to", assign);
    if (to > 0) {
      for (let i = assign + 1; i < to; i++) used.add(i);
      used.add(to);
      const target = rest();
      const who = w.slice(to + 1).join(" ");
      for (let i = to + 1; i < w.length; i++) used.add(i);
      return { intent: { action: "owner", target, value: who }, missing: target ? undefined : { slot: "target", question: "Which item?" }, text };
    }
  }

  // "put X in Release 2" / "move X to the March release" / "move X to the payments lane"
  const verb = at("put", "move", "set", "plan", "schedule");
  if (verb >= 0) {
    for (let i = 0; i <= verb; i++) used.add(i);
    const connector = w.findIndex((x, i) => i > verb && (x === "in" || x === "to"));
    if (connector > 0) {
      for (let i = verb + 1; i < connector; i++) used.add(i);
      used.add(connector);
      const target = rest();
      const restWords = w.slice(connector + 1);
      // "release 2" names the release; "march release" names it the other way round.
      const releaseWord = restWords.findIndex(x => ["release", "version", "iteration", "sprint"].includes(x));
      const laneWord = restWords.findIndex(x => ["lane", "swimlane", "stream", "board"].includes(x));
      if (releaseWord >= 0) {
        const name = restWords.slice(0, releaseWord).join(" ");
        for (let i = connector + 1; i < w.length; i++) used.add(i);
        const value = name || restWords.join(" ");
        return { intent: { action: "release", target, value }, missing: target ? undefined : { slot: "target", question: "Which item?" }, text };
      }
      if (laneWord >= 0) {
        const name = restWords.slice(0, laneWord).join(" ");
        for (let i = connector + 1; i < w.length; i++) used.add(i);
        const value = name || restWords.join(" ");
        return { intent: { action: "lane", target, value }, missing: target ? undefined : { slot: "target", question: "Which item?" }, text };
      }
    }
  }

  // "move X to the 15th" / "put X on next Friday"
  const named = parseDate(text, TODAY);
  if (named && /\b(move|put|set|shift|slide|deadline|finish|end)\b/.test(text)) {
    const verb = at("move", "put", "set", "shift", "slide");
    if (verb >= 0) {
      for (let i = 0; i <= verb; i++) used.add(i);
      const target = rest();
      return {
        intent: { action: "setDate", target, date: named.date },
        missing: target ? undefined : { slot: "target", question: "Which item?" },
        text,
      };
    }
  }

  // "move X two weeks later"
  const shift = parseShift(text);
  if (shift !== null) {
    for (let i = 0; i < w.length; i++) {
      if (["move", "shift", "slide", "push", "pull", "delay", "bring"].includes(w[i]!)) { used.add(i); continue; }
      if (UNITS[w[i]!]) { used.add(i); if (i > 0 && (COUNT_WORDS[w[i - 1]!] || !Number.isNaN(Number(w[i - 1])))) used.add(i - 1); continue; }
      if (LATER.has(w[i]!) || EARLIER.has(w[i]!)) used.add(i);
    }
    const target = rest();
    const days = /later|forward|out|after/.test(text.toLowerCase()) ? Math.abs(shift) : shift;
    return { intent: { action: "shift", target, days }, missing: target ? undefined : { slot: "target", question: "Which item should move?" }, text };
  }

  // "add a story called X under Y"
  const create = at("add", "create", "new");
  if (create >= 0) {
    for (let i = 0; i <= create; i++) used.add(i);
    const epic = w.includes("epic");
    const under = w.findIndex((x, i) => i > create && (x === "under" || x === "in"));
    let titleWords: string[] = [];
    for (let i = create + 1; i < w.length; i++) {
      if (["epic", "story", "task", "called", "named", "titled"].includes(w[i]!)) { used.add(i); continue; }
      if (under > 0 && i >= under) break;
      titleWords.push(w[i]!);
      used.add(i);
    }
    const underWords = under > 0 ? w.slice(under + 1) : [];
    const title = titleWords.join(" ");
    return {
      intent: { action: "create", title, under: underWords.length ? underWords.join(" ") : undefined, epic },
      missing: title ? undefined : { slot: "target", question: "What should it be called?" },
      text,
    };
  }

  return null;
}
