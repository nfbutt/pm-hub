// Every GraphQL document pm-hub sends. v1 is read-only: test/readonly.test.ts fails
// if a mutation appears here.

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

const FIELD_REF = `field { ... on ProjectV2FieldCommon { name } }`;

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

export const PROJECT_ITEMS = `
query ProjectItems($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
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
                number title url state stateReason createdAt closedAt updatedAt
                repository { nameWithOwner }
                labels(first: 30) { nodes { name color } }
                assignees(first: 10) { nodes { login avatarUrl } }
                milestone { title number dueOn state }
                issueType { name }
                parent { number repository { nameWithOwner } }
                subIssuesSummary { total completed }
                blockedBy(first: 25) { nodes { number state repository { nameWithOwner } } }
              }
              ... on PullRequest {
                number title url state createdAt closedAt updatedAt
                repository { nameWithOwner }
                labels(first: 30) { nodes { name color } }
                assignees(first: 10) { nodes { login avatarUrl } }
                milestone { title number dueOn state }
              }
              ... on DraftIssue {
                title createdAt updatedAt
                assignees(first: 10) { nodes { login avatarUrl } }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { remaining limit resetAt cost }
}`;

export const ALL_DOCUMENTS = [VIEWER_PROJECTS, PROJECT_META, PROJECT_ITEMS];
