import type { MagicStudioResult } from './types'

export class MagicStudioService {
  /**
   * Generates a 4-channel full marketing package from a single photo
   */
  static generateFullPackage(input: {
    photoName: string
    photoUrl?: string
    storeName?: string
    treatmentNote?: string
  }): MagicStudioResult {
    const store = input.storeName || '바이름 청라점'
    const note = input.treatmentNote || '환절기 속건조 진정 앰플 케어'
    const image = input.photoUrl || '/images/marketing/v085/sohee-marketing-og-v1.png'

    return {
      id: `magic_studio_${Date.now()}`,
      originalFileName: input.photoName,
      enhancedImageUrl: image,
      instagramCaption: `[${store} 오늘의 케어 기록 ✨]\n\n오늘 방문해 주신 고객님의 피부 고민을 덜어드린 '${note}' 실물 기록이에요 🌿\n\n칙칙했던 피부 톤이 25년 손길의 맞춤 앰플을 듬뿍 머금고 맑고 투명하게 살아났어요 😊\n\n거울 보시고 환하게 웃으시는 고객님 모습에 오늘도 소희와 원장님은 보람을 가득 충전합니다 💕`,
      threadsText: `오늘 시술 끝나고 한 컷 📸 속건조 심했던 분인데 관리 직후 윤기 도는 거 보고 둘 다 감탄했네요 ㅎㅎ 1인샵이라 더 정성껏 해드릴 수 있어 행복해요 ☕`,
      shortformScript: {
        durationSec: 15,
        hook: '속건조 심해서 화장 다 뜨는 사람 주목! 🚨',
        bodyScenes: [
          '0~5초: 시술 전 건조하고 붉은 피부 클로즈업',
          '5~10초: 25년 손길의 속건조 앰플 흡수 테크닉',
          '10~15초: 관리 직후 조명 켠 듯 광채 도는 피부 완성!',
        ],
        cta: '청라 1인샵 바이름에서 인생 피부 찾기 ✨ 프로필 링크 예약',
      },
      blogPost: {
        title: `[청라 피부관리] 환절기 속건조 잡는 25년 손길의 진정 앰플 케어 실제 전후 후기`,
        subheadings: ['환절기마다 뒤집어지는 피부, 원인은 속건조', '기계 대신 25년 손길로 채우는 맞춤 앰플 테크닉', '시술 직후 고객님의 생생한 리액션과 홈케어 꿀팁'],
        body: `안녕하세요! 청라에서 25년간 한결같은 손길로 고객님들의 피부를 케어해 드리는 ${store}입니다.\n\n요즘 아침저녁 일교차가 커지면서 화장이 들뜨고 피부가 붉어진다는 분들이 부쩍 늘었어요. 오늘 찾아주신 고객님도 같은 고민이셨는데요...\n\n자세한 맞춤 케어 과정과 원장님의 꿀팁을 확인해 보세요!`,
      },
      hashtags: ['#청라피부관리', '#청라에스테틱', '#속건조케어', '#1인샵맞춤케어', '#물광피부'],
      createdAt: new Date().toISOString(),
    }
  }
}
