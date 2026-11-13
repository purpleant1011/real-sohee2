/**
 * [ANI-465][J03] Admin Runtime Failure Queue & Incident Lifecycle Engine
 * Detects agent runtime execution failures, creates incident records, and automates retry/compensation.
 */

export type IncidentSeverity = 'SEV1_CRITICAL' | 'SEV2_HIGH' | 'SEV3_MEDIUM' | 'SEV4_LOW'
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RETRY_QUEUED' | 'COMPENSATED' | 'RESOLVED'

export interface RuntimeFailureEntry {
  id: string
  workspaceId: string
  channel: string
  actionType: string
  errorMessage: string
  failedAt: string
  retryCount: number
  idempotencyKey: string
}

export interface IncidentRecord {
  incidentId: string
  severity: IncidentSeverity
  status: IncidentStatus
  affectedWorkspaces: string[]
  rootCause: string
  compensationsIssuedSC: number
  createdAt: string
  resolvedAt?: string
}

export class RuntimeFailureQueueService {
  private static failures: RuntimeFailureEntry[] = []
  private static incidents: IncidentRecord[] = []

  public static enqueueFailure(failure: Omit<RuntimeFailureEntry, 'id' | 'retryCount'>): RuntimeFailureEntry {
    const entry: RuntimeFailureEntry = {
      ...failure,
      id: `fail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      retryCount: 0
    }
    this.failures.push(entry)
    return entry
  }

  public static createIncidentFromFailures(params: {
    severity: IncidentSeverity
    rootCause: string
    affectedWorkspaces: string[]
  }): IncidentRecord {
    const incident: IncidentRecord = {
      incidentId: `inc_${Date.now()}`,
      severity: params.severity,
      status: 'OPEN',
      affectedWorkspaces: params.affectedWorkspaces,
      rootCause: params.rootCause,
      compensationsIssuedSC: 0,
      createdAt: new Date().toISOString()
    }
    this.incidents.push(incident)
    return incident
  }

  public static issueCompensation(incidentId: string, creditsSC: number): IncidentRecord | null {
    const incident = this.incidents.find((i) => i.incidentId === incidentId)
    if (!incident) return null

    incident.compensationsIssuedSC += creditsSC
    incident.status = 'COMPENSATED'
    return incident
  }

  public static resolveIncident(incidentId: string): IncidentRecord | null {
    const incident = this.incidents.find((i) => i.incidentId === incidentId)
    if (!incident) return null

    incident.status = 'RESOLVED'
    incident.resolvedAt = new Date().toISOString()
    return incident
  }

  public static getActiveIncidents(): IncidentRecord[] {
    return this.incidents.filter((i) => i.status !== 'RESOLVED')
  }

  public static getFailuresByWorkspace(workspaceId: string): RuntimeFailureEntry[] {
    return this.failures.filter((f) => f.workspaceId === workspaceId)
  }
}
