// What the map colours and groups by. The category is the default; the others come from
// the project's own fields, so a team can look at the same map by release, by person or
// by priority.

export type Lens = "category" | "release" | "assignee" | "priority";

export const LENSES: { id: Lens; name: string }[] = [
  { id: "category", name: "Category" },
  { id: "release", name: "Release" },
  { id: "assignee", name: "Assignee" },
  { id: "priority", name: "Priority" },
];

/** What the map needs to know about an item to put it in a group. */
export interface LensNode {
  category: string;
  release: string | null;
  priority: string | null;
  assignees: string[];
}

/** The group an item belongs to under a lens. */
export function lensValue(lens: Lens, node: LensNode): string {
  switch (lens) {
    case "release": return node.release ?? "No release";
    case "assignee": return node.assignees[0] ?? "Nobody";
    case "priority": return node.priority ?? "No priority";
    default: return node.category;
  }
}

/**
 * The colours of the groups, in a stable order so the same group keeps its colour.
 * The palette is the one the categories already use, so both themes still work.
 */
export const LENS_COLOURS = ["frontend", "backend", "security", "data", "infra", "business", "mobile", "quality", "docs", "other"];

export function lensColours(values: string[]): Map<string, string> {
  const sorted = [...new Set(values)].sort();
  return new Map(sorted.map((v, i) => [v, LENS_COLOURS[i % LENS_COLOURS.length]!]));
}
