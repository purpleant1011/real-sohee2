import { describe, it, expect } from 'vitest';
import { CustomerCrmService } from '@/lib/crm/customer-crm-service';
import { PaymentTransaction } from '@/types/customer-crm';
import { CustomerReservationRevenueEngine } from '@/features/marketing-agent/engine/customer-reservation-revenue';

describe('Revenue & Payment Truth Lineage (ANI-945)', () => {
  describe('CustomerCrmService.calculateVerifiedRevenue', () => {
    it('only aggregates COMPLETED payments with valid evidenceId', () => {
      const transactions: PaymentTransaction[] = [
        {
          transactionId: 'tx_001',
          workspaceId: 'ws_test',
          bookingId: 'bk_001',
          customerId: 'cust_001',
          amountKrw: 100000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_pg_001',
        },
        {
          transactionId: 'tx_002',
          workspaceId: 'ws_test',
          bookingId: 'bk_002',
          customerId: 'cust_002',
          amountKrw: 50000,
          paymentType: 'DEPOSIT',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T11:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_pg_002',
        },
        {
          transactionId: 'tx_003',
          workspaceId: 'ws_test',
          bookingId: 'bk_003',
          customerId: 'cust_003',
          amountKrw: 80000,
          paymentType: 'FULL',
          paymentStatus: 'PENDING', // 미완료 결제
          paidAt: '2026-09-01T12:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_pg_003',
        },
        {
          transactionId: 'tx_004',
          workspaceId: 'ws_test',
          bookingId: 'bk_004',
          customerId: 'cust_004',
          amountKrw: 70000,
          paymentType: 'FULL',
          paymentStatus: 'FAILED', // 실패 결제
          paidAt: '2026-09-01T13:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_pg_004',
        },
      ];

      const result = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'ACTUAL' });
      expect(result.totalKrw).toBe(150000);
      expect(result.verifiedCount).toBe(2);
      expect(result.hasMissingSource).toBe(false);
    });

    it('rejects payments missing evidenceId (Fail-Closed, zero fabrication)', () => {
      const transactions: PaymentTransaction[] = [
        {
          transactionId: 'tx_valid',
          workspaceId: 'ws_test',
          bookingId: 'bk_valid',
          customerId: 'cust_valid',
          amountKrw: 120000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_real_123',
        },
        {
          transactionId: 'tx_no_evidence_1',
          workspaceId: 'ws_test',
          bookingId: 'bk_fake_1',
          customerId: 'cust_fake_1',
          amountKrw: 120000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          // missing evidenceId
        },
        {
          transactionId: 'tx_no_evidence_2',
          workspaceId: 'ws_test',
          bookingId: 'bk_fake_2',
          customerId: 'cust_fake_2',
          amountKrw: 120000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: '   ', // whitespace only
        },
      ];

      const result = CustomerCrmService.calculateVerifiedRevenue(transactions);
      expect(result.totalKrw).toBe(120000);
      expect(result.verifiedCount).toBe(1);
      expect(result.hasMissingSource).toBe(true);
      expect(result.rejectedCount).toBe(2);
    });

    it('correctly deducts REFUND payments from total revenue', () => {
      const transactions: PaymentTransaction[] = [
        {
          transactionId: 'tx_100',
          workspaceId: 'ws_test',
          bookingId: 'bk_100',
          customerId: 'cust_100',
          amountKrw: 200000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_pg_100',
        },
        {
          transactionId: 'tx_101',
          workspaceId: 'ws_test',
          bookingId: 'bk_100',
          customerId: 'cust_100',
          amountKrw: 50000,
          paymentType: 'REFUND',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-02T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_refund_101',
        },
      ];

      const result = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'ACTUAL' });
      expect(result.totalKrw).toBe(150000);
      expect(result.refundCount).toBe(1);
      expect(result.refundedAmountKrw).toBe(50000);
    });

    it('strictly isolates CANARY and TEST payment records from ACTUAL revenue', () => {
      const transactions: PaymentTransaction[] = [
        {
          transactionId: 'tx_actual',
          workspaceId: 'ws_test',
          bookingId: 'bk_actual',
          customerId: 'cust_actual',
          amountKrw: 150000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_pg_act',
        },
        {
          transactionId: 'tx_canary',
          workspaceId: 'ws_test',
          bookingId: 'bk_canary',
          customerId: 'cust_canary',
          amountKrw: 888000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'CANARY',
          evidenceId: 'receipt_canary_001',
        },
        {
          transactionId: 'tx_test',
          workspaceId: 'ws_test',
          bookingId: 'bk_test',
          customerId: 'cust_test',
          amountKrw: 999000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'TEST',
          evidenceId: 'receipt_test_001',
        },
      ];

      // 1. Default / ACTUAL mode: MUST NOT include CANARY or TEST
      const actualResult = CustomerCrmService.calculateVerifiedRevenue(transactions);
      expect(actualResult.totalKrw).toBe(150000);
      expect(actualResult.verifiedCount).toBe(1);

      // 2. CANARY mode: ONLY includes CANARY
      const canaryResult = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'CANARY' });
      expect(canaryResult.totalKrw).toBe(888000);
      expect(canaryResult.verifiedCount).toBe(1);

      // 3. TEST mode: ONLY includes TEST
      const testResult = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'TEST' });
      expect(testResult.totalKrw).toBe(999000);
      expect(testResult.verifiedCount).toBe(1);

      // 4. Invalid mode: Fail-Closed to 0
      const invalidResult = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'UNKNOWN' as any });
      expect(invalidResult.totalKrw).toBe(0);
      expect(invalidResult.verifiedCount).toBe(0);
    });

    it('rejects payments with invalid numbers (NaN, Infinity) or negative non-refund amounts (Fail-Closed)', () => {
      const transactions: PaymentTransaction[] = [
        {
          transactionId: 'tx_valid',
          workspaceId: 'ws_test',
          bookingId: 'bk_valid',
          customerId: 'cust_valid',
          amountKrw: 100000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_valid',
        },
        {
          transactionId: 'tx_nan',
          workspaceId: 'ws_test',
          bookingId: 'bk_nan',
          customerId: 'cust_nan',
          amountKrw: NaN,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_nan',
        },
        {
          transactionId: 'tx_infinity',
          workspaceId: 'ws_test',
          bookingId: 'bk_inf',
          customerId: 'cust_inf',
          amountKrw: Infinity,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_inf',
        },
        {
          transactionId: 'tx_negative',
          workspaceId: 'ws_test',
          bookingId: 'bk_neg',
          customerId: 'cust_neg',
          amountKrw: -50000, // 음수 일반 결제 유입
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_neg',
        },
      ];

      const result = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'ACTUAL' });
      expect(result.totalKrw).toBe(100000);
      expect(result.verifiedCount).toBe(1);
      expect(result.rejectedCount).toBe(3);
    });

    it('defends against CANARY/TEST keyword leakage in transactionId and customerId in ACTUAL mode (Defense-in-depth)', () => {
      const transactions: PaymentTransaction[] = [
        {
          transactionId: 'tx_clean_001',
          workspaceId: 'ws_test',
          bookingId: 'bk_clean_001',
          customerId: 'cust_clean_001',
          amountKrw: 70000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_clean_001',
        },
        {
          transactionId: 'tx_leak_001',
          workspaceId: 'ws_test',
          bookingId: 'bk_leak_001',
          customerId: 'cust_canary_secret',
          amountKrw: 70000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_leak_001',
        },
        {
          transactionId: 'tx_test_leak_002',
          workspaceId: 'ws_test',
          bookingId: 'bk_leak_002',
          customerId: 'cust_clean_002',
          amountKrw: 70000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_leak_002',
        },
        {
          transactionId: 'tx_leak_003',
          workspaceId: 'ws_test',
          bookingId: 'bk_leak_003',
          customerId: '고객_카나리_003',
          amountKrw: 70000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_leak_003',
        },
        {
          transactionId: 'tx_테스트_결제_004',
          workspaceId: 'ws_test',
          bookingId: 'bk_leak_004',
          customerId: 'cust_clean_004',
          amountKrw: 70000,
          paymentType: 'FULL',
          paymentStatus: 'COMPLETED',
          paidAt: '2026-09-01T10:00:00Z',
          datasetMode: 'ACTUAL',
          evidenceId: 'receipt_leak_004',
        },
      ];

      const result = CustomerCrmService.calculateVerifiedRevenue(transactions, { datasetMode: 'ACTUAL' });
      expect(result.totalKrw).toBe(70000);
      expect(result.verifiedCount).toBe(1);
      expect(result.rejectedCount).toBe(4);
    });
  });

  describe('CustomerReservationRevenueEngine.confirmReservation', () => {
    it('does NOT fabricate 120,000 KRW revenue upon booking confirmation without deposit payment', () => {
      const engine = new CustomerReservationRevenueEngine();
      const customer = engine.findOrCreateCustomer({
        workspaceId: 'fixture:TEST:marketing',
        channel: 'instagram',
        channelUserId: 'user_123',
        displayName: '이예약',
      });

      const reservation = engine.createReservationProposal({
        workspaceId: 'fixture:TEST:marketing',
        customerId: customer.id,
        serviceId: 'srv-balayage-01',
        serviceName: '디자인 시술',
        proposedSlots: ['2026-09-10T14:00:00+09:00'],
        sourceChannel: 'instagram',
        sourceConversationId: 'conv_123',
      });

      // Missing payment is unobserved, not a measured zero or a fabricated price.
      const confirmed = engine.confirmReservation(reservation.id, '2026-09-10T14:00:00+09:00');
      expect(confirmed.status).toBe('CONFIRMED');

      const traces = engine.getRevenueTraces('fixture:TEST:marketing');
      expect(traces).toHaveLength(1);
      expect(traces[0].realizedRevenue).toBeNull();
      expect(traces[0].realizedRevenue).not.toBe(120000);
    });

    it('records verified deposit amount when deposit is actually paid upon confirmation', () => {
      const engine = new CustomerReservationRevenueEngine();
      const customer = engine.findOrCreateCustomer({
        workspaceId: 'fixture:TEST:marketing',
        channel: 'instagram',
        channelUserId: 'user_456',
        displayName: '김결제',
      });

      const reservation = engine.createReservationProposal({
        workspaceId: 'fixture:TEST:marketing',
        customerId: customer.id,
        serviceId: 'srv-balayage-01',
        serviceName: '디자인 시술',
        proposedSlots: ['2026-09-10T16:00:00+09:00'],
        sourceChannel: 'instagram',
        sourceConversationId: 'conv_456',
      });

      // Confirm with 30,000 KRW deposit
      const confirmed = engine.confirmReservation(reservation.id, '2026-09-10T16:00:00+09:00', 30000);
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.depositAmount).toBe(30000);

      const traces = engine.getRevenueTraces('fixture:TEST:marketing');
      expect(traces).toHaveLength(1);
      expect(traces[0].realizedRevenue).toBe(30000);
    });

    it('clamps negative depositPaidAmount to 0 upon confirmation', () => {
      const engine = new CustomerReservationRevenueEngine();
      const customer = engine.findOrCreateCustomer({
        workspaceId: 'fixture:TEST:marketing',
        channel: 'instagram',
        channelUserId: 'user_neg',
        displayName: '박음수',
      });

      const reservation = engine.createReservationProposal({
        workspaceId: 'fixture:TEST:marketing',
        customerId: customer.id,
        serviceId: 'srv-balayage-01',
        serviceName: '디자인 시술',
        proposedSlots: ['2026-09-10T18:00:00+09:00'],
        sourceChannel: 'instagram',
        sourceConversationId: 'conv_neg',
      });

      // Confirm with negative deposit amount (-20,000 KRW)
      const confirmed = engine.confirmReservation(reservation.id, '2026-09-10T18:00:00+09:00', -20000);
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.depositAmount).toBe(0);

      const traces = engine.getRevenueTraces('fixture:TEST:marketing');
      expect(traces).toHaveLength(1);
      expect(traces[0].realizedRevenue).toBe(0);
    });
  });
});
