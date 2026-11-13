export class WorkspaceSwitchRaceError extends Error {
  readonly code: string

  constructor(message: string, code = 'WORKSPACE_SWITCH_RACE_DETECTED') {
    super(message)
    this.name = 'WorkspaceSwitchRaceError'
    this.code = code
  }
}

/**
 * WorkspaceSwitchGuard
 * Ensures that any in-flight asynchronous operation originating from workspace A
 * is strictly isolated and discarded if the active workspace has switched to workspace B.
 */
export class WorkspaceSwitchGuard {
  private activeWorkspaceId: string

  constructor(initialWorkspaceId: string) {
    this.activeWorkspaceId = initialWorkspaceId
  }

  getActiveWorkspace(): string {
    return this.activeWorkspaceId
  }

  switchWorkspace(newWorkspaceId: string): void {
    this.activeWorkspaceId = newWorkspaceId
  }

  /**
   * Executes an asynchronous task and verifies that the workspace did not switch
   * during execution. If switched, the result is discarded and WorkspaceSwitchRaceError is thrown.
   */
  async runWithGuard<T>(originWorkspaceId: string, task: () => Promise<T>): Promise<T> {
    if (originWorkspaceId !== this.activeWorkspaceId) {
      throw new WorkspaceSwitchRaceError(
        `Workspace switch race detected before start: operation targeted "${originWorkspaceId}", but active workspace is "${this.activeWorkspaceId}".`
      )
    }

    const result = await task()

    if (originWorkspaceId !== this.activeWorkspaceId) {
      throw new WorkspaceSwitchRaceError(
        `Workspace switch race detected on completion: operation originated from "${originWorkspaceId}", but user switched to "${this.activeWorkspaceId}". Result safely discarded.`
      )
    }

    return result
  }
}
