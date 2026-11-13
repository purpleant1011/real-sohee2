import { createHash } from 'crypto';
import { HarnessSourceProvenance } from './types';

export class HarnessProvenanceService {
  /**
   * 룩북 또는 참조 소스 출처 및 권리 증거 생성 (ANI-831)
   */
  createProvenance(params: {
    sourceType: HarnessSourceProvenance['sourceType'];
    sourceAccount?: string;
    sourceUrl?: string;
    rightsScope: HarnessSourceProvenance['rightsScope'];
    metadataPayload?: Record<string, unknown>;
  }): HarnessSourceProvenance {
    const {
      sourceType,
      sourceAccount,
      sourceUrl,
      rightsScope,
      metadataPayload = {},
    } = params;

    const sourceId = `src_prov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fetchedAt = new Date().toISOString();

    // SHA-256 무결성 라이선스 다이제스트 계산
    const digestRaw = JSON.stringify({
      sourceId,
      sourceType,
      sourceAccount: sourceAccount || null,
      sourceUrl: sourceUrl || null,
      rightsScope,
      fetchedAt,
      metadataPayload,
    });
    const licenseDigest = createHash('sha256').update(digestRaw).digest('hex');

    // 권리 범위가 상업용 허용이거나 점주 소유인 경우 rights cleared 판정
    const isRightsCleared =
      rightsScope === 'COMMERCIAL_USE_ALLOWED' || rightsScope === 'OWNER_COPYRIGHT';

    return {
      sourceId,
      sourceType,
      sourceAccount,
      sourceUrl,
      fetchedAt,
      rightsScope,
      licenseDigest,
      isRightsCleared,
    };
  }

  /**
   * 라이선스 다이제스트 무결성 재검증
   */
  verifyDigest(provenance: HarnessSourceProvenance, metadataPayload: Record<string, unknown> = {}): boolean {
    const digestRaw = JSON.stringify({
      sourceId: provenance.sourceId,
      sourceType: provenance.sourceType,
      sourceAccount: provenance.sourceAccount || null,
      sourceUrl: provenance.sourceUrl || null,
      rightsScope: provenance.rightsScope,
      fetchedAt: provenance.fetchedAt,
      metadataPayload,
    });
    const expected = createHash('sha256').update(digestRaw).digest('hex');
    return expected === provenance.licenseDigest;
  }
}
