# ANI-1635 골격 검증 영수증

구현/실행: 사용자 승인된 Gemini3.8Flash(high). 독립 source/artifact 리뷰·제출: W3 Sol.
검증 source는 HEAD `742ee9accb784afb48368ae3c2b919a45f0f5b7d`에 신규 골격이 있는 **dirty working tree**였다. 이 HEAD 단독으로 신규 코드를 포함/증명한다고 표시하지 않는다.

## 실행·관측 범위

| 항목 | 명령·근거 | 실제 결과 | 판정 경계 |
|---|---|---|---|
| 단위 계약 | `npx --no-install vitest run tests/e2e-v093/e2e-v093.test.ts`, Gemini 실행 보고·source 리뷰 | 19 PASS / exit0 보고 | 순수 guard/parity/집계/PLAN_ONLY 계약. 실제 UI·server·SDK 실행 아님 |
| PLAN_ONLY | `node tests/e2e-v093/run-plan-only.mjs`, 추적 가능한 execution-summary.json | exit2, actions0, 24 NOT_VERIFIED, 실업무 검증0 | readiness 미검증. 환경변수/hash 모양만으로 fixture 서버를 인증하지 않음 |
| 최신 TypeScript | `heavy.sh node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit` | 최신2차 job exit0. Sol이 완료된 raw 종료코드 읽음 | heap3GB 직접 호출. 실제 E2E·통합 통과로 확대 금지 |
| 타깃 ESLint | `heavy.sh npx --no-install eslint tests/e2e-v093` | job exit0, 오류0/경고0. Sol이 완료된 raw 종료코드 읽음 | tests/e2e-v093 타깃만, 전체 repo 경고0 주장 아님 |

raw gate job 식별자: TypeScript `bwnxwp8pw.output`, 타깃 lint `br2ft9dkg.output`. 로컬 harness 결과에서 종료코드를 검토했다. 원시 queue 출력에는 타 작업 정보가 섞일 수 있어 공개 PR에 전체를 복제하지 않는다.

## 수정·리뷰 이력

- 초기13개 unit green은 독립 review에서 승인하지 않았다. caller hash→격리 VERIFIED, 누락된 업무 값 비교, raw diff 노출, 고정 SHA와 증거 없는 집계를 보완했다.
- 추가 음성 계약으로 date-only/TZ 오인·빈/미관측/오류 금액·미지원 통화·이미지 순서/타입·scope/creation 상태·raw input 비반사를 검증하도록 했다. Gemini는 RED 단계 exit1 후 최종19 PASS를 보고했다. 초기 gate0를 최신 source의 근거로 재사용하지 않았다.
- 최종 허용 범위는 **준비용 골격 및 순수 계약**이다. 기본 PLAN_ONLY는 adapter/SDK/driver를 호출하지 않으며 실제 서버 attestor·앱 fixture loader/selector/reader는 미바인딩 상태다.
- 계약 집계와 실업무 검증 수를 분리했다. 실브라우저가 연동되지 않은 현 골격은 real verified tasks를0으로 유지한다.

## 미검증

실제 Ego TaskSpace/viewport UI/브라우저 screenshot·PWA/PC 전환·운영 DB/Provider·LIVE 계정·앱 TEST fixture 연결은 미실행/NOT_VERIFIED다. 공식 guide v2.1.0 확인 영수증은 별도이며 SDK runtime 검증을 대체하지 않는다.

`integration/v093 INTEGRATION-report.md`는 조사한 shared notes/이 checkout에서 미확보(NOT_AVAILABLE). 다른 위치에 존재하지 않는다고 단정하지 않는다. 실제 report·고정 통합 SHA·명령/exit/evidence를 받은 뒤 Golden12와 반례 family·FACT gate를 재판정한다.

**최종 서비스 판정: NO-GO.** 이 골격 제출은 실계정/외부 쓰기·branch merge·운영 배포 승인이나 ANI-1635 전체 E2E DoD 완료가 아니다.
