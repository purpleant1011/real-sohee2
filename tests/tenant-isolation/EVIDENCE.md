# W3 Evidence Bundle — ANI-1587 / ANI-1591

환경: 로컬 격리 PostgreSQL 16 / Vitest 3.2.7, 기준 main `7dc57c20`, 2026-10-21.
상태: CODE_COMPLETE(담당 교정) / 일부 TESTED. **전체 테넌트 안전·운영 검증·릴리스 완료 아님.**
운영 DDL/DML·실Provider 쓰기 0건. 새 마이그레이션은 운영 미적용.

## Red → Green

| 반례 | Before | After |
|---|---|---|
| 미디어 workspace/asset/extension 탈출 | 36개 중 정상 2개 통과, 거부 34개 실패 | 동일 36개 통과 |
| raw replay membership 중복 재귀 정책 | authenticated reservations SELECT: `infinite recursion detected in policy for relation workspace_members` (42P17) | 중복 policy 제거 후 A/B·disabled/nonmember/anon 실역할 SQL 통과 |
| raw replay 공개 legacy operator RPC | `SECURITY CONTRACT FAILED: get_operator_control_tower_summary anon denied` | PUBLIC/anon/auth revoke 후 실제 client 호출 거부, service_role read 통과 |
| CRM 같은 identity/phone/cross merge | 3개 모두 실패: B 호출이 A workspace 반환, cross merge가 예외 없음 | **아직 RED. W9 소유 수정·통합 필요** |
| RLS 밖 TRUNCATE/TRIGGER/REFERENCES 권한 (ANI-1591) | Supabase 기본 권한(pg_default_acl) 상속으로 anon/authenticated가 public 테이블 TRUNCATE 보유: `ERROR: SECURITY CONTRACT FAILED: public.marketing_missions anon TRUNCATE denied` | 신규 마이그레이션 `20261022030200_v093_revoke_public_table_truncate_least_privilege.sql`로 전체 회수, 279개 replay 통과 |
| TRUNCATE 회수 후 4대 불변식 (ANI-1591 영향 조사) | 권한 회수로 인한 service_role 장애, 정상 RLS DML 차단, FK 무결성 검증 실패, 신규 테이블 상속 누락 우려 | 격리 PG16 실측: ① service_role TRUNCATE/DML 보존 ② authenticated 정상 RLS DML 보존 ③ REFERENCES 부재에도 FK 검증 정상 ④ 후속 신규 테이블 최소권한 상속 100% 통과 |

로컬 상세 출력은 같은 폴더 red-unit.log / red-db.log / red-advisor.log / db-result.log에 보존된다(런 로그는 Git ignore 대상). 이 문서에 비밀값·운영 개인정보를 기록하지 않았다.

## 실행한 게이트

| 명령 | 실제 결과 |
|---|---|
| `node scripts/test-tenant-security-db.mjs` | exit0. 279개 전체 raw replay, advisor/domain/storage SQL 3파일 통과 (TRUNCATE/TRIGGER/REFERENCES 회수 검증 완료) |
| `npm test -- tests/tenant-isolation/media-path.test.ts src/features/sohee-studio/__tests__/repository.test.ts src/features/booking-recovery/__tests__/repository.test.ts` | exit0. 62/62 PASS |
| `npm test -- tests/tenant-isolation/studio-boundaries.test.ts` | exit0. 4/4 PASS |
| `npm run test:tenant-isolation` | exit0. 기존 Vault 통합 7/7 PASS, 278개 replay |
| `npm run lint` | exit0. 0 errors / **1409 warnings**. 새 W3 파일 경고는 관찰 안 됨 |
| `npm run typecheck` | 최초 local TypeScript 누락 exit1, 자원 경합 재시도 exit137. 이후 `heavy.sh npm run typecheck` 전역 직렬 락으로 재실행하여 **exit0 / 진단 0건 PASS**. 앞선 실패 이력은 보존 |
| `npm run db:verify-drift` | 미실행. 기존 스크립트가 Keychain credential 조회·운영 POST RPC를 사용함. SELECT-only/시스템 팝업 금지 범위와 분리. 신규 migration 미운영 적용으로 zero-drift 아님 |
| `git diff --check` | exit0 |

위 실행 로그와 별도로 기본 전체 Vitest는 CRM 회귀 3개가 실패할 것으로 예상된다(이미 실패를 실제 관측). 이를 skip/todo/기대 실패로 숨기지 않았다. Draft PR은 release-ready 아님.

## 요구사항 커버리지

- A↔B 양방향 media_assets, content_drafts, knowledge_facts, customer_conversations, reservations, DM threads/messages/drafts, funnel_events, recovery cases/steps/outbox/approvals/slots/proposals 실제 역할 read·write 경계.
- Studio service-only proposals는 direct client 거부, repository query계약 4개와 source/fact 복합 FK 확인. 공개 RPC 8개 전체가 있어야 통과하도록 커버리지 assertion.
- active owner 양성 read와 active viewer 읽기/수정 제한, disabled·멤버십 없는 authenticated·anon 반례. 조작된 user_metadata에 workspace/role을 넣어도 foreign row 노출 없음.
- Storage 플랫폼 stub grants/RLS를 명시적으로 재현한 SQL private attachment read/delete/upload 경계. **실제 HTTP·서명·만료 검증 아님.**
- Advisor는 no-policy 9개, 공개 anon RPC 1개, authenticated definer 24개를 유효 권한·본문 guard로 분류. 원격 함수는 호출하지 않음. 전체 분류는 ADVISOR.md.

## Known Risks / Not Verified (승인·통합 전 차단)

1. **CRM 3개 교차 경계 실패**: W9 src/features/crm/customer-identity-graph.ts 소유자에게 `[W3][RISK]` 전달. 이 브랜치에서 타 창 코드를 고치거나 다른 branch를 무단 merge하지 않음.
2. **accepted_inbound_message_id 단일 FK**: W5에 workspace 복합 FK 요청. 현재 source FK 검증과 달리 이 수락 필드의 강화는 W5 통합 뒤 재검증 필요.
3. **운영 스키마≠raw replay**: 운영만 있는 waitlist primitive는 격리 SQL 미검증. 운영에는 없는 legacy operator RPC·재귀 policy가 raw replay에 재생되는 위험을 추가 migration으로 방지.
4. 운영 Data API HTTP·Storage signed URL·두 실계정·검색/agent retrieval 전체·unauthorized application audit 기록·실운영자 권한 양성 UI 검증 미실시. DB 정책 통과만으로 이 범위의 안전을 주장하지 않음.
5. leaked password protection OFF·join_waitlist 열거/남용 방어는 운영 설정/공개 endpoint 별도 검증 항목. 여기서 운영 설정을 변경하지 않음.
6. test:tenant-security-db npm alias는 공용 package.json 소유자에게 등록 요청. 직접 node 실행은 가능.

## 롤백·배포 경계

- 두 신규 SQL은 테이블/행 삭제 없이 중복 policy 제거·과거 함수 권한 축소만 한다. 기존 history 수정 없음.
- 롤백 시 공개 EXECUTE나 재귀 policy를 복원하지 않는다. 애플리케이션을 이전 버전으로 돌리되 보안 교정은 유지한다. 운영 함수가 없으면 재생성하지 않는다.
- 운영 적용·main merge·배포는 별도 사용자 승인 전 금지. 이후 security/performance Advisor 및 동일 카탈로그 SELECT readback 필요.
