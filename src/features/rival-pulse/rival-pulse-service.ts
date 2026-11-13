import type { RivalInsight, CounterCampaignProposal } from './types'

export class RivalPulseService {
  /**
   * Generates actionable commercial counter-campaign proposals based on local area dynamics
   */
  static generateCounterProposal(params: {
    location?: string
    industry?: string
    brandTone?: string
  }): CounterCampaignProposal {
    const loc = params.location || '청라'

    return {
      id: `rival_counter_${Date.now()}`,
      topic: `${loc} 상권 역발상: 자극 없는 속건조 진정 케어 반격 캠페인`,
      headline: `주변 샵 가을 필링 자극 불만 감지 ➡️ '25년 손길 진정 앰플 케어' 반격 기획`,
      targetPainPoint: '인근 샵 가을철 무리한 필링 시술 후 피부 붉어짐 및 당김 불만 증가',
      caption: `[${loc} 원장님이 전하는 가을 피부 이야기 🌿]\n\n가을철 건조하다고 무작정 각질만 벗겨내면 피부 장벽이 무너져요 😢\n\n바이름은 25년 에스테틱 노하우로 자극 없이 피부 속 깊은 건조부터 꽉 채워드리는 '1:1 맞춤 진정 앰플 케어'를 고집합니다.\n\n✨ 지금 예약 주시면 첫 방문 2만원 우대 혜택과 맞춤 홈케어 키트를 선물해 드려요!`,
      hashtags: [`#${loc}피부관리`, `#${loc}에스테틱`, '#속건조진정', '#1인샵맞춤케어', '#가을피부관리'],
      recommendedChannels: ['instagram', 'threads', 'naver_blog'],
      expectedAdvantage: '인근 자극성 시술 이탈 고객 유입 및 첫 방문 예약 전환율 극대화',
      createdAt: new Date().toISOString(),
    }
  }

  static getRivalInsights(location = '청라'): RivalInsight[] {
    return [
      {
        id: 'rival_1',
        rivalName: 'A 에스테틱',
        locationDistance: '반경 600m',
        observedTrend: '가을 물광 필링 30% 할인 행사 공격적 홍보 중',
        customerPainPoint: '시술 후 홍조 및 건조함 호소 리뷰 4건 감지',
        counterAngle: '자극 없는 속건조 진정 앰플 케어로 차별화',
      },
      {
        id: 'rival_2',
        rivalName: 'B 뷰티살롱',
        locationDistance: '반경 1.2km',
        observedTrend: '단순 기계 관리 중심 빠른 회전율 마케팅',
        customerPainPoint: '상담이 성의 없고 기계만 돌린다는 고객 아쉬움',
        counterAngle: '25년 원장 손길 1:1 프라이빗 집중 맞춤 케어 부각',
      },
    ]
  }
}
