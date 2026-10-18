// Every write pm-hub can make to GitHub. Nothing else in the codebase may contain a
// mutation (test/write-guard.test.ts). Each document does one thing, so a failure
// maps to exactly one change in the review screen.

export const SET_FIELD = `
mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) { projectV2Item { id } }
}`;

export const CLEAR_FIELD = `
mutation ClearField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } }
}`;

export const UPDATE_ISSUE = `
mutation UpdateIssue($id: ID!, $title: String, $milestoneId: ID, $assigneeIds: [ID!]) {
  updateIssue(input: { id: $id, title: $title, milestoneId: $milestoneId, assigneeIds: $assigneeIds }) { issue { id } }
}`;

export const CLOSE_ISSUE = `
mutation CloseIssue($issueId: ID!, $stateReason: IssueClosedStateReason) {
  closeIssue(input: { issueId: $issueId, stateReason: $stateReason }) { issue { id state } }
}`;

export const REOPEN_ISSUE = `
mutation ReopenIssue($issueId: ID!) {
  reopenIssue(input: { issueId: $issueId }) { issue { id state } }
}`;

export const ADD_SUB_ISSUE = `
mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
  addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: true }) { issue { id } }
}`;

export const REMOVE_SUB_ISSUE = `
mutation RemoveSubIssue($issueId: ID!, $subIssueId: ID!) {
  removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) { issue { id } }
}`;

export const ADD_BLOCKED_BY = `
mutation AddBlockedBy($issueId: ID!, $blockingIssueId: ID!) {
  addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) { issue { id } }
}`;

export const REMOVE_BLOCKED_BY = `
mutation RemoveBlockedBy($issueId: ID!, $blockingIssueId: ID!) {
  removeBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) { issue { id } }
}`;

export const ADD_LABELS = `
mutation AddLabels($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) { clientMutationId }
}`;

export const REMOVE_LABELS = `
mutation RemoveLabels($labelableId: ID!, $labelIds: [ID!]!) {
  removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) { clientMutationId }
}`;

export const CREATE_ISSUE = `
mutation CreateIssue($repositoryId: ID!, $title: String!, $labelIds: [ID!], $parentIssueId: ID) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, labelIds: $labelIds, parentIssueId: $parentIssueId }) { issue { id number url } }
}`;

export const ADD_TO_PROJECT = `
mutation AddToProject($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`;

export const ARCHIVE_ITEM = `
mutation ArchiveItem($projectId: ID!, $itemId: ID!) {
  archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { item { id } }
}`;

export const UNARCHIVE_ITEM = `
mutation UnarchiveItem($projectId: ID!, $itemId: ID!) {
  unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { item { id } }
}`;

export const ADD_COMMENT = `
mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) { commentEdge { node { id url } } }
}`;

export const CREATE_STATUS_UPDATE = `
mutation CreateStatusUpdate($projectId: ID!, $status: ProjectV2StatusUpdateStatus, $body: String, $startDate: Date, $targetDate: Date) {
  createProjectV2StatusUpdate(input: { projectId: $projectId, status: $status, body: $body, startDate: $startDate, targetDate: $targetDate }) { statusUpdate { id } }
}`;

export const ALL_MUTATIONS = {
  SET_FIELD, CLEAR_FIELD, UPDATE_ISSUE, CLOSE_ISSUE, REOPEN_ISSUE, ADD_SUB_ISSUE, REMOVE_SUB_ISSUE, ADD_BLOCKED_BY, REMOVE_BLOCKED_BY,
  ADD_LABELS, REMOVE_LABELS, CREATE_ISSUE, ADD_TO_PROJECT, ARCHIVE_ITEM, UNARCHIVE_ITEM, ADD_COMMENT, CREATE_STATUS_UPDATE,
};
