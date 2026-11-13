import type { DataState } from '@/components/feedback/data-boundary'

export type HomeSummary = {
  title: string
}

export async function getHomeSummary(): Promise<DataState<HomeSummary>> {
  return {
    kind: 'empty',
    title: '아직 연결된 작업이 없어요',
    description: '작업을 연결하면 오늘 확인할 내용을 이곳에서 안내할게요.',
  }
}
