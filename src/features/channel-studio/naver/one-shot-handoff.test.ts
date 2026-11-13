import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGalleryPlainText,
  clearPreparedAssetsCache,
  copyPreparedPost,
  downloadPreparedPhotosFallbackNames,
  evictPreparedAsset,
  getOrStartPreparedAssets,
  listPostPhotos,
  prepareOneShotAssets,
  sharePreparedPhotos,
  type OneShotAssets,
} from './one-shot-handoff'
import type { NaverPostForCopy } from './copy-naver-post'

describe('one-shot-handoff (네이버 원샷 핸드오프)', () => {
  const mediaId1 = '11111111-0000-4000-8000-000000000001'
  const mediaId2 = '22222222-0000-4000-8000-000000000002'
  const mediaId3 = '33333333-0000-4000-8000-000000000003'
  const src1 = `/api/workspaces/00000000-0000-4000-8000-000000000000/media/${mediaId1}`
  const src2 = `/api/workspaces/00000000-0000-4000-8000-000000000000/media/${mediaId2}`
  const src3 = `/api/workspaces/00000000-0000-4000-8000-000000000000/media/${mediaId3}`

  const basePost: NaverPostForCopy = {
    title: '강남역 맛집 탐방기',
    introduction: '소개글',
    sections: [],
    keywords: ['강남역맛집', '점심추천'],
    media: [
      { id: mediaId1, src: src1 },
      { id: mediaId2, src: src2 },
      { id: mediaId3, src: src3 },
    ],
    editorBlocks: [
      { kind: 'heading', text: '1. 입구 및 분위기' },
      { kind: 'image', mediaId: mediaId1, altText: '매장 입구: 간판/외관' },
      { kind: 'paragraph', text: '매장 입구부터 분위기가 아늑했습니다.' },
      { kind: 'image', mediaId: mediaId2, altText: '대표 메뉴 한상차림 맛있는 구성' },
      { kind: 'paragraph', text: '음식이 정갈하게 나왔어요.' },
    ],
  }

  describe('listPostPhotos', () => {
    it('editorBlocks의 image 순서대로 추출하고 photo-01.jpg 형식의 영문/숫자 파일명을 부여한다', () => {
      const photos = listPostPhotos(basePost)
      expect(photos).toHaveLength(2)
      expect(photos[0]).toEqual({
        id: mediaId1,
        src: src1,
        name: 'photo-01.jpg',
      })
      expect(photos[1]).toEqual({
        id: mediaId2,
        src: src2,
        name: 'photo-02.jpg',
      })
    })

    it('동일한 mediaId가 여러 번 나오면 중복을 제거한다', () => {
      const duplicatePost: NaverPostForCopy = {
        ...basePost,
        editorBlocks: [
          { kind: 'image', mediaId: mediaId1, altText: '첫번째' },
          { kind: 'paragraph', text: '중간 글' },
          { kind: 'image', mediaId: mediaId2, altText: '두번째' },
          { kind: 'image', mediaId: mediaId1, altText: '첫번째 중복' },
        ],
      }
      const photos = listPostPhotos(duplicatePost)
      expect(photos).toHaveLength(2)
      expect(photos.map((p) => p.id)).toEqual([mediaId1, mediaId2])
      expect(photos[0].name).toBe('photo-01.jpg')
      expect(photos[1].name).toBe('photo-02.jpg')
    })

    it('altText slug 없이 photo-NN.jpg 두 자리 번호 파일명 규칙을 적용한다', () => {
      const postWithSpecialNames: NaverPostForCopy = {
        ...basePost,
        editorBlocks: [
          { kind: 'image', mediaId: mediaId1, altText: '가나다라마바사아자차카타파하일이삼사오육칠팔' },
          { kind: 'image', mediaId: mediaId2, altText: '  특수문자 *?/:|"<> 제거!  ' },
          { kind: 'image', mediaId: mediaId3, altText: '   ' },
        ],
      }
      const photos = listPostPhotos(postWithSpecialNames)
      expect(photos[0].name).toBe('photo-01.jpg')
      expect(photos[1].name).toBe('photo-02.jpg')
      expect(photos[2].name).toBe('photo-03.jpg')
    })
  })

  describe('buildGalleryPlainText', () => {
    it('줄1=제목, 빈 줄, 도입 문단, 빈 줄(=사진자리), 설명 목록(1., 2.), 빈 줄, 태그 순으로 구성한다', () => {
      const text = buildGalleryPlainText(basePost)

      const lines = text.split('\n')
      expect(lines[0]).toBe('강남역 맛집 탐방기')
      expect(lines[1]).toBe('')
      expect(lines[2]).toBe('1. 입구 및 분위기')
      expect(lines[3]).toBe('')
      expect(lines[4]).toBe('1. 매장 입구부터 분위기가 아늑했습니다.')
      expect(lines[5]).toBe('')
      expect(lines[6]).toBe('2. 음식이 정갈하게 나왔어요.')
      expect(lines[7]).toBe('')
      expect(lines[8]).toBe('#강남역맛집 #점심추천')

      // 잔여 마커나 [사진] 문구 금지
      expect(text).not.toContain('[사진')
      expect(text).not.toContain('사진]')
    })

    it('사진이 없는 글에서는 사진 자리 빈 줄을 생략하고 설명 목록 번호도 붙이지 않는다', () => {
      const textOnlyPost: NaverPostForCopy = {
        title: '글 전용 포스팅',
        introduction: '',
        sections: [],
        keywords: ['정보', '리뷰'],
        editorBlocks: [
          { kind: 'heading', text: '소제목 안내' },
          { kind: 'paragraph', text: '첫 번째 본문 문단입니다.' },
          { kind: 'paragraph', text: '두 번째 본문 문단입니다.' },
        ],
      }

      const text = buildGalleryPlainText(textOnlyPost)
      expect(text).toBe([
        '글 전용 포스팅',
        '',
        '소제목 안내',
        '',
        '첫 번째 본문 문단입니다.',
        '',
        '두 번째 본문 문단입니다.',
        '',
        '#정보 #리뷰',
      ].join('\n'))
    })

    it('사진 8장 이상일 때 문단 앞에 1. 2. 번호 목록을 붙인다', () => {
      const mediaList = Array.from({ length: 8 }, (_, i) => ({
        id: `media-${i + 1}`,
        src: `/api/workspaces/00000000-0000-4000-8000-000000000000/media/media-${i + 1}`,
      }))
      const blocks: Array<NonNullable<NaverPostForCopy['editorBlocks']>[number]> = [
        { kind: 'paragraph', text: '도입 설명글입니다.' },
      ]
      for (let i = 0; i < 8; i++) {
        blocks.push({ kind: 'image', mediaId: `media-${i + 1}`, altText: `사진 ${i + 1}` })
        blocks.push({ kind: 'paragraph', text: `사진 ${i + 1}번에 대한 설명 내용입니다.` })
      }
      const postWith8Photos: NaverPostForCopy = {
        title: '8장 대용량 갤러리 글',
        introduction: '',
        sections: [],
        media: mediaList,
        editorBlocks: blocks,
        cta: '방문해 보세요',
      }

      const text = buildGalleryPlainText(postWith8Photos)
      expect(text).toContain('도입 설명글입니다.')
      expect(text).toContain('1. 사진 1번에 대한 설명 내용입니다.')
      expect(text).toContain('8. 사진 8번에 대한 설명 내용입니다.')
      expect(text).toContain('방문해 보세요')
    })

    it('traditional 형식(sections)에서도 소제목은 한 줄로 유지하고 [대괄호]를 넣지 않는다', () => {
      const traditionalPost: NaverPostForCopy = {
        title: '인천 피부관리 후기',
        introduction: '오늘 소개할 곳은 인천 피부관리샵입니다.',
        sections: [
          { heading: '1. 관리 순서', body: '첫 번째로 클렌징을 진행했습니다.' },
          { heading: '2. 전후 비교', body: '수분감이 많이 개선되었습니다.' },
        ],
        keywords: ['인천피부관리', '청라피부관리'],
        disclosure: '소정의 원고료를 지원받았습니다.',
        media: [
          { id: mediaId1, src: src1 },
          { id: mediaId2, src: src2 },
        ],
      }

      const text = buildGalleryPlainText(traditionalPost)
      expect(text).not.toContain('[1. 관리 순서]')
      expect(text).toContain('1. 관리 순서')
      expect(text).toContain('첫 번째로 클렌징을 진행했습니다.')
      expect(text).toContain('소정의 원고료를 지원받았습니다.')
      expect(text).toContain('#인천피부관리 #청라피부관리')
    })
  })

  describe('prepareOneShotAssets', () => {
    it('photo-01.jpg 파일 목록을 준비하고 skippedPhotos는 0이다', async () => {
      const fakeFetch = vi.fn(async () => {
        return new Response(new Blob(['fake-jpg-binary'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      const assets = await prepareOneShotAssets(basePost, { fetcher: fakeFetch as typeof fetch })
      expect(assets.photoCount).toBe(2)
      expect(assets.files).toHaveLength(2)
      expect(assets.files[0].name).toBe('photo-01.jpg')
      expect(assets.files[1].name).toBe('photo-02.jpg')
      expect(assets.skippedPhotos).toBe(0)
    })

    it('동시 실행 수가 최대 5를 넘지 않고 병렬로 실행된다', async () => {
      const photoCount = 12
      const mediaList = Array.from({ length: photoCount }, (_, i) => {
        const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        return {
          id,
          src: `/api/workspaces/00000000-0000-4000-8000-000000000000/media/${id}`,
        }
      })
      const postWith12Photos: NaverPostForCopy = {
        title: '동시성 테스트',
        introduction: '',
        sections: [],
        media: mediaList,
      }

      let activeFetches = 0
      let maxActiveFetches = 0

      const fakeFetch = vi.fn(async () => {
        activeFetches++
        if (activeFetches > maxActiveFetches) {
          maxActiveFetches = activeFetches
        }
        await new Promise((r) => setTimeout(r, 20))
        activeFetches--
        return new Response(new Blob(['jpg-data'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      const assets = await prepareOneShotAssets(postWith12Photos, { fetcher: fakeFetch as typeof fetch })
      expect(maxActiveFetches).toBe(5)
      expect(assets.photoCount).toBe(12)
      expect(assets.files).toHaveLength(12)
    })

    it('각 사진의 응답 지연이 무작위여도 최종 결과 순서(photo-01..)가 완벽히 보존된다', async () => {
      const photoCount = 8
      const mediaList = Array.from({ length: photoCount }, (_, i) => {
        const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        return {
          id,
          src: `/api/workspaces/00000000-0000-4000-8000-000000000000/media/${id}`,
        }
      })
      const postWithPhotos: NaverPostForCopy = {
        title: '순서 테스트',
        introduction: '',
        sections: [],
        media: mediaList,
      }

      // 역순으로 완료되도록 지연 시간 부여
      const fakeFetch = vi.fn(async (url: string) => {
        const index = mediaList.findIndex((m) => url.includes(m.id))
        const delay = (photoCount - index) * 10
        await new Promise((r) => setTimeout(r, delay))
        return new Response(new Blob([`data-${index}`], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      const assets = await prepareOneShotAssets(postWithPhotos, { fetcher: fakeFetch as typeof fetch })
      expect(assets.photoCount).toBe(photoCount)
      for (let i = 0; i < photoCount; i++) {
        const expectedName = `photo-${String(i + 1).padStart(2, '0')}.jpg`
        expect(assets.files[i].name).toBe(expectedName)
      }
    })

    it('동시 5 병렬 실행 시 총 소요 시간이 순차 실행보다 현저히 짧다', async () => {
      const photoCount = 10
      const mediaList = Array.from({ length: photoCount }, (_, i) => {
        const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        return {
          id,
          src: `/api/workspaces/00000000-0000-4000-8000-000000000000/media/${id}`,
        }
      })
      const postWithPhotos: NaverPostForCopy = {
        title: '소요시간 테스트',
        introduction: '',
        sections: [],
        media: mediaList,
      }

      const delayPerPhoto = 30
      const fakeFetch = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, delayPerPhoto))
        return new Response(new Blob(['data'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      const start = Date.now()
      const assets = await prepareOneShotAssets(postWithPhotos, { fetcher: fakeFetch as typeof fetch })
      const elapsed = Date.now() - start

      expect(assets.photoCount).toBe(10)
      // 순차였다면 10 * 30ms = 300ms 이상 소요. 동시 5 병렬이면 2회 배치 = ~60-150ms
      expect(elapsed).toBeLessThan(delayPerPhoto * photoCount * 0.7)
    })

    it('외부 AbortSignal이 취소되면 처리를 중단하고 오류를 던진다', async () => {
      const abortCtrl = new AbortController()
      const fakeFetch = vi.fn(async () => {
        abortCtrl.abort()
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        throw error
      })

      await expect(
        prepareOneShotAssets(basePost, {
          signal: abortCtrl.signal,
          fetcher: fakeFetch as typeof fetch,
        })
      ).rejects.toThrow()
    })

    it('fetch 일부 실패 시 skippedPhotos를 증가시킨다', async () => {
      const fakeFetch = vi.fn(async (url: string) => {
        if (url.includes(mediaId2)) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(new Blob(['img1-data'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      const assets = await prepareOneShotAssets(basePost, { fetcher: fakeFetch as typeof fetch })
      expect(assets.skippedPhotos).toBe(1)
      expect(assets.photoCount).toBe(1)
      expect(assets.files).toHaveLength(1)
      expect(assets.files[0].name).toBe('photo-01.jpg')
    })

    it('개별 이미지 20MB 초과 또는 허용되지 않은 Content-Type은 건너뛴다', async () => {
      const fakeFetch = vi.fn(async (url: string) => {
        if (url.includes(mediaId1)) {
          // 20MB 초과
          return new Response(new Uint8Array(20 * 1024 * 1024 + 1), {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024 + 1) },
          })
        }
        // 잘못된 content-type
        return new Response('gif-data', {
          status: 200,
          headers: { 'content-type': 'image/gif' },
        })
      })

      const assets = await prepareOneShotAssets(basePost, { fetcher: fakeFetch as typeof fetch })
      expect(assets.skippedPhotos).toBe(2)
      expect(assets.files).toHaveLength(0)
      expect(assets.photoCount).toBe(0)
    })
  })

  describe('copyPreparedPost', () => {
    let originalClipboard: Clipboard | undefined

    beforeEach(() => {
      originalClipboard = navigator.clipboard
    })

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true, writable: true })
    })

    it('navigator.clipboard.writeText로 buildGalleryPlainText 결과를 복사하고 status: ok를 반환한다', async () => {
      const writeTextMock = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      })

      const dummyAssets: OneShotAssets = {
        photoCount: 2,
        files: [
          new File(['img1'], 'photo-01.jpg', { type: 'image/jpeg' }),
          new File(['img2'], 'photo-02.jpg', { type: 'image/jpeg' }),
        ],
        skippedPhotos: 0,
      }

      const outcome = await copyPreparedPost(dummyAssets, basePost)
      expect(outcome).toEqual({ status: 'ok', photos: 2 })
      expect(writeTextMock).toHaveBeenCalledTimes(1)
      const copiedText = writeTextMock.mock.calls[0][0]
      expect(copiedText).toContain('강남역 맛집 탐방기')
      expect(copiedText).toContain('1. 입구 및 분위기')
      expect(copiedText).toContain('1. 매장 입구부터 분위기가 아늑했습니다.')
    })

    it('권한 거부 시 status: denied를 반환한다', async () => {
      const writeTextMock = vi.fn(async () => {
        const error = new Error('Permission denied')
        error.name = 'NotAllowedError'
        throw error
      })
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      })

      const dummyAssets: OneShotAssets = {
        photoCount: 1,
        files: [],
        skippedPhotos: 0,
      }

      const outcome = await copyPreparedPost(dummyAssets, basePost)
      expect(outcome).toEqual({ status: 'denied', photos: 0 })
    })

    it('클립보드 API 미지원 환경에서는 status: unavailable을 반환한다', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
      })

      const dummyAssets: OneShotAssets = {
        photoCount: 1,
        files: [],
        skippedPhotos: 0,
      }

      const outcome = await copyPreparedPost(dummyAssets, basePost)
      expect(outcome).toEqual({ status: 'unavailable', photos: 0 })
    })
  })

  describe('sharePreparedPhotos', () => {
    let originalShare: ((data?: ShareData) => Promise<void>) | undefined
    let originalCanShare: ((data?: ShareData) => boolean) | undefined

    beforeEach(() => {
      originalShare = navigator.share
      originalCanShare = navigator.canShare
    })

    afterEach(() => {
      Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true, writable: true })
      Object.defineProperty(navigator, 'canShare', { value: originalCanShare, configurable: true, writable: true })
    })

    it('지원 환경에서 파일 공유 성공 시 shared를 반환한다', async () => {
      const shareMock = vi.fn(async () => undefined)
      const canShareMock = vi.fn(() => true)
      Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true, writable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareMock, configurable: true, writable: true })

      const assets: OneShotAssets = {
        photoCount: 1,
        files: [new File(['bytes'], 'photo-01.jpg', { type: 'image/jpeg' })],
        skippedPhotos: 0,
      }

      const outcome = await sharePreparedPhotos(assets)
      expect(outcome).toBe('shared')
      expect(shareMock).toHaveBeenCalledWith({ files: assets.files })
    })

    it('사용자가 공유 취소 시 cancelled를 반환한다', async () => {
      const abortError = new Error('Share canceled')
      abortError.name = 'AbortError'
      const shareMock = vi.fn(async () => {
        throw abortError
      })
      Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true, writable: true })
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true, writable: true })

      const assets: OneShotAssets = {
        photoCount: 1,
        files: [new File(['bytes'], 'photo-01.jpg', { type: 'image/jpeg' })],
        skippedPhotos: 0,
      }

      const outcome = await sharePreparedPhotos(assets)
      expect(outcome).toBe('cancelled')
    })

    it('미지원 환경이거나 canShare false 시 unsupported를 반환한다', async () => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true })

      const assets: OneShotAssets = {
        photoCount: 1,
        files: [new File(['bytes'], 'photo-01.jpg', { type: 'image/jpeg' })],
        skippedPhotos: 0,
      }

      const outcome = await sharePreparedPhotos(assets)
      expect(outcome).toBe('unsupported')
    })
  })

  describe('downloadPreparedPhotosFallbackNames', () => {
    it('assets.files의 파일명 목록을 반환한다', () => {
      const assets: OneShotAssets = {
        photoCount: 2,
        files: [
          new File(['1'], 'photo-01.jpg', { type: 'image/jpeg' }),
          new File(['2'], 'photo-02.jpg', { type: 'image/jpeg' }),
        ],
        skippedPhotos: 0,
      }
      expect(downloadPreparedPhotosFallbackNames(assets)).toEqual([
        'photo-01.jpg',
        'photo-02.jpg',
      ])
    })
  })

  describe('getOrStartPreparedAssets (모듈 단위 캐시)', () => {
    beforeEach(() => {
      clearPreparedAssetsCache()
    })

    it('동일한 key로 여러 번 호출 시 동일한 Promise를 반환하며 fetch는 1번만 실행된다', async () => {
      let fetchCount = 0
      const fakeFetch = vi.fn(async () => {
        fetchCount++
        return new Response(new Blob(['fake-jpg-binary'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      const key = 'content-1:version-1'
      const promise1 = getOrStartPreparedAssets(key, basePost, { fetcher: fakeFetch as typeof fetch })
      const promise2 = getOrStartPreparedAssets(key, basePost, { fetcher: fakeFetch as typeof fetch })

      expect(promise1).toBe(promise2)

      const [res1, res2] = await Promise.all([promise1, promise2])
      expect(res1).toBe(res2)
      expect(res1.photoCount).toBe(2)
      expect(fetchCount).toBe(2)
    })

    it('실패 시 캐시에서 제거되어 이후 다시 호출하면 재시도한다', async () => {
      const key = 'content-fail:version-1'
      let shouldReject = true
      const rejectingFetch = vi.fn(async () => {
        if (shouldReject) {
          throw new Error('Fatal network error')
        }
        return new Response(new Blob(['fake-jpg-binary'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })

      evictPreparedAsset(key)

      const dummyPost = { ...basePost }
      const abortCtrl = new AbortController()
      abortCtrl.abort()

      await expect(
        getOrStartPreparedAssets(key, dummyPost, { signal: abortCtrl.signal, fetcher: rejectingFetch as typeof fetch })
      ).rejects.toThrow()

      shouldReject = false
      const secondPromise = getOrStartPreparedAssets(key, dummyPost, { fetcher: rejectingFetch as typeof fetch })
      const res = await secondPromise
      expect(res.photoCount).toBe(2)
    })
  })
})
