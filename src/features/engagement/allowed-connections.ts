import { isEngagementWorkspaceAllowed } from './engagement-allowlist'

/** Reading customers' accounts and calling the LLM must be as workspace-gated as sending. */
export function filterAllowedConnections<T extends { workspace_id: string }>(connections: readonly T[]): T[] {
  return connections.filter((connection) => isEngagementWorkspaceAllowed(connection.workspace_id))
}
