/**
 * Tests for Sohee V0.9 Wave 3 Workbench Contracts & Figma Semantic Parity
 * Traceability: ANI-935, ANI-934
 */

import { describe, it, expect } from 'vitest';
import {
  SEVEN_SERVICE_WORKBENCHES,
  WorkbenchId,
  FORBIDDEN_UI_LABELS,
  sanitizeProductionDisplayLabel,
  resolveDockPresentationMode,
} from '@/types/workbench-contract';
import { WorkbenchRegistry } from '@/lib/workbench/workbench-registry';

describe('V0.9 Wave 3 · Chat-Native 7 Workbench Design Source of Truth (ANI-935)', () => {
  const REQUIRED_WORKBENCHES: WorkbenchId[] = [
    'home',
    'content',
    'customers',
    'results',
    'sohee',
    'ads',
    'system',
  ];

  it('1. 7대 Service Workbench 메타데이터가 누락 없이 등록되어 있어야 한다', () => {
    const all = WorkbenchRegistry.getAllWorkbenches();
    expect(all).toHaveLength(7);

    for (const wbId of REQUIRED_WORKBENCHES) {
      const meta = WorkbenchRegistry.getWorkbench(wbId);
      expect(meta).toBeDefined();
      expect(meta.id).toBe(wbId);
      expect(meta.route).toMatch(/^\/app/);
      expect(meta.koreanName).toBeTruthy();
      expect(meta.englishTitle).toBeTruthy();
      expect(meta.figmaLightNodeId).toBeTruthy();
      expect(meta.figmaDarkNodeId).toBeTruthy();
      expect(meta.requiredDatasetMode).toBe('ACTUAL');
    }
  });

  it('2. URL pathname에 따라 정확한 워크벤치 메타데이터가 식별되어야 한다', () => {
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app').id).toBe('home');
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app/content').id).toBe('content');
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app/customers/123').id).toBe('customers');
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app/results?period=last_month').id).toBe('results');
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app/sohee/knowledge').id).toBe('sohee');
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app/ads').id).toBe('ads');
    expect(WorkbenchRegistry.resolveWorkbenchFromPathname('/app/system/billing').id).toBe('system');
  });

  it('3. Canonical Workbench Lineage가 세션/스레드/상태를 온전히 보존해야 한다', () => {
    const lineage = WorkbenchRegistry.createCanonicalLineage({
      workspaceId: 'ws-gangnam-beauty',
      workbenchId: 'content',
      agentSessionId: 'sess-001',
      threadId: 'th-001',
      conversationId: 'conv-001',
      goalId: 'goal-eyebrow-promo',
      planId: 'plan-insta-feed',
      actionRunId: 'act-run-001',
      currentState: 'APPROVAL',
      datasetMode: 'ACTUAL',
    });

    expect(lineage.workspaceId).toBe('ws-gangnam-beauty');
    expect(lineage.workbenchId).toBe('content');
    expect(lineage.agentSessionId).toBe('sess-001');
    expect(lineage.currentState).toBe('APPROVAL');
    expect(lineage.datasetMode).toBe('ACTUAL');
    expect(lineage.timestamp).toBeTruthy();
  });

  it('4. 반응형 브레이크포인트에 따라 데스크톱/태블릿/모바일 도크 모드가 정확히 결정되어야 한다', () => {
    // Desktop (>= 1024px)
    expect(WorkbenchRegistry.getDockMode(1440)).toBe('FIXED_DOCK');
    expect(WorkbenchRegistry.getDockMode(1024)).toBe('FIXED_DOCK');

    // Tablet (640px ~ 1023px)
    expect(WorkbenchRegistry.getDockMode(768)).toBe('OPS_DRAWER');
    expect(WorkbenchRegistry.getDockMode(1000)).toBe('OPS_DRAWER');

    // Mobile (< 640px)
    expect(WorkbenchRegistry.getDockMode(375)).toBe('BOTTOM_SHEET');
    expect(WorkbenchRegistry.getDockMode(320)).toBe('BOTTOM_SHEET');
  });

  it('5. 프로덕션 UI 안전성 검증기: Figma 내부 노드나 mock/dummy 라벨 노출을 차단해야 한다', () => {
    // 위반 사례들
    const invalidText1 = 'Frame 63:2 고객 관리 패널';
    const check1 = WorkbenchRegistry.validateUiSafety(invalidText1);
    expect(check1.isValid).toBe(false);
    expect(check1.violations.length).toBeGreaterThan(0);

    const invalidText2 = '현재 V0.3 10 Energy 충전 대기 중';
    const check2 = WorkbenchRegistry.validateUiSafety(invalidText2);
    expect(check2.isValid).toBe(false);

    const invalidText3 = '[Sample] dummy 고객 예약 데이터';
    const check3 = WorkbenchRegistry.validateUiSafety(invalidText3);
    expect(check3.isValid).toBe(false);

    // 정상 프로덕션 카피
    const validText = '오늘의 예약 3건 및 인스타그램 포스트 검수가 대기 중입니다.';
    const checkValid = WorkbenchRegistry.validateUiSafety(validText);
    expect(checkValid.isValid).toBe(true);
    expect(checkValid.violations).toHaveLength(0);
  });

  it('6. 라벨 새니타이저가 불필요한 내부 라벨을 정제해야 한다', () => {
    const raw = 'Frame 1023 [Demo] 이번 주 성과 요약 dummy';
    const sanitized = sanitizeProductionDisplayLabel(raw);
    expect(sanitized).not.toContain('Frame');
    expect(sanitized).not.toContain('[Demo]');
    expect(sanitized).not.toContain('dummy');
    expect(sanitized).toContain('이번 주 성과 요약');
  });
});
