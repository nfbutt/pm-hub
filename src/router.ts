import { useEffect, useState } from "react";

export const VIEWS = ["overview", "gantt", "releases", "schedule", "progress", "burnup", "confidence", "dependencies", "workload", "settings"] as const;
export type ViewId = (typeof VIEWS)[number];

export type Route =
  | { kind: "home" }
  | { kind: "demo"; view: ViewId }
  | { kind: "project"; owner: string; number: number; view: ViewId };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const view = (v: string | undefined): ViewId => (VIEWS as readonly string[]).includes(v ?? "") ? (v as ViewId) : "overview";
  if (parts[0] === "demo") return { kind: "demo", view: view(parts[1]) };
  if (parts.length >= 2 && /^\d+$/.test(parts[1]!)) return { kind: "project", owner: parts[0]!, number: Number(parts[1]), view: view(parts[2]) };
  return { kind: "home" };
}

export function hrefFor(r: Route): string {
  if (r.kind === "home") return "#/";
  if (r.kind === "demo") return `#/demo/${r.view}`;
  return `#/${encodeURIComponent(r.owner)}/${r.number}/${r.view}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
