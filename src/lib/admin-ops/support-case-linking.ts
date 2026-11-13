export interface SupportCaseLinkRecord {
  caseId: string;
  workspaceId: string;
  userId: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'IN_INVESTIGATION' | 'RESOLVED' | 'CLOSED';
  linkedEntities: {
    actionRunId?: string;
    paymentId?: string;
    bookingId?: string;
    ledgerEntryId?: string;
  };
  resolution?: {
    actionTaken: 'ISSUE_REFUND' | 'RE_TRIGGER_ACTION' | 'ADJUST_CREDITS' | 'EXPLAINED' | 'DISMISS';
    operatorId: string;
    notes: string;
    resolvedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export class SupportCaseLinkingService {
  private cases: Map<string, SupportCaseLinkRecord> = new Map();

  /**
   * 지원 케이스 등록 및 운영 엔티티 연결 (ANI-877)
   */
  createCaseWithLinks(params: {
    caseId?: string;
    workspaceId: string;
    userId: string;
    subject: string;
    description: string;
    linkedEntities: SupportCaseLinkRecord['linkedEntities'];
  }): SupportCaseLinkRecord {
    const { workspaceId, userId, subject, description, linkedEntities } = params;
    const caseId = params.caseId || `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const record: SupportCaseLinkRecord = {
      caseId,
      workspaceId,
      userId,
      subject,
      description,
      status: 'OPEN',
      linkedEntities,
      createdAt: now,
      updatedAt: now,
    };

    this.cases.set(caseId, record);
    return record;
  }

  /**
   * 관리자 해결 조치 적용
   */
  resolveCase(params: {
    caseId: string;
    operatorId: string;
    actionTaken: NonNullable<SupportCaseLinkRecord['resolution']>['actionTaken'];
    notes: string;
  }): SupportCaseLinkRecord {
    const { caseId, operatorId, actionTaken, notes } = params;
    const item = this.cases.get(caseId);

    if (!item) {
      throw new Error(`Support case not found: ${caseId}`);
    }

    const now = new Date().toISOString();
    item.status = 'RESOLVED';
    item.resolution = {
      actionTaken,
      operatorId,
      notes,
      resolvedAt: now,
    };
    item.updatedAt = now;

    return item;
  }

  getCase(caseId: string): SupportCaseLinkRecord | undefined {
    return this.cases.get(caseId);
  }

  listCasesByWorkspace(workspaceId: string): SupportCaseLinkRecord[] {
    return Array.from(this.cases.values()).filter((c) => c.workspaceId === workspaceId);
  }
}
