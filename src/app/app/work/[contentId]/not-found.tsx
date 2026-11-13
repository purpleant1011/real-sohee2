import { AppLink as Link } from '@/components/navigation/app-link'
import { Button } from '@/components/ui/button'
import { StateView } from '@/components/mobile-ui/state-view'

export default function WorkNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col items-center justify-center p-4">
      <StateView
        kind="confirmed_empty"
        title="요청한 작업을 찾을 수 없어요"
        description="다른 작업공간의 콘텐츠이거나 이미 정리된 항목일 수 있습니다."
        action={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/app/content">작업 목록으로 돌아가기</Link>
          </Button>
        }
      />
    </main>
  )
}
