/**
 * Unified Tool Execution Envelope (ANI-975)
 * 
 * Standardizes execution specification for both external MCP servers and internal domain adapters.
 * 
 * 9 Required Fields:
 * - workspaceId
 * - actorId
 * - sessionId
 * - goalId
 * - actionRunId
 * - stepIndex
 * - capabilityId
 * - inputPayload
 * - idempotencyKey
 */

import { randomUUID } from 'crypto';
import { resolveCapabilityId } from '@/lib/agent-os/mcp-capability-registry';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import {
  ToolAdmissionController,
  CapabilityNotReadyError,
  AdmissionOptions,
} from './tool-admission-controller';
import type { ToolExecutionContext } from '@/features/tool-runtime/types';

export type TransportType = 'INTERNAL_DOMAIN' | 'EXTERNAL_MCP' | 'BROWSER';

export interface ToolExecutionEnvelope {
  envelopeId: string;
  workspaceId: string;
  actorId: string;
  sessionId: string;
  goalId: string;
  actionRunId: string;
  stepIndex: number;
  capabilityId: string;
  inputPayload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
  transportType?: TransportType;
  intentMode?: 'DRAFT' | 'EXECUTE';
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionEnvelopeInput {
  envelopeId?: string;
  workspaceId: string;
  actorId: string;
  sessionId: string;
  goalId: string;
  actionRunId: string;
  stepIndex: number;
  capabilityId: string;
  inputPayload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
  transportType?: TransportType;
  intentMode?: 'DRAFT' | 'EXECUTE';
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionEnvelopeResult {
  envelopeId: string;
  capabilityId: string;
  success: boolean;
  status: string;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  evidence?: Record<string, unknown> | any;
  proposal?: {
    proposalId: string;
    title: string;
    description?: string;
    capabilityId?: string;
    diffPayload?: Record<string, unknown>;
    [key: string]: unknown;
  };
  creditDeducted?: number;
  logs?: string[];
  isIdempotentReplay?: boolean;
  executedAt: string;
  durationMs?: number;
}

const REQUIRED_FIELDS: (keyof ToolExecutionEnvelope)[] = [
  'workspaceId',
  'actorId',
  'sessionId',
  'goalId',
  'actionRunId',
  'stepIndex',
  'capabilityId',
  'inputPayload',
  'idempotencyKey',
];

/**
 * Validates that all 9 required fields are present and valid.
 */
export function validateToolExecutionEnvelope(envelope: unknown): {
  valid: boolean;
  missingFields: string[];
} {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, missingFields: [...REQUIRED_FIELDS] };
  }

  const record = envelope as Record<string, unknown>;
  const missingFields: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const val = record[field];
    if (val === undefined || val === null) {
      missingFields.push(field);
    } else if (typeof val === 'string' && val.trim() === '') {
      missingFields.push(field);
    } else if (field === 'stepIndex' && (typeof val !== 'number' || val < 0)) {
      missingFields.push(field);
    } else if (field === 'inputPayload' && (typeof val !== 'object' || Array.isArray(val))) {
      missingFields.push(field);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Creates and formats a canonical ToolExecutionEnvelope
 */
export function createToolExecutionEnvelope(input: ToolExecutionEnvelopeInput): ToolExecutionEnvelope {
  return {
    envelopeId: input.envelopeId || `env-${randomUUID()}`,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    goalId: input.goalId,
    actionRunId: input.actionRunId,
    stepIndex: input.stepIndex,
    capabilityId: resolveCapabilityId(input.capabilityId),
    inputPayload: input.inputPayload || {},
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    transportType: input.transportType || 'INTERNAL_DOMAIN',
    intentMode: input.intentMode || 'DRAFT',
    createdAt: input.createdAt || new Date().toISOString(),
    metadata: input.metadata,
  };
}

/**
 * Executor for Unified ToolExecutionEnvelope
 */
export class ToolExecutionEnvelopeExecutor {
  // Idempotency cache: `${workspaceId}:${idempotencyKey}` -> ToolExecutionEnvelopeResult
  private static idempotencyCache: Map<string, ToolExecutionEnvelopeResult> = new Map();

  public static clearCache(): void {
    this.idempotencyCache.clear();
  }

  /**
   * Execute an envelope with preflight admission and idempotency replay
   */
  public static async execute(
    envelope: ToolExecutionEnvelope,
    options?: AdmissionOptions & { executionContext?: Partial<ToolExecutionContext> }
  ): Promise<ToolExecutionEnvelopeResult> {
    const startTime = Date.now();
    const executedAt = new Date().toISOString();

    // 1. Validate envelope integrity
    const validation = validateToolExecutionEnvelope(envelope);
    if (!validation.valid) {
      return {
        envelopeId: envelope.envelopeId || 'unknown',
        capabilityId: envelope.capabilityId || 'unknown',
        success: false,
        status: 'FAILED',
        error: {
          code: 'MALFORMED_ENVELOPE',
          message: `필수 엔벨로프 필드가 누락되었습니다: [${validation.missingFields.join(', ')}]`,
        },
        executedAt,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Idempotency Check: return cached result if duplicate
    const cacheKey = `${envelope.workspaceId}:${envelope.idempotencyKey}`;
    if (this.idempotencyCache.has(cacheKey)) {
      const cached = this.idempotencyCache.get(cacheKey)!;
      return {
        ...cached,
        isIdempotentReplay: true,
        executedAt: new Date().toISOString(),
      };
    }

    // 3. Admission Preflight Gate
    try {
      await ToolAdmissionController.admit(envelope, options);
    } catch (err: unknown) {
      if (err instanceof CapabilityNotReadyError) {
        return {
          envelopeId: envelope.envelopeId,
          capabilityId: envelope.capabilityId,
          success: false,
          status: err.operationalStatus,
          error: {
            code: err.code,
            message: err.reason,
            details: err.details,
          },
          executedAt,
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    }

    // 4. Dispatch tool to Domain or MCP Handler
    const context: ToolExecutionContext = {
      workspaceId: envelope.workspaceId,
      sessionId: envelope.sessionId,
      actionRunId: envelope.actionRunId,
      correlationId: envelope.correlationId || envelope.actionRunId,
      intentMode: envelope.intentMode || 'DRAFT',
      creditBalance: options?.creditBalance,
      isTestAccount: options?.isTestAccount,
      ...(options?.executionContext || {}),
    };

    const dispatchResult = await ToolDispatcher.dispatch(
      envelope.capabilityId,
      envelope.inputPayload,
      context
    );

    const envelopeResult: ToolExecutionEnvelopeResult = {
      envelopeId: envelope.envelopeId,
      capabilityId: dispatchResult.toolId || envelope.capabilityId,
      success: dispatchResult.success,
      status: dispatchResult.status,
      data: dispatchResult.data,
      error: dispatchResult.error,
      evidence: dispatchResult.evidence,
      proposal: dispatchResult.proposal,
      creditDeducted: dispatchResult.creditDeducted,
      logs: dispatchResult.logs,
      executedAt,
      durationMs: Date.now() - startTime,
    };

    // Cache successful idempotent execution
    if (envelopeResult.success) {
      this.idempotencyCache.set(cacheKey, envelopeResult);
    }

    return envelopeResult;
  }
}
