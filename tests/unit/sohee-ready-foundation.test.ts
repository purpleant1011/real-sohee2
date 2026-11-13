import { describe, it, expect, vi } from 'vitest';
import { getSoheeReadiness } from '@/features/sohee-ready/read-model';
import { requireSoheeReady } from '@/features/sohee-ready/admission-guard';
import { resolveAppShellMode } from '@/features/sohee-ready/shell-resolver';
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types';

describe('HF-01 & HF-02: SOHEE_READY Foundation & Admission Guard (Canonical Invariants)', () => {
  const mockWorkspaceId = 'ws-1111111-1111-1111-1111-111111111111';

  describe('RED-01: Pre-Ready Signup Flow Must NOT Grant Production Execution Entitlement', () => {
    it('ensures a newly signed-up workspace with only business verified is NOT production ready', async () => {
      // Given: Business verified, agreements completed, but zero SNS and zero Harness
      const readiness = await getSoheeReadiness(mockWorkspaceId);

      // Then: ready must be FALSE
      expect(readiness.ready).toBe(false);
      // And must have blockers for the unfulfilled prerequisites
      expect(readiness.blockers.length).toBeGreaterThan(0);
      expect(readiness.blockers.map((b) => b.code)).toContain('INSTAGRAM_NOT_VERIFIED');
      expect(readiness.blockers.map((b) => b.code)).toContain('THREADS_NOT_VERIFIED');
      expect(readiness.blockers.map((b) => b.code)).toContain('TEXT_HARNESS_NOT_CONFIRMED');
      expect(readiness.blockers.map((b) => b.code)).toContain('IMAGE_HARNESS_NOT_CONFIRMED');
      expect(readiness.blockers.map((b) => b.code)).toContain('OPERATING_POLICY_NOT_CONFIRMED');
    });
  });

  describe('RED-02: requireSoheeReady Admission Guard Must Fail-Closed for Pre-Ready Workspace', () => {
    it('throws SOHEE_NOT_READY error when attempting Mission creation on pre-ready workspace', async () => {
      // Given: workspace is pre-ready (SOHEE_READY = false)
      // When: requireSoheeReady is invoked for production action
      // Then: must reject with SOHEE_NOT_READY error and list blockers
      await expect(
        requireSoheeReady(mockWorkspaceId, { action: 'MISSION_CREATE' })
      ).rejects.toThrow(/SOHEE_NOT_READY/);
    });
  });

  describe('RED-03: Pre-Ready User Must Be Routed to EducationShell and NOT Full V088AppShell', () => {
    it('resolves shell mode to EDUCATION_SHELL when workspace is not ready', async () => {
      const readiness = await getSoheeReadiness(mockWorkspaceId);
      const shellMode = resolveAppShellMode(readiness);
      expect(shellMode).toBe('EDUCATION_SHELL');
    });
  });

  describe('RED-04: Instagram VERIFIED but Threads NOT VERIFIED -> SOHEE_READY must be FALSE', () => {
    it('returns ready=false and THREADS_NOT_VERIFIED blocker when only Instagram is verified', async () => {
      // Given: Instagram is verified, but Threads is missing
      const readiness = await getSoheeReadiness('ws-ig-only');
      expect(readiness.ready).toBe(false);
      const threadBlocker = readiness.blockers.find((b) => b.code === 'THREADS_NOT_VERIFIED');
      expect(threadBlocker).toBeDefined();
      expect(threadBlocker?.message).toContain('스레드');
    });
  });

  describe('RED-05: Dual SNS VERIFIED but Text Harness Missing -> SOHEE_READY must be FALSE', () => {
    it('returns ready=false and TEXT_HARNESS_NOT_CONFIRMED blocker when text harness is missing', async () => {
      // Given: Instagram and Threads verified, but Text Harness is missing
      const readiness = await getSoheeReadiness('ws-missing-text-harness');
      expect(readiness.ready).toBe(false);
      const textBlocker = readiness.blockers.find((b) => b.code === 'TEXT_HARNESS_NOT_CONFIRMED');
      expect(textBlocker).toBeDefined();
      expect(textBlocker?.message).toContain('글');
    });
  });

  describe('RED-06: All 7 Canonical Conditions TRUE -> SOHEE_READY must be TRUE', () => {
    it('returns ready=true and 0 blockers when all 7 conditions are satisfied', async () => {
      // Given: All 7 conditions are confirmed
      const readiness = await getSoheeReadiness('ws-all-7-ready');
      expect(readiness.ready).toBe(true);
      expect(readiness.blockers).toEqual([]);
      expect(readiness.facts.BUSINESS_VERIFIED.verified).toBe(true);
      expect(readiness.facts.INSTAGRAM_VERIFIED.verified).toBe(true);
      expect(readiness.facts.THREADS_VERIFIED.verified).toBe(true);
      expect(readiness.facts.BUSINESS_KNOWLEDGE_CONFIRMED.verified).toBe(true);
      expect(readiness.facts.TEXT_HARNESS_CONFIRMED.verified).toBe(true);
      expect(readiness.facts.IMAGE_HARNESS_CONFIRMED.verified).toBe(true);
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.verified).toBe(true);
    });
  });
});
