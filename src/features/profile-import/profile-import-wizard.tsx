'use client'

import { useState } from 'react'
import {
  fetchProfileTextStyleAction,
  importProfileImagesAction,
  applyProfileTextStyleAction,
} from './actions/profile-import-actions'
import type { ProfileImagesResult, ProfileTextStyleResult } from './actions/profile-import-actions'
import styles from './profile-import-wizard.module.css'

type ProfileTextStyleData = ProfileTextStyleResult
type ProfileImagesData = ProfileImagesResult
type ImageStyleResult = Readonly<{ form: ProfileImagesResult['form']; references: ProfileImagesResult['references'] }>

function sanitizeError(message: string): string {
  return message
    .replace(/EAAB[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/EAA[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/(access_token|appsecret_proof|client_secret|code|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/"(access_token|appsecret_proof|client_secret|code|secret|password)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
}

export type ProfileImportWizardProps = Readonly<{
  workspaceId: string
  canEdit: boolean
  onImageStyle: (result: ImageStyleResult) => void
}>

export function ProfileImportWizard({
  workspaceId,
  canEdit,
  onImageStyle,
}: ProfileImportWizardProps) {
  const [url, setUrl] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const [textStatus, setTextStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [imageStatus, setImageStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const [textError, setTextError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [textResult, setTextResult] = useState<ProfileTextStyleData | null>(null)
  const [imageResult, setImageResult] = useState<ProfileImagesData | null>(null)

  const [voiceSummary, setVoiceSummary] = useState('')
  const [styleGuide, setStyleGuide] = useState('')
  const [keywords, setKeywords] = useState('')
  const [prohibitedTerms, setProhibitedTerms] = useState('')

  const [applyBusy, setApplyBusy] = useState(false)
  const [applySuccess, setApplySuccess] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const analyzing = textStatus === 'loading' || imageStatus === 'loading'

  async function handleStartAnalysis() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setInputError('계정 링크를 입력해 주세요.')
      return
    }

    setInputError(null)
    setTextStatus('loading')
    setImageStatus('loading')
    setTextError(null)
    setImageError(null)
    setTextResult(null)
    setImageResult(null)
    setApplySuccess(false)
    setApplyError(null)

    const textPromise = fetchProfileTextStyleAction({ workspaceId, url: trimmedUrl })
      .then((res) => {
        if ('error' in res && res.error) {
          setTextStatus('error')
          setTextError(sanitizeError(res.error.message))
        } else if ('data' in res && res.data) {
          const data = res.data
          setTextStatus('done')
          setTextResult(data)
          setVoiceSummary(data.draft.voiceSummary)
          setStyleGuide(data.draft.styleGuide)
          setKeywords(data.draft.keywords.join(', '))
          setProhibitedTerms(data.draft.prohibitedTerms.join(', '))
        }
      })
      .catch((err) => {
        setTextStatus('error')
        setTextError(sanitizeError(err instanceof Error ? err.message : '글 분석 중 오류가 발생했습니다.'))
      })

    const imagePromise = importProfileImagesAction({ workspaceId, url: trimmedUrl })
      .then((res) => {
        if ('error' in res && res.error) {
          setImageStatus('error')
          setImageError(sanitizeError(res.error.message))
        } else if ('data' in res && res.data) {
          const data = res.data
          setImageStatus('done')
          setImageResult(data)
          onImageStyle({ form: data.form, references: data.references })
        }
      })
      .catch((err) => {
        setImageStatus('error')
        setImageError(sanitizeError(err instanceof Error ? err.message : '사진 분석 중 오류가 발생했습니다.'))
      })

    await Promise.all([textPromise, imagePromise])
  }

  async function handleApplyText() {
    setApplyBusy(true)
    setApplyError(null)
    setApplySuccess(false)

    const parsedKeywords = keywords
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    const parsedProhibited = prohibitedTerms
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    try {
      const res = await applyProfileTextStyleAction({
        workspaceId,
        voiceSummary,
        styleGuide,
        keywords: parsedKeywords,
        prohibitedTerms: parsedProhibited,
      })

      if ('error' in res && res.error) {
        setApplyError(sanitizeError(res.error.message))
      } else if ('data' in res && res.data) {
        setApplySuccess(true)
      }
    } catch (err) {
      setApplyError(sanitizeError(err instanceof Error ? err.message : '적용 중 오류가 발생했습니다.'))
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>링크로 한 번에 만들기</h2>
        <p className={styles.hint}>
          인스타그램·스레드 계정 링크를 넣으면 글과 사진을 분석해 소희의 이미지 스타일과 글 쓰는 방식을 만들어요. (현재 연결된 사장님의 계정 링크만 가져올 수 있어요; 현재 연결한 계정 분석 지원; 다른 계정은 사진·텍스트 자료로 직접 등록)
        </p>
      </div>

      {!canEdit ? (
        <p className={styles.hint}>스타일과 글 쓰는 방식을 바꾸려면 편집 권한이 필요해요.</p>
      ) : (
        <div className={styles.inputGroup}>
          <input
            className={styles.input}
            type="url"
            aria-label="인스타그램·스레드 계정 링크"
            placeholder="https://www.instagram.com/내계정/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={analyzing}
          />
          <button
            className={styles.button}
            type="button"
            onClick={handleStartAnalysis}
            disabled={analyzing}
          >
            {analyzing ? '분석 중…' : '분석 시작'}
          </button>
        </div>
      )}

      {inputError && (
        <div className={styles.errorAlert} role="alert">
          {inputError}
        </div>
      )}

      {(textStatus !== 'idle' || imageStatus !== 'idle') && (
        <div className={styles.statusList}>
          {textStatus === 'loading' && (
            <div className={styles.statusItem} role="status">
              글 분석 중…
            </div>
          )}
          {textStatus === 'done' && (
            <div className={`${styles.statusItem} ${styles.done}`} role="status">
              글 분석 완료
            </div>
          )}
          {textStatus === 'error' && textError && (
            <div className={styles.errorAlert} role="alert">
              {textError}
            </div>
          )}

          {imageStatus === 'loading' && (
            <div className={styles.statusItem} role="status">
              사진 분석 중…
            </div>
          )}
          {imageStatus === 'done' && (
            <div className={`${styles.statusItem} ${styles.done}`} role="status">
              사진 분석 완료
            </div>
          )}
          {imageStatus === 'error' && imageError && (
            <div className={styles.errorAlert} role="alert">
              {imageError}
            </div>
          )}
        </div>
      )}

      {imageResult && (
        <div className={styles.imageSuccessNotice}>
          사진 {imageResult.pickedCount}장을 기준 사진으로 보관하고 이미지 스타일 칸을 채웠어요. 아래에서 확인하고 저장해 주세요.
        </div>
      )}

      {textResult && (
        <div className={styles.reviewCard}>
          <h3 className={styles.reviewTitle}>글 쓰는 방식 검토</h3>

          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>분석 게시물</span>
              <span className={styles.statValue}>{textResult.postCount}개</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>평균 글자 수</span>
              <span className={styles.statValue}>{Math.round(textResult.stats.averageLength)}자</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>평균 해시태그 수</span>
              <span className={styles.statValue}>{textResult.stats.averageHashtagCount}개</span>
            </div>
            {textResult.stats.topHashtags.length > 0 && (
              <div className={styles.statItem}>
                <span className={styles.statLabel}>자주 쓰는 해시태그</span>
                <span className={styles.statValue}>{textResult.stats.topHashtags.join(', ')}</span>
              </div>
            )}
            {textResult.stats.repeatedHeaderLine && (
              <div className={styles.statItem}>
                <span className={styles.statLabel}>반복 시그니처 줄</span>
                <span className={styles.statValue}>{textResult.stats.repeatedHeaderLine}</span>
              </div>
            )}
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="profile-import-voice-summary">
              글 쓰는 방식 요약
            </label>
            <textarea
              id="profile-import-voice-summary"
              className={styles.textarea}
              aria-label="글 쓰는 방식 요약"
              rows={2}
              maxLength={200}
              value={voiceSummary}
              onChange={(e) => setVoiceSummary(e.target.value)}
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="profile-import-style-guide">
              글 구조·말투 지시문
            </label>
            <textarea
              id="profile-import-style-guide"
              className={styles.textarea}
              aria-label="글 구조·말투 지시문"
              rows={6}
              maxLength={1200}
              value={styleGuide}
              onChange={(e) => setStyleGuide(e.target.value)}
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="profile-import-keywords">
              자주 쓰는 키워드
            </label>
            <input
              id="profile-import-keywords"
              className={styles.input}
              type="text"
              aria-label="자주 쓰는 키워드"
              placeholder="키워드1, 키워드2"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="profile-import-prohibited-terms">
              쓰지 않을 표현
            </label>
            <input
              id="profile-import-prohibited-terms"
              className={styles.input}
              type="text"
              aria-label="쓰지 않을 표현"
              placeholder="표현1, 표현2"
              value={prohibitedTerms}
              onChange={(e) => setProhibitedTerms(e.target.value)}
            />
          </div>

          {textResult.sample && (
            <div className={styles.sampleBox}>
              <span className={styles.sampleTitle}>이 업무 지침으로 써 본 예시 글</span>
              <pre className={styles.sampleContent}>{textResult.sample}</pre>
            </div>
          )}

          <div>
            <button
              className={styles.secondary}
              type="button"
              onClick={handleApplyText}
              disabled={applyBusy}
            >
              {applyBusy ? '적용 중…' : '글 쓰는 방식 적용'}
            </button>
          </div>

          {applySuccess && (
            <div className={styles.successStatus} role="status">
              적용했어요. 다음 글부터 이 방식으로 써요.
            </div>
          )}

          {applyError && (
            <div className={styles.errorAlert} role="alert">
              {applyError}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
