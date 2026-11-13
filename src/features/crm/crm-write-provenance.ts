import { createHash } from 'crypto';
import { CrmFieldWriteProvenance, ConsentStatus } from './types';

export interface RecordFieldWriteParams {
  workspaceId: string;
  customerId: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  source: CrmFieldWriteProvenance['source'];
  consentStatus: ConsentStatus;
  consentAcquiredAt?: string;
  retentionYears?: number; // 기본 1년
  operatorId?: string;
}

export class CrmWriteProvenanceService {
  private provenanceLedger: Map<string, CrmFieldWriteProvenance> = new Map();

  /**
   * CRM 필드 쓰기 시 출처 및 개인정보 동의 불변 원장 기록 (ANI-852)
   */
  recordWrite(params: RecordFieldWriteParams): CrmFieldWriteProvenance {
    const {
      workspaceId,
      customerId,
      fieldName,
      oldValue,
      newValue,
      source,
      consentStatus,
      consentAcquiredAt,
      retentionYears = 1,
      operatorId,
    } = params;

    const recordId = `crm_prov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const writtenAt = new Date().toISOString();

    const retentionMs = retentionYears * 365 * 24 * 60 * 60 * 1000;
    const retentionExpiresAt = new Date(Date.now() + retentionMs).toISOString();

    // SHA-256 감사 다이제스트 계산
    const rawPayload = JSON.stringify({
      recordId,
      workspaceId,
      customerId,
      fieldName,
      oldValue,
      newValue,
      source,
      consentStatus,
      consentAcquiredAt,
      retentionExpiresAt,
      operatorId,
      writtenAt,
    });
    const auditDigest = createHash('sha256').update(rawPayload).digest('hex');

    const record: CrmFieldWriteProvenance = {
      recordId,
      workspaceId,
      customerId,
      fieldName,
      oldValue,
      newValue,
      source,
      consentStatus,
      consentAcquiredAt,
      retentionExpiresAt,
      operatorId,
      writtenAt,
      auditDigest,
    };

    this.provenanceLedger.set(recordId, Object.freeze(record));
    return record;
  }

  /**
   * 개인정보 보존 기간 만료 여부 판정 (GDPR/개인정보보호법 컴플라이언스)
   */
  isRetentionExpired(recordId: string): boolean {
    const record = this.provenanceLedger.get(recordId);
    if (!record) return false;
    return new Date(record.retentionExpiresAt).getTime() <= Date.now();
  }

  /**
   * 고객별 필드 변경 계보 조회
   */
  getCustomerAuditHistory(customerId: string): CrmFieldWriteProvenance[] {
    return Array.from(this.provenanceLedger.values()).filter((r) => r.customerId === customerId);
  }
}
