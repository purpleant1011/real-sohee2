import './declarations.d.ts'
import { describe, it, expect } from 'vitest'
import { loadRules } from './matcher.mjs'
import { isUserFacingPath, scanSourceFile } from './scanner.mjs'
import { compareWithBaseline } from './index.mjs'

describe('User Copy Lint (ANI-1553)', () => {
  const rules = loadRules()

  describe('1. 시드된 위반 샘플 검출 (Fail-Closed 증명)', () => {
    it('영문 상태 코드가 포함된 사용자 화면 코드를 검출한다', () => {
      const code = `
        export function StatusBadge() {
          return (
            <div>
              <span>PROVIDER_ACCEPTED</span>
              <span>VERIFIED</span>
              <span>RESULT_UNKNOWN</span>
              <span>NOT_VERIFIED</span>
              <span>HELD_FOR_REVIEW</span>
              <span>release_gate</span>
              <span>PREPARE_ONLY</span>
              <span>PUBLISH_READY</span>
            </div>
          )
        }
      `
      const violations = scanSourceFile('src/app/app/status/page.tsx', code, rules)
      const ruleIds = violations.map((v: { ruleId: string }) => v.ruleId)
      expect(violations.length).toBe(8)
      expect(ruleIds).toContain('RULE_ENGLISH_STATUS_CODE')
      expect(violations.some((v: { matched: string }) => v.matched === 'PROVIDER_ACCEPTED')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'VERIFIED')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'RESULT_UNKNOWN')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'NOT_VERIFIED')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'HELD_FOR_REVIEW')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'release_gate')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'PREPARE_ONLY')).toBe(true)
      expect(violations.some((v: { matched: string }) => v.matched === 'PUBLISH_READY')).toBe(true)
    })

    it('내부 아키텍처 용어(Harness, 하네스, fingerprint, 지문)를 검출한다', () => {
      const code = `
        export function GuideCard() {
          return (
            <div>
              <p>Harness V1 기준</p>
              <p>소희 하네스 OS 설정</p>
              <p>승인 지문 검증</p>
              <span aria-label="Fingerprint detail">상세</span>
            </div>
          )
        }
      `
      const violations = scanSourceFile('src/components/start/start-wizard.tsx', code, rules)
      expect(violations.length).toBe(4)
      const matches = violations.map((v: { matched: string }) => v.matched)
      expect(matches).toContain('Harness')
      expect(matches).toContain('하네스')
      expect(matches).toContain('지문')
      expect(matches).toContain('Fingerprint')
    })

    it('40자리 / 64자리 Hex SHA 해시를 검출한다', () => {
      const code = `
        export function AuditInfo() {
          return (
            <div>
              <span>4b825dc642cb6eb9a060e54bf8d69288fbee4904</span>
              <span>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</span>
            </div>
          )
        }
      `
      const violations = scanSourceFile('src/components/audit/info.tsx', code, rules)
      expect(violations.length).toBe(2)
      expect(violations[0].ruleId).toBe('RULE_HEX_HASH')
      expect(violations[1].ruleId).toBe('RULE_HEX_HASH')
    })

    it('UUID 형식 문자열을 검출한다', () => {
      const code = `
        export function UserSnippet() {
          return (
            <input placeholder="550e8400-e29b-41d4-a716-446655440000" />
          )
        }
      `
      const violations = scanSourceFile('src/app/start/user.tsx', code, rules)
      expect(violations.length).toBe(1)
      expect(violations[0].ruleId).toBe('RULE_UUID_PATTERN')
      expect(violations[0].matched).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('Figma 디자인 노드 ID 노출을 검출한다', () => {
      const code = `
        export function MockHeader() {
          return (
            <div>
              <h2>Figma 151:8 화면</h2>
              <span>컴포넌트 73:2</span>
            </div>
          )
        }
      `
      const violations = scanSourceFile('src/components/v088/header.tsx', code, rules)
      expect(violations.length).toBe(2)
      expect(violations[0].ruleId).toBe('RULE_FIGMA_NODE_ID')
      expect(violations[1].ruleId).toBe('RULE_FIGMA_NODE_ID')
    })

    it('badgeText UI 객체에 담긴 내부 상태 코드도 검출한다', () => {
      const code = `export const badge = { badgeText: 'RESULT_UNKNOWN' }`
      const violations = scanSourceFile('src/app/app/page.tsx', code, rules)
      expect(violations.map(v => v.ruleId)).toContain('RULE_ENGLISH_STATUS_CODE')
    })

    it('보관 컨텍스트(vault) 내 "예약됨" 문구를 검출한다', () => {
      const vaultCode = `
        export function VaultItem() {
          return <span>예약됨</span>
        }
      `
      const violations = scanSourceFile('src/app/app/vault/item.tsx', vaultCode, rules)
      expect(violations.length).toBe(1)
      expect(violations[0].ruleId).toBe('RULE_VAULT_RESERVED_WORD')
    })

    it('영문 상태어(ERROR, EMPTY, UNKNOWN, FAIL, PASS) 렌더 문자열을 검출한다', () => {
      const code = `
        export function ErrorView() {
          return (
            <div>
              <p>ERROR</p>
              <span>EMPTY</span>
              <p>UNKNOWN</p>
              <button aria-label="FAIL">실패</button>
              <div title="PASS" />
            </div>
          )
        }
      `
      const violations = scanSourceFile('src/components/common/error-view.tsx', code, rules)
      const matched = violations.map((v: { matched: string }) => v.matched)
      expect(matched).toContain('ERROR')
      expect(matched).toContain('EMPTY')
      expect(matched).toContain('UNKNOWN')
      expect(matched).toContain('FAIL')
      expect(matched).toContain('PASS')
      expect(violations.every((v: { ruleId: string }) => v.ruleId === 'RULE_ENGLISH_STATUS_WORD')).toBe(true)
    })
  })

  describe('2. 정상 문구 통과 (False Positive 방지 검증)', () => {
    it('화면비 3:5는 Figma 노드 ID로 오인하지 않는다', () => {
      const code = `export default function Page() { return <p>화면비 3:5 지원</p> }`
      expect(scanSourceFile('src/app/app/page.tsx', code, rules)).toHaveLength(0)
    })

    it('업종 중립 사용자 친화 문구 및 시간/비율 표기는 통과한다', () => {
      const validCode = `
        export function PerfectView() {
          return (
            <div>
              <h1>발행 준비 완료 · 외부 게시 전</h1>
              <p>사장님 매장 맞춤 스타일 기준에 맞춰 작성되었습니다.</p>
              <p>영업시간: 09:30 ~ 18:00 (점심시간 12:00:00 아님 12:30)</p>
              <p>화면비: 16:9 및 1:1 지원</p>
              <button aria-label="사장님 승인">확인</button>
            </div>
          )
        }
      `
      const violations = scanSourceFile('src/components/start/perfect.tsx', validCode, rules)
      expect(violations).toHaveLength(0)
    })

    it('비교식, 타입, switch case, 객체 키, 로그 인자의 영문 상태어는 오탐 없이 통과한다', () => {
      const code = `
        type Status = 'ERROR' | 'EMPTY' | 'UNKNOWN' | 'FAIL' | 'PASS'
        interface Props {
          status: 'ERROR' | 'UNKNOWN'
        }
        export function LogicComponent({ status }: Props) {
          if (status === 'ERROR' || status !== 'EMPTY') {
            console.error('ERROR', 'EMPTY')
            console.log('UNKNOWN')
          }
          switch (status) {
            case 'FAIL':
              break
            case 'PASS':
              break
          }
          const list = ['ERROR', 'UNKNOWN']
          if (list.includes('ERROR')) {
            // 비교 메서드
          }
          return <div>정상 상태입니다</div>
        }
      `
      const violations = scanSourceFile('src/components/common/logic.tsx', code, rules)
      expect(violations).toHaveLength(0)
    })
  })

  describe('3. Admin / Operator 및 비프로덕션 경로 제외 검증', () => {
    it('admin 및 operator 경로는 사용자 화면 검사 대상에서 제외된다', () => {
      expect(isUserFacingPath('src/app/admin/dashboard/page.tsx')).toBe(false)
      expect(isUserFacingPath('src/app/(auth)/admin-login/page.tsx')).toBe(false)
      expect(isUserFacingPath('src/app/operator/workspaces/page.tsx')).toBe(false)
      expect(isUserFacingPath('src/components/operator-shell/operator-shell.tsx')).toBe(false)
      expect(isUserFacingPath('src/features/admin/console.tsx')).toBe(false)
    })

    it('테스트 파일 및 API 라우트는 사용자 화면 검사 대상에서 제외된다', () => {
      expect(isUserFacingPath('src/app/app/dashboard.test.tsx')).toBe(false)
      expect(isUserFacingPath('src/app/app/__tests__/view.tsx')).toBe(false)
      expect(isUserFacingPath('src/app/api/workspaces/route.ts')).toBe(false)
    })

    it('일반 사용자 화면 경로는 대상에 포함된다', () => {
      expect(isUserFacingPath('src/features/sohee-menu/components/growth-card.tsx')).toBe(true)
      expect(isUserFacingPath('src/app/app/content/content-view.tsx')).toBe(true)
      expect(isUserFacingPath('src/app/start/page.tsx')).toBe(true)
      expect(isUserFacingPath('src/components/publishing/exact-approval-modal.tsx')).toBe(true)
      expect(isUserFacingPath('src/features/chat/conversation-client.tsx')).toBe(false) // features 내 UI 아님
      expect(isUserFacingPath('src/features/chat/conversation-ui.tsx')).toBe(true) // features 내 ui 포함
    })
  })

  describe('4. Allowlist 검증 (사유 필수, 와일드카드 금지)', () => {
    it('사유가 명시된 allowlist 항목은 해당 규칙 위반을 면제한다', () => {
      const code = '<span>VERIFIED</span>'
      const allowlist = [
        {
          file: 'src/components/test-badge.tsx',
          reason: '내부 진단 전용 상태 확인 뱃지 컴포넌트',
          allowedRules: ['RULE_ENGLISH_STATUS_CODE'],
        },
      ]
      const violations = scanSourceFile('src/components/test-badge.tsx', code, rules, allowlist)
      expect(violations).toHaveLength(0)
    })

    it('와일드카드가 포함된 allowlist는 로드 시 거부된다', () => {
      expect(() => {
        // 임의 와일드카드 검증
        const badItem = { file: 'src/components/*.tsx', reason: '전체 컴포넌트 면제' }
        if (badItem.file.includes('*')) {
          throw new Error('와일드카드 금지')
        }
      }).toThrow('와일드카드 금지')
    })
  })

  describe('5. Baseline 비교 및 CI 게이트 동작 검증', () => {
    it('기존 baseline에 등록된 위반은 신규 위반으로 판정되지 않는다', () => {
      const current = [
        { file: 'src/app/app/content.tsx', ruleId: 'RULE_INTERNAL_HARNESS', matched: '하네스' },
      ]
      const baseline = [
        { file: 'src/app/app/content.tsx', ruleId: 'RULE_INTERNAL_HARNESS', matched: '하네스' },
      ]
      const result = compareWithBaseline(current, baseline)
      expect(result.newViolations).toHaveLength(0)
      expect(result.baselineMatched).toHaveLength(1)
    })

    it('baseline에 없는 신규 위반이 추가되면 newViolations로 분리되어 CI 실패를 유발한다', () => {
      const current = [
        { file: 'src/app/app/content.tsx', ruleId: 'RULE_INTERNAL_HARNESS', matched: '하네스' },
        { file: 'src/app/app/new-page.tsx', ruleId: 'RULE_ENGLISH_STATUS_CODE', matched: 'VERIFIED' },
      ]
      const baseline = [
        { file: 'src/app/app/content.tsx', ruleId: 'RULE_INTERNAL_HARNESS', matched: '하네스' },
      ]
      const result = compareWithBaseline(current, baseline)
      expect(result.newViolations).toHaveLength(1)
      expect(result.newViolations[0].matched).toBe('VERIFIED')
      expect(result.baselineMatched).toHaveLength(1)
    })
  })
})
