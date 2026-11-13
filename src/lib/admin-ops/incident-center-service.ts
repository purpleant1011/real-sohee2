/**
 * Admin Incident Center Service (ANI-878)
 * P0/P1 영향 Workspace·Provider·Plugin·Customer Impact 관리
 */

export type IncidentSeverity = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM';
export type IncidentStatus = 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';

export interface IncidentRecord {
  incidentId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affectedProvider?: 'META' | 'NAVER' | 'TOSS_PAYMENTS' | 'OPENAI' | 'DAANGN';
  affectedWorkspaceIds: string[];
  customerImpactDescription: string;
  mitigationActionTaken?: string;
  declaredAt: string;
  resolvedAt?: string;
}

export class IncidentCenterService {
  private incidents: Map<string, IncidentRecord> = new Map();

  declareIncident(params: {
    title: string;
    severity: IncidentSeverity;
    affectedProvider?: IncidentRecord['affectedProvider'];
    affectedWorkspaceIds: string[];
    customerImpactDescription: string;
  }): IncidentRecord {
    const { title, severity, affectedProvider, affectedWorkspaceIds, customerImpactDescription } =
      params;
    const incidentId = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const incident: IncidentRecord = {
      incidentId,
      title,
      severity,
      status: 'INVESTIGATING',
      affectedProvider,
      affectedWorkspaceIds,
      customerImpactDescription,
      declaredAt: now,
    };

    this.incidents.set(incidentId, incident);
    return incident;
  }

  resolveIncident(incidentId: string, mitigationActionTaken: string): IncidentRecord {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    incident.status = 'RESOLVED';
    incident.mitigationActionTaken = mitigationActionTaken;
    incident.resolvedAt = new Date().toISOString();
    return incident;
  }

  listActiveIncidents(): IncidentRecord[] {
    return Array.from(this.incidents.values()).filter((i) => i.status !== 'RESOLVED');
  }

  getIncident(incidentId: string): IncidentRecord | undefined {
    return this.incidents.get(incidentId);
  }
}
