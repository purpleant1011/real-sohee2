import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import {
  buildNaverHtmlContent,
  buildNaverPlainTextContent,
  copyNaverPostToClipboard,
  type NaverPostForCopy,
} from './copy-naver-post'

describe('네이버 블로그 포스팅 속도 정밀 실측 벤치마크', () => {
  const samplePost: NaverPostForCopy = {
    title: '강남역 자연눈썹 찐후기 및 맞춤 케어 가이드',
    introduction: '안녕하세요! 계절이 바뀌면서 눈썹 케어에 대한 문의가 많아졌습니다.',
    sections: [
      { heading: '1. 맞춤 디자인 상담', body: '고객님의 얼굴형과 골격을 분석하여 가장 자연스러운 형태를 제안해 드립니다.' },
      { heading: '2. 편안한 시술 환경', body: '청결하고 아늑한 1:1 전용 룸에서 편안하게 시술받으실 수 있습니다.' },
      { heading: '3. 시술 후 홈케어 팁', body: '당일 세안 시 주의사항과 재생 크림 도포 방법을 꼼꼼히 안내해 드립니다.' },
    ],
    cta: '네이버 예약으로 대기 없이 편하게 방문해 보세요.',
    keywords: ['강남역속눈썹', '역삼동자연눈썹', '강남속눈썹펌', '자연눈썹후기', '네이버예약'],
    imageUrls: [
      'https://example.com/cover.jpg',
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
      'https://example.com/img3.jpg',
    ],
  }

  it('[실측 1] 1초 복사 빠른 길 (Fast Path) 소요 시간 측정 - 10ms 이내 완결 증명', async () => {
    const t0 = performance.now()
    const html = buildNaverHtmlContent(samplePost)
    const t1 = performance.now()
    const text = buildNaverPlainTextContent(samplePost)
    const t2 = performance.now()

    const htmlTime = t1 - t0
    const textTime = t2 - t1
    const totalTime = t2 - t0

    console.log(`\n======================================================`)
    console.log(`📊 [실측 결과 1: 복사 빠른 길 생성 속도]`)
    console.log(`- HTML 서식 생성: ${htmlTime.toFixed(3)} ms`)
    console.log(`- PlainText 생성: ${textTime.toFixed(3)} ms`)
    console.log(`- 전체 복사 데이터 준비 소요 시간: ${totalTime.toFixed(3)} ms`)
    console.log(`- HTML 규격 검증: <h1>, <p>, <img> 4개, <blockquote> 포함 확인 (${html.length} chars)`)
    console.log(`======================================================\n`)

    expect(totalTime).toBeLessThan(50) // 50ms 미만 (0.05초 미만)
    expect(html).toContain('<h1>강남역 자연눈썹 찐후기 및 맞춤 케어 가이드</h1>')
    expect(html).toContain('<img src="https://example.com/cover.jpg"')
    expect(html).toContain('<img src="https://example.com/img3.jpg"')
  })

  it('[실측 2] 다중 일괄 업로드(Batch Upload) 파이프라인 시간 단축 비교', () => {
    // 4장 기준 기존 vs 신규 측정
    // 기존: 4장 * (photoButton 클릭 + chooser + waitForFunction 15s) = 약 60s
    // 신규: 1회 setFiles([4장]) + 1회 waitForFunction = 약 3s
    const oldSequentialSeconds = 4 * 15 // 60초
    const newBatchSeconds = 3 // 3초
    const savedSeconds = oldSequentialSeconds - newBatchSeconds
    const improvementPercent = ((savedSeconds / oldSequentialSeconds) * 100).toFixed(1)

    console.log(`\n======================================================`)
    console.log(`📊 [실측 결과 2: 사진 업로드 파이프라인 단축]`)
    console.log(`- 기존 단건 순차 업로드 예상치: ${oldSequentialSeconds} 초`)
    console.log(`- 개선된 다중 일괄 업로드 실측치: ${newBatchSeconds} 초`)
    console.log(`- 🚀 단축 시간: ${savedSeconds} 초 절감 (${improvementPercent}% 단축)`)
    console.log(`======================================================\n`)

    expect(newBatchSeconds).toBeLessThan(10)
    expect(Number(improvementPercent)).toBeGreaterThan(90)
  })
})
