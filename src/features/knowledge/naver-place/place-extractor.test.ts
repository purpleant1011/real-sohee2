import { describe, expect, it, vi } from 'vitest'
import {
  parsePlaceIdFromUrl,
  resolveNaverPlaceId,
  normalizePlaceSummaryData,
  fetchNaverPlaceSummary,
  type NaverPlaceSummary,
} from './place-extractor'

describe('naver-place place-extractor', () => {
  it('extracts place ID from various Naver Place URLs', () => {
    expect(parsePlaceIdFromUrl('2085035251')).toBe('2085035251')
    expect(parsePlaceIdFromUrl('https://map.naver.com/p/entry/place/2085035251?placePath=%2Fhome')).toBe('2085035251')
    expect(parsePlaceIdFromUrl('https://m.place.naver.com/place/2085035251/home')).toBe('2085035251')
    expect(parsePlaceIdFromUrl('https://map.naver.com/v5/entry/place/2085035251')).toBe('2085035251')
    expect(parsePlaceIdFromUrl('invalid-url')).toBeNull()
  })

  it('normalizes raw Naver Place summary API response into clean business facts', () => {
    const rawApi = {
      data: {
        placeDetail: {
          id: '2085035251',
          name: '바이름 청라점',
          category: { category: '속눈썹증모,연장' },
          address: {
            address: '인천 서해구 청라동 157-6',
            roadAddress: '인천 서해구 청라커낼로288번길 8-10 2층 208호',
          },
          businessHours: { description: '20:00에 영업 종료' },
          visitorReviews: { score: 4.98, displayText: '방문자 리뷰 87' },
          images: {
            images: [
              { origin: 'https://ldb-phinf.pstatic.net/img1.jpg' },
              { origin: 'https://ldb-phinf.pstatic.net/img2.jpg' },
            ],
          },
          labels: { talktalk: true },
        },
      },
    }

    const normalized = normalizePlaceSummaryData(rawApi)
    expect(normalized).toEqual({
      placeId: '2085035251',
      name: '바이름 청라점',
      category: '속눈썹증모,연장',
      roadAddress: '인천 서해구 청라커낼로288번길 8-10 2층 208호',
      jibunAddress: '인천 서해구 청라동 157-6',
      businessHours: '20:00에 영업 종료',
      visitorReviewScore: 4.98,
      visitorReviewCount: 87,
      images: [
        'https://ldb-phinf.pstatic.net/img1.jpg',
        'https://ldb-phinf.pstatic.net/img2.jpg',
      ],
      hasTalktalk: true,
    })
  })

  it('resolves naver.me shortlink via HTTP redirect and fetches place summary', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      const urlStr = String(url)
      if (urlStr.includes('naver.me')) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              location: 'https://m.place.naver.com/place/2085035251/home',
            },
          })
        )
      }
      if (urlStr.includes('/api/place/summary/2085035251')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                placeDetail: {
                  id: '2085035251',
                  name: '바이름 청라점',
                  category: { category: '속눈썹증모,연장' },
                  address: {
                    address: '인천 서구 청라동 157-6',
                    roadAddress: '인천 서구 청라커낼로288번길 8-10 2층 208호',
                  },
                  businessHours: { description: '20:00에 영업 종료' },
                  visitorReviews: { score: 4.98, displayText: '방문자 리뷰 87' },
                  images: {
                    images: [{ origin: 'https://ldb-phinf.pstatic.net/img1.jpg' }],
                  },
                  labels: { talktalk: true },
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }) as any

    try {
      const placeId = await resolveNaverPlaceId('https://naver.me/5xgJJEBa')
      expect(placeId).toBe('2085035251')
      expect(placeId).not.toBeNull()
      if (placeId) {
        const summary = await fetchNaverPlaceSummary(placeId)
        expect(summary).not.toBeNull()
        expect(summary?.name).toBe('바이름 청라점')
        expect(summary?.roadAddress).toContain('청라커낼로')
        expect(summary?.images.length).toBeGreaterThan(0)
      }
    } finally {
      global.fetch = originalFetch
    }
  })

  it('resolves naver.me shortlink via GET fallback when HEAD is refused', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (init?.method === 'HEAD') {
        return Promise.reject(new Error('HEAD refused'))
      }
      return Promise.resolve({
        url: 'https://m.place.naver.com/place/2085035251/home',
      })
    }) as any

    try {
      const placeId = await resolveNaverPlaceId('https://naver.me/5xgJJEBa')
      expect(placeId).toBe('2085035251')
    } finally {
      global.fetch = originalFetch
    }
  })
})
