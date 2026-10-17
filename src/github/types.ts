// Shapes of the raw GraphQL responses for the documents in queries.ts.

export interface RateLimit { remaining: number; limit: number; resetAt: string; cost: number }

export interface RawProjectSummary {
  id: string; number: number; title: string; shortDescription: string | null; closed: boolean;
  updatedAt: string; url: string; items: { totalCount: number };
  owner: { login?: string };
}

export interface ViewerProjectsData {
  viewer: {
    login: string; name: string | null; avatarUrl: string;
    projectsV2: { nodes: RawProjectSummary[] };
    organizations: { nodes: { login: string; projectsV2: { nodes: RawProjectSummary[] } }[] };
  };
  rateLimit: RateLimit;
}

export interface RawIteration { id: string; title: string; startDate: string; duration: number }

export type RawField =
  | { __typename: "ProjectV2Field"; id: string; name: string; dataType: string }
  | { __typename: "ProjectV2SingleSelectField"; id: string; name: string; dataType: string; options: { id: string; name: string; color: string }[] }
  | {
      __typename: "ProjectV2IterationField"; id: string; name: string; dataType: string;
      configuration: { duration: number; startDay: number; iterations: RawIteration[]; completedIterations: RawIteration[] };
    };

export interface ProjectMetaData {
  repositoryOwner: {
    projectV2: (Omit<RawProjectSummary, "owner"> & { fields: { nodes: RawField[] } }) | null;
  } | null;
  rateLimit: RateLimit;
}

type FieldRef = { field: { name?: string } | null };
export type RawFieldValue =
  | ({ __typename: "ProjectV2ItemFieldDateValue"; date: string } & FieldRef)
  | ({ __typename: "ProjectV2ItemFieldSingleSelectValue"; name: string; optionId: string } & FieldRef)
  | ({ __typename: "ProjectV2ItemFieldIterationValue"; title: string; startDate: string; duration: number; iterationId: string } & FieldRef)
  | ({ __typename: "ProjectV2ItemFieldNumberValue"; number: number } & FieldRef)
  | ({ __typename: "ProjectV2ItemFieldTextValue"; text: string } & FieldRef)
  | ({ __typename: "ProjectV2ItemFieldUserValue"; users: { nodes: { login: string }[] } } & FieldRef)
  | { __typename: string };

interface RawPerson { login: string; avatarUrl?: string }
interface RawMilestone { title: string; number: number; dueOn: string | null; state: string }
interface RawRepoRef { nameWithOwner: string }

export type RawContent =
  | {
      __typename: "Issue"; number: number; title: string; url: string; state: "OPEN" | "CLOSED"; stateReason: string | null;
      createdAt: string; closedAt: string | null; updatedAt: string; repository: RawRepoRef;
      labels: { nodes: { name: string; color: string }[] }; assignees: { nodes: RawPerson[] };
      milestone: RawMilestone | null; issueType: { name: string } | null;
      parent: { number: number; repository: RawRepoRef } | null;
      subIssuesSummary: { total: number; completed: number } | null;
      blockedBy: { nodes: { number: number; state: string; repository: RawRepoRef }[] } | null;
    }
  | {
      __typename: "PullRequest"; number: number; title: string; url: string; state: "OPEN" | "CLOSED" | "MERGED";
      createdAt: string; closedAt: string | null; updatedAt: string; repository: RawRepoRef;
      labels: { nodes: { name: string; color: string }[] }; assignees: { nodes: RawPerson[] }; milestone: RawMilestone | null;
    }
  | { __typename: "DraftIssue"; title: string; createdAt: string; updatedAt: string; assignees: { nodes: RawPerson[] } }
  | null;

export interface RawItem {
  id: string; type: string; isArchived: boolean;
  fieldValues: { nodes: RawFieldValue[] };
  content: RawContent;
}

export interface ProjectItemsData {
  repositoryOwner: {
    projectV2: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] } } | null;
  } | null;
  rateLimit: RateLimit;
}
