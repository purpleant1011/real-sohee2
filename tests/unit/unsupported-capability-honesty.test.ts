import { describe, it, expect } from 'vitest';
import { DRAFT_HONESTY_INSTRUCTION } from '@/lib/ai/conversation-brain';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';

describe('Task C: Honest responses for unsupported capabilities', () => {
  const WORKSPACE_ID = 'ws-test-unsupported';

  it('contains strict honest guidance in DRAFT_HONESTY_INSTRUCTION for unsupported capabilities like review replies and scheduled publishing', () => {
    expect(DRAFT_HONESTY_INSTRUCTION).toContain('지원하지 않');
    expect(DRAFT_HONESTY_INSTRUCTION).toContain('대안');
  });

  it('fails closed when unsupported capability content.schedule is called', async () => {
    const result = await ToolDispatcher.dispatch(
      'content.schedule',
      { scheduledAt: '2026-10-15T10:00:00Z' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-unsupported-2',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('NOT_IMPLEMENTED');
    expect(result.error?.code).toBe('NOT_IMPLEMENTED');
  });
});
