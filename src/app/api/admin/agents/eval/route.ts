export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';
import { QUALITY_SEVEN_FIXTURES, qualityTestHarnessEvaluator } from '@/features/harness/quality-test-harness';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const BUILD_DEPLOYED_AT = '2026-09-03T03:22:00.000Z'; // Immutable deployment timestamp (ANI-588)
const BUILD_VERSION = process.env.CF_VERSION_METADATA || 'v0.8.9-prod-9b6ea68e';

export async function GET() {
  try {
    await requireOperatorAnyScope('agent.read');

    // Return Canonical Agent Build & Evaluation Fixtures (ANI-588)
    return NextResponse.json({
      success: true,
      agentBuild: {
        version: 'v0.8.9-commercial-runtime',
        buildHash: BUILD_VERSION,
        runtime: 'Cloudflare Workers OpenNext & AGY Edge Engine',
        deployedAt: BUILD_DEPLOYED_AT,
        policyVersion: '2026.09-v1',
        modelConfig: {
          textModel: process.env.GEMINI_ACTION_MODEL || process.env.GEMINI_CONVERSATION_MODEL || 'gemini-3.8-flash',
          imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
          reasoningEffort: process.env.GEMINI_TEXT_REASONING_EFFORT || 'high'
        }
      },
      fixtures: QUALITY_SEVEN_FIXTURES,
      totalFixtures: QUALITY_SEVEN_FIXTURES.length
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '조회 실패' }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const operator = await requireOperatorAnyScope('agent.read');
    const supabase = await createServerSupabaseClient();

    // 동적 품질 검증 실행 (ANI-641: 공식 QualityTestHarnessEvaluator 연동)
    const results = QUALITY_SEVEN_FIXTURES.map(fixture => {
      const evalRes = qualityTestHarnessEvaluator.evaluateFixture(fixture);
      const verdict = evalRes.verdict;
      const reason = evalRes.reason;
      const isCompliant = verdict === fixture.expectedVerdict;

      return {
        id: fixture.id,
        name: fixture.name,
        fixtureType: fixture.fixtureType,
        verdict,
        expectedVerdict: fixture.expectedVerdict,
        reason,
        isCompliant
      };
    });

    const passedCount = results.filter(r => r.isCompliant).length;
    const allPassed = passedCount === results.length;
    const testedAt = new Date().toISOString();

    // Record Eval Run in audit_events for durable provenance (ANI-608 / ANI-641: Fail-closed on audit failure)
    const evalRunId = crypto.randomUUID();
    const { error: auditErr } = await (supabase as any).from('audit_events').insert({
      workspace_id: '00000000-0000-0000-0000-000000000000',
      actor_id: operator.userId || null,
      entity_type: 'agent_build_eval',
      entity_id: evalRunId,
      event_type: 'agent_eval_run',
      created_at: testedAt,
      metadata: {
        eval_run_id: evalRunId,
        version: BUILD_VERSION,
        total: results.length,
        passed: passedCount,
        allPassed,
        testedAt,
        operator_id: operator.userId
      }
    });

    if (auditErr) {
      console.error('[agent/eval] audit insert failure (fail-closed):', auditErr);
      return NextResponse.json({
        error: `평가 결과 영구 원장 기록 실패 (Fail-Closed): ${auditErr.message}`,
        success: false,
        gatePassed: false
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      buildHash: BUILD_VERSION,
      summary: {
        total: results.length,
        passed: passedCount,
        failed: results.length - passedCount,
        allPassed,
        testedAt
      },
      results
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '평가 실행 실패' }, { status: 403 });
  }
}
