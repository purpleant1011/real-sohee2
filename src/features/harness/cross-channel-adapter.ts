/**
 * SOHEE Harness Knowledge OS — Cross-Channel Platform Adapter (v1.1)
 * Enforces:
 * 1. Instagram DNA ➔ Threads Conversational Adapter
 * 2. Instagram DNA ➔ Naver Blog C-Rank Structured Column Adapter
 * 3. Platform Constraint Transformation
 */

import { TextHarness, PlatformType } from '@/types/harness'

export interface AdapterInput {
  targetPlatform: PlatformType
  textHarness: TextHarness
  brandName: string
  location: string
  topic: string
  currentPromo?: string
}

export interface AdaptedOutput {
  platform: PlatformType
  title?: string
  body: string
  headings?: { level: 'H2' | 'H3'; text: string }[]
  hashtags: string[]
  cta: string
}

export class CrossChannelAdapter {
  public adapt(input: AdapterInput): AdaptedOutput {
    const { targetPlatform, textHarness, brandName, location, topic, currentPromo } = input

    switch (targetPlatform) {
      case 'threads':
        return this.adaptToThreads(textHarness, brandName, location, topic)
      case 'naver_blog':
        return this.adaptToNaverBlog(textHarness, brandName, location, topic, currentPromo)
      case 'instagram':
      default:
        return this.adaptToInstagram(textHarness, brandName, location, topic, currentPromo)
    }
  }

  private adaptToThreads(
    harness: TextHarness,
    brandName: string,
    location: string,
    topic: string
  ): AdaptedOutput {
    const hook = `${topic}에 대해 많은 분들이 오해하시는 부분이 있어요.`
    const diagnosis = `누구나 똑같은 모양으로 찍어내는 방식은 결국 얼굴 표정과 모류 흐름을 망치게 됩니다.\n\n[${brandName}]에서는 본래 눈썹 결에 맞춘 1:1 맞춤 진단을 가장 중요하게 생각합니다.`
    const tailQuestion = `지금 가장 고민되는 눈썹 모양이나 스트레스 받는 부분이 있으신가요? 댓글로 편하게 알려주세요! 👇`

    return {
      platform: 'threads',
      body: `${hook}\n\n${diagnosis}\n\n${tailQuestion}`,
      hashtags: [`#${brandName}`, `#${location}눈썹`, '#눈썹상담', '#자연눈썹'],
      cta: '댓글로 고민 공유 시 1:1 맞춤 상담 답변'
    }
  }

  private adaptToNaverBlog(
    harness: TextHarness,
    brandName: string,
    location: string,
    topic: string,
    promo?: string
  ): AdaptedOutput {
    const title = `${location} 자연눈썹 잘하는곳, 짱구 눈썹 없이 내 눈썹처럼 자연스러운 ${brandName} 1:1 맞춤 진단`
    const h2_1 = `■ 아침마다 양쪽 대칭 맞추느라 스트레스 받으셨나요?`
    const body_1 = `매일 아침 출근길 눈썹 그리기에 15분씩 씨름하셨던 분들이라면, 왜 화장을 지우고 나면 어색하고 오후만 되면 지워지는지 고민하셨을 것입니다.\n\n공장식 시술이 실패하는 가장 큰 이유는 사람마다 다른 '골격 뼈의 돌출도'와 '깜빡일 때 움직이는 근육 모류'를 무시하기 때문입니다.`

    const h2_2 = `■ ${brandName}만의 1:1 정밀 골격 분석 솔루션`
    const body_2 = `[${brandName}]은 고객 한 분 한 분의 눈썹 결 흐름과 얼굴 비대칭을 정밀하게 진단하여, 붉은 잔흔이 남지 않는 최고급 천연 유기농 피그먼트로 한 올 한 올 섬세하게 결을 채워드립니다.\n\n시술 직후에도 짱구 눈썹이나 붉은기 없이 바로 일상생활이 가능하여 많은 고객님들이 높은 만족도를 보여주고 계십니다.`

    const h2_3 = `■ ${location} ${brandName} 예약 및 프로모션 안내`
    const body_3 = promo
      ? `현재 ${promo}가 한정 예약으로 진행되고 있습니다.\n하루 한정 인원 100% 예약제로 운영되오니, 아래 링크를 통해 편안하게 예약해 주시기 바랍니다.`
      : `하루 한정 인원 100% 예약제로 운영됩니다.`

    const fullBody = `${h2_1}\n${body_1}\n\n${h2_2}\n${body_2}\n\n${h2_3}\n${body_3}`

    return {
      platform: 'naver_blog',
      title,
      headings: [
        { level: 'H2', text: h2_1 },
        { level: 'H2', text: h2_2 },
        { level: 'H2', text: h2_3 }
      ],
      body: fullBody,
      hashtags: [`#${location}자연눈썹`, `#${location}눈썹문신`, `#${brandName}`, `#${location}눈썹잘하는곳`],
      cta: '네이버 플레이스 100% 프라이빗 예약 링크'
    }
  }

  private adaptToInstagram(
    harness: TextHarness,
    brandName: string,
    location: string,
    topic: string,
    promo?: string
  ): AdaptedOutput {
    const hook = harness.hookPatterns[0] || '아침마다 눈썹 그리기 씨름하셨나요?'
    const body = `${hook}\n\n공장식 시술과 1:1 퍼스널 디자인의 차이는 '내 본래 눈썹 결을 얼마나 자연스럽게 살리는가'에 있습니다. ✨\n\n[${brandName}]에서는 정밀 골격 진단으로 무통·무붉은기 시술을 약속드립니다.\n\n${promo ? `💡 ${promo}\n\n` : ''}📍 위치: ${location}\n👉 프로필 링크에서 100% 프라이빗 예약 가능합니다.`

    return {
      platform: 'instagram',
      body,
      hashtags: [`#${location}자연눈썹`, `#${location}눈썹`, `#${brandName}`, '#자연눈썹추천'],
      cta: '프로필 링크 100% 프라이빗 예약'
    }
  }
}

export const crossChannelAdapter = new CrossChannelAdapter()
