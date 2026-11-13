import { getFixtureRevenueCommandReadModel } from '@/features/marketing-agent/engine/fixtures/revenue-command-sample';
import { isMarketingFixtureWorkspace } from '@/features/marketing-agent/engine/fixture-context';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import { RevenueOpportunity, DecisionRequest } from '@/features/marketing-agent/engine/revenue-data-spine';

export interface BookingPulse {
  occupancyRate: number;       // 75%
  occupancyNumerator: number;  // 18 slots
  occupancyDenominator: number;// 24 slots
  availableSlotsCount: number; // 6 slots
  confirmedBookingsCount: number; // 18 slots
  bookedRevenueAmount: number; // 4,320,000 KRW
  potentialRevenueMin: number; // 720,000 KRW
  potentialRevenueMax: number; // 1,440,000 KRW
  highIntentInquiriesCount: number; // 3 leads
  updatedAt: string;
}

export interface RevenuePipelineStage {
  stage: 'INQUIRY' | 'CONSULTATION' | 'SLOT_PROPOSAL' | 'BOOKING_CONFIRMED' | 'VISIT_COMPLETED';
  label: string;
  count: number;
  valueAmount: number;
}

export interface RevenueCommandReadModel {
  workspaceId: string;
  isDemo: boolean;
  agentStatus: {
    desiredMode: string;
    actualMode: string;
    statusReason: string;
    killSwitchActive: boolean;
    lastHeartbeatAt: string;
    workerVersion: string;
  };
  briefingText: string;
  observationStatus: 'NOT_OBSERVED' | 'FIXTURE';
  pulse: BookingPulse | null;
  topOpportunities: RevenueOpportunity[];
  pipeline: RevenuePipelineStage[];
  decisions: DecisionRequest[];
  next24HoursQueue: Array<{
    time: string;
    channel: string;
    action: string;
    risk: string;
    stopCondition: string;
  }>;
  verifiedOutcomes: Array<{
    time: string;
    channel: string;
    title: string;
    externalId: string;
    permalink: string;
    result: string;
  }>;
}

export function getRevenueCommandReadModel(workspaceId: string, _isDemo: boolean = false): RevenueCommandReadModel {
  void _isDemo; // A URL demo flag cannot select a fixture or authorize sample data.
  const control = AgentControlPlaneService.getControlState(workspaceId);
  if (!isMarketingFixtureWorkspace(workspaceId)) {
    return {
      workspaceId,
      isDemo: false,
      observationStatus: 'NOT_OBSERVED',
      agentStatus: {
        desiredMode: control.desiredMode,
        actualMode: control.actualMode,
        statusReason: control.statusReason,
        killSwitchActive: control.killSwitchActive,
        lastHeartbeatAt: control.lastHeartbeatAt,
        workerVersion: control.workerVersion,
      },
      briefingText: '예약·매출 원장이 연결되지 않아 현황을 확인할 수 없습니다.',
      pulse: null,
      topOpportunities: [],
      pipeline: [],
      decisions: [],
      next24HoursQueue: [],
      verifiedOutcomes: [],
    };
  }
  return getFixtureRevenueCommandReadModel(workspaceId);
}
