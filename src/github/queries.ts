// Every read pm-hub sends. Writes live only in mutations.ts; test/write-guard.test.ts
// fails if a mutation appears anywhere else.

const PROJECT_SUMMARY = `
  id number title shortDescription closed updatedAt url
  items { totalCount }
  owner { ... on User { login } ... on Organization { login } }
`;

export const VIEWER_PROJECTS = `
query ViewerProjects {
  viewer {
    login
    name
    avatarUrl
    projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PROJECT_SUMMARY} } }
    organizations(first: 50) {
      nodes {
        login
        projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PROJECT_SUMMARY} } }
      }
    }
  }
  rateLimit { remaining limit resetAt cost }
}`;

// Field ids come back too, so edits can target a field even if it is renamed.
const FIELD_REF = `field { ... on ProjectV2FieldCommon { id name } }`;

export const PROJECT_META = `
query ProjectMeta($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        id number title url shortDescription closed updatedAt
        items { totalCount }
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name color } }
            ... on ProjectV2IterationField {
              configuration {
                duration startDay
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { remaining limit resetAt cost }
}`;

// Everything pm-hub reads about one project item. Shared by the full load and the
// pre-apply check, so both see items the same way.
const ITEM = `
  id
  type
  isArchived
  fieldValues(first: 30) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldDateValue { date ${FIELD_REF} }
      ... on ProjectV2ItemFieldSingleSelectValue { name optionId ${FIELD_REF} }
      ... on ProjectV2ItemFieldIterationValue { title startDate duration iterationId ${FIELD_REF} }
      ... on ProjectV2ItemFieldNumberValue { number ${FIELD_REF} }
      ... on ProjectV2ItemFieldTextValue { text ${FIELD_REF} }
      ... on ProjectV2ItemFieldUserValue { users(first: 10) { nodes { login } } ${FIELD_REF} }
    }
  }
  content {
    __typename
    ... on Issue {
      id number title body url state stateReason createdAt closedAt updatedAt
      repository { id nameWithOwner }
      labels(first: 30) { nodes { id name color } }
      assignees(first: 10) { nodes { id login avatarUrl } }
      milestone { id title number dueOn state }
      issueType { name }
      parent { id number repository { nameWithOwner } }
      subIssuesSummary { total completed }
      blockedBy(first: 25) { nodes { id number state repository { nameWithOwner } } }
    }
    ... on PullRequest {
      id number title url state createdAt closedAt updatedAt
      repository { id nameWithOwner }
      labels(first: 30) { nodes { id name color } }
      assignees(first: 10) { nodes { id login avatarUrl } }
      milestone { id title number dueOn state }
    }
    ... on DraftIssue {
      id title body createdAt updatedAt
      assignees(first: 10) { nodes { id login avatarUrl } }
    }
  }
`;

export const PROJECT_ITEMS = `
query ProjectItems($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ${ITEM}
          }
        }
      }
    }
  }
  rateLimit { remaining limit resetAt cost }
}`;

/** Re-reads specific project items right before applying, to detect changes made on GitHub meanwhile. */
export const ITEMS_BY_ID = `
query ItemsById($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProjectV2Item { ${ITEM} }
  }
  rateLimit { remaining limit resetAt cost }
}`;

/** What a repository offers for edits: its id, labels, open milestones and people who can be assigned. */
export const REPO_META = `
query RepoMeta($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id nameWithOwner
    labels(first: 100) { nodes { id name } }
    milestones(first: 100, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { id title number dueOn state } }
    assignableUsers(first: 100) { nodes { id login } }
  }
  rateLimit { remaining limit resetAt cost }
}`;

export const ALL_DOCUMENTS = [VIEWER_PROJECTS, PROJECT_META, PROJECT_ITEMS, ITEMS_BY_ID, REPO_META];
// VIEWER_LOGIN is declared below and added at the end of the file.

/** Who is signed in, for attributing history records. */
export const VIEWER_LOGIN = `
query ViewerLogin { viewer { login } }`;
ALL_DOCUMENTS.push(VIEWER_LOGIN);
