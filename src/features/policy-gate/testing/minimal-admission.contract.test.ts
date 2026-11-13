import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkMinimalAdmission,
  createMinimalAdmissionEvaluator,
  type Controls,
  type Context,
  type Scope,
  type Evaluator,
} from './minimal-admission';

describe('minimal-admission contract tests', () => {
  const createFetchSpy = () => vi.spyOn(globalThis, 'fetch');
  let fetchSpy: ReturnType<typeof createFetchSpy>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    fetchSpy = createFetchSpy();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fetchSpy.mockRestore();
  });

  const validWorkspaceId = '11111111-2222-3333-4444-555555555555';
  const otherWorkspaceId = '99999999-8888-7777-6666-555555555555';

  const validScope: Scope = {
    workspaceId: validWorkspaceId,
    provider: 'portone',
    action: 'payment',
    operationKey: 'op-valid-1',
  };

  const validControls: Controls = {
    mode: 'TEST_FAKE_ONLY',
    datasetMode: 'TEST',
    allowedWorkspaceIds: [validWorkspaceId],
    killSwitch: false,
  };

  const readyEvaluator: Evaluator = () => ({
    ready: true,
  });

  it('verifies zero external HTTP calls occur during admission checks', async () => {
    const context: Context = {
      controls: validControls,
      now: new Date('2026-10-22T10:00:00.000Z'),
      evaluator: readyEvaluator,
    };
    const result = await checkMinimalAdmission(context, validScope);
    expect(result.kind).toBe('ADMITTED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('parameterized denial matrix', () => {
    it('denies when controls are missing/undefined', async () => {
      const context: Context = {
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
      expect(result.actualVerified).toBe(false);
    });

    it('denies when mode is OFF', async () => {
      const context: Context = {
        controls: { ...validControls, mode: 'OFF' },
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it.each(['ACTUAL', 'SHOWCASE_DEMO'] as const)(
      'denies non-TEST datasetMode: %s',
      async (datasetMode) => {
        const context: Context = {
          controls: { ...validControls, datasetMode },
          now: new Date('2026-10-22T10:00:00.000Z'),
          evaluator: readyEvaluator,
        };
        const result = await checkMinimalAdmission(context, validScope);
        expect(result.kind).toBe('DENIED');
        if (result.kind === 'DENIED') {
          expect(result.requestedDataset).toBe(datasetMode);
        }
      }
    );

    it('denies when NODE_ENV is production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it.each([
      true,
      undefined,
      'true' as unknown as boolean,
      'false' as unknown as boolean,
      1 as unknown as boolean,
    ])('denies non-strict-false killSwitch: %s', async (killSwitch) => {
      const context: Context = {
        controls: { ...validControls, killSwitch: killSwitch as unknown as boolean },
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it('denies empty allowedWorkspaceIds array', async () => {
      const context: Context = {
        controls: { ...validControls, allowedWorkspaceIds: [] },
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it('denies wildcard * in allowedWorkspaceIds', async () => {
      const context: Context = {
        controls: { ...validControls, allowedWorkspaceIds: ['*'] },
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it('denies foreign UUID not in allowedWorkspaceIds', async () => {
      const context: Context = {
        controls: { ...validControls, allowedWorkspaceIds: [validWorkspaceId] },
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, {
        ...validScope,
        workspaceId: otherWorkspaceId,
      });
      expect(result.kind).toBe('DENIED');
    });

    it('denies non-UUID or malformed workspaceId', async () => {
      const context: Context = {
        controls: { ...validControls, allowedWorkspaceIds: ['not-a-uuid'] },
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, {
        ...validScope,
        workspaceId: 'not-a-uuid',
      });
      expect(result.kind).toBe('DENIED');
    });

    it('denies invalid now Date', async () => {
      const context: Context = {
        controls: validControls,
        now: new Date('invalid-date'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it.each([
      { provider: 'kakao' as const, action: 'payment' as const },
      { provider: 'kakao' as const, action: 'refund' as const },
      { provider: 'portone' as const, action: 'message' as const },
    ])('denies mismatched provider-action pair: %o', async ({ provider, action }) => {
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, {
        ...validScope,
        provider,
        action,
      });
      expect(result.kind).toBe('DENIED');
    });

    it('denies when evaluator is missing', async () => {
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });

    it('denies when evaluator returns ready=false', async () => {
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: () => ({
          ready: false,
          reason: 'CAPABILITY_UNSUPPORTED',
          manualAlternative: 'manual-flow',
        }),
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
      if (result.kind === 'DENIED') {
        expect(result.reason).toContain('CAPABILITY_UNSUPPORTED');
        expect(result.manualAlternative).toBe('manual-flow');
      }
    });

    it('denies when evaluator throws an exception without exposing raw secret', async () => {
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: () => {
          throw new Error('secret-key-evaluator-crash');
        },
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
      if (result.kind === 'DENIED') {
        expect(result.reason).not.toContain('secret-key-evaluator-crash');
        expect(result.reason).toBe('EVALUATOR_ERROR');
      }
    });

    it('denies when evaluator returns non-boolean ready (truthy string)', async () => {
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: () => ({
          ready: 'true' as unknown as boolean,
        }),
      };
      const result = await checkMinimalAdmission(context, validScope);
      expect(result.kind).toBe('DENIED');
    });
  });

  describe('successful admission', () => {
    it.each([
      { provider: 'portone' as const, action: 'payment' as const },
      { provider: 'portone' as const, action: 'refund' as const },
      { provider: 'kakao' as const, action: 'message' as const },
    ])('admits valid matching pair: %o', async ({ provider, action }) => {
      const context: Context = {
        controls: validControls,
        now: new Date('2026-10-22T10:00:00.000Z'),
        evaluator: readyEvaluator,
      };
      const result = await checkMinimalAdmission(context, {
        ...validScope,
        provider,
        action,
      });
      expect(result.kind).toBe('ADMITTED');
      if (result.kind === 'ADMITTED') {
        expect(result.datasetMode).toBe('TEST');
        expect(result.actualVerified).toBe(false);
        expect(result.scope.action).toBe(action);
        expect(result.scope.provider).toBe(provider);
      }
    });
  });

  describe('production factory safety', () => {
    it('refuses production instantiation when createMinimalAdmissionEvaluator called under production NODE_ENV', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => createMinimalAdmissionEvaluator()).toThrow(/PRODUCTION_FORBIDDEN/);
    });
  });
});
