import { StickyActionBar } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { SegmentedControl, type SegmentedControlItem } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { MAX_PHOTO_BYTES, canSubmitRights, type RightsDeclaration } from './photo-intake'

/**
 * 첫 포스팅 레인 M02(가게 정보) · M04(사진 등록) · M04b(사진 사용권) 예시 화면.
 * 프리뷰 전용 presentational view이며 값을 저장하거나 조회·전송하지 않는다.
 * 실제 화면은 같은 마크업에 서버 명령 연결을 붙인다.
 */

const LANE_STEPS = ['가게 정보', '사진 등록', '첫 게시 미리보기'] as const
const PHOTO_MAX_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024))

function noop() {}

function LaneHeader({
  step,
  title,
  description,
}: Readonly<{ step: 1 | 2 | 3; title: string; description: string }>) {
  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="-ml-2 inline-flex min-h-11 min-w-11 items-center rounded-xl px-2 text-sm font-medium text-muted-foreground"
        >
          ‹ 뒤로
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">{step} / 3</span>
      </div>
      <Progress value={step} max={3} aria-label="첫 게시 준비 진행률" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <nav aria-label="첫 게시 준비 단계">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {LANE_STEPS.map((label, index) => {
            const current = index + 1 === step
            return (
              <li
                key={label}
                aria-current={current ? 'step' : undefined}
                className={current ? 'font-semibold text-foreground' : undefined}
              >
                {index + 1}. {label}
              </li>
            )
          })}
        </ol>
      </nav>
    </header>
  )
}

/** M02 가게 정보. 1/3 단계이며, 이미 입력한 값은 다시 묻지 않는다. */
export function ShopInfoStepView() {
  return (
    <div className="space-y-5">
      <LaneHeader
        step={1}
        title="어떤 가게인가요?"
        description="소희가 홍보를 돕기 위해 알아야 해요."
      />

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="lane-shop-name">가게 이름</Label>
          <Input id="lane-shop-name" className="min-h-11" defaultValue="예시 가게" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lane-shop-industry">업종</Label>
          <Input id="lane-shop-industry" className="min-h-11" defaultValue="뷰티" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lane-shop-topic">이번에 알릴 것</Label>
          <Textarea
            id="lane-shop-topic"
            defaultValue="가을 신메뉴와 예약 방법을 알리고 싶어요."
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          이미 입력한 정보는 다시 묻지 않아요. 가입할 때 적은 내용은 그대로 채워 두었어요.
        </p>
      </div>

      <StickyActionBar>
        <Button size="lg" className="w-full">
          사진 한 장으로 이어가기
        </Button>
      </StickyActionBar>
    </div>
  )
}

type ExamplePhoto = Readonly<{ id: string; label: string; rights: RightsDeclaration }>

/** 예시 사진 2장. 한 장은 권리 확인됨, 한 장은 아직 확인 전 상태를 보여 준다. */
const EXAMPLE_PHOTOS: readonly ExamplePhoto[] = [
  {
    id: 'example-photo-1',
    label: '예시 사진 1',
    rights: { ownership: 'OWN', hasPerson: false },
  },
  {
    id: 'example-photo-2',
    label: '예시 사진 2',
    rights: { ownership: 'UNKNOWN', hasPerson: false },
  },
]

/** M04 사진 등록. 2/3 단계이며 사진 사용권 확인 전에는 게시할 수 없다. */
export function PhotoIntakeStepView() {
  const publishableCount = EXAMPLE_PHOTOS.filter(photo => canSubmitRights(photo.rights).canPublish).length

  return (
    <div className="space-y-5">
      <LaneHeader
        step={2}
        title="사진을 올려 주세요"
        description="가게를 보여 줄 사진이 있으면 소개가 훨씬 좋아져요."
      />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg">
          사진첩에서 고르기
        </Button>
        <Button variant="outline" size="lg">
          사진 찍기
        </Button>
      </div>

      <ul aria-label="올린 사진" className="grid grid-cols-3 gap-2">
        {EXAMPLE_PHOTOS.map(photo => (
          <li key={photo.id} className="space-y-1">
            <div
              role="img"
              aria-label={`${photo.label} 미리보기`}
              className="flex aspect-square items-center justify-center rounded-xl border border-border bg-muted text-[11px] text-muted-foreground"
            >
              예시 사진
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {canSubmitRights(photo.rights).canPublish ? '게시 가능' : '게시 전 확인 필요'}
            </p>
          </li>
        ))}
      </ul>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>사진 확인</span>
          <span>
            {publishableCount} / {EXAMPLE_PHOTOS.length}장
          </span>
        </div>
        <Progress value={publishableCount} max={EXAMPLE_PHOTOS.length} aria-label="사진 확인 진행률" />
      </div>

      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>
          JPG·PNG 사진 한 장은 {PHOTO_MAX_MB}MB까지 올릴 수 있어요. 아이폰에서 찍은 HEIC 사진은 JPG로
          변환한 뒤 올려 주세요.
        </p>
        <p>
          직접 찍었거나 사용 권한이 있는 사진만 올려 주세요. 권리를 확인하지 못한 사진은 저장만 되고
          게시는 되지 않아요.
        </p>
      </div>

      <StickyActionBar hint="확인된 사진이 한 장 이상 있으면 소개를 만들 수 있어요.">
        <Button size="lg" className="w-full">
          다음
        </Button>
      </StickyActionBar>
    </div>
  )
}

type RightsOwnership = RightsDeclaration['ownership']

const RIGHTS_ITEMS: readonly SegmentedControlItem<RightsOwnership>[] = [
  { id: 'OWN', label: '직접 촬영' },
  { id: 'PERMITTED', label: '사용 허락 받음' },
  { id: 'UNKNOWN', label: '아직 모름' },
]

/** 예시 응답: 직접 촬영했고 다른 사람이 나오지 않는다. */
const EXAMPLE_RIGHTS: RightsDeclaration = { ownership: 'OWN', hasPerson: false }

/** M04b 사진 사용권. 사진 등록(2/3) 안에서 권리를 확인하는 화면이다. */
export function PhotoRightsStepView() {
  const { canPublish } = canSubmitRights(EXAMPLE_RIGHTS)

  return (
    <div className="space-y-5">
      <LaneHeader
        step={2}
        title="사진 사용권을 확인해 주세요"
        description="게시하려면 이 사진을 쓸 수 있는지 먼저 확인해야 해요."
      />

      <div className="space-y-2">
        <p className="text-sm font-medium">이 사진을 어떻게 구했나요?</p>
        <SegmentedControl
          ariaLabel="사진 사용권"
          items={RIGHTS_ITEMS}
          value="OWN"
          onChange={noop}
        />
      </div>

      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">사진에 다른 사람이 나오나요?</p>
          <p className="text-xs leading-5 text-muted-foreground">나온다면 그분의 동의도 함께 확인해요.</p>
        </div>
        {/* 공용 Switch 는 루트 버튼이 size-11(44×44), 안쪽 트랙이 36×20 알약이다. */}
        <Switch
          checked={false}
          onCheckedChange={noop}
          aria-label="사진에 다른 사람이 나오나요"
        />
      </div>

      <p
        className={
          canPublish
            ? 'rounded-xl bg-primary/5 p-3 text-xs leading-relaxed text-foreground'
            : 'rounded-xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground'
        }
      >
        {canPublish
          ? '권리를 확인했어요. 이 사진으로 첫 게시를 준비할 수 있어요.'
          : '권리를 확인하지 못하면 저장만 되고 게시는 되지 않아요.'}
      </p>

      <p className="text-xs leading-relaxed text-muted-foreground">
        확인한 내용은 저장되지만, 게시하기 전에 한 번 더 확인해요.
      </p>

      <StickyActionBar>
        <Button size="lg" className="w-full">
          확인 완료
        </Button>
        <Button size="lg" variant="ghost" className="w-full">
          나중에 확인하기
        </Button>
      </StickyActionBar>
    </div>
  )
}
