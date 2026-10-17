import type { GitHubClient } from "./client";
import { GitHubError } from "./client";
import { PROJECT_ITEMS, PROJECT_META, VIEWER_PROJECTS } from "./queries";
import type { ProjectItemsData, ProjectMetaData, RawItem, ViewerProjectsData } from "./types";
import { normalizeProject, summarizeProjects, type Project, type ProjectSummary } from "../model/normalize";

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
