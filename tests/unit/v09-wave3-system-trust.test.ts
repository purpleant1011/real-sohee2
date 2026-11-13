/**
 * Tests for Sohee V0.9 Wave 3 System Trust Center & Parity
 * Traceability: ANI-931
 */

import { describe, it, expect } from 'vitest';
import { SystemTrustService } from '@/lib/system-trust/system-trust-service';
import { ChannelConnectionRecord, SystemTrustCenterState } from '@/types/system-trust';

describe('V0.9 Wave 3 · System Account & Trust Center (ANI-931)', () => {
  const sampleConnections: ChannelConnectionRecord[] = [
    {
      connectionId: 'conn-ig-01',
      workspaceId: 'ws-gangnam',
      channel: 'instagram',
      channelLabel: '인스타그램 비즈니스',
      accountHandle: 'studio_by.reum',
      status: 'CONNECTED',
      grantedScopes: ['instagram_basic', 'instagram_content_publish'],
      connectedAt: '2026-08-20T10:00:00.000Z',
      lastUsedAt: null,
    },
    {
      connectionId: 'conn-naver-02',
      workspaceId: 'ws-gangnam',
      channel: 'naver',
      channelLabel: '네이버 블로그',
      accountHandle: 'byreum_official',
      status: 'CONNECTED',
      grantedScopes: ['blog_write'],
      connectedAt: '2026-08-22T10:00:00.000Z',
      lastUsedAt: null,
    },
  ];

  it('1. 외부 채널 권한 철회(Revoke) 시 상태가 전이되고 불변 감사 기록이 생성되어야 한다', () => {
    const { updatedConnections, auditRecord } = SystemTrustService.revokeChannelConnection({
      workspaceId: 'ws-gangnam',
      connectionId: 'conn-ig-01',
      connections: sampleConnections,
      performer: '원장님',
    });

    const target = updatedConnections.find(c => c.connectionId === 'conn-ig-01');
    expect(target).toBeDefined();
    expect(target?.status).toBe('REVOKED');
    expect(auditRecord.actionType).toBe('REVOKE_CHANNEL');
    expect(auditRecord.readbackVerified).toBe(true);
    expect(auditRecord.details).toContain('인스타그램 비즈니스');
    expect(auditRecord.details).toContain('철회');
  });

  it('2. 개인정보 및 고객 정본 데이터 내보내기(Export) 요청 시 감사 기록과 다이제스트가 발급되어야 한다', () => {
    const { exportArchiveDigest, auditRecord } = SystemTrustService.exportAccountData({
      workspaceId: 'ws-gangnam',
      performer: '원장님',
    });

    expect(exportArchiveDigest).toContain('export_sha256_');
    expect(auditRecord.actionType).toBe('EXPORT_DATA');
    expect(auditRecord.readbackVerified).toBe(true);
  });

  it('3. 서비스 의존성 건강도는 실측 Source, Freshness, Latency를 정확히 제공해야 한다', () => {
    const health = SystemTrustService.getCanonicalDependenciesHealth();
    expect(health.length).toBeGreaterThanOrEqual(4);

    for (const dep of health) {
      expect(dep.serviceName).toBeTruthy();
      expect(dep.source).toBeTruthy();
      expect(dep.freshness).toBeTruthy();
      expect(dep.latencyMs).toBeGreaterThan(0);
      expect(dep.status).toBe('HEALTHY');
    }
  });

  it('4. Dock 지시 "인스타 권한 끊어줘" 및 "크레딧 내역 보여줘"가 실제 read/write를 수행해야 한다', () => {
    const state: SystemTrustCenterState = {
      workspaceId: 'ws-gangnam',
      account: {
        businessName: '바이름 뷰티',
        ownerName: '원장님',
        businessNumber: '134-87-02941',
        location: '인천 서구 청라',
        contactEmail: 'owner@byreum.beauty',
      },
      planCredits: {
        planTier: 'PRO',
        creditBalance: 380000,
        externalAdSpendTotalKrw: 24000,
        monthlyCreditCapacity: 500000,
      },
      connections: sampleConnections,
      health: [],
      audits: [],
    };

    // 4-1. 인스타 권한 해제 지시
    const res1 = SystemTrustService.handleDockCommand('인스타 권한 끊어줘', state);
    expect(res1.actionExecuted).toBe(true);
    expect(res1.responseMessage).toContain('권한을 안전하게 철회');
    expect(res1.newState?.connections.find(c => c.channel === 'instagram')?.status).toBe('REVOKED');

    // 4-2. 크레딧 내역 및 분리 원장 조회 지시
    const res2 = SystemTrustService.handleDockCommand('크레딧 내역 보여줘', state);
    expect(res2.actionExecuted).toBe(true);
    expect(res2.responseMessage).toContain('380,000');
    expect(res2.responseMessage).toContain('외부 광고 집행 누적액');
  });
});
