'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { analyzeReferenceImagesAction, previewImageStyleAction } from './actions/image-style-training'
import { saveWorkspaceImageStyleAction } from './actions/save-workspace-image-style'
import { ProfileImportWizard } from '../profile-import/profile-import-wizard'
import { OverlayComposer } from './overlay/overlay-composer'
import {
  canonicalStyleKey,
  clearStyleDraft,
  isDraftDifferentFromBaseline,
  loadStyleDraft,
  saveStyleDraft,
} from './style-draft'
import type { WorkspaceImageStyle } from './workspace-image-style'
import styles from './image-style-settings.module.css'

type FormState = Readonly<{
  subject: string
  composition: string
  setting: string
  mood: string
  lookAndColor: string
  people: string
  avoid: string
  extra: string
  guide: string
}>

type Reference = Readonly<{ id: string; url: string; note: string }>

const MAX_REFERENCES = 8
const MAX_UPLOAD_TOTAL_BYTES = 10 * 1024 * 1024
const EMPTY: FormState = { subject: '', composition: '', setting: '', mood: '', lookAndColor: '', people: 'any', avoid: '', extra: '', guide: '' }

const PRESETS: ReadonlyArray<Readonly<{ label: string; values: FormState }>> = [
  { label: '네일', values: { ...EMPTY, subject: '네일 아트가 선명하게 보이는 손 클로즈업', composition: '위에서 45도, 손은 화면 중앙, 주변 여백', mood: '화사하고 깨끗한', setting: '밝은 네일샵 테이블', lookAndColor: '부드러운 자연광, 파스텔 톤', people: 'hands', avoid: '네온, 과한 보정, 왜곡된 손가락' } },
  { label: '헤어', values: { ...EMPTY, subject: '스타일링이 완성된 헤어 디테일', composition: '뒷모습·옆모습 상반신, 머리결이 중심', mood: '세련되고 따뜻한', setting: '채광이 좋은 미용실', lookAndColor: '부드러운 조명, 차분한 뉴트럴 톤', people: 'people', avoid: '과한 보정, 유명인 닮은 얼굴' } },
  { label: '카페·베이커리', values: { ...EMPTY, subject: '갓 만든 시그니처 메뉴 클로즈업', composition: '메뉴는 화면 아래 1/3, 위쪽은 매장 분위기', mood: '따뜻하고 아늑한', setting: '원목 테이블이 있는 매장', lookAndColor: '창가 자연광, 따뜻한 베이지 톤', people: 'none', avoid: '네온, 플라스틱 질감, 글자' } },
  { label: '식당', values: { ...EMPTY, subject: '막 나온 대표 음식', composition: '위에서 내려다본 구도, 음식이 화면의 60%', mood: '활기차고 먹음직스러운', setting: '깔끔한 식당 테이블', lookAndColor: '따뜻한 조명, 선명한 색감', people: 'none', avoid: '과한 보정, 비현실적인 양' } },
  { label: '꽃집·소품샵', values: { ...EMPTY, subject: '진열된 꽃과 소품이 매력적으로 보이는 클로즈업', composition: '위에서 내려다본 구도, 제품이 화면 60%', mood: '싱그럽고 아기자기한', setting: '자연광이 드는 매장 진열대', lookAndColor: '밝은 자연광, 선명한 색감', people: 'none', avoid: '과한 보정, 글자' } },
  { label: '학원·교육', values: { ...EMPTY, subject: '수업·학습 장면, 집중하는 학생의 모습', composition: '정면 상반신, 학습 도구가 보이는 구도', mood: '차분하고 신뢰감 있는', setting: '밝은 교실', lookAndColor: '균일한 조명, 화이트·우드 톤', people: 'people', avoid: '실제 학생 얼굴 식별 가능, 과한 보정' } },
  { label: '피부·눈썹', values: { ...EMPTY, subject: '시술 디테일이 보이는 자연스러운 클로즈업', composition: '정면 가까이, 시술 부위가 화면 중앙', mood: '깨끗하고 신뢰감 있는', setting: '밝고 정돈된 시술실', lookAndColor: '부드러운 확산광, 화이트·크림 톤', people: 'hands', avoid: '피·상처, 과한 보정, 전후 비교' } },
]

const GUIDE_CHIPS: ReadonlyArray<string> = [
  '제품은 화면 중앙에 두고 여백을 충분히 살려주세요',
  '인물은 얼굴 없이 손과 세부 디테일만 담아주세요',
  '자연스러운 채광과 따뜻하고 편안한 색감으로 만들어주세요',
  '화려한 필터나 과한 보정은 피해주세요',
]

const FIXED_SCENE_CHIPS: ReadonlyArray<Readonly<{ label: string; value: string }>> = [
  { label: '대표 상품·서비스 클로즈업', value: '우리 대표 상품 또는 서비스를 가까이서 보여주는 대표 사진' },
  { label: '매장 분위기', value: '매장의 분위기와 공간이 느껴지는 사진' },
  { label: '작업 과정', value: '작업하거나 만드는 과정이 보이는 사진' },
  { label: '고객 응대 장면', value: '고객을 맞이하거나 상담하는 따뜻한 장면' },
]

function fromStyle(style: WorkspaceImageStyle | null): FormState {
  if (!style) return EMPTY
  return {
    subject: style.subject, composition: style.composition, setting: style.setting, mood: style.mood,
    lookAndColor: style.lookAndColor, people: style.people, avoid: style.avoid.join(', '), extra: style.extra, guide: style.guide,
  }
}

const ANALYSIS_MARK = '[사진 분석 노트]'

function mergeAnalysis(guide: string, analysis: string): string {
  const own = guide.split(ANALYSIS_MARK)[0]?.trim() ?? ''
  return [own, `${ANALYSIS_MARK} ${analysis}`].filter(Boolean).join('\n\n').slice(0, 2000)
}

function mediaUrl(workspaceId: string, id: string) {
  return `/api/workspaces/${workspaceId}/media/${id}`
}

export function ImageStyleSettings(
  props: Readonly<{ workspaceId: string; canEdit: boolean; initialStyle: WorkspaceImageStyle | null }>,
) {
  return <ImageStyleSettingsInner key={props.workspaceId} {...props} />
}

function ImageStyleSettingsInner({
  workspaceId,
  canEdit,
  initialStyle,
}: Readonly<{ workspaceId: string; canEdit: boolean; initialStyle: WorkspaceImageStyle | null }>) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [learning, startLearning] = useTransition()
  const [previewing, startPreview] = useTransition()
  const [initialDraft] = useState(() => {
    const d = loadStyleDraft(workspaceId)
    return d && isDraftDifferentFromBaseline(d, initialStyle) ? d : null
  })

  const [form, setForm] = useState<FormState>(() => {
    if (initialDraft) {
      return initialDraft.form
    }
    return fromStyle(initialStyle)
  })
  const [references, setReferences] = useState<Reference[]>(() => {
    if (initialDraft) {
      return initialDraft.references.map((r) => ({
        id: r.id,
        url: r.url,
        note: r.note,
      }))
    }
    return (initialStyle?.referenceAssetIds ?? []).map((id) => ({
      id,
      url: mediaUrl(workspaceId, id),
      note: initialStyle?.referenceNotes[id] ?? '',
    }))
  })
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const [rights, setRights] = useState(false)
  const [learnMessage, setLearnMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [scene, setScene] = useState(() => initialDraft?.scene ?? '')
  const [restoredBanner, setRestoredBanner] = useState<boolean>(() => Boolean(initialDraft))
  const [draft, setDraft] = useState<{ id: string; url: string; remaining: number } | null>(null)
  const [draftError, setDraftError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [baseChoice, setBaseChoice] = useState<string | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [showDetailedOptions, setShowDetailedOptions] = useState(false)
  const [showAllSummaryChips, setShowAllSummaryChips] = useState(false)

  const busy = pending || learning || previewing
  const refIds = references.map((reference) => reference.id)
  const refNotes = Object.fromEntries(references.map((reference) => [reference.id, reference.note]))
  const [baseline, setBaseline] = useState(() =>
    canonicalStyleKey(
      fromStyle(initialStyle),
      initialStyle?.referenceAssetIds ?? [],
      initialStyle?.referenceNotes ?? {},
    ),
  )
  const dirty = canonicalStyleKey(form, refIds, refNotes) !== baseline

  useEffect(() => {
    saveStyleDraft(workspaceId, {
      form,
      references: references.map((r) => ({ id: r.id, url: r.url, note: r.note })),
      scene,
    })
  }, [workspaceId, form, references, scene])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function appendToGuide(text: string) {
    setForm((current) => {
      const trimmed = current.guide.trim()
      const next = trimmed ? `${trimmed}\n${text}` : text
      return { ...current, guide: next.slice(0, 2000) }
    })
  }

  function applyAnalysis(
    f: Readonly<{ subject: string; composition?: string; setting: string; mood: string; lookAndColor: string; people: string; avoid: string; extra: string; analysis?: string }>,
    newReferences: ReadonlyArray<Reference>,
  ) {
    setForm((current) => ({
      ...current,
      subject: f.subject || current.subject,
      composition: f.composition ?? current.composition,
      setting: f.setting || current.setting,
      mood: f.mood || current.mood,
      lookAndColor: f.lookAndColor || current.lookAndColor,
      people: f.people || current.people,
      avoid: f.avoid || current.avoid,
      extra: f.extra || current.extra,
      guide: f.analysis ? mergeAnalysis(current.guide, f.analysis) : current.guide,
    }))
    setReferences((current) => {
      const known = new Set(current.map((reference) => reference.id))
      return [...current, ...newReferences.filter((reference) => !known.has(reference.id))].slice(0, MAX_REFERENCES)
    })
  }

  function learn() {
    setLearnMessage(null)
    const totalSize = photos.reduce((sum, photo) => sum + photo.size, 0)
    if (totalSize > MAX_UPLOAD_TOTAL_BYTES) {
      setLearnMessage({ kind: 'error', text: '사진 용량 합계는 10MB 이하여야 해요. 사진 크기를 줄여서 다시 올려주세요.' })
      return
    }
    const data = new FormData()
    data.set('workspaceId', workspaceId)
    data.set('rightsAcknowledged', rights ? 'true' : 'false')
    for (const photo of photos) data.append('files', photo)
    startLearning(async () => {
      try {
        const analyzed = await analyzeReferenceImagesAction(data)
        if (analyzed.error) {
          setLearnMessage({ kind: 'error', text: analyzed.error.message })
          return
        }
        applyAnalysis(analyzed.data.form, analyzed.data.references)
        setPhotos([])
        setLearnMessage({ kind: 'ok', text: '읽은 내용을 아래 칸에 채우고 사진을 기준 사진으로 보관했어요. 고칠 부분을 고친 뒤 시안을 보고 저장해 주세요.' })
      } catch (error) {
        const text = error instanceof Error && error.message ? error.message : '사진을 분석하지 못했어요. 잠시 후 다시 시도해 주세요.'
        setLearnMessage({ kind: 'error', text })
      }
    })
  }

  function makeDraft(next: FormState, nextScene: string) {
    setDraftError('')
    startPreview(async () => {
      try {
        const made = await previewImageStyleAction({
          workspaceId, ...next, references: refIds, referenceNotes: refNotes, ...(nextScene.trim() ? { scene: nextScene.trim() } : {}),
        })
        if (made.error) {
          setDraftError(made.error.message)
          return
        }
        setDraft({ id: made.data.assetId, url: made.data.previewUrl, remaining: made.data.remainingToday })
        setBaseChoice('draft')
      } catch (error) {
        const text = error instanceof Error && error.message ? error.message : '시안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'
        setDraftError(text)
      }
    })
  }

  function regenerate() {
    const note = feedback.trim()
    if (!note) return
    const merged = { ...form, extra: [form.extra.trim(), note].filter(Boolean).join(' / ').slice(0, 600) }
    setForm(merged)
    setFeedback('')
    makeDraft(merged, scene)
  }

  function addDraftAsReference() {
    if (!draft || references.length >= MAX_REFERENCES || refIds.includes(draft.id)) return
    setReferences((current) => [...current, { id: draft.id, url: mediaUrl(workspaceId, draft.id), note: '소희가 만든 시안 중 마음에 든 것' }])
  }

  function save() {
    setResult(null)
    startTransition(async () => {
      try {
        const saved = await saveWorkspaceImageStyleAction({ workspaceId, ...form, references: refIds, referenceNotes: refNotes })
        if (saved.error) {
          setResult({ kind: 'error', text: saved.error.message })
          return
        }
        setBaseline(canonicalStyleKey(form, refIds, refNotes))
        clearStyleDraft(workspaceId)
        setRestoredBanner(false)
        setResult({ kind: 'ok', text: '저장했어요. 다음 이미지부터 이 스타일로 만들어요.' })
        router.refresh()
      } catch (error) {
        const text = error instanceof Error && error.message ? error.message : '이미지 스타일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
        setResult({ kind: 'error', text })
      }
    })
  }

  const draftIsReference = draft ? refIds.includes(draft.id) : false

  const effectiveBaseChoice = (() => {
    if (baseChoice === 'draft' && draft) return 'draft'
    if (baseChoice === 'none') return 'none'
    if (baseChoice?.startsWith('ref:') && references.some((reference) => `ref:${reference.id}` === baseChoice)) return baseChoice
    if (draft) return 'draft'
    if (references.length > 0 && references[0]) return `ref:${references[0].id}`
    return 'none'
  })()

  const selectedBaseUrl = (() => {
    if (effectiveBaseChoice === 'draft') return draft?.url ?? null
    if (effectiveBaseChoice === 'none') return null
    if (effectiveBaseChoice.startsWith('ref:')) {
      const id = effectiveBaseChoice.slice(4)
      return references.find((reference) => reference.id === id)?.url ?? null
    }
    return null
  })()

  const dynamicChips = (() => {
    const notes: string[] = []
    for (const reference of references) {
      const trimmed = reference.note.trim()
      if (trimmed && !notes.includes(trimmed)) {
        notes.push(trimmed)
        if (notes.length === 4) break
      }
    }
    return notes.map((note) => ({
      label: note.length > 14 ? `${note.slice(0, 14)}…` : note,
      value: note,
    }))
  })()

  const sceneChips = [...dynamicChips, ...FIXED_SCENE_CHIPS]

  const hasConfiguredStyle = Boolean(
    form.subject.trim() || form.guide.trim() || references.length > 0 || form.mood.trim(),
  )

  const summaryChipItems = [
    references.length > 0 ? `기준 사진 ${references.length}장` : null,
    form.subject ? form.subject : null,
    form.mood ? form.mood : null,
    form.lookAndColor ? form.lookAndColor : null,
  ].filter(Boolean) as string[]

  const visibleSummaryChips = showAllSummaryChips ? summaryChipItems : summaryChipItems.slice(0, 2)
  const remainingChipsCount = summaryChipItems.length - 2

  return (
    <section aria-labelledby="image-style-title" className={cn(styles.panel, 'space-y-4 pb-24')}>
      {/* 1. 상단 요약 Card */}
      <Card className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary shrink-0" aria-hidden="true" />
            <h2 id="image-style-title" className="text-lg font-bold tracking-tight">
              이미지 스타일
            </h2>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'px-2.5 py-0.5 text-xs font-semibold shrink-0',
              hasConfiguredStyle
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-muted/60 text-muted-foreground',
            )}
          >
            {hasConfiguredStyle ? '스타일 등록됨' : '미등록'}
          </Badge>
        </div>

        <p className={styles.hint}>
          원하는 사진 느낌을 알려주면 소희가 맞춰 만들어요.
        </p>

        {/* 현재 스타일 요약 칩 (최대 2개 노출, 초과 시 더보기) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs font-medium text-muted-foreground mr-1">현재 설정:</span>
          {visibleSummaryChips.map((chipText, idx) => (
            <span
              key={idx}
              className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-foreground font-medium max-w-[200px] truncate"
            >
              {chipText}
            </span>
          ))}
          {summaryChipItems.length > 2 ? (
            <button
              type="button"
              onClick={() => setShowAllSummaryChips((prev) => !prev)}
              className="text-xs font-semibold text-primary underline underline-offset-2 ml-1 cursor-pointer"
            >
              {showAllSummaryChips ? '접기' : `+${remainingChipsCount}개 더보기`}
            </button>
          ) : null}
          {!hasConfiguredStyle ? (
            <span className="text-xs text-muted-foreground">아직 등록된 스타일이 없어요. 아래에서 사진을 올리거나 업종을 골라보세요.</span>
          ) : null}
        </div>

        {/* 업종별 빠른 추천 칩 (가로 스크롤 한 줄 snap + 페이드) */}
        <div className="pt-2 border-t border-border/60">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            업종을 누르면 추천 문구를 채워 줘요
          </p>
          <div className={styles.presetsWrapper}>
            <div aria-label="업종별 예시" className={styles.presets} role="group">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  disabled={busy}
                  onClick={() => setForm((current) => ({ ...preset.values, guide: current.guide }))}
                  type="button"
                  className="transition-colors active:scale-95"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {!canEdit ? (
        <Card className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            소유자와 관리자만 이미지 스타일을 바꿀 수 있어요.
          </p>
        </Card>
      ) : (
        <>
          {/* 링크로 한 번에 만들기 섹션 (한 겹 Card) */}
          <Card className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm space-y-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                링크로 한 번에 만들기
              </h3>
              <p className={styles.hint}>
                내 인스타그램·스레드 계정만 가져올 수 있어요
              </p>
            </div>
            <div className={styles.wizardWrapper}>
              <ProfileImportWizard
                canEdit={canEdit}
                onImageStyle={(result) => applyAnalysis(result.form, result.references)}
                workspaceId={workspaceId}
              />
            </div>
          </Card>

          {/* 2. 기준 사진 섹션 */}
          <Card className={cn(styles.step, 'rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm space-y-3')}>
            <div className="flex items-center justify-between">
              <h3>
                <span aria-hidden="true">1</span>
                사진으로 가르치기
              </h3>
              <span className="text-xs font-semibold text-muted-foreground">
                {references.length} / {MAX_REFERENCES}장
              </span>
            </div>

            <p className={styles.hint}>
              최대 8장 · 직접 찍은 사진을 올려주세요
            </p>

            <div className="space-y-3">
              {/* 3열 정사각 썸네일 그리드 */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {references.map((reference, index) => (
                  <div
                    key={reference.id}
                    className="group relative flex flex-col rounded-xl border border-border/80 overflow-hidden bg-muted/20"
                  >
                    <div className="aspect-square relative w-full overflow-hidden bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={`기준 사진 ${index + 1}`}
                        src={reference.url}
                        className="size-full object-cover"
                      />
                      <button
                        aria-label={`기준 사진 ${index + 1} 빼기`}
                        disabled={learning}
                        onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))}
                        type="button"
                        className="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                        title="사진 삭제"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">빼기</span>
                      </button>
                    </div>
                    {reference.note ? (
                      <span className={cn(styles.refNote, 'p-1.5 text-[11px] font-medium leading-tight line-clamp-2 bg-card')}>
                        {reference.note}
                      </span>
                    ) : null}
                  </div>
                ))}

                {references.length < MAX_REFERENCES ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/80 hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground active:scale-98 min-h-11"
                  >
                    <ImagePlus className="size-5 text-muted-foreground" aria-hidden="true" />
                    <span className="text-xs font-semibold">+ 사진 추가</span>
                  </button>
                ) : null}
              </div>

              {/* 접근성 및 기존 테스트 호환용 파일 input */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground block mb-1">
                  참고 사진 올리기
                </span>
                <input
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="참고 사진 올리기"
                  disabled={busy}
                  multiple
                  onChange={(e) => {
                    setLearnMessage(null)
                    const selected = Array.from(e.target.files ?? []).slice(0, MAX_REFERENCES)
                    const totalSize = selected.reduce((sum, file) => sum + file.size, 0)
                    if (totalSize > MAX_UPLOAD_TOTAL_BYTES) {
                      setLearnMessage({ kind: 'error', text: '사진 용량 합계는 10MB 이하여야 해요. 사진 크기를 줄여서 다시 올려주세요.' })
                      setPhotos([])
                      e.target.value = ''
                      return
                    }
                    setPhotos(selected)
                  }}
                  type="file"
                />
              </label>

              {photos.length > 0 ? (
                <p className={styles.hint}>
                  선택한 사진: {photos.map((photo) => photo.name).join(', ')}
                </p>
              ) : null}

              <label className={styles.check}>
                <input
                  checked={rights}
                  disabled={busy}
                  onChange={(e) => setRights(e.target.checked)}
                  type="checkbox"
                />
                <span>직접 찍었거나 사용할 수 있는 사진이에요</span>
              </label>

              <button
                className={styles.save}
                disabled={busy || photos.length === 0 || !rights}
                onClick={learn}
                type="button"
              >
                {learning ? '읽는 중…' : '사진에서 느낌 읽기'}
              </button>

              {learnMessage ? (
                <p
                  className={learnMessage.kind === 'ok' ? styles.ok : styles.error}
                  role={learnMessage.kind === 'error' ? 'alert' : 'status'}
                >
                  {learnMessage.text}
                </p>
              ) : null}
            </div>
          </Card>

          {/* 3. 원하는 느낌 섹션 */}
          <Card className={cn(styles.step, 'rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm space-y-3')}>
            <div className="flex items-center justify-between">
              <h3>
                <span aria-hidden="true">2</span>
                말로 가르치기
              </h3>
              <span className="text-xs font-medium text-muted-foreground">
                {form.guide.length} / 2000자
              </span>
            </div>

            <p className={styles.hint}>
              소희가 기억할 사진 규칙을 적어주세요
            </p>

            <div className="space-y-3">
              <label>
                소희에게 직접 가르치기
                <textarea
                  disabled={busy}
                  maxLength={2000}
                  onChange={(e) => set('guide', e.target.value)}
                  placeholder="예: 제품은 항상 화면 오른쪽 1/3에 두고, 왼쪽은 비워 둬요. 사람은 얼굴 없이 손만 나오게 하고, 배경은 밝은 매장 공간이에요."
                  rows={4}
                  value={form.guide}
                  className="resize-y"
                />
              </label>

              {/* 예시 칩: 탭하면 문구 추가 */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">추천 문구 (누르면 추가)</span>
                <div className="flex flex-wrap gap-1.5">
                  {GUIDE_CHIPS.map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={busy}
                      onClick={() => appendToGuide(chip)}
                      className="inline-flex min-h-[34px] items-center rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted active:scale-95 transition-all text-left"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* 세부 항목 설정 (기존 테스트 계약 완벽 호환) */}
              <div className="pt-2 border-t border-border/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground tracking-wide">
                    세부 설정 항목
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDetailedOptions((prev) => !prev)}
                    className="text-xs font-semibold text-primary underline underline-offset-2 py-1"
                  >
                    {showDetailedOptions ? '간단히 접기' : '모두 펼쳐서 보기'}
                  </button>
                </div>

                <div className={cn('space-y-3', !showDetailedOptions && 'sm:block')}>
                  <label>
                    무엇을 찍을까요
                    <textarea
                      disabled={busy}
                      maxLength={300}
                      onChange={(e) => set('subject', e.target.value)}
                      placeholder="예: 대표 상품·서비스를 가까이 보여주는 사진"
                      rows={2}
                      value={form.subject}
                    />
                  </label>

                  <label>
                    구도·화면 구조
                    <input
                      disabled={busy}
                      maxLength={300}
                      onChange={(e) => set('composition', e.target.value)}
                      placeholder="예: 위에서 45도, 제품은 오른쪽 1/3, 왼쪽 여백"
                      value={form.composition}
                    />
                  </label>

                  <label>
                    배경·장소
                    <input
                      disabled={busy}
                      maxLength={300}
                      onChange={(e) => set('setting', e.target.value)}
                      placeholder="예: 자연광이 드는 매장 공간"
                      value={form.setting}
                    />
                  </label>

                  <label>
                    분위기
                    <input
                      disabled={busy}
                      maxLength={300}
                      onChange={(e) => set('mood', e.target.value)}
                      placeholder="예: 화사하고 깨끗한"
                      value={form.mood}
                    />
                  </label>

                  <label>
                    빛과 색감
                    <input
                      disabled={busy}
                      maxLength={300}
                      onChange={(e) => set('lookAndColor', e.target.value)}
                      placeholder="예: 부드러운 자연광, 파스텔 톤"
                      value={form.lookAndColor}
                    />
                  </label>

                  <label>
                    사람 표현
                    <select
                      disabled={busy}
                      onChange={(e) => set('people', e.target.value)}
                      value={form.people}
                    >
                      <option value="any">소희가 정하기</option>
                      <option value="none">사람 없이</option>
                      <option value="hands">얼굴 없이 손·디테일만</option>
                      <option value="people">사람이 나오게</option>
                    </select>
                  </label>

                  <label>
                    피하고 싶은 것 (쉼표로 구분)
                    <input
                      disabled={busy}
                      onChange={(e) => set('avoid', e.target.value)}
                      placeholder="예: 네온, 과한 보정"
                      value={form.avoid}
                    />
                  </label>

                  <label>
                    추가 요청
                    <textarea
                      disabled={busy}
                      maxLength={600}
                      onChange={(e) => set('extra', e.target.value)}
                      rows={2}
                      value={form.extra}
                    />
                  </label>
                </div>
              </div>
            </div>
          </Card>

          {/* 4. 시안 테스트 섹션 */}
          <Card className={cn(styles.step, 'rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm space-y-3')}>
            <div className="flex items-center justify-between">
              <h3>
                <span aria-hidden="true">3</span>
                바로 만들어 보고 고치기
              </h3>
              <span className="text-xs font-semibold text-muted-foreground">
                하루 6번
              </span>
            </div>
            <p className={styles.hint}>
              저장 전에 시안을 먼저 만들어 봐요
            </p>

            <div aria-label="장면 빠른 선택" className={styles.chips} role="group">
              {sceneChips.map((chip, index) => (
                <button
                  disabled={busy}
                  key={`${chip.label}-${index}`}
                  onClick={() => setScene(chip.value)}
                  title="예시 장면 — 고쳐서 쓰세요"
                  type="button"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <label>
              테스트로 만들 장면 (비우면 대표 이미지)
              <input
                disabled={busy}
                maxLength={300}
                onChange={(e) => setScene(e.target.value)}
                placeholder="예: 이번에 소개할 대표 상품·서비스"
                value={scene}
              />
            </label>

            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => makeDraft(form, scene)}
              type="button"
            >
              {previewing ? '시안 만드는 중…' : '이 스타일로 시안 보기'}
            </button>

            {previewing ? (
              <p className={styles.hint} role="status">
                시안을 만드는 중이에요. 30초 안팎 걸려요.
              </p>
            ) : null}

            {draftError ? (
              <p className={styles.error} role="alert">
                {draftError}
              </p>
            ) : null}

            {draft ? (
              <div className="space-y-3 pt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="이미지 스타일 시안" className={styles.draft} src={draft.url} />
                <p className={styles.hint}>오늘 {draft.remaining}번 더 만들 수 있어요.</p>

                <button
                  className={styles.secondary}
                  disabled={busy || draftIsReference || references.length >= MAX_REFERENCES}
                  onClick={addDraftAsReference}
                  type="button"
                >
                  {draftIsReference ? '기준 사진에 추가됨' : '이 시안을 기준 사진으로 추가'}
                </button>

                {draftIsReference ? (
                  <p className={styles.ok} role="status">
                    기준 사진 {refIds.indexOf(draft.id) + 1}번으로 추가했어요. 저장하면 앞으로 이 사진도 참고해요.
                  </p>
                ) : null}

                <label>
                  시안이 어떤가요? 바꾸고 싶은 점을 알려 주세요
                  <textarea
                    disabled={busy}
                    maxLength={200}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="예: 더 밝게, 배경은 단순하게"
                    rows={2}
                    value={feedback}
                  />
                </label>

                <button
                  className={styles.secondary}
                  disabled={busy || feedback.trim().length === 0}
                  onClick={regenerate}
                  type="button"
                >
                  반영해서 다시 만들기
                </button>
              </div>
            ) : null}
          </Card>

          {/* 5. 문구 합성(오버레이) 섹션 (Switch + 접이식) */}
          <Card className={cn(styles.step, 'rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm space-y-3')}>
            <div className="flex items-center justify-between">
              <h3>
                <span aria-hidden="true">4</span>
                문구·삽입컷 얹기
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">편집기 펼치기</span>
                <Switch
                  checked={overlayOpen}
                  onCheckedChange={setOverlayOpen}
                  aria-label="문구·삽입컷 편집기 토글"
                />
              </div>
            </div>

            <p className={styles.hint}>
              사진 위에 글자나 비교 컷을 얹어요
            </p>

            <details
              className={styles.details}
              open={overlayOpen}
              onToggle={(e) => setOverlayOpen(e.currentTarget.open)}
            >
              <summary>문구·삽입컷 편집기 열기</summary>
              <div className={styles.detailsContent}>
                <label>
                  바탕 사진
                  <select
                    aria-label="바탕 사진"
                    disabled={busy}
                    onChange={(e) => setBaseChoice(e.target.value)}
                    value={effectiveBaseChoice}
                  >
                    <option value="none">없음(후기 카드용)</option>
                    {draft ? <option value="draft">방금 만든 시안</option> : null}
                    {references.map((reference, index) => (
                      <option key={reference.id} value={`ref:${reference.id}`}>
                        기준 사진 {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <OverlayComposer baseUrl={selectedBaseUrl} workspaceId={workspaceId} />
              </div>
            </details>
          </Card>

          {/* 6. 하단 고정 저장 바 */}
          <div className={styles.saveBar}>
            {restoredBanner ? (
              <p className={styles.dirty} role="status">
                저장하지 않은 입력을 복구했어요
              </p>
            ) : null}
            {dirty ? (
              <p className={styles.dirty}>
                저장하지 않은 변경이 있어요
              </p>
            ) : null}
            {result ? (
              <p
                className={result.kind === 'ok' ? styles.ok : styles.error}
                role={result.kind === 'error' ? 'alert' : 'status'}
              >
                {result.text}
              </p>
            ) : null}
            <button
              className={cn(styles.save, 'w-full py-3 text-base shadow-sm font-semibold')}
              disabled={busy}
              onClick={save}
              type="button"
            >
              {pending ? '저장 중…' : '이미지 스타일 저장'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
