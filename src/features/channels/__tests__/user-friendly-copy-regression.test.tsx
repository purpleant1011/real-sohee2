import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('자영업자 고객메뉴 쉬운 한국어 카피 회귀 검증 (12개 파일 JSX-literal 검사)', () => {
  const root = path.resolve(__dirname, '../../../..')

  const targetFiles = [
    'src/features/channels/components/oauth-explainability-modal.tsx',
    'src/features/channels/sohee-channel-wizard.tsx',
    'src/components/v089/channel-control-center.tsx',
    'src/components/v088/content/content-production-pipeline.tsx',
    'src/components/v088/same-truth/EvidenceCard.tsx',
    'src/components/v088/same-truth/ProductionReadinessCard.tsx',
    'src/features/channel-studio/naver/ui/naver-quality-sections.tsx',
    'src/features/naver-publish/components/naver-search-observation-card.tsx',
    'src/features/knowledge/knowledge-dashboard.tsx',
    'src/features/profile-import/profile-import-wizard.tsx',
    'src/features/sohee-menu/components/materials-box.tsx',
    'src/features/automation/automation-workspace.tsx',
  ]

  it('12개 UI 파일의 고객 노출 JSX 텍스트에서 금지된 기술용어가 제거되어야 한다', () => {
    // 검사할 금지 문자열 패턴들 (고객 노출 UI 텍스트 기준)
    const bannedCopyPatterns = [
      { pattern: /회원사 데이터 보호 및 안전한 API 통신/, name: '안전한 API 통신' },
      { pattern: />공식 OAuth</, name: '공식 OAuth 뱃지' },
      { pattern: />브라우저 커넥터</, name: '브라우저 커넥터 뱃지' },
      { pattern: /소희의 실행 권한\(Capability\)/, name: '권한(Capability)' },
      { pattern: /댓글 및 DM 답변 초안 준비 \(CRM\)/, name: '초안 준비 (CRM)' },
      { pattern: /데이터베이스 SSOT 영속성/, name: '데이터베이스 SSOT 영속성' },
      { pattern: />✓ 승인 완료 \(불변 영속\)</, name: '승인 완료 (불변 영속)' },
      { pattern: />이 하네스로 써 본 글</, name: '이 하네스로 써 본 글' },
      { pattern: /실시간\(Real-Time\) 감지/, name: '실시간(Real-Time) 감지' },
      { pattern: />인스타그램 Graph API</, name: '인스타그램 Graph API' },
    ]

    const violations: string[] = []

    for (const relPath of targetFiles) {
      const fullPath = path.join(root, relPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      for (const { pattern, name } of bannedCopyPatterns) {
        if (pattern.test(content)) {
          violations.push(`${relPath} 에 금지된 기술용어 UI 문구 '${name}' 발견`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
