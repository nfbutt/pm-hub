// A proposal: changes someone has drafted and put up for the team, rather than applied.
// The operations are the proposal — the same ones an apply would send — so whoever picks
// it up gets exactly what was drafted, and can review it before anything is written.
import type { Op } from "./ops";

export interface Proposal {
  version: 1;
  at: string;
  author: string | null;
  /** What the proposal is called. */
  name: string;
  /** Why the person thinks it should be done. */
  note: string;
  /** The changes, in the same shape an apply sends. */
  ops: Op[];
}

/** A proposal is only worth showing if it changes something. */
export const isUseful = (p: Proposal): boolean => p.ops.length > 0;

/** How many changes a proposal makes, for the line the reader sees. */
export const proposalSize = (p: Proposal): number => p.ops.length;

/** A short description of what a proposal does, for the list. */
export function describeProposal(p: Proposal, titleOf: (key: string) => string): string {
  const creates = p.ops.filter(o => o.kind === "create").length;
  const archives = p.ops.filter(o => o.kind === "archive").length;
  const dates = p.ops.filter(o => o.kind === "setDates").length;
  const parts: string[] = [];
  if (creates) parts.push(`${creates} new`);
  if (archives) parts.push(`${archives} removed`);
  if (dates) parts.push(`${dates} re-dated`);
  if (!parts.length) {
    const first = p.ops.find(o => "key" in o);
    parts.push(first && "key" in first ? titleOf(first.key) : "a change");
  }
  return parts.join(", ");
}
