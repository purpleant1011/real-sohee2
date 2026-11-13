/**
 * 데이터셋 모드 (ANI-1764).
 *
 * M06 미리보기가 보여 주는 사진·문구가 어디서 왔는지 화면에서 구분한다.
 * - `ACTUAL`: 이 워크스페이스의 실제 업로드 자산과 서버 초안.
 * - `SHOWCASE_DEMO`: 화면 배치를 보여 주기 위한 예시. 실제 사진·문구가 아니다.
 * - `TEST`: 시험용. 실제 게시에 쓰이지 않는다.
 *
 * 서버가 보낸 값이 세 값 중 하나가 아니면 `null` 이다. 호출 측이 임의로
 * `ACTUAL` 로 승격하지 않도록, 파서는 모르는 값을 통과시키지 않는다.
 * (실제 초안 경로는 `draftDatasetMode()` 가 서버 초안에 한해 `ACTUAL` 을 쓴다.)
 */

export const DATASET_MODES = ['ACTUAL', 'SHOWCASE_DEMO', 'TEST'] as const
export type DatasetMode = (typeof DATASET_MODES)[number]

/** 서버·DTO 값 파싱. 모르는 값은 `null`(fail-closed). */
export function parseDatasetMode(value: unknown): DatasetMode | null {
  return typeof value === 'string' && (DATASET_MODES as readonly string[]).includes(value)
    ? (value as DatasetMode)
    : null
}

/**
 * 사용자에게 보이는 라벨. `ACTUAL` 은 실제 데이터이므로 별도 라벨이 없다.
 * 영문 코드(ACTUAL 등)는 화면에 내보내지 않는다.
 */
export const DATASET_MODE_LABEL: Record<DatasetMode, string | null> = {
  ACTUAL: null,
  SHOWCASE_DEMO: '예시 화면이에요 · 실제 사진과 문구가 아니에요',
  TEST: '시험용 화면이에요 · 실제 게시에 쓰이지 않아요',
}

export function datasetModeLabel(mode: DatasetMode): string | null {
  return DATASET_MODE_LABEL[mode]
}

/** 실제 워크스페이스 데이터인가. 미리보기 자산 범위 검증의 기준이다. */
export function isActualDataset(mode: DatasetMode): boolean {
  return mode === 'ACTUAL'
}
