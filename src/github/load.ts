import type { GitHubClient } from "./client";
import { GitHubError } from "./client";
import { ITEM_COMMENTS, PROJECT_ITEMS, PROJECT_META, VIEWER_PROJECTS } from "./queries";
import type { ProjectItemsData, ProjectMetaData, RawItem, ViewerProjectsData } from "./types";
import { normalizeProject, summarizeProjects, type Item, type Project, type ProjectSummary } from "../model/normalize";

export interface Viewer { login: string; name: string | null; avatarUrl: string }

export async function loadViewerProjects(client: GitHubClient): Promise<{ viewer: Viewer; projects: ProjectSummary[] }> {
  const data = await client.query<ViewerProjectsData>(VIEWER_PROJECTS);
  const { login, name, avatarUrl } = data.viewer;
  return { viewer: { login, name, avatarUrl }, projects: summarizeProjects(data) };
}

export async function loadProject(
  client: GitHubClient,
  owner: string,
  number: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Project> {
  const meta = await client.query<ProjectMetaData>(PROJECT_META, { owner, number });
  const project = meta.repositoryOwner?.projectV2;
  if (!project) throw new GitHubError(`Project ${owner}/${number} wasn't found, or this token can't see it.`, "not-found");

  const items: RawItem[] = [];
  let after: string | null = null;
  const total = project.items.totalCount;
  for (let page = 0; page < 200; page++) {
    const data: ProjectItemsData = await client.query<ProjectItemsData>(PROJECT_ITEMS, { owner, number, after });
    const conn = data.repositoryOwner?.projectV2?.items;
    if (!conn) break;
    items.push(...conn.nodes);
    onProgress?.(items.length, total);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return normalizeProject(owner, project, items, new Date().toISOString());
}

/** What someone said on an issue. */
export interface Comment { author: string; body: string; at: string }

/**
 * The comments on some items, newest first. The comments are the one channel a colleague
 * has into the plan, so pm-hub reads them.
 */
export async function loadComments(client: GitHubClient, items: Item[]): Promise<Map<string, Comment[]>> {
  const wanted = items.filter(i => i.ids.content);
  const out = new Map<string, Comment[]>();
  if (!wanted.length) return out;
  const ids = wanted.map(i => i.ids.content!);
  for (let i = 0; i < ids.length; i += 20) {
    const data = await client.query<{ nodes: ({ comments?: { nodes: { author: { login: string } | null; body: string; createdAt: string }[] } } | null)[] }>(
      ITEM_COMMENTS, { ids: ids.slice(i, i + 20) });
    // The nodes come back in the order we asked for them.
    (data.nodes ?? []).forEach((node, index) => {
      const key = wanted[i + index]?.key;
      if (!key || !node?.comments) return;
      const comments = node.comments.nodes
        .filter(c => c.body && c.body.trim())
        .map(c => ({ author: c.author?.login ?? "someone", body: c.body.trim(), at: c.createdAt }));
      if (comments.length) out.set(key, comments);
    });
  }
  return out;
}
