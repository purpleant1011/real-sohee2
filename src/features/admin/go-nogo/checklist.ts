/**
 * 릴리스 체크리스트 정의 (ANI-1562).
 * 여기에는 "무엇을 확인해야 하는가"만 둔다. 통과 여부는 절대 이 파일에 두지 않고,
 * record-evidence.mjs 가 실제 실행해 남긴 evidence/runs/<id>.json 에서만 읽는다.
 */
export type ChecklistItem = {
  id: string
  label: string
  /** 증거를 만들 때 쓰는 명령 안내(사람이 재실행할 때 참고) */
  how: string
}

export const CHECKLIST: readonly ChecklistItem[] = Object.freeze([
  { id: 'deploy-sha', label: '배포 기준 버전', how: 'node scripts/record-evidence.mjs deploy-sha -- git rev-parse HEAD' },
  { id: 'migration-match', label: '데이터베이스 변경 이력 일치', how: 'node scripts/record-evidence.mjs migration-match -- npx vitest run tests/unit/remediation/hf41-immutable-migration-history.test.ts --testTimeout=30000' },
  { id: 'golden-e2e', label: '핵심 흐름 시험(가입→미리보기→보관 / 연결 시 발행)', how: 'node scripts/record-evidence.mjs golden-e2e -- <핵심 흐름 시험 명령>' },
  { id: 'tenant-isolation', label: '사업장 간 데이터 분리 시험', how: 'node scripts/record-evidence.mjs tenant-isolation -- npm run test:tenant-isolation' },
  { id: 'user-copy', label: '고객 화면 내부 용어 검사', how: 'node scripts/record-evidence.mjs user-copy -- npm run lint:user-copy' },
  { id: 'typecheck', label: '타입 검사', how: 'node scripts/record-evidence.mjs typecheck -- npm run typecheck' },
  { id: 'mobile-evidence', label: '모바일 화면 증거(스크린샷과 측정 수치)', how: 'node scripts/record-evidence.mjs mobile-evidence -- node scripts/check-mobile-evidence.mjs' },
  { id: 'no-external-publish', label: '외부 게시 0건 불변식(보관함 DB 시험)', how: 'node scripts/record-evidence.mjs no-external-publish -- npm run test:vault-db' },
])
