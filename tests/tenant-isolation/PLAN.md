# W3 테넌트 보안 설계·실행 계획 (ANI-1587 / ANI-1591)

## 범위와 수용 기준
운영 SELECT/Advisor만 사용한다. 테스트는 새 Unix socket 전용 PostgreSQL 16 클러스터에서 전체 마이그레이션을 재생한다. 기존 Vault 격리 검증은 유지한다. UI 변경·실외부 발송·운영 DDL은 없다.

| 조사 항목 | 이미 있음 | 격차와 대응 |
|---|---|---|
| Vault | tests/integration/tenant-isolation 2파일, 독립 PG replay | 대체하지 않고 기존 명령도 실행 |
| Recovery | 서버 RPC grants 제한, 복합 FK, 기존 SQL/통합 | 실제 역할 호출·타 workspace ID·disabled/멤버십 없음·anon 행 검사 확대 |
| Studio | service_role 전용 proposals, 복합 source/fact FK | repository 경계 및 서비스 RPC actor 검증 조사 |
| Media | private bucket, workspace RLS, 정규 경로 builder | 경로 세그먼트 탈출 입력 거부 단위 테스트 |
| Knowledge/고객 대화/DM/drafts/funnel | 기존 테이블·정책 | A/B fixture 실제 SELECT/UPDATE/INSERT 교차 시험 |
| CRM | process-memory identity graph | workspace 없는 identity key 및 merge 위험: 소유 W9에 이관, 반례 유지 |
| Advisor no-policy | 9개 모두 anon/authenticated DML grants 없음 | 의도된 내부 전용. 공개 정책을 추가하지 않음 |
| Advisor public RPC | anon 1, authenticated 24 | 카탈로그 grants + 내부 guard + 격리 실행 결과로 분류 |

## 선택한 구조
1. `scripts/test-tenant-security-db.mjs`: 기존 replay preamble을 재사용하되 auth.uid/jwt/role을 요청별 GUC로 교체. 완전히 새 PG 클러스터만 생성·정리. 원격 DB URL을 받지 않음. SQL 테스트는 rollback-only.
2. `tests/tenant-isolation/domain-boundaries.sql`: A/B 소유자·disabled·멤버십 없음 fixture. 정상 own read의 양성 대조와 foreign read/write 거부를 함께 검증. SQLSTATE 42501·RLS 0행을 구분하고 구문/타입/fixture 오류는 성공으로 삼지 않음. 서비스 전용 RPC는 실제 SET ROLE 호출과 service_role 양성 권한 확인.
3. `tests/tenant-isolation/media-path.test.ts`: workspace/asset/extension 경로 탈출 반례 RED 후 media-storage.ts 최소 입력 검증.
4. `tests/tenant-isolation/crm-boundaries.test.ts`: 같은 식별자·전화 힌트·cross workspace merge 반례. 타 소유 코드 수정 금지. 해결 전에는 Known Risk로 보고.
5. `tests/tenant-isolation/ADVISOR.md`: 개인정보 없는 카탈로그 관측·분류·한계·재검증 계획. 검증된 결함에 한해서만 예약된 W3 시간대의 추가 migration 작성.

## 실행 순서
- 실패 테스트 작성 → 기존 구현에서 RED 출력 보존 → 최소 교정 → 동일 테스트 GREEN.
- node scripts/test-tenant-security-db.mjs, npm test -- tests/tenant-isolation, npm run test:tenant-isolation, npm run typecheck, npm run lint, npm run db:verify-drift 실행 결과를 그대로 기록.
- diff/비밀값/타 소유 파일 점검 후 커밋·Draft PR. 운영 미적용·미검증 경계 명시. Linear In Review는 증거를 붙인 후만, Done 금지.
