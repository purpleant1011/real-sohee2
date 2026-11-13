/**
 * Sohee V0.9 5th Update · Wave 5 UX QA Unit Tests
 * Responsive · Accessibility · Figma Semantic Visual Regression Verification
 * 
 * Traceability: ANI-934
 */

import { describe, it, expect } from 'vitest';
import {
  UxQASemanticVerifier,
  CANONICAL_VIEWPORTS,
} from '@/features/qa/ux-qa-semantic-verifier';

describe('V0.9 Wave 5 · UxQASemanticVerifier (ANI-934)', () => {
  const verifier = new UxQASemanticVerifier();

  it('detects horizontal overflow and Korean text clipping risks on 375 mobile viewport', () => {
    // 1. Horizontal overflow failure
    const overflowRes = verifier.verifyResponsiveLayout({
      viewport: CANONICAL_VIEWPORTS.MOBILE_375,
      renderedElementWidthPx: 420, // 375 초과
      koreanText: '정상 텍스트',
      hasTextWrap: true,
    });
    expect(overflowRes.isValid).toBe(false);
    expect(overflowRes.violation).toContain('가로 오버플로 감지');

    // 2. Korean long-copy clipping without text-wrap
    const clippingRes = verifier.verifyResponsiveLayout({
      viewport: CANONICAL_VIEWPORTS.MOBILE_375,
      renderedElementWidthPx: 350,
      koreanText: '원장님 이번 주말 예약 슬롯이 모두 마감되었으며 다음 주 월요일 프로모션을 시작합니다.',
      hasTextWrap: false,
    });
    expect(clippingRes.isValid).toBe(false);
    expect(clippingRes.violation).toContain('한국어 장문 클리핑 위험');

    // 3. Valid responsive layout
    const validRes = verifier.verifyResponsiveLayout({
      viewport: CANONICAL_VIEWPORTS.MOBILE_375,
      renderedElementWidthPx: 350,
      koreanText: '정상 텍스트 줄바꿈 적용',
      hasTextWrap: true,
    });
    expect(validRes.isValid).toBe(true);
  });

  it('validates WCAG AA contrast, focus-visible outlines, and dynamic status live-regions', () => {
    // Contrast failure (< 4.5:1)
    const lowContrastRes = verifier.verifyAccessibility({
      contrastRatio: 3.2,
      isLargeText: false,
      hasLiveRegionForStatus: true,
      hasFocusVisibleStyle: true,
    });
    expect(lowContrastRes.isValid).toBe(false);
    expect(lowContrastRes.violation).toContain('WCAG AA 명도 대비율 위반');

    // Missing live-region
    const noLiveRes = verifier.verifyAccessibility({
      contrastRatio: 5.5,
      isLargeText: false,
      hasLiveRegionForStatus: false,
      hasFocusVisibleStyle: true,
    });
    expect(noLiveRes.isValid).toBe(false);
    expect(noLiveRes.violation).toContain('상태 변화 알림 누락');

    // Valid accessibility
    const validRes = verifier.verifyAccessibility({
      contrastRatio: 7.1,
      isLargeText: false,
      hasLiveRegionForStatus: true,
      hasFocusVisibleStyle: true,
    });
    expect(validRes.isValid).toBe(true);
  });

  it('scans and eliminates internal/figma/sample/invalid-calendar labels from production output', () => {
    const dirtyHtml = `
      <div class="card">
        <span>https://figma.com/file/1234?node-id=64-1889</span>
        <span>sample_user_account</span>
        <span>2026년 9월 32일 목요일</span>
      </div>
    `;

    const dirtyScan = verifier.scanForForbiddenInternalLabels(dirtyHtml);
    expect(dirtyScan.hasViolations).toBe(true);
    expect(dirtyScan.detectedViolations.length).toBeGreaterThanOrEqual(3);

    const cleanHtml = `
      <div class="card">
        <span>강남 프라임 피부과</span>
        <span>2026년 9월 7일 월요일</span>
      </div>
    `;

    const cleanScan = verifier.scanForForbiddenInternalLabels(cleanHtml);
    expect(cleanScan.hasViolations).toBe(false);
    expect(cleanScan.detectedViolations.length).toBe(0);
  });

  it('enforces semantic badge rules: VERIFIED requires evidenceId, BLOCKED requires reason', () => {
    // VERIFIED without evidenceId -> False-Green violation
    const falseGreenRes = verifier.verifyBadgeSemantics({
      state: 'VERIFIED',
    });
    expect(falseGreenRes.isValid).toBe(false);
    expect(falseGreenRes.violation).toContain('False-Green 위반');

    // VERIFIED with evidenceId -> Valid
    const validVerifiedRes = verifier.verifyBadgeSemantics({
      state: 'VERIFIED',
      evidenceId: 'ev_proof_12345',
    });
    expect(validVerifiedRes.isValid).toBe(true);

    // BLOCKED without reason -> Violation
    const noReasonRes = verifier.verifyBadgeSemantics({
      state: 'BLOCKED',
    });
    expect(noReasonRes.isValid).toBe(false);
    expect(noReasonRes.violation).toContain('사유(reason)가 필수');
  });
});
