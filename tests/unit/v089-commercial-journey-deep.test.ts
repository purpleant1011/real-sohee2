import { describe, it, expect } from 'vitest';
import { calculateActivationScore } from '../../src/lib/activation/activation-engine';
import { createAutonomousCampaign } from '../../src/lib/campaigns/campaign-planner';
import { createKnowledgeEntry } from '../../src/lib/knowledge/knowledge-harness';
import { createPrivacyRequest, completePrivacyRequest } from '../../src/lib/privacy/privacy-lifecycle';
import { buildCustomer360Summary } from '../../src/lib/admin/customer-360-read-model';
import { recordInternalCost } from '../../src/lib/admin/finops-ledger';
import { acquireSessionLease, releaseSessionLease } from '../../src/lib/channels/browser-agent-vault';
import { verifyMetaWebhookSignature, parseMetaWebhookPayload } from '../../src/lib/channels/meta-webhooks';

describe('Sohee V0.8.9 & Admin V0.3 Deep Verification Suite (Linear 80 Issues Checklist)', () => {
  describe('M7: Activation & Campaigns Deep Tests', () => {
    it('should accurately calculate step-by-step activation score and next best action', () => {
      const step1 = calculateActivationScore({
        businessVerified: true,
        agreementsAccepted: false,
        storeProfileComplete: false,
        channelConnected: false,
        firstTestPublished: false
      });
      expect(step1.totalScore).toBe(25);
      expect(step1.isFullyActivated).toBe(false);
      expect(step1.nextBestAction).toContain('약관에 동의');

      const stepFull = calculateActivationScore({
        businessVerified: true,
        agreementsAccepted: true,
        storeProfileComplete: true,
        channelConnected: true,
        firstTestPublished: true
      });
      expect(stepFull.totalScore).toBe(100);
      expect(stepFull.isFullyActivated).toBe(true);
      expect(stepFull.nextBestAction).toContain('자율 마케팅을 시작');
    });

    it('should generate 7-day autonomous campaign schedule for target channels', () => {
      const campaign = createAutonomousCampaign('ws_123', '봄맞이 디저트 페스티벌', 'PROMOTE_SEASONAL_MENU', ['INSTAGRAM', 'NAVER_BLOG'], 7);
      expect(campaign.status).toBe('PLANNING');
      expect(campaign.targetChannels).toHaveLength(2);
      expect(campaign.scheduledContents).toHaveLength(2);
      expect(campaign.scheduledContents[0].status).toBe('DRAFT');
    });
  });

  describe('M1 & M2: Cloud Browser Vault & Webhook Crypto', () => {
    it('should safely manage concurrency leases for browser session', () => {
      const session = {
        workspaceId: 'ws_test',
        channelId: 'NAVER_BLOG' as const,
        accountIdentifier: 'naver_user_1',
        encryptedCookieJar: 'enc_data',
        sessionState: 'HEALTHY' as const,
        lastUsedAt: new Date().toISOString()
      };

      const { acquired, updatedSession } = acquireSessionLease(session, 'worker_A', 30000);
      expect(acquired).toBe(true);
      expect(updatedSession.leaseHolderId).toBe('worker_A');

      // worker_B should fail to acquire while worker_A holds active lease
      const conflict = acquireSessionLease(updatedSession, 'worker_B', 30000);
      expect(conflict.acquired).toBe(false);

      // Release lease
      const released = releaseSessionLease(updatedSession, 'worker_A');
      expect(released.leaseHolderId).toBeNull();
    });

    it('should verify valid HMAC-SHA256 signatures on Meta webhooks', async () => {
      const rawPayload = JSON.stringify({ object: 'instagram', entry: [] });
      const secret = 'meta_test_secret_123';

      // Generate HMAC
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(rawPayload));
      const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

      const isValid = await verifyMetaWebhookSignature(rawPayload, `sha256=${sigHex}`, secret);
      expect(isValid).toBe(true);

      const isInvalid = await verifyMetaWebhookSignature(rawPayload, 'sha256=invalidhex', secret);
      expect(isInvalid).toBe(false);
    });

    it('should parse normalized inbound events from Meta webhook payload', () => {
      const samplePayload = {
        object: 'instagram',
        entry: [
          {
            changes: [
              {
                field: 'comments',
                value: {
                  id: 'comment_999',
                  text: '영업시간이 몇시까지인가요?',
                  from: { id: 'user_1', username: 'foodie_lover' }
                }
              }
            ]
          }
        ]
      };

      const events = parseMetaWebhookPayload(samplePayload);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('COMMENT');
      expect(events[0].content).toBe('영업시간이 몇시까지인가요?');
    });
  });

  describe('M3, M4, M8 & M9: Knowledge, Admin Customer 360, FinOps & Privacy', () => {
    it('should assign provenance and approval status to knowledge entries', () => {
      const ownerEntry = createKnowledgeEntry('ws_1', 'MENU_ITEM', '시그니처 라떼', '생크림과 바닐라빈이 들어간 라떼', 'MANUAL_OWNER_INPUT');
      expect(ownerEntry.approvalStatus).toBe('APPROVED');

      const scrapedEntry = createKnowledgeEntry('ws_1', 'STORE_INFO', '네이버 지도 영업시간', '11:00 ~ 21:00', 'CHANNEL_SYNC');
      expect(scrapedEntry.approvalStatus).toBe('PENDING_REVIEW');
    });

    it('should generate complete privacy deletion receipt on account closure', () => {
      const req = createPrivacyRequest('ws_del', 'u_del', 'DELETE_WORKSPACE');
      expect(req.status).toBe('REQUESTED');

      const completed = completePrivacyRequest(req);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.receiptHash).toContain('sha256_');
    });

    it('should track FinOps cost entries and unit consumption', () => {
      const entry = recordInternalCost('ws_1', 'LLM_INFERENCE', 15.5, 1200, '댓글 생성 토큰 비용');
      expect(entry.category).toBe('LLM_INFERENCE');
      expect(entry.costInWon).toBe(15.5);
      expect(entry.unitsConsumed).toBe(1200);
    });

    it('should compute accurate Customer 360 summary and recommendations', () => {
      const summary = buildCustomer360Summary({
        workspaceId: 'ws_1',
        companyName: '테스트 카페',
        representativeName: '김대표',
        businessNumber: '120-81-47521',
        lifecycleState: 'TRIAL_ACTIVE',
        businessVerificationStatus: 'PENDING',
        trialStartedAt: new Date().toISOString(),
        trialEndsAt: null,
        creditBalance: { activation: 5000, agent: 25000, protectedWow: 10000, purchased: 0, total: 40000 },
        channels: [],
        recentAuditEventsCount: 0,
        openSupportTicketsCount: 0,
        riskScore: 10,
        createdAt: new Date().toISOString()
      });

      expect(summary.isHealthy).toBe(false);
      expect(summary.statusBadgeText).toBe('사업자 심사 대기');
      expect(summary.recommendedAction).toContain('국세청 진위 확인');
    });
  });
});
