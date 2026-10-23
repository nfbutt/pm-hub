import type { GitHubClient } from "./client";
import { GitHubError } from "./client";
import { ITEM_COMMENTS, PROJECT_ITEMS, PROJECT_META, REPO_MILESTONES, VIEWER_PROJECTS } from "./queries";
import type { ProjectItemsData, ProjectMetaData, RawItem, ViewerProjectsData } from "./types";
import { normalizeProject, summarizeProjects, type Item, type Milestone, type Project, type ProjectSummary } from "../model/normalize";

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
  const out = normalizeProject(owner, project, items, new Date().toISOString());
  out.milestones = await loadMilestones(client, out);
  return out;
}

/** How many repositories' releases are read. A project spread wider than this is rare. */
const MAX_REPOS = 12;

/**
 * The open milestones of every repository the project's issues live in. A failure here is
 * not a failure to load: the releases the issues are in are still known from the issues.
 */
async function loadMilestones(client: GitHubClient, project: Project): Promise<Milestone[]> {
  const repos = [...new Set(project.items.map(i => i.repo).filter((r): r is string => !!r))].slice(0, MAX_REPOS);
  const out: Milestone[] = [];
  for (const repo of repos) {
    const [owner, name] = repo.split("/");
    try {
      const data = await client.query<{ repository: { milestones: { nodes: { id: string; title: string; number: number; dueOn: string | null; state: string }[] } } | null }>(
        REPO_MILESTONES, { owner, name });
      for (const m of data.repository?.milestones.nodes ?? []) out.push({ ...m, repo });
    } catch { /* the issues still say which releases they are in */ }
  }
  return out;
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
