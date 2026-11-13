import { describe, expect, it } from 'vitest'
import {
  ALIMTALK_TEMPLATE_CODES,
  getAlimtalkTemplate,
} from './templates'
import {
  buildTemplateApprovalRecord,
  type BuildTemplateApprovalRecordParams,
} from './template-approval-record'
import { createHash } from 'node:crypto'

describe('buildTemplateApprovalRecord (카카오 승인 확인은 사람이 콘솔에서)', () => {
  const fixedNow = new Date('2026-11-06T12:00:00.000Z')
  const validBaseParams: BuildTemplateApprovalRecordParams = {
    templateCode: ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED,
    templateId: 'SOLAPI_TPL_001',
    channelId: 'SOLAPI_CH_001',
    state: 'APPROVED',
    verifiedAt: '2026-11-06T10:00:00.000Z',
    evidenceRef: '카카오 비즈메시지 콘솔 승인 확인 (심사완료-스크린샷-20261106)',
    now: fixedNow,
  }

  it('유효한 입력으로 올바른 DB row 객체를 생성한다', () => {
    const row = buildTemplateApprovalRecord(validBaseParams)
    const expectedTemplate = getAlimtalkTemplate(ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED)
    const expectedSha256 = createHash('sha256')
      .update(expectedTemplate!.templateBody)
      .digest('hex')

    expect(row).toEqual({
      template_code: ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED,
      template_id: 'SOLAPI_TPL_001',
      channel_id: 'SOLAPI_CH_001',
      body_sha256: expectedSha256,
      state: 'APPROVED',
      verified_at: '2026-11-06T10:00:00.000Z',
      evidence_ref: '카카오 비즈메시지 콘솔 승인 확인 (심사완료-스크린샷-20261106)',
    })
  })

  it('입력값의 앞뒤 공백을 trim하여 안전하게 정규화한다', () => {
    const row = buildTemplateApprovalRecord({
      ...validBaseParams,
      templateId: '  SOLAPI_TPL_TRIMMED  ',
      channelId: '  SOLAPI_CH_TRIMMED  ',
      evidenceRef: '  콘솔 수동 확인 메모  ',
    })

    expect(row.template_id).toBe('SOLAPI_TPL_TRIMMED')
    expect(row.channel_id).toBe('SOLAPI_CH_TRIMMED')
    expect(row.evidence_ref).toBe('콘솔 수동 확인 메모')
  })

  it('REJECTED 및 PENDING 상태도 정상적으로 생성한다', () => {
    const rejectedRow = buildTemplateApprovalRecord({
      ...validBaseParams,
      state: 'REJECTED',
    })
    expect(rejectedRow.state).toBe('REJECTED')

    const pendingRow = buildTemplateApprovalRecord({
      ...validBaseParams,
      state: 'PENDING',
    })
    expect(pendingRow.state).toBe('PENDING')
  })

  it('offset이 포함된 다양한 ISO 8601 타임스탬프(+09:00, Z 등)를 허용한다', () => {
    const kstRow = buildTemplateApprovalRecord({
      ...validBaseParams,
      verifiedAt: '2026-11-06T19:00:00+09:00', // UTC 10:00와 동일 (fixedNow보다 과거)
    })
    expect(kstRow.verified_at).toBe('2026-11-06T19:00:00+09:00')
  })

  it('unknown 템플릿 코드인 경우 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        templateCode: 'UNKNOWN_TEMPLATE_V99',
      }),
    ).toThrowError(/known.*template/i)
  })

  it('templateId 또는 channelId가 빈값이거나 공백이면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        templateId: '   ',
      }),
    ).toThrowError(/templateId/i)

    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        channelId: '',
      }),
    ).toThrowError(/channelId/i)
  })

  it('state가 없거나 허용되지 않은 상태값이면 에러를 던진다 (APPROVED 자동 추정 금지)', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        // @ts-expect-error 테스트를 위한 잘못된 state
        state: undefined,
      }),
    ).toThrowError(/state.*APPROVED|REJECTED|PENDING/i)

    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        // @ts-expect-error 테스트를 위한 잘못된 state
        state: 'SUCCESS',
      }),
    ).toThrowError(/state.*APPROVED|REJECTED|PENDING/i)
  })

  it('verifiedAt에 timezone offset이 없으면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        verifiedAt: '2026-11-06T10:00:00', // offset 없음
      }),
    ).toThrowError(/offset/i)
  })

  it('verifiedAt이 유효하지 않은 날짜 형식이면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        verifiedAt: 'not-a-valid-date',
      }),
    ).toThrowError(/verifiedAt/i)
  })

  it('verifiedAt이 미래 시각이면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        verifiedAt: '2026-11-06T13:00:00.000Z', // fixedNow(12:00:00Z)보다 1시간 미래
      }),
    ).toThrowError(/future|미래/i)
  })

  it('evidenceRef가 비어있거나 공백이면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: '   ',
      }),
    ).toThrowError(/evidenceRef/i)
  })

  it('evidenceRef가 200자를 초과하면 에러를 던진다', () => {
    const longRef = 'A'.repeat(201)
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: longRef,
      }),
    ).toThrowError(/200/i)

    const maxValidRef = 'A'.repeat(200)
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: maxValidRef,
      }),
    ).not.toThrow()
  })

  it('evidenceRef에 URL 쿼리 스트링(? 또는 &key=)이 포함되어 있으면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: 'https://console.kakao.com/templates?id=123',
      }),
    ).toThrowError(/query|url/i)

    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: '스크린샷확인&auth=token123',
      }),
    ).toThrowError(/query|url/i)
  })

  it('evidenceRef에 API 키/비밀값/토큰 패턴이 포함되어 있으면 에러를 던진다', () => {
    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: 'apiKey=AKIAIOSFODNN7EXAMPLE',
      }),
    ).toThrowError(/secret|token|api.*key/i)

    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: 'Bearer secret_token_value_here',
      }),
    ).toThrowError(/secret|token|api.*key/i)

    expect(() =>
      buildTemplateApprovalRecord({
        ...validBaseParams,
        evidenceRef: '확인완료 secret: 1234567890',
      }),
    ).toThrowError(/secret|token|api.*key/i)
  })

  it('입력 객체를 변경(mutate)하지 않는 순수 함수이다', () => {
    const paramsCopy = { ...validBaseParams }
    buildTemplateApprovalRecord(validBaseParams)
    expect(validBaseParams).toEqual(paramsCopy)
  })
})
