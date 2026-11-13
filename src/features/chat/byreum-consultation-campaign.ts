export function createByreumConsultationCampaign() {
  return Object.freeze({
    key: 'byreum-eyebrow-consultation-checklist-v1' as const,
    title: '눈썹 상담 전에 확인하면 좋은 세 가지 기준',
    region: '인천 청라 및 인근 생활권',
    mustAvoid: Object.freeze([
      '시술 결과 보장',
      '의학적 효능 단정',
      '허위 전후 비교',
    ]),
    instagram: Object.freeze({
      imageCount: 3 as const,
      slidePrompts: Object.freeze([
        '내 얼굴에 어울리는 눈썹, 무엇부터 봐야 할까요?',
        '얼굴형, 눈매, 표정, 기존 눈썹 결을 차분히 확인하는 기준',
        '평소 메이크업과 원하는 인상을 상담에서 설명하는 방법',
      ]),
    }),
    threads: Object.freeze({
      imageCount: 1 as const,
      opening: '내 눈썹에서 가장 먼저 고민되는 기준은 무엇인가요?',
    }),
  })
}

export type ByreumConsultationCampaign = ReturnType<typeof createByreumConsultationCampaign>

export function buildByreumConsultationCampaignRequest(): string {
  const campaign = createByreumConsultationCampaign()
  return [
    `바이름의 '${campaign.title}' 캠페인을 만들어줘.`,
    '인스타그램 이미지 3장과 스레드 이미지 1장으로 각각 완성 게시물을 만들어줘.',
    `지역 문맥은 ${campaign.region}으로 하고, 얼굴형·눈매·표정·기존 눈썹 결·평소 메이크업을 상담에서 확인하는 정보성 내용으로 구성해줘.`,
    `${campaign.mustAvoid.join(', ')} 표현은 사용하지 말고 실제 고객 사례나 확인되지 않은 결과를 만들지 마.`,
    '각 채널의 문안과 이미지는 별도 정확한 버전으로 보존하고 외부 게시 전 승인 대기 상태로 준비해줘.',
  ].join(' ')
}
