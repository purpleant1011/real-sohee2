import { AttributionSummary } from "../types";

export interface AttributionTouchpointInput {
  workspaceId: string;
  touchpointType: "customer_message" | "content_post" | "review_reply" | "local_map";
  channelKey: string;
  targetCustomerIdentifier?: string;
  contentOrCampaignId?: string;
  associatedBookingId?: string;
  revenueAmount: number;
  attributionType: "direct" | "assisted";
  confidenceScore: number;
  notes?: string;
}

const ledgerStore = new Map<string, (AttributionTouchpointInput & { id: string; recordedAt: string })[]>();


export function recordAttributionTouchpoint(
  input: AttributionTouchpointInput
): AttributionTouchpointInput & { id: string; recordedAt: string } {
  const id = `tp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const record = {
    ...input,
    id,
    recordedAt: new Date().toISOString(),
  };

  const list = ledgerStore.get(input.workspaceId) || [];
  list.push(record);
  ledgerStore.set(input.workspaceId, list);

  return record;
}

export function getAttributionTouchpoints(
  workspaceId: string
): (AttributionTouchpointInput & { id: string; recordedAt: string })[] {
  return ledgerStore.get(workspaceId) || [];
}

export interface CalculatedSummary {
  totalDirectAttributedRevenue: number;
  totalAssistedAttributedRevenue: number;
  directBookingConversionsCount: number;
  assistedBookingConversionsCount: number;
  totalTouchpointsCount: number;
}

export function calculateAttributionSummary(
  records: Array<{
    attributionType?: "direct" | "assisted";
    contributionLevel?: "direct" | "assisted";
    revenueAmount?: number;
  }>,
  periodLabel: string = "이번 주"
): CalculatedSummary & AttributionSummary {
  const directRecords = records.filter(
    (r) => r.attributionType === "direct" || r.contributionLevel === "direct"
  );
  const assistedRecords = records.filter(
    (r) => r.attributionType === "assisted" || r.contributionLevel === "assisted"
  );

  const directRevenue = directRecords.reduce((acc, curr) => acc + (curr.revenueAmount || 0), 0);
  const assistedRevenue = assistedRecords.reduce((acc, curr) => acc + (curr.revenueAmount || 0), 0);
  const totalRevenue = directRevenue + assistedRevenue;

  return {
    totalDirectAttributedRevenue: directRevenue,
    totalAssistedAttributedRevenue: assistedRevenue,
    directBookingConversionsCount: directRecords.length,
    assistedBookingConversionsCount: assistedRecords.length,
    totalTouchpointsCount: records.length,
    periodLabel,
    totalInquiries: {
      value: records.length,
      provenance: "measured",
      sourceDescription: "연결된 터치포인트 원장 수",
    },
    totalRepliesSent: {
      value: records.length,
      provenance: "measured",
      sourceDescription: "발송 및 응답 기록 수",
    },
    totalBookings: {
      value: directRecords.length + assistedRecords.length,
      provenance: "measured",
      sourceDescription: "매장 실제 확정 예약 건수",
    },
    attributedBookingsDirect: {
      value: directRecords.length,
      provenance: "calculated",
      sourceDescription: "소희 직접 메시지/링크로 즉시 전환된 예약",
    },
    attributedBookingsAssisted: {
      value: assistedRecords.length,
      provenance: "calculated",
      sourceDescription: "소희 콘텐츠/플레이스 노출 후 전환된 보조 기여 예약",
    },
    totalAttributedRevenue: {
      value: totalRevenue,
      provenance: "calculated",
      sourceDescription: "소희 기여 예약의 총 시술 결제액 합산",
    },
    funnelSteps: [
      { label: "터치포인트", count: records.length, subtext: "소희 액션 실행" },
      { label: "직접 전환", count: directRecords.length, subtext: "직접 예약 확정" },
      { label: "보조 기여", count: assistedRecords.length, subtext: "탐색 후 예약 전환" },
    ],
  };
}
