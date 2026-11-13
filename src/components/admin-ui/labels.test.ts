import { describe, expect, it } from 'vitest'
import { adminRoleLabel, adminStatusLabel, auditActionLabel, creditActionLabel, memberStatusLabel, missionGoalLabel } from './labels'

describe('operator-only Korean labels', () => {
  it('localizes formal and applicant member statuses', () => {
    expect(memberStatusLabel('FORMAL')).toBe('정회원')
    expect(memberStatusLabel('formal')).toBe('정회원')
    expect(memberStatusLabel('APPLICANT')).toBe('가입자(미인증)')
    expect(memberStatusLabel('applicant')).toBe('가입자(미인증)')
    expect(memberStatusLabel(null)).toBe('확인 필요')
    expect(memberStatusLabel('unknown')).toBe('확인 필요')
  })
  it('removes only trailing English translations from mission goals', () => {
    expect(missionGoalLabel('첫 게시물 발행 미션 (First Post Guided Mission)')).toBe('첫 게시물 발행 미션')
    expect(missionGoalLabel('시즌 기획 (봄)')).toBe('시즌 기획 (봄)')
    expect(missionGoalLabel(null)).toBe('목표 미지정')
  })

  it('labels known and unknown admin statuses without exposing codes', () => {
    expect(adminStatusLabel('ACTIVE')).toBe('사용 중')
    expect(adminStatusLabel('unexpected_status')).toBe('확인 필요')
    expect(adminStatusLabel(null)).toBe('상태 미확인')
  })

  it('labels known and unknown admin roles without exposing codes', () => {
    expect(adminRoleLabel('operations_admin')).toBe('운영 관리자')
    expect(adminRoleLabel('unmapped_role')).toBe('기타 역할')
    expect(adminRoleLabel(undefined)).toBe('역할 미지정')
  })

  it('localizes audit actions and drops unknown internal tokens', () => {
    expect(auditActionLabel('workspace.lifecycle.activated')).toBe('고객사 진행 단계 활성화')
    expect(auditActionLabel('internal_unmapped')).toBe('운영 작업')
    expect(auditActionLabel(null)).toBe('운영 작업')
  })

  it('localizes credit actions and never returns an unknown code', () => {
    expect(creditActionLabel('RESET_PASS')).toBe('주간 리셋')
    expect(creditActionLabel('internal_unmapped')).toBe('운영 작업')
    expect(creditActionLabel(null)).toBe('-')
  })
})
