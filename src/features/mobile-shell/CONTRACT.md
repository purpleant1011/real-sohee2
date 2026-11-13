# Mobile R2 셸 계약 · 1차 공개

2026-10-22 · W1 · ANI-1662 / ANI-1663 / ANI-1664 / ANI-1665 / ANI-1668

상태: 독립 스켈레톤 + 단위/컴포넌트 테스트. **실서비스 라우팅에 아직 연결하지 않았다.** Desktop/R1 분기는 그대로다. 이 계약은 통합 완료나 실기기 검증의 증거가 아니다.

## 1. 진입부와 공개 API

`@/features/mobile-shell`에서 `MobileAppShell`, `ShellScreen`, `useShellScreen`, `useShellViewport`, `useKeyboard`, `ShellScreenConfig`, `ShellCta`, `SHELL_ROUTES`, `SHELL_TABS`를 가져온다.

- 앱 레이아웃의 모바일 분기에서 `MobileAppShell`을 한 번만 마운트한다. Desktop 셸 안에 중첩하지 않는다.
- feature 담당은 화면 본문만 만들고 헤더·5탭·고정 CTA·컴포저를 중복 생성하지 않는다.
- `ShellScreen` 또는 `useShellScreen`으로 설정한다. 마지막으로 등록한 화면이 우선하며 언마운트하면 이전 설정으로 복귀한다.
- 등록은 클라이언트 effect 이후 반영된다. SSR/첫 페인트는 라우트 기본값이며 그때 REVIEW/EDIT의 CTA가 없을 수 있다. 서버 쓰기를 이 등록 상태로 허가하지 않는다.

```tsx
'use client'
import { ShellScreen } from '@/features/mobile-shell'

export function ReviewScreen() {
  return (
    <ShellScreen title="게시 전 확인" mode="REVIEW"
      cta={{ label: '승인하기', disabled: true,
        disabledReason: '채널 연결을 먼저 확인해 주세요', onPress: () => {} }}>
      <p>서버에서 받은 승인 내용을 표시합니다.</p>
    </ShellScreen>
  )
}
```

`ShellScreenConfig`: `mode?`, `title?`, `status?`, `backHref?`, `actions?`(최대 2개), `cta?`, `composer?`.
`ShellCta`: `label`, `onPress`, `busy?`, `disabled?`, `disabledReason?`, `secondary?`(최대 2개). 비활성 이유는 한국어로 명시한다. 서버 권한·멱등성·실행 직전 검증은 feature의 책임이며 셸은 도메인 실행을 하지 않는다.

## 2. 라우트 맵

정확한 패턴/기존 여부/뒤로 목적지는 `routes.ts`의 `SHELL_ROUTES`가 실행 정본이다. `:id`는 한 세그먼트, `/*`는 루트와 하위 전체다. 구체 경로를 먼저 선언한다. `proposed`는 해당 경로의 페이지가 구현됐다는 뜻이 아니다. 기존 여부는 담당 창에서 재확인한다. `absorbed`는 별도 페이지를 만들지 않고 상위 화면의 단계에서 처리한다는 뜻이다(예: M04 사진 선택은 M03 가게 단계, M05 사실 질문은 M03 말투 단계).

| ID | 화면 | 경로 | 모드 / 탭 |
|---|---|---|---|
| M01 | 소개 | `/` | BROWSE / 셸 밖 |
| M02 | 인증 | `/login`, `/signup` | DETAIL / 셸 밖 |
| M03 | 가게 소개 | `/start`, `/app/onboarding` | DETAIL / 셸 밖 |
| M04 | 사진 | `/start/photo` (제안) | DETAIL / 셸 밖 |
| M05 | 사실 확인 | `/start/facts` (제안) | DETAIL / 셸 밖 |
| M06 | 미리보기·홍보 세트 | `/start/preview`, `/app/work/:id` (제안) | DETAIL / 작업 또는 셸 밖 |
| M07 | 게시 전 승인 | `/app/work/:id/approve` (제안) | REVIEW / 작업 |
| M08 | 첫 게시 결과 | `/app/outcome/:id` (제안) | DETAIL / 작업 |
| M09 | 오늘 | `/app` | BROWSE / 오늘 |
| M10 | 채팅 | `/app/command` | CHAT / 오늘 |
| M11 | 작업함 | `/app/content`, `/app/work`, `/app/vault/*` | BROWSE / 작업 |
| M12 | 수정 | `/app/work/:id/edit` | EDIT / 작업 |
| M13 | 소통함·대화 | `/app/engagement`, `/app/engagement/:id` (제안) | BROWSE·DETAIL / 고객 |
| M14 | 예약 문의 | `/app/inbox/:id` (제안) | DETAIL / 고객 |
| M15 | 예약 일정 | `/app/schedule` | BROWSE / 고객 |
| M16 | 예약금·환불 | `/app/schedule/payments/*` (제안) | DETAIL / 고객 |
| M17 | 고객 | `/app/customers`, `/app/customers/:id` (제안) | BROWSE·DETAIL / 고객 |
| M18 | 제안 | `/app/campaigns/*` | DETAIL / 작업 |
| M19 | 승인함 | `/app/approvals`, `/app/approvals/:id` (제안) | REVIEW / 오늘 |
| M20 | 성과·보고 | `/app/results`, `/app/results/:id` | BROWSE·DETAIL / 성과 |
| M21 | 채널 | `/app/channels/*` | DETAIL / 더보기 |
| M22 | 기억 | `/app/knowledge/*`, `/app/memory/*` | DETAIL / 더보기 |
| M23 | 알림 | `/app/notifications` | DETAIL / 오늘 |
| M24 | 내 소희 | `/app/sohee/*` | DETAIL / 더보기 |
| M25 | 요금·설정 | `/app/system`, `/app/settings/*`, `/app/account/*` | BROWSE·DETAIL / 더보기 |
| M26 | 연결 상태 | `/app/offline` (제안) | DETAIL / 셸 밖 |

5탭 루트: 오늘 `/app`, 작업 `/app/content`, 고객 `/app/customers`, 성과 `/app/results`, 더보기 `/app/system`. 미등록 `/app/` 경로는 더보기 DETAIL로 보수적으로 처리하며 `/application` 등은 매치하지 않는다.

## 3. 모드별 표면 소유권

| 모드 | 헤더 | 5탭 | 고정 하단 |
|---|---|---|---|
| BROWSE | 소희 + 맡기기 | 표시 | 탭바만 |
| DETAIL | 뒤로 + 제목 + 행동 | 숨김 | CTA 선택 |
| REVIEW | 뒤로 + 제목 + 행동 | 숨김 | CTA 필수 |
| CHAT | 뒤로 + 제목 + 행동 | 숨김 | 컴포저만 |
| EDIT | 뒤로 + 제목 + 행동 | 숨김 | CTA 필수 |

- `resolveSurface`는 금지된 CTA를 제거하고 위반 목록을 반환한다. CTA 누락을 가짜 동작으로 채우지 않는다.
- CHAT 화면은 `composer={<Composer />}`로 입력창을 등록한다. 셸이 하단 슬롯을 소유하고 화면은 메시지 본문만 제공한다.
- 시트/다이얼로그는 기존 shadcn Sheet/Dialog를 화면이 소유한다. 셸 API에는 시트 스택·이탈 방지 인터셉터가 아직 없다. fixed CTA를 시트 밖/안에 이중 생성하지 않는다.

## 4. 상태 복원

- 탭 변경: 해당 탭 마지막 위치, 없으면 루트. 같은 탭 하위에서 누르면 루트, 같은 루트에서 누르면 맨 위로.
- 스크롤은 경로+쿼리별 sessionStorage 보조 상태다. 필터 정본은 URL, 업무/권한 정본은 서버다.
- 저장소 사용이 불가능하면 복원을 생략하고 정상 탐색한다. 업무 내용을 sessionStorage에 저장하지 않는다.
- URL에 인증 토큰·서명 URL·개인정보·대화 원문을 넣지 않는다. 현재 스켈레톤은 workspace별 저장소 분리/초기화가 아직 없으므로 통합 전에 추가해야 한다.
- 입력 draft·저장 충돌·미저장 이탈 확인은 각 feature 책임이다. 셸이 자동 저장/재전송하지 않는다.

## 5. 딥링크와 뒤로가기

안전한 `backHref` 등록값 → 앱 내부 탐색 이력 → 안전한 `?from=` → 라우트 fallback → 탭 루트 순이다. `safeReturnPath`는 `/app`·`/start` 내부 경로만 허용한다. 상세 진입에는 `withFrom`을 사용할 수 있다. 직접 진입에서 외부 사이트로 history.back하지 않는다.

인증 복귀는 기존 auth safe-next-path를 유지한다. 앱 복귀는 서버 권한/최신 상태를 다시 조회하고 오래된 표시 상태로 실행하지 않는다.

## 6. viewport / 키보드

- `useViewport()`는 셸 루트에서만 측정. `height`, `keyboardOpen`, `keyboardHeight`를 반환한다.
- 하위 화면은 `useShellViewport()` 또는 `useKeyboard(): { open, height }`를 사용한다.
- SSR 초기값은 높이 0 → CSS `100dvh`. visualViewport 미지원 시 innerHeight.
- visualViewport 축소 120px 이상을 키보드로 추정하며 핀치 확대는 제외한다. 이는 휴리스틱이지 실기기 인증이 아니다.
- 키보드 열림 시 BROWSE 탭바를 숨긴다. 고정 CTA/컴포저는 셸 flex 레이아웃 안에 둔다.
- 헤더 상단과 하단 슬롯에 safe-area를 적용한다. iOS offsetTop·Android resize 동작·회전·200% 확대는 통합 후 실기기 확인 대상이다.

## 7. 통합 게이트

셸 단독 59 tests, 기존 mobile-decision/R1 포함 110 tests green. 셸 ESLint green. 전체 typecheck는 별도 검증 결과를 인계 기록에 남긴다. Desktop import 없음. 아직 app layout/전역 CSS/package.json 수정 없음.

실서비스 연결 전: R2 플래그/기기 판별 SSR 일치, Desktop 독립 분기, workspace별 복원 분리, 미저장 이탈 정책, 토큰 연결, 320~430px/키보드/axe/PC 회귀 검증이 필요하다. 구현 스켈레톤을 INTEGRATION_VERIFIED 또는 DONE으로 보고하지 않는다.
