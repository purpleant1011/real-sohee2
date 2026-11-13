import { describe, expect, it } from 'vitest'
import {
  APPROVAL_BADGE_LABEL,
  CHANNEL_FRAME_SPEC,
  CHANNEL_NAME,
  COPY_SPEC,
  FRAME_EVIDENCE_NOTE,
  MANUAL_FALLBACK_ACTIONS,
  PREVIEW_ACTION_LABEL,
  PREVIEW_BADGE_LABEL,
  PREVIEW_BLOCKER_COPY,
  PREVIEW_CHANNELS,
  SAVE_LABEL,
  acceptAiSuggestion,
  applyAiSuggestion,
  approvalBadge,
  beginSave,
  canRenderPreview,
  canReview,
  channelBadge,
  channelFrame,
  connectionBadge,
  copyLengthVerdict,
  customerLink,
  dismissAiSuggestion,
  editChannelCopy,
  findChannelPreview,
  hasUnsavedChanges,
  needsLeaveConfirmation,
  previewActions,
  previewBlockers,
  previewFingerprint,
  previewFrame,
  publishableChannels,
  saveFailed,
  saveSucceeded,
  seedPreviewSet,
  selectChannel,
  toChannelCapability,
  type ChannelCapability,
  type PreviewAsset,
  type PreviewSetState,
} from './preview-set'

const PHOTO: PreviewAsset = {
  assetId: 'asset_01HX',
  imageUrl: 'https://cdn.example.test/store/photo-1.jpg',
  width: 1200,
  height: 1600,
  rights: 'CONFIRMED',
}

function seeded(): PreviewSetState {
  return seedPreviewSet({
    channels: [
      { channel: 'instagram', copy: { text: '인스타 원고', cta: 'DM 주세요' } },
      { channel: 'threads', copy: { text: '스레드 원고', cta: '프로필 링크' } },
    ],
  })
}

describe('M06 — 실제 사진이 있어야만 미리보기를 만든다', () => {
  it('asset id·이미지 주소·크기·사용 권리가 모두 확인돼야 그린다', () => {
    expect(previewBlockers(PHOTO)).toEqual([])
    expect(canRenderPreview(PHOTO)).toBe(true)
  })

  it('사진이 없으면 미리보기를 만들지 않는다', () => {
    expect(previewBlockers(null)).toEqual(['NO_ASSET'])
    expect(canRenderPreview(null)).toBe(false)
    expect(previewFrame(null as unknown as PreviewAsset)).toBeNull()
  })

  it('asset id 가 비면 실제 사진으로 보지 않는다', () => {
    expect(previewBlockers({ ...PHOTO, assetId: '  ' })).toEqual(['MISSING_ASSET_ID'])
  })

  it('http(s) 가 아닌 주소로 이미지를 만들지 않는다', () => {
    expect(previewBlockers({ ...PHOTO, imageUrl: 'blob:local-preview' })).toEqual(['INVALID_IMAGE_URL'])
    expect(previewBlockers({ ...PHOTO, imageUrl: '' })).toEqual(['INVALID_IMAGE_URL'])
    expect(previewBlockers({ ...PHOTO, imageUrl: 'javascript:alert(1)' })).toEqual(['INVALID_IMAGE_URL'])
  })

  it('크기를 모르면 원본 비율을 지어내지 않는다', () => {
    expect(previewBlockers({ ...PHOTO, width: 0 })).toEqual(['INVALID_DIMENSIONS'])
    expect(previewBlockers({ ...PHOTO, height: Number.NaN })).toEqual(['INVALID_DIMENSIONS'])
  })

  it('사용 권리가 확인되지 않은 사진은 막는다', () => {
    expect(previewBlockers({ ...PHOTO, rights: 'UNCONFIRMED' })).toEqual(['RIGHTS_UNCONFIRMED'])
  })

  it('여러 사유가 동시에 막을 수 있다', () => {
    expect(
      previewBlockers({ assetId: '', imageUrl: 'not-a-url', width: -1, height: 0, rights: 'UNCONFIRMED' }),
    ).toEqual(['MISSING_ASSET_ID', 'INVALID_IMAGE_URL', 'INVALID_DIMENSIONS', 'RIGHTS_UNCONFIRMED'])
  })

  it('원본 비율을 유지하고 잘라내지 않는다', () => {
    const frame = previewFrame(PHOTO)
    expect(frame).toEqual({ aspectRatio: 1200 / 1600, fit: 'CONTAIN' })
    expect(previewFrame({ ...PHOTO, width: 900, height: 900 })?.aspectRatio).toBe(1)
  })

  it('막는 사유마다 사용자용 한국어 문구가 있다', () => {
    for (const blocker of Object.keys(PREVIEW_BLOCKER_COPY) as Array<keyof typeof PREVIEW_BLOCKER_COPY>) {
      const copy = PREVIEW_BLOCKER_COPY[blocker]
      expect(copy.label.length).toBeGreaterThan(0)
      expect(copy.detail.length).toBeGreaterThan(0)
      expect(copy.label).not.toMatch(/[A-Z_]{3,}/)
    }
  })
})

describe('M06 — 채널별 세로형 틀 (ANI-1678)', () => {
  it('채널마다 세로형 틀이 있고, 확인 전 규격임을 숨기지 않는다', () => {
    for (const channel of PREVIEW_CHANNELS) {
      const spec = CHANNEL_FRAME_SPEC[channel]
      expect(spec.aspectRatio).toBeLessThan(1)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.evidence).toBe('UNVERIFIED')
      expect(FRAME_EVIDENCE_NOTE[spec.evidence]).toBeTruthy()
    }
  })

  it('틀과 사진 비율을 따로 둔다 — 세로형으로 보이려고 사진을 자르지 않는다', () => {
    const frame = channelFrame({ ...PHOTO, width: 1600, height: 1200 }, 'instagram')
    expect(frame?.frameAspectRatio).toBe(4 / 5)
    expect(frame?.photoAspectRatio).toBe(1600 / 1200)
    expect(frame?.fit).toBe('CONTAIN')
  })

  it('사진을 그릴 수 없으면 빈 틀도 만들지 않는다', () => {
    expect(channelFrame(null, 'instagram')).toBeNull()
    expect(channelFrame({ ...PHOTO, rights: 'UNCONFIRMED' }, 'threads')).toBeNull()
  })

  it('채널을 바꾸면 그 채널의 틀을 쓴다', () => {
    expect(channelFrame(PHOTO, 'instagram')?.spec).toBe(CHANNEL_FRAME_SPEC.instagram)
    expect(channelFrame(PHOTO, 'threads')?.spec).toBe(CHANNEL_FRAME_SPEC.threads)
  })
})

describe('채널 원고 규격 — 확인되지 않은 길이는 저장을 막지 않는다', () => {
  it('규격은 근거 라벨을 함께 갖는다', () => {
    for (const channel of PREVIEW_CHANNELS) {
      expect(COPY_SPEC[channel].maxLength).toBeGreaterThan(0)
      expect(COPY_SPEC[channel].evidence).toBe('UNVERIFIED')
    }
  })

  it('길이 초과는 표시 판정일 뿐이다', () => {
    const long = 'ㄱ'.repeat(COPY_SPEC.threads.maxLength + 1)
    expect(copyLengthVerdict('threads', long)).toEqual({
      kind: 'OVER_LIMIT',
      length: long.length,
      maxLength: COPY_SPEC.threads.maxLength,
      evidence: 'UNVERIFIED',
    })
  })

  it('경계값까지는 정상으로 본다', () => {
    const text = 'ㄱ'.repeat(COPY_SPEC.instagram.maxLength)
    expect(copyLengthVerdict('instagram', text)).toEqual({ kind: 'OK', length: text.length })
  })

  it('길이 초과 원고도 편집·저장이 거부되지 않는다', () => {
    const long = 'ㄱ'.repeat(COPY_SPEC.threads.maxLength + 10)
    const result = editChannelCopy(seeded(), 'threads', { text: long })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.channels.threads?.copy.text).toBe(long)
    expect(result.state.save).toBe('DIRTY')
  })
})

describe('seedPreviewSet — 서버가 준 초안에서 시작한다', () => {
  it('첫 채널을 선택하고 저장된 상태로 연다', () => {
    const state = seeded()
    expect(state.selected).toBe('instagram')
    expect(state.save).toBe('SAVED')
    expect(state.revision).toBe(0)
    expect(state.channels.threads?.copy).toEqual({ text: '스레드 원고', cta: '프로필 링크' })
  })

  it('요청한 채널이 있으면 그 채널을 연다', () => {
    const state = seedPreviewSet({
      channels: [{ channel: 'threads', copy: { text: '스레드', cta: 'CTA' } }],
      selected: 'threads',
    })
    expect(state.selected).toBe('threads')
  })

  it('없는 채널을 선택하면 실제 있는 채널로 되돌린다', () => {
    const state = seedPreviewSet({
      channels: [{ channel: 'threads', copy: { text: '스레드', cta: 'CTA' } }],
      selected: 'instagram',
    })
    expect(state.selected).toBe('threads')
  })

  it('생성 중 채널은 초안으로 취급하지 않는다', () => {
    const state = seedPreviewSet({
      channels: [{ channel: 'instagram', copy: { text: '아직', cta: '없음' }, status: 'GENERATING' }],
    })
    expect(channelBadge(findChannelPreview(state, 'instagram')!)).toBe('GENERATING')
    expect(publishableChannels(state)).toEqual([])
    expect(canReview(state)).toBe(false)
  })
})

describe('채널 탭 이동은 편집을 잃지 않는다', () => {
  it('다른 탭으로 갔다 와도 고친 원문이 남아 있다', () => {
    const edited = editChannelCopy(seeded(), 'instagram', { text: '고친 인스타 원고' })
    if (!edited.ok) throw new Error('편집이 성공해야 한다')
    const moved = selectChannel(edited.state, 'threads')
    expect(moved.selected).toBe('threads')
    expect(moved.channels.instagram?.copy.text).toBe('고친 인스타 원고')
    const back = selectChannel(moved, 'instagram')
    expect(back.channels.instagram?.copy.text).toBe('고친 인스타 원고')
  })

  it('탭 이동만으로는 저장 상태·revision 이 바뀌지 않는다', () => {
    const state = seeded()
    const moved = selectChannel(state, 'threads')
    expect(moved.save).toBe('SAVED')
    expect(moved.revision).toBe(0)
    expect(needsLeaveConfirmation(moved, 'SWITCH_CHANNEL')).toBe(false)
  })

  it('없는 채널로는 이동하지 않는다', () => {
    const state = seedPreviewSet({ channels: [{ channel: 'instagram', copy: { text: '원고', cta: 'CTA' } }] })
    expect(selectChannel(state, 'threads')).toBe(state)
  })
})

describe('편집 — 화면 원문 그대로 보존한다', () => {
  it('앞뒤 공백·줄바꿈을 정규화하지 않는다', () => {
    const text = '  첫 줄\n\n둘째 줄  '
    const result = editChannelCopy(seeded(), 'instagram', { text })
    if (!result.ok) throw new Error('편집이 성공해야 한다')
    expect(result.state.channels.instagram?.copy.text).toBe(text)
  })

  it('빈 원고는 거부하지만 선택 CTA는 원문 그대로 비울 수 있다', () => {
    expect(editChannelCopy(seeded(), 'instagram', { text: '   ' })).toEqual({ ok: false, reason: 'EMPTY_COPY' })
    expect(editChannelCopy(seeded(), 'instagram', { cta: '' })).toMatchObject({ ok: true, state: { save: 'DIRTY', channels: { instagram: { copy: { cta: '' } } } } })
  })

  it('같은 값이면 변경 없음으로 돌려준다', () => {
    const state = seeded()
    expect(editChannelCopy(state, 'instagram', { text: '인스타 원고' })).toEqual({ ok: true, state, changed: false })
    expect(state.save).toBe('SAVED')
  })

  it('없는 채널·생성 중 채널 편집은 거부된다', () => {
    expect(editChannelCopy(seeded(), 'threads', { text: 'x' }).ok).toBe(true)
    const generating = seedPreviewSet({
      channels: [{ channel: 'instagram', copy: { text: '원고', cta: 'CTA' }, status: 'GENERATING' }],
    })
    expect(editChannelCopy(generating, 'instagram', { text: 'x' })).toEqual({ ok: false, reason: 'COPY_GENERATING' })
  })

  it('편집은 저장 대기로 표시하고 revision 을 올린다', () => {
    const first = editChannelCopy(seeded(), 'instagram', { text: '1차' })
    if (!first.ok) throw new Error('편집이 성공해야 한다')
    expect(first.state.save).toBe('DIRTY')
    expect(first.state.revision).toBe(1)
    const second = editChannelCopy(first.state, 'threads', { cta: '2차' })
    if (!second.ok) throw new Error('편집이 성공해야 한다')
    expect(second.state.revision).toBe(2)
  })

  it("'수정됨' 은 생성 원문과 지금 원문을 비교해 판정한다", () => {
    const state = seeded()
    const edited = editChannelCopy(state, 'instagram', { text: '고침' })
    if (!edited.ok) throw new Error('편집이 성공해야 한다')
    expect(channelBadge(findChannelPreview(edited.state, 'instagram')!)).toBe('EDITED')
    expect(channelBadge(findChannelPreview(edited.state, 'threads')!)).toBe('DRAFT_READY')
  })
})

describe('AI 재작성은 제안이다 — 수락 전에는 아무것도 덮지 않는다', () => {
  it('제안 도착은 원고·revision·저장 상태를 바꾸지 않는다', () => {
    const state = seeded()
    const applied = applyAiSuggestion(state, 'instagram', 'AI 가 다듬은 문장')
    if (!applied.ok) throw new Error('제안이 만들어져야 한다')
    expect(applied.changed).toBe(false)
    expect(applied.state.channels.instagram?.copy).toEqual({ text: '인스타 원고', cta: 'DM 주세요' })
    expect(applied.state.channels.instagram?.aiSuggestion).toBe('AI 가 다듬은 문장')
    expect(applied.state.revision).toBe(0)
    expect(applied.state.save).toBe('SAVED')
  })

  it('제안 도착만으로는 승인 지문이 바뀌지 않는다', () => {
    const state = seeded()
    const before = previewFingerprint(state)
    const applied = applyAiSuggestion(state, 'threads', 'AI 제안')
    if (!applied.ok) throw new Error('제안이 만들어져야 한다')
    expect(previewFingerprint(applied.state)).toBe(before)
  })

  it('빈 제안은 저장하지 않는다', () => {
    expect(applyAiSuggestion(seeded(), 'instagram', '   ')).toEqual({ ok: false, reason: 'EMPTY_SUGGESTION' })
  })

  it('수락할 때만 원고가 바뀌고 승인 지문이 새로 계산된다', () => {
    const state = seeded()
    const before = previewFingerprint(state)
    const applied = applyAiSuggestion(state, 'instagram', 'AI 가 다듬은 문장')
    if (!applied.ok) throw new Error('제안이 만들어져야 한다')
    const accepted = acceptAiSuggestion(applied.state, 'instagram')
    if (!accepted.ok) throw new Error('수락이 성공해야 한다')
    expect(accepted.changed).toBe(true)
    expect(accepted.state.channels.instagram?.copy.text).toBe('AI 가 다듬은 문장')
    expect(accepted.state.channels.instagram?.aiSuggestion).toBeNull()
    expect(previewFingerprint(accepted.state)).not.toBe(before)
    expect(accepted.state.save).toBe('DIRTY')
  })

  it('제안을 버리면 원고와 지문이 그대로다', () => {
    const state = seeded()
    const applied = applyAiSuggestion(state, 'instagram', '버릴 제안')
    if (!applied.ok) throw new Error('제안이 만들어져야 한다')
    const dismissed = dismissAiSuggestion(applied.state, 'instagram')
    if (!dismissed.ok) throw new Error('버리기가 성공해야 한다')
    expect(dismissed.state.channels.instagram?.copy.text).toBe('인스타 원고')
    expect(previewFingerprint(dismissed.state)).toBe(previewFingerprint(state))
    expect(dismissed.state.save).toBe('SAVED')
  })

  it('제안이 없으면 수락·버리기는 거부된다', () => {
    expect(acceptAiSuggestion(seeded(), 'instagram')).toEqual({ ok: false, reason: 'NO_SUGGESTION' })
    expect(dismissAiSuggestion(seeded(), 'instagram')).toEqual({ ok: false, reason: 'NO_SUGGESTION' })
  })
})

describe('승인 지문 — 화면에서 본 원문 그대로', () => {
  it('채널 순서를 고정해 만든다', () => {
    const state = seeded()
    expect(previewFingerprint(state)).toBe(
      JSON.stringify([
        ['instagram', '인스타 원고', 'DM 주세요'],
        ['threads', '스레드 원고', '프로필 링크'],
      ]),
    )
    expect(previewFingerprint(state, ['threads', 'instagram'])).toBe(previewFingerprint(state))
  })

  it('공백·줄바꿈을 정규화하지 않으므로 지문이 실제 원문과 대응한다', () => {
    const base = seeded()
    const padded = editChannelCopy(base, 'instagram', { text: '인스타 원고 ' })
    if (!padded.ok) throw new Error('편집이 성공해야 한다')
    expect(previewFingerprint(padded.state)).not.toBe(previewFingerprint(base))
    expect(JSON.parse(previewFingerprint(padded.state))[0][1]).toBe('인스타 원고 ')
  })

  it('생성 중·빈 원고 채널은 승인 대상에서 빠진다', () => {
    const state = seedPreviewSet({
      channels: [
        { channel: 'instagram', copy: { text: '원고', cta: 'CTA' } },
        { channel: 'threads', copy: { text: '   ', cta: 'CTA' } },
      ],
    })
    expect(publishableChannels(state)).toEqual(['instagram'])
    expect(canReview(state)).toBe(true)
  })

  it('승인 전·현재·오래됨을 구분한다', () => {
    const state = seeded()
    const fingerprint = previewFingerprint(state)
    expect(approvalBadge(null, fingerprint)).toBe('BEFORE_APPROVAL')
    expect(approvalBadge(fingerprint, fingerprint)).toBe('CURRENT')
    expect(approvalBadge(fingerprint, `${fingerprint} `)).toBe('STALE')
  })

  it('승인 후 원고를 고치면 다시 승인 전 상태가 아니라 오래됨이 된다', () => {
    const state = seeded()
    const approved = previewFingerprint(state)
    const edited = editChannelCopy(state, 'threads', { cta: '새 CTA' })
    if (!edited.ok) throw new Error('편집이 성공해야 한다')
    expect(approvalBadge(approved, previewFingerprint(edited.state))).toBe('STALE')
  })

  it('AI 제안 도착은 승인 상태를 오래됨으로 만들지 않는다', () => {
    const state = seeded()
    const approved = previewFingerprint(state)
    const applied = applyAiSuggestion(state, 'threads', '제안')
    if (!applied.ok) throw new Error('제안이 만들어져야 한다')
    expect(approvalBadge(approved, previewFingerprint(applied.state))).toBe('CURRENT')
  })
})

describe('저장 상태 — 서버 확인과 현재 revision 이 맞아야 저장됨', () => {
  it('저장할 것이 없으면 저장을 시작하지 않는다', () => {
    const saved = seeded()
    expect(beginSave(saved)).toBe(saved)
  })

  it('저장 중에는 다시 시작하지 않는다', () => {
    const edited = editChannelCopy(seeded(), 'instagram', { text: '고침' })
    if (!edited.ok) throw new Error('편집이 성공해야 한다')
    const saving = beginSave(edited.state)
    expect(saving.save).toBe('SAVING')
    expect(beginSave(saving)).toBe(saving)
  })

  it('현재 revision 응답일 때만 저장됨으로 올린다', () => {
    const edited = editChannelCopy(seeded(), 'instagram', { text: '고침' })
    if (!edited.ok) throw new Error('편집이 성공해야 한다')
    const saving = beginSave(edited.state)
    expect(saveSucceeded(saving, 0).save).toBe('DIRTY')
    expect(saveSucceeded(saving, 1).save).toBe('SAVED')
  })

  it('저장 중이 아니면 응답을 반영하지 않는다', () => {
    const state = seeded()
    expect(saveSucceeded(state, state.revision)).toBe(state)
    expect(saveFailed(state)).toBe(state)
  })

  it('저장 실패는 사용자에게 실패로 남고 저장 해제로 보지 않는다', () => {
    const edited = editChannelCopy(seeded(), 'instagram', { text: '고침' })
    if (!edited.ok) throw new Error('편집이 성공해야 한다')
    const saving = beginSave(edited.state)
    const failed = saveFailed(saving)
    expect(failed.save).toBe('FAILED')
    expect(hasUnsavedChanges(failed)).toBe(true)
    expect(beginSave(failed).save).toBe('SAVING')
  })

  it('저장 안 된 변경이 있을 때만 이탈 확인을 요구한다', () => {
    const dirty = editChannelCopy(seeded(), 'instagram', { text: '고침' })
    if (!dirty.ok) throw new Error('편집이 성공해야 한다')
    expect(needsLeaveConfirmation(dirty.state, 'CUT')).toBe(true)
    expect(needsLeaveConfirmation(dirty.state, 'REPLACE_PHOTO')).toBe(true)
    expect(needsLeaveConfirmation(dirty.state, 'BACK')).toBe(true)
    expect(needsLeaveConfirmation(dirty.state, 'SWITCH_CHANNEL')).toBe(false)
    expect(needsLeaveConfirmation(seeded(), 'BACK')).toBe(false)
  })

  it('사용자 화면 저장 표기에 영문 코드가 없다', () => {
    for (const label of Object.values(SAVE_LABEL)) expect(label).not.toMatch(/[A-Z_]{3,}/)
    expect(SAVE_LABEL.SAVED).toBe('저장됨')
  })
})

describe('채널 권한 — 연결과 게시 권한을 따로 확인한다', () => {
  it('연결만으로 게시 권한을 추정하지 않는다', () => {
    expect(toChannelCapability({ channel: 'instagram', connection: 'CONNECTED', publishPermission: 'UNKNOWN' }).canPublish).toBe(false)
    expect(toChannelCapability({ channel: 'instagram', connection: 'CONNECTED', publishPermission: 'DENIED' }).canPublish).toBe(false)
  })

  it('게시 권한만 있어도 연결이 확인되지 않았으면 게시 불가다', () => {
    expect(toChannelCapability({ channel: 'threads', connection: 'NOT_CONNECTED', publishPermission: 'GRANTED' }).canPublish).toBe(false)
    expect(toChannelCapability({ channel: 'threads', connection: 'UNKNOWN', publishPermission: 'GRANTED' }).canPublish).toBe(false)
  })

  it('연결·권한이 모두 확인된 경우에만 게시 가능하다', () => {
    expect(toChannelCapability({ channel: 'threads', connection: 'CONNECTED', publishPermission: 'GRANTED' }).canPublish).toBe(true)
  })

  it('초록 체크는 연결·권한이 모두 확인된 경우에만 그린다', () => {
    const verified = toChannelCapability({ channel: 'instagram', connection: 'CONNECTED', publishPermission: 'GRANTED' })
    expect(connectionBadge(verified)).toEqual({ label: '인스타그램 연결됨', verified: true })

    const connectedOnly = toChannelCapability({ channel: 'instagram', connection: 'CONNECTED', publishPermission: 'DENIED' })
    expect(connectionBadge(connectedOnly).verified).toBe(false)

    const unknown = toChannelCapability({ channel: 'threads', connection: 'UNKNOWN', publishPermission: 'UNKNOWN' })
    expect(connectionBadge(unknown).verified).toBe(false)
    expect(connectionBadge(unknown).label).toBe('스레드 연결 상태 확인 중')

    const disconnected = toChannelCapability({ channel: 'threads', connection: 'NOT_CONNECTED', publishPermission: 'GRANTED' })
    expect(connectionBadge(disconnected)).toEqual({ label: '스레드 연결 필요', verified: false })
  })
})

describe('행동 — 게시 권한이 없으면 게시하기를 노출하지 않는다', () => {
  const noPermission: ChannelCapability[] = PREVIEW_CHANNELS.map((channel) => ({
    channel,
    connection: 'CONNECTED',
    canPublish: false,
  }))

  it('게시 가능한 채널이 하나도 없으면 저장·복사·다운로드와 연결 제안을 남긴다', () => {
    const result = previewActions(noPermission)
    expect(result.actions).not.toContain('PUBLISH')
    expect(result.publishEnabled).toBe(false)
    expect(result.manualFallback).toEqual(MANUAL_FALLBACK_ACTIONS)
    expect(result.actions).toEqual(['EDIT_COPY', 'REVIEW', ...MANUAL_FALLBACK_ACTIONS, 'CONNECT_CHANNEL'])
    expect(result.connectProposal).toEqual(['instagram', 'threads'])
  })

  it('게시 가능한 채널이 하나라도 있으면 게시하기를 노출한다', () => {
    const result = previewActions([
      { channel: 'instagram', connection: 'CONNECTED', canPublish: true },
      { channel: 'threads', connection: 'NOT_CONNECTED', canPublish: false },
    ])
    expect(result.publishEnabled).toBe(true)
    expect(result.actions).toContain('PUBLISH')
    expect(result.manualFallback).toEqual([])
    expect(result.connectProposal).toEqual(['threads'])
  })

  it('권한 정보가 아예 없으면 게시하기를 노출하지 않는다', () => {
    const result = previewActions([])
    expect(result.publishEnabled).toBe(false)
    expect(result.actions).not.toContain('PUBLISH')
    expect(result.actions).not.toContain('CONNECT_CHANNEL')
    expect(result.actions).toEqual(['EDIT_COPY', 'REVIEW', ...MANUAL_FALLBACK_ACTIONS])
  })

  it('모든 행동에 사용자용 한국어 표기가 있다', () => {
    for (const label of Object.values(PREVIEW_ACTION_LABEL)) expect(label).not.toMatch(/[A-Z_]{3,}/)
  })
})

describe('고객 링크 — 없으면 주소를 지어내지 않는다', () => {
  it('http(s) 링크만 확인하기로 연다', () => {
    expect(customerLink('https://instagram.com/p/abc')).toEqual({ label: '확인하기', href: 'https://instagram.com/p/abc' })
    expect(customerLink('http://example.test/post')).toEqual({ label: '확인하기', href: 'http://example.test/post' })
  })

  it('없거나 확인할 수 없는 링크는 준비 중으로 두고 href 를 만들지 않는다', () => {
    for (const raw of [null, undefined, '', 'not-a-url', 'ftp://example.test/a', 'javascript:alert(1)']) {
      expect(customerLink(raw)).toEqual({ label: '링크 준비 중', href: null })
    }
  })
})

describe('생성됨 ≠ 게시됨 — 이 화면의 배지는 게시 상태를 만들지 않는다', () => {
  it('미리보기 배지는 생성·초안·수정 세 가지뿐이다', () => {
    expect(Object.keys(PREVIEW_BADGE_LABEL)).toEqual(['GENERATING', 'DRAFT_READY', 'EDITED'])
  })

  it('게시 확인·게시됨 표기가 섞이지 않는다', () => {
    const labels = Object.values(PREVIEW_BADGE_LABEL)
    for (const label of labels) {
      expect(label).not.toContain('게시')
      expect(label).not.toMatch(/[A-Z_]{3,}/)
    }
    expect(labels).not.toContain('게시 확인')
  })

  it('승인 표기는 승인 전·현재·오래됨뿐이고 게시 상태가 아니다', () => {
    expect(Object.keys(APPROVAL_BADGE_LABEL)).toEqual(['BEFORE_APPROVAL', 'CURRENT', 'STALE'])
    for (const label of Object.values(APPROVAL_BADGE_LABEL)) expect(label).not.toContain('게시')
  })

  it('채널 이름은 사용자용 한국어다', () => {
    expect(CHANNEL_NAME).toEqual({ instagram: '인스타그램', threads: '스레드' })
  })
})
