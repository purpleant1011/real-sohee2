# mobile-firstpost (W4) — 사실 질문→홍보세트→편집→승인→게시→10분 E2E

담당: ANI-1677(M05) · 1678(M06) · 1679(M12) · 1680(M07) · 1681(M08) · 1682(E2E)

## 서버 계약 분석 (2026-10-22, 기존 코드 기준)

| 구간 | 엔드포인트 | 현재 계약 | 모바일 R2 갭 |
|---|---|---|---|
| 초안 | `POST /api/workspaces/:id/quick-post` | `requestId`(uuid)로 퍼널/크레딧 멱등 | 없음 |
| 편집 | `PATCH …/quick-post` (`copies` 직접수정) | 서버가 `metadata.quick.revision`을 읽어 CAS. **클라이언트가 기준 revision을 보내지 않음** | **G1** 구버전 기기가 저장해도 최신을 읽고 덮어씀(무증거 덮어쓰기). CAS 실패는 500 `PERSISTENCE_ERROR`(409 아님) |
| 승인 | `POST /api/missions/first-post/approve` | fingerprint 서버 재계산, 명시 문구 `이 버전 승인하고 발행`, CAS(status, updated_at 조건은 select에 updated_at 미포함이라 사실상 미적용) | **G2** `select`에 `updated_at` 없어 `mission.updated_at` 분기가 죽은 코드. 동시 승인은 status CAS로만 방어 |
| 게시 | `POST /api/missions/first-post/publish` | `PUBLISHED_VERIFIED` 재호출은 idempotent replay, `APPROVED→EXECUTING` CAS, 독립 readback | **G3** `PARTIAL_SUCCESS`는 DB를 `EXECUTING`에 두고 재시도 경로 없음(영구 "발행 중"). **G4** 요청 멱등키 헤더 없음. 생성 계정은 `WORKSPACE_NOT_IN_LIVE_ROLLOUT`에서 403 |
| 결과 | `executionResult.receipts[ch].stage` | REQUESTED/EXECUTING/PROVIDER_ACCEPTED/EXTERNALLY_VERIFIED/OUTCOME_OBSERVED/FAILED/RESULT_UNKNOWN | `QuickPostItem.stageOf`가 `partial`을 만들지 못하고 `LISTENING`/`COMPLETED`를 "발행됨"으로 표시 → 거짓 게시됨 위험 |

> **2026-10-23 정정**: G1 #1959(`expectedRevision` 409), G2·G3는 main에 이미 해결(approve select에 `updated_at`, `publish/retry` 채널별 재시도·`CHANNEL_ALREADY_VERIFIED`), G4 #1962(`Idempotency-Key`), G5(워크스페이스+채널 단위 진행중(EXECUTING) 게시 가드 `channel-publish-guard`, R1/R2 별개 미션 교차 차단)로 닫힘.

제안(서버 변경은 이슈별 후속 PR, 본 영역 밖 파일 수정 전 총사령관 확인):
- G1: PATCH body에 `expectedRevision` 추가 → 불일치 시 409 `REVISION_CONFLICT` + 서버 최신본 반환. 클라 판정은 `revision-conflict.ts`.
- G2: approve의 `select`에 `updated_at` 포함.
- G3: PARTIAL_SUCCESS를 채널별 재시도 가능한 상태로 노출(이미 verified 채널 재게시 금지).
- G4: publish 요청에 `Idempotency-Key` 수신·저장.

## 실사진 asset 연결 · 샘플 사진 제거 (ANI-1764, 2026-10-23)

M06 미리보기는 **이 워크스페이스의 실제 자산과 서버 초안**만 그린다. `/dev` 예시 화면은 실제 사진 대신 인라인 자리표시자를 쓰고 데이터셋 모드 라벨을 항상 함께 보여 준다.

### 데이터셋 모드 (`dataset-mode.ts`)
- `ACTUAL | SHOWCASE_DEMO | TEST` 세 값만 인정한다. 모르는 값은 `null`(fail-closed)이며 `ACTUAL` 로 승격하지 않는다.
- 사용자 라벨은 한국어 문구만 내보낸다(`ACTUAL` 은 라벨 없음). 영문 코드는 화면에 노출하지 않는다.
- 서버 초안에 `datasetMode` 필드가 없으면 `ACTUAL` 로 본다 — propose 응답은 워크스페이스 소유자가 조회한 실제 레코드다. 필드가 있는데 모르는 값이면 화면은 "화면 데이터를 확인하지 못했어요"로 닫힌다.

### 자산 범위 검증 (`asset-dto.ts`)
- `ACTUAL`: `same-origin` + `/api/workspaces/{workspaceId}/media/{assetId}` 경로만 통과. 다른 워크스페이스 경로(`CROSS_WORKSPACE`), 바깥 출처(`EXTERNAL_ORIGIN`), media 가 아닌 경로(`NOT_WORKSPACE_SCOPED`), 워크스페이스 id 미상(`NO_WORKSPACE`)은 모두 거절한다.
- `SHOWCASE_DEMO`·`TEST`: 같은 출처 상대 경로와 인라인 자리표시자(`data:image/...`)만 허용하고 바깥 출처는 계속 막는다.
- 사진 주소를 지어내지 않는다. 근거가 하나라도 어긋나면 `null` 이고 화면은 빈 상태/차단 사유를 보여 준다.
- 미리보기 렌더 계약(`previewBlockers`/`canRenderPreview`/`previewFrame`)도 `datasetMode` 를 받아, `ACTUAL` 에서는 인라인 자리표시자도 `INVALID_IMAGE_URL` 로 막는다.

### 정직한 빈 상태
- 사진이 없으면 `NO_ASSET` → "사진이 아직 없어요 / 사진을 한 장 골라야 미리보기를 만들 수 있어요." 샘플 사진으로 채우지 않는다.
- 예시 화면은 `role="note"` 라벨("예시 화면이에요 · 실제 사진과 문구가 아니에요")과 `data-dataset-mode-label` 로 구분한다.
- 채널 미연결이어도 저장·복사·다운로드는 그대로 열려 있고, "게시완료" 표현은 만들지 않는다(회귀 테스트로 고정).

### `/dev` 예시에서 제거한 것
- `sohee_insta_post.jpg` 정적 샘플 사진 참조 3곳(`preview-set-demo`, `first-post-flow-demo`, `approval-review-demo`)을 인라인 SVG 자리표시자(`demo-placeholder.ts`)로 교체했다. 외부 요청·파일 자산 없음.

## 이번 단계 산출물 (UI 비의존 순수 도메인, 286 tests GREEN)
- `publish-outcome.ts` — 영수증 → 표시 모델. permalink+verifiedAt 없으면 VERIFIED 불가, RESULT_UNKNOWN 재전송 금지, 영문 에러 비노출. MANUAL_REQUIRED 원인별 문구 분기(READBACK_UNKNOWN은 재시도 금지).
- `execution-contract.ts` — W6 실행 코어의 5상태(`ExecuteStatus`)·실패 원인·transport/readback 메타데이터 계약. 값 보존만 정의.
- `execute-status-adapter.ts` — W6 상태 → W4 `OutcomeStage` 정본 매핑 표와 strict DTO 파서. 상태를 재판정하지 않고 근거(permalink/verifiedAt)를 만들지 않는다.
- `revision-conflict.ts` — 기준 revision 비교, 필드별 diff, 동일 내용이면 충돌 아님.
- `approval-gate.ts` — 단일 요청 보장(single-flight), 승인 지문 stale 판정, 승인 문구 상수.
- `facts.ts` — M05 사실 확인. 누락 항목만 순서대로 질문, 답변은 `PROPOSED`→사용자 확인 `CONFIRMED`, 건너뜀은 재질문 없음, 원고에는 `CONFIRMED` 값만 투입.
- `preview-set.ts` — M06 홍보 세트. 실제 asset·권리 근거(`CONFIRMED`)가 있을 때만 미리보기, 채널 원고 독립 버전(탭 이동 시 편집 유지), 승인 지문은 화면 원문 그대로, AI 재작성 제안은 수락 전 지문·저장 상태 불변, 만들어진 배지는 게시 상태가 아님. 게시 권한 미확인 시 `게시하기` 대신 저장·복사·다운로드·연결 제안.
- `approval-review.ts` — M07 승인 화면. 「어디에(채널·계정) / 무엇을(이미지+전문) / 언제·예상 비용」을 한 화면 계약으로 묶고, 근거 없는 항목은 blocker로 fail-closed(`NO_CHANNEL`·`MISSING_ACCOUNT`·`CHANNEL_NOT_PUBLISHABLE`·`COST_UNKNOWN`·`APPROVED_SNAPSHOT_MISMATCH` 등). 비용은 출처(`SERVER_QUOTE`/`POLICY`/`UNKNOWN`)를 보존하고 출처 불명은 `확인 불가`로 남긴다. 승인 요청은 클릭 시점에 화면을 다시 읽어 재검증하고 single-flight로 1회만 나간다. **승인은 게시가 아니다** — 제출 결과는 `SUBMITTED`이며 게시 확인은 별도 readback이다. 승인 후 원고가 바뀌면 `STALE`로 무효화되어 재승인이 필요하다.
- `result-screen.ts` — M08 결과·증거 화면. 성공 카드의 근거는 독립 readback(`permalink`+게시 시각+대상 계정 대조)뿐이며, 근거가 어긋나면 VERIFIED를 UNKNOWN으로 **낮추기만** 한다(무효 링크·파싱 불가 시각·다른 계정·대상 계정 미상). 축하·완료 토스트·첫 가치 이벤트는 모든 표시 채널이 VERIFIED일 때만 만들고, 확인 중·확인 불가에는 재게시 대신 새로고침만 연다. 수동 전달(복사·다운로드)은 `MANUAL` 카드로만 두고 "직접 확인" 안내를 붙이며 성공으로 승격하지 않는다. 새로고침·재시도 실행은 호출 측이 주입한다.

## 화면 설계 (M05~M08, M12) — 390px, BROWSE 탭 숨김, 단일 고정 CTA
1. 사실 질문 (M05): 소희 말풍선 1개 + 기존 확인 정보 칩 + 누락 사실만 1문항씩. 하단 CTA `이 내용으로 계속`, 보조 `정보 없이 진행`. 답변은 "수정 제안" 칩으로 저장 전 확인.
2. 홍보 세트 (M06): 채널 세그먼트(가로 스와이프) + 실제 asset 비율 유지 + 문구 접기/펼치기. 상태 배지: 초안 준비/수정됨/승인 전. CTA `이 내용 검토`, 보조 `문구 수정`.
3. 편집 (M12): 전체화면, 채널별 1문단. 키보드 위 고정 `변경 저장`. 409면 시트: 내 수정 vs 다른 기기 수정 필드별 선택 → 선택 결과로 재저장(새 revision).
4. 승인 (M07): 어디에(채널·계정) → 무엇을(이미지+전문) → 언제·예상 비용 → 고정 CTA `이 내용으로 게시 요청`. 탭 즉시 비활성(single-flight). 승인 후 원고 변경 감지 시 재승인 배너.
5. 결과 (M08): 채널별 카드 4상태(게시 확인 / 외부 확인 중 / 결과 확인 불가 / 실패). 축하는 `celebrate`일 때만. 비라이브 계정은 복사·다운로드 수동 경로.
UI 구현은 W1 셸 계약(`src/features/mobile-shell/CONTRACT.md`)·W2 토큰 공개 후 통합.
