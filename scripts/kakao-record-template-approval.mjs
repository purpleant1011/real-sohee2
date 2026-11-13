#!/usr/bin/env node
/**
 * 카카오 알림톡 템플릿 심사 승인 원장 레코드 생성 스크립트 (Dry-Run Builder)
 *
 * [운영 및 보안 가이드라인]
 * 1. 카카오 승인 확인은 사람이 콘솔에서 직접 수행합니다.
 *    본 스크립트는 승인 자동화가 아니며, 운영자가 카카오 비즈메시지 콘솔 및 솔라피 콘솔에서
 *    확인한 심사 승인 내역을 안전하게 kakao_template_approvals 테이블에 기록하기 위한
 *    dry-run 빌더입니다.
 * 2. DB 직접 쓰기 및 API 호출 원천 배제:
 *    - 본 스크립트는 네트워크 호출, DB 커넥션, 솔라피 API 호출을 일절 수행하지 않습니다.
 *    - API Key, Secret 등 비밀값을 입력받거나 출력하지 않습니다.
 * 3. 승인 상태 자동 추정 금지:
 *    - 'APPROVED'를 기본값으로 자동 추정하지 않습니다.
 *    - --state 인자는 필수이며, 운영자가 콘솔에서 확인한 상태(APPROVED, REJECTED, PENDING)를 명시해야 합니다.
 * 4. 실제 DB 반영:
 *    - stdout에 출력된 upsert SQL을 운영자가 직접 검토한 후 psql 콘솔 등에서 수동으로 실행합니다.
 */

import { buildTemplateApprovalRecord } from '../src/features/kakao/notify/template-approval-record.ts'

function printHelp() {
  console.log(`
카카오 알림톡 템플릿 승인 원장 레코드 빌더 (Dry-Run)

[카카오 승인 확인은 사람이 콘솔에서]
본 스크립트는 DB에 직접 쓰지 않고 검증된 행 JSON 및 psql upsert SQL을 stdout에만 출력합니다.

사용법:
  node scripts/kakao-record-template-approval.mjs [옵션]

필수 옵션:
  --template-code <code>     알림톡 템플릿 코드 (예: SOHEE_BOOKING_CONFIRMED_V1)
  --template-id <id>         솔라피 콘솔 발급 템플릿 ID (예: KA01TP23041200000001)
  --channel-id <id>          카카오 채널/PF ID (예: @sohee 또는 SOLAPI_PF_ID 환경변수)
  --state <state>            승인 상태 (APPROVED, REJECTED, PENDING 중 하나 / 자동 추정 금지)
  --evidence-ref <ref>       콘솔 확인 증거 참조 (스크린샷 ID, 확인 메모 등 최대 200자)

선택 옵션:
  --verified-at <iso>        승인 확인 시각 (ISO 8601 offset 포함, 기본값: 현재 시각)
  --help, -h                 도움말 출력

예시:
  node scripts/kakao-record-template-approval.mjs \\
    --template-code SOHEE_BOOKING_CONFIRMED_V1 \\
    --template-id KA01TP240101000001 \\
    --channel-id @sohee_official \\
    --state APPROVED \\
    --evidence-ref "CONSOLE_APPROVAL_CHECKED_20261106_BY_OPERATOR"
`)
}

function parseArgs(args) {
  const parsed = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
    } else if (arg === '--template-code' && i + 1 < args.length) {
      parsed.templateCode = args[++i]
    } else if (arg === '--template-id' && i + 1 < args.length) {
      parsed.templateId = args[++i]
    } else if (arg === '--channel-id' && i + 1 < args.length) {
      parsed.channelId = args[++i]
    } else if (arg === '--state' && i + 1 < args.length) {
      parsed.state = args[++i]
    } else if (arg === '--evidence-ref' && i + 1 < args.length) {
      parsed.evidenceRef = args[++i]
    } else if (arg === '--verified-at' && i + 1 < args.length) {
      parsed.verifiedAt = args[++i]
    }
  }
  return parsed
}

function escapeSqlString(val) {
  return String(val).replace(/'/g, "''")
}

function generateUpsertSql(row) {
  const templateCode = escapeSqlString(row.template_code)
  const templateId = escapeSqlString(row.template_id)
  const channelId = escapeSqlString(row.channel_id)
  const bodySha256 = escapeSqlString(row.body_sha256)
  const state = escapeSqlString(row.state)
  const verifiedAt = escapeSqlString(row.verified_at)
  const evidenceRef = escapeSqlString(row.evidence_ref)

  return `-- ============================================================================
-- [카카오 승인 확인은 사람이 콘솔에서]
-- kakao_template_approvals 수동 Upsert SQL
-- 생성 시각: ${new Date().toISOString()}
-- 주의: 운영자가 카카오/솔라피 콘솔에서 승인 사실을 직접 확인한 후에만 실행하십시오.
-- ============================================================================
INSERT INTO public.kakao_template_approvals (
  template_code,
  template_id,
  channel_id,
  body_sha256,
  state,
  verified_at,
  evidence_ref,
  updated_at
) VALUES (
  '${templateCode}',
  '${templateId}',
  '${channelId}',
  '${bodySha256}',
  '${state}',
  '${verifiedAt}'::timestamptz,
  '${evidenceRef}',
  statement_timestamp()
)
ON CONFLICT (template_code) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  channel_id = EXCLUDED.channel_id,
  body_sha256 = EXCLUDED.body_sha256,
  state = EXCLUDED.state,
  verified_at = EXCLUDED.verified_at,
  evidence_ref = EXCLUDED.evidence_ref,
  updated_at = statement_timestamp();`
}

function main() {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)

  if (parsed.help || args.length === 0) {
    printHelp()
    process.exit(0)
  }

  // 필수 인자 검증 및 안내
  if (!parsed.state) {
    console.error('오류: --state 인자는 필수입니다 (APPROVED, REJECTED, PENDING 중 하나).')
    console.error('카카오 승인 상태는 자동 추정되지 않으며, 운영자가 콘솔에서 확인한 상태를 직접 입력해야 합니다.')
    process.exit(1)
  }

  const channelId = parsed.channelId || process.env.SOLAPI_CHANNEL_ID || process.env.SOLAPI_PF_ID
  if (!channelId) {
    console.error('오류: --channel-id 인자가 필요합니다 (또는 SOLAPI_CHANNEL_ID / SOLAPI_PF_ID 환경변수 지정).')
    process.exit(1)
  }

  const verifiedAt = parsed.verifiedAt || new Date().toISOString()

  let row
  try {
    row = buildTemplateApprovalRecord({
      templateCode: parsed.templateCode,
      templateId: parsed.templateId,
      channelId,
      state: parsed.state,
      verifiedAt,
      evidenceRef: parsed.evidenceRef,
    })
  } catch (err) {
    console.error(`레코드 생성 검증 오류: ${err.message}`)
    process.exit(1)
  }

  console.log('--- [1] kakao_template_approvals Row JSON (Dry-Run) ---')
  console.log(JSON.stringify(row, null, 2))
  console.log('')
  console.log('--- [2] psql Upsert SQL (운영자 수동 실행용) ---')
  console.log(generateUpsertSql(row))
  console.log('')
  console.log('--- [안내] 카카오 승인 확인은 사람이 콘솔에서 직접 수행해야 하며, 위 SQL을 복사하여 psql 콘솔에서 실행하십시오. ---')
}

main()
