import { describe, it, expect } from 'vitest';
import { CustomerCrmService } from '@/lib/crm/customer-crm-service';
import { CustomerIdentity } from '@/types/customer-crm';

describe('ANI-944: Dataset Mode Isolation — CustomerCrmService', () => {
  const workspaceId = 'ws-production-actual';

  it('1. getCustomers with datasetMode === "ACTUAL" must NOT return CANARY or TEST records', () => {
    const customers = CustomerCrmService.getCustomers(workspaceId, { datasetMode: 'ACTUAL' });

    expect(Array.isArray(customers)).toBe(true);

    // Any returned customer must have datasetMode === 'ACTUAL'
    customers.forEach((customer: CustomerIdentity) => {
      expect(customer.datasetMode).toBe('ACTUAL');
      expect(customer.name).not.toMatch(/canary|test/i);
      expect(customer.customerId).not.toMatch(/canary|test/i);
    });

    // Ensure Canary fixtures like "김민지 (Canary)" never leak into ACTUAL mode
    const hasCanaryName = customers.some(c => c.name.includes('Canary') || c.name.includes('김민지 (Canary)'));
    expect(hasCanaryName).toBe(false);
  });

  it('2. getCustomers with default options (no datasetMode specified) defaults to ACTUAL mode (Fail-Closed)', () => {
    const customers = CustomerCrmService.getCustomers(workspaceId);

    expect(Array.isArray(customers)).toBe(true);

    // Fail-Closed: Default must be ACTUAL mode
    customers.forEach((customer: CustomerIdentity) => {
      expect(customer.datasetMode).toBe('ACTUAL');
      expect(customer.name).not.toMatch(/canary|test/i);
    });
  });

  it('3. getCustomers with datasetMode === "CANARY" returns CANARY records', () => {
    const canaryCustomers = CustomerCrmService.getCustomers(workspaceId, { datasetMode: 'CANARY' });

    expect(Array.isArray(canaryCustomers)).toBe(true);
    expect(canaryCustomers.length).toBeGreaterThan(0);

    const hasCanary = canaryCustomers.some(c => c.datasetMode === 'CANARY' || c.name.includes('Canary'));
    expect(hasCanary).toBe(true);
  });

  it('4. getCustomers with datasetMode === "TEST" returns TEST records', () => {
    const testCustomers = CustomerCrmService.getCustomers(workspaceId, { datasetMode: 'TEST' });

    expect(Array.isArray(testCustomers)).toBe(true);
    expect(testCustomers.length).toBeGreaterThan(0);

    const hasTest = testCustomers.some(c => c.datasetMode === 'TEST' || c.name.includes('Test') || c.name.includes('테스트'));
    expect(hasTest).toBe(true);
  });

  it('5. filters external mixed customer list strictly when datasetMode is ACTUAL', () => {
    const mixedRecords: CustomerIdentity[] = [
      {
        customerId: 'cust_real_999',
        workspaceId,
        name: '정진우',
        phone: '010-1111-2222',
        channels: [{ channel: 'instagram', handle: '@jinwoo', externalUserId: 'u1', consentStatus: 'CONSENTED', consentedAt: null }],
        provenance: { firstTouchChannel: 'instagram', joinedAt: '2026-09-01T00:00:00.000Z' },
        vipLevel: 'NEW',
        requiresHumanHandoff: false,
        datasetMode: 'ACTUAL',
      },
      {
        customerId: 'cust_canary_888',
        workspaceId,
        name: '김민지 (Canary)',
        channels: [{ channel: 'instagram', handle: '@minji_canary', externalUserId: 'u2', consentStatus: 'CONSENTED', consentedAt: null }],
        provenance: { firstTouchChannel: 'instagram', joinedAt: '2026-09-01T00:00:00.000Z' },
        vipLevel: 'VIP',
        requiresHumanHandoff: false,
        datasetMode: 'CANARY',
      },
      {
        customerId: 'cust_test_777',
        workspaceId,
        name: '테스트 계정',
        channels: [{ channel: 'kakao', handle: '@test', externalUserId: 'u3', consentStatus: 'CONSENTED', consentedAt: null }],
        provenance: { firstTouchChannel: 'kakao', joinedAt: '2026-09-01T00:00:00.000Z' },
        vipLevel: 'NEW',
        requiresHumanHandoff: false,
        datasetMode: 'TEST',
      },
    ];

    const filtered = CustomerCrmService.filterCustomersByMode(mixedRecords, 'ACTUAL');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].customerId).toBe('cust_real_999');
    expect(filtered[0].name).toBe('정진우');
  });

  it('6. excludes Korean keyword records (테스트 고객, 카나리 계정) in ACTUAL mode (Defense-in-depth)', () => {
    const recordsWithKoreanKeywords: CustomerIdentity[] = [
      {
        customerId: 'cust_real_001',
        workspaceId,
        name: '정상 고객',
        channels: [],
        provenance: { firstTouchChannel: 'instagram', joinedAt: '2026-09-01T00:00:00.000Z' },
        vipLevel: 'NEW',
        requiresHumanHandoff: false,
        datasetMode: 'ACTUAL',
      },
      {
        // Even if datasetMode is incorrectly marked as ACTUAL, Korean keyword must block it
        customerId: 'cust_002',
        workspaceId,
        name: '테스트 고객',
        channels: [],
        provenance: { firstTouchChannel: 'instagram', joinedAt: '2026-09-01T00:00:00.000Z' },
        vipLevel: 'NEW',
        requiresHumanHandoff: false,
        datasetMode: 'ACTUAL',
      },
      {
        // Korean keyword in customerId
        customerId: 'cust_카나리_003',
        workspaceId,
        name: '카나리 계정',
        channels: [],
        provenance: { firstTouchChannel: 'instagram', joinedAt: '2026-09-01T00:00:00.000Z' },
        vipLevel: 'VIP',
        requiresHumanHandoff: false,
        datasetMode: 'ACTUAL',
      },
    ];

    const actualCustomers = CustomerCrmService.filterCustomersByMode(recordsWithKoreanKeywords, 'ACTUAL');
    expect(actualCustomers).toHaveLength(1);
    expect(actualCustomers[0].name).toBe('정상 고객');

    const hasKoreanTest = actualCustomers.some(c => c.name.includes('테스트') || c.customerId.includes('테스트'));
    const hasKoreanCanary = actualCustomers.some(c => c.name.includes('카나리') || c.customerId.includes('카나리'));
    expect(hasKoreanTest).toBe(false);
    expect(hasKoreanCanary).toBe(false);
  });
});
