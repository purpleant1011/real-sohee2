/**
 * 코호트 보드 설정값 (ANI-1556).
 * 근거와 변경 방법: docs/v092/admin-cohort-thresholds.md
 *
 * - STALL_HOURS = 24: 사장님이 하루(24시간) 안에 같은 단계에서 움직이지 않으면
 *   "오늘 챙겨야 할 사람"으로 올린다. 24시간 미만은 정상 진행으로 본다(근무일 하루 단위 운영 리듬).
 *   관측 데이터로 보정하기 전 초기값이며, 코드 수정 없이 이 파일 한 곳에서만 바꾼다.
 * - MAX_COHORT: 5~20명 규모를 가정한 단순 표/카드이므로 이를 넘으면 합계를 확정하지 않는다.
 */
export const COHORT_CONFIG = Object.freeze({
  STALL_HOURS: 24,
  MAX_COHORT: 50,
})
