import { describe, expect, it } from 'vitest'
import { DATASET_MODE_LABEL, datasetModeLabel, isActualDataset, parseDatasetMode } from './dataset-mode'

describe('데이터셋 모드 — 샘플/실데이터 구분', () => {
  it('세 값만 인정한다', () => {
    expect(parseDatasetMode('ACTUAL')).toBe('ACTUAL')
    expect(parseDatasetMode('SHOWCASE_DEMO')).toBe('SHOWCASE_DEMO')
    expect(parseDatasetMode('TEST')).toBe('TEST')
  })
  it('모르는 값·비문자열은 null(fail-closed)', () => {
    expect(parseDatasetMode('DEMO')).toBeNull()
    expect(parseDatasetMode('actual')).toBeNull()
    expect(parseDatasetMode(undefined)).toBeNull()
    expect(parseDatasetMode(1)).toBeNull()
  })
  it('실제 데이터에는 라벨을 붙이지 않는다', () => {
    expect(datasetModeLabel('ACTUAL')).toBeNull()
    expect(isActualDataset('ACTUAL')).toBe(true)
  })
  it('예시·시험 화면은 사용자 문구로 구분한다(영문 코드 비노출)', () => {
    expect(DATASET_MODE_LABEL.SHOWCASE_DEMO).toContain('예시 화면')
    expect(DATASET_MODE_LABEL.TEST).toContain('시험용 화면')
    for (const label of [DATASET_MODE_LABEL.SHOWCASE_DEMO, DATASET_MODE_LABEL.TEST]) {
      expect(label).not.toContain('ACTUAL')
      expect(label).not.toContain('SHOWCASE_DEMO')
      expect(label).not.toContain('TEST')
    }
  })
})
