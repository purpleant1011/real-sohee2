import { createHash, randomUUID } from 'node:crypto';
import type { ConnectorEvidence } from '../evidence';
import { isValidIsoDateString } from '../evidence';

export interface ExistingProposal {
  readonly id: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}

export interface OpportunityGateway {
  getExistingProposals?(workspaceId: string): Promise<readonly ExistingProposal[]> | readonly ExistingProposal[];
  getRejectedFingerprints?(workspaceId: string): Promise<readonly string[]> | readonly string[];
  saveOpportunities?(opportunities: readonly GeneratedOpportunity[]): Promise<void> | void;
}

export interface GeneratedOpportunity {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly reasonWhyNow: string;
  readonly suggestedAction: string;
  readonly evidenceIds: readonly string[];
  readonly fingerprint: string;
  readonly expiresAt: string;
  readonly status: 'pending';
  readonly type?: 'event_promotion' | 'price_update' | string;
}

export interface GenerateOpportunitiesInput {
  readonly workspaceId: string;
  readonly evidences: readonly (ConnectorEvidence & { metadata?: Record<string, unknown> })[];
  readonly existingProposals?: readonly ExistingProposal[];
  readonly rejectedFingerprints?: readonly string[];
  readonly now: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function computeOpportunityFingerprint(
  sourceId: string,
  eventIdOrItem: string,
  date: string,
): string {
  return createHash('sha256')
    .update(`${sourceId}:${eventIdOrItem}:${date}`)
    .digest('hex');
}

export async function generateConnectorOpportunities(
  input: GenerateOpportunitiesInput,
  gateway?: OpportunityGateway,
): Promise<GeneratedOpportunity[]> {
  // 1. Strict validation (fail-closed)
  if (typeof input !== 'object' || input === null) return [];
  if (typeof input.workspaceId !== 'string' || input.workspaceId.trim() === '') return [];
  if (!isValidIsoDateString(input.now)) return [];
  if (!Array.isArray(input.evidences)) return [];

  const nowTime = Date.parse(input.now);
  const nowDate = new Date(nowTime);

  // 2. Resolve existing proposals & rejected fingerprints
  let allExistingProposals: readonly ExistingProposal[] = input.existingProposals ?? [];
  if (gateway?.getExistingProposals) {
    const gwProposals = await gateway.getExistingProposals(input.workspaceId);
    if (Array.isArray(gwProposals)) {
      allExistingProposals = [...allExistingProposals, ...gwProposals];
    }
  }

  let allRejectedFingerprints: readonly string[] = input.rejectedFingerprints ?? [];
  if (gateway?.getRejectedFingerprints) {
    const gwRejected = await gateway.getRejectedFingerprints(input.workspaceId);
    if (Array.isArray(gwRejected)) {
      allRejectedFingerprints = [...allRejectedFingerprints, ...gwRejected];
    }
  }

  // 3. Build suppression set:
  // - 사장님 거절 이력에 포함된 fingerprint
  // - 최근 7일 이내에 이미 제안된 fingerprint
  const suppressedFingerprints = new Set<string>(allRejectedFingerprints);

  for (const proposal of allExistingProposals) {
    if (typeof proposal !== 'object' || proposal === null) continue;
    if (typeof proposal.fingerprint !== 'string' || !proposal.fingerprint) continue;
    if (!isValidIsoDateString(proposal.createdAt)) continue;

    const createdAtTime = Date.parse(proposal.createdAt);
    const diff = nowTime - createdAtTime;
    if (diff >= 0 && diff < SEVEN_DAYS_MS) {
      suppressedFingerprints.add(proposal.fingerprint);
    }
  }

  const generatedOpportunities: GeneratedOpportunity[] = [];
  const seenFingerprintsInBatch = new Set<string>();

  // 4. Generate opportunities from evidence
  for (const evidence of input.evidences) {
    if (typeof evidence !== 'object' || evidence === null) continue;
    if (evidence.revokedAt !== null) continue;

    const metadata = (evidence.metadata ?? {}) as Record<string, unknown>;

    // Case A: Calendar Event (Upcoming event D-14 ~ D-1)
    if (evidence.connectorId === 'google_calendar' || metadata.calendarId || metadata.start || metadata.startDate) {
      // Skip cancelled/tombstone events
      if (metadata.tombstone === true || metadata.status === 'cancelled') continue;

      const summary = (metadata.summary as string) || '매장 행사';
      const eventId = (metadata.eventId as string) || evidence.sourceId;
      const calendarId = (metadata.calendarId as string) || evidence.sourceId;

      const eventStartStr = (metadata.start as string) || (metadata.startDate as string);
      if (!eventStartStr) continue;

      const eventStartTime = Date.parse(eventStartStr);
      if (Number.isNaN(eventStartTime)) continue;

      // 지난 행사 제안 금지 (이미 시작했거나 지난 일정)
      if (eventStartTime <= nowTime) continue;

      // D-day 계산 (UTC 일자 기준 차이)
      const eventDate = new Date(eventStartTime);
      const startOfDayNow = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
      const startOfDayEvent = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
      const daysUntil = Math.round((startOfDayEvent - startOfDayNow) / (24 * 60 * 60 * 1000));

      // D-14 ~ D-1 이내만 기회로 채택 (D-0 당일이나 14일 초과는 제외)
      if (daysUntil < 1 || daysUntil > 14) continue;

      const datePart = eventStartStr.slice(0, 10);
      const fingerprint = computeOpportunityFingerprint(calendarId, eventId, datePart);

      if (suppressedFingerprints.has(fingerprint) || seenFingerprintsInBatch.has(fingerprint)) {
        continue;
      }

      seenFingerprintsInBatch.add(fingerprint);

      const opportunity: GeneratedOpportunity = {
        id: `opp-cal-${randomUUID()}`,
        workspaceId: input.workspaceId,
        title: `[이벤트 사전 홍보] ${summary} 일정 사전 안내`,
        reasonWhyNow: `행사 D-${daysUntil}일 전으로 사전 홍보 및 고객 모객에 가장 적절한 시점입니다.`,
        suggestedAction: '인스타그램 스토리 및 네이버 플레이스 소식에 행사 일정 사전 공지 등록',
        evidenceIds: [evidence.id],
        fingerprint,
        expiresAt: eventStartStr,
        status: 'pending',
        type: 'event_promotion',
      };

      generatedOpportunities.push(opportunity);
      continue;
    }

    // Case B: Sheet Price Changes (hasPriceConflict: true)
    const hasPriceConflict = Boolean(metadata.hasPriceConflict || metadata.priceConflict);
    if (hasPriceConflict) {
      const spreadsheetId = (metadata.spreadsheetId as string) || evidence.sourceId;
      const conflictingPrices = Array.isArray(metadata.conflictingPrices)
        ? (metadata.conflictingPrices as Array<{ item: string; oldPrice?: number; newPrice?: number }>)
        : [];

      const observedDatePart = evidence.observedAt ? evidence.observedAt.slice(0, 10) : input.now.slice(0, 10);

      if (conflictingPrices.length > 0) {
        for (const priceChange of conflictingPrices) {
          const item = priceChange.item;
          if (!item) continue;

          const fingerprint = computeOpportunityFingerprint(spreadsheetId, item, observedDatePart);

          if (suppressedFingerprints.has(fingerprint) || seenFingerprintsInBatch.has(fingerprint)) {
            continue;
          }

          seenFingerprintsInBatch.add(fingerprint);

          const oldPriceStr = typeof priceChange.oldPrice === 'number' ? `${priceChange.oldPrice}원` : '기존 가격';
          const newPriceStr = typeof priceChange.newPrice === 'number' ? `${priceChange.newPrice}원` : '신규 가격';

          const opportunity: GeneratedOpportunity = {
            id: `opp-sheet-${randomUUID()}`,
            workspaceId: input.workspaceId,
            title: `[가격 변경] ${item} 가격 변동에 따른 메뉴판 업데이트`,
            reasonWhyNow: `최근 시트에서 ${item}의 가격 변경(${oldPriceStr} → ${newPriceStr})이 감지되어 매장 안내판 및 플레이스 메뉴 가격 동기화가 필요합니다.`,
            suggestedAction: '네이버 플레이스 및 배달 플랫폼 메뉴 가격을 업데이트하고 가격 조정 안내 소식을 발행합니다.',
            evidenceIds: [evidence.id],
            fingerprint,
            expiresAt: evidence.expiresAt,
            status: 'pending',
            type: 'price_update',
          };

          generatedOpportunities.push(opportunity);
        }
      } else {
        // Conflicting prices array is empty but hasPriceConflict is true
        const item = '메뉴판 전반';
        const fingerprint = computeOpportunityFingerprint(spreadsheetId, item, observedDatePart);

        if (!suppressedFingerprints.has(fingerprint) && !seenFingerprintsInBatch.has(fingerprint)) {
          seenFingerprintsInBatch.add(fingerprint);

          const opportunity: GeneratedOpportunity = {
            id: `opp-sheet-${randomUUID()}`,
            workspaceId: input.workspaceId,
            title: '[가격 변경] 메뉴판 가격 변동 감지에 따른 공지 업데이트',
            reasonWhyNow: '시트에서 메뉴 가격 변동 충돌이 감지되어 매장 안내판 및 플레이스 가격 정보 확인이 필요합니다.',
            suggestedAction: '메뉴판 및 채널별 가격 정보를 대조하여 최신 가격으로 일괄 갱신합니다.',
            evidenceIds: [evidence.id],
            fingerprint,
            expiresAt: evidence.expiresAt,
            status: 'pending',
            type: 'price_update',
          };

          generatedOpportunities.push(opportunity);
        }
      }
    }
  }

  // 5. Save opportunities via gateway if provided
  if (gateway?.saveOpportunities && generatedOpportunities.length > 0) {
    await gateway.saveOpportunities(generatedOpportunities);
  }

  return generatedOpportunities;
}
