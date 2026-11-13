import type { InstagramGenerationContext } from '@/features/auth/workspace-context'
import type { ConversationImageCount } from './conversation-image-intent'
import type { NaverBlogDraft } from './naver-blog-draft-provider'

function ownedUrl(context: InstagramGenerationContext, channel: string): string {
  const source = context.ownedKnowledgeSources?.find((candidate) => candidate.channel === channel)
  if (!source || !source.url.startsWith('https://')) throw new Error('BYREUM_OWNED_SOURCE_REQUIRED')
  return source.url
}

export function createByreumNaverReferenceDraft(
  context: InstagramGenerationContext,
  imageCount: ConversationImageCount,
): NaverBlogDraft {
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 20) {
    throw new Error('BYREUM_NAVER_REFERENCE_IMAGE_COUNT_INVALID')
  }
  const blogUrl = ownedUrl(context, 'naver_blog')
  const placeUrl = ownedUrl(context, 'naver_place')

  const introduction = '반영구 눈썹을 고민할 때는 유행하는 모양을 고르는 것보다 상담에서 무엇을 확인할지 먼저 정리하는 편이 도움이 됩니다. 얼굴 인상과 현재 눈썹 상태, 평소 메이크업 방식, 기존 시술 흔적처럼 사람마다 출발점이 다르기 때문입니다. 이 글은 바이름 상담을 앞둔 분이 자신의 요청과 질문을 차분히 준비할 수 있도록 확인 항목을 정리한 정보성 안내입니다. 특정 결과를 약속하거나 실제 고객 사례를 재구성하지 않으며, 개인별 상태와 시술 가능 여부는 현장 상담에서 별도로 확인해야 합니다.'
  const sections = [
    {
      heading: '1. 원하는 인상을 모양보다 먼저 설명해 보세요',
      body: '상담 전에는 아치형, 일자형처럼 모양 이름만 정하기보다 어떤 인상을 원하는지 말로 적어보는 것이 좋습니다. 자연스럽고 편안한 느낌인지, 또렷하지만 과하지 않은 느낌인지, 평소 메이크업에서 눈썹을 어느 정도 강조하는지부터 정리해 보세요. 참고 이미지는 취향을 전달하는 자료일 뿐 동일한 결과를 보장하는 기준은 아닙니다. 얼굴의 여백, 눈매 방향, 좌우 표정 차이와 현재 눈썹의 숱은 사람마다 다르므로, 참고 이미지에서 마음에 드는 요소와 피하고 싶은 요소를 나누어 설명하면 상담이 더 구체적이 됩니다. 평소 안경을 쓰거나 앞머리 스타일이 자주 바뀌는지도 함께 말하면 일상에서 보이는 인상을 논의하는 데 도움이 됩니다.',
    },
    {
      heading: '2. 현재 눈썹과 기존 시술 흔적을 함께 확인하세요',
      body: '눈썹의 숱과 결 방향, 비어 보이는 부분, 좌우 높이와 길이 차이를 먼저 살펴보세요. 과거 반영구 시술이나 문신 경험이 있다면 언제 받았는지, 남아 있는 색과 형태가 있는지 상담자에게 알려야 합니다. 사진만으로는 피부 상태나 남은 색을 정확히 판단하기 어려울 수 있으므로, 온라인 문의 단계의 안내를 최종 판단으로 받아들이지 않는 것이 중요합니다. 민감하게 반응했던 화장품이나 피부 관련 특이사항, 현재 불편한 부분도 빠뜨리지 말고 이야기해 주세요. 기존 흔적 때문에 원하는 방향을 바로 적용하기 어려울 수 있다는 가능성까지 열어두고, 가능한 범위와 추가로 확인할 사항을 질문하는 편이 안전합니다.',
    },
    {
      heading: '3. 디자인을 결정하는 순서를 질문해 보세요',
      body: '상담에서는 디자인을 어떤 순서로 정하는지, 시술 전에 형태를 어떻게 확인하는지, 어느 단계에서 의견을 조정할 수 있는지 물어보세요. 설명을 듣는 동안 앞머리의 농도, 중간 부분의 굵기, 꼬리의 길이와 방향을 나누어 살펴보면 막연한 선호를 구체적인 언어로 바꾸기 쉽습니다. 한 번에 완벽한 모양을 고르려 하기보다 얼굴에서 편안하게 보이는 범위를 찾는 과정으로 이해하는 것이 좋습니다. 상담자가 제안한 이유를 듣고 본인이 걱정하는 부분을 다시 확인하세요. 충분히 이해되지 않은 항목이 있다면 바로 결정하기보다 질문을 남기고 다시 설명을 요청하는 것이 바람직합니다.',
    },
    {
      heading: '4. 색과 농도는 일상 습관과 함께 이야기하세요',
      body: '평소 눈썹 화장을 진하게 하는지, 거의 하지 않는지, 사용하는 머리 색과 메이크업 색감은 어떤지 정리해 두세요. 같은 색 이름도 피부와 주변 색, 조명에 따라 다르게 보일 수 있으므로 이름 하나만으로 결정하기보다 상담에서 비교하며 확인하는 편이 좋습니다. 출근이나 외출 준비 시간, 운동이나 야외 활동 빈도처럼 일상 습관도 관리 가능성을 판단하는 참고가 됩니다. 시술 직후와 시간이 지난 뒤 보이는 느낌이 같다고 단정할 수 없으므로 변화 과정과 안내 기준을 질문하세요. 개인별 반응과 유지 양상은 다를 수 있다는 설명을 충분히 듣고 본인의 기대를 현실적인 범위로 조정하는 것이 중요합니다.',
    },
    {
      heading: '5. 과정과 위생 안내는 구체적으로 확인하세요',
      body: '상담에서 예상되는 진행 순서, 준비 과정, 사용하는 도구와 위생 관리 방식에 대한 안내를 요청하세요. 궁금한 내용을 묻는 것은 까다로운 요구가 아니라 안전한 결정을 위한 기본 확인입니다. 시술 중 불편함이 있을 때 어떻게 의사를 전달할 수 있는지, 중간에 형태나 상태를 확인하는 단계가 있는지도 질문해 보세요. 온라인 게시물이나 다른 사람의 경험만으로 자신에게 적용될 과정을 단정하지 말고, 실제 상담에서 제공되는 설명을 기준으로 판단해야 합니다. 확인한 내용은 짧게 메모해 두면 여러 정보를 비교할 때 혼동을 줄일 수 있습니다.',
    },
    {
      heading: '6. 시술 후 관리가 내 일정과 맞는지 살펴보세요',
      body: '세안과 화장, 운동, 자외선 노출처럼 평소 생활과 연결되는 관리 항목을 상담에서 확인하세요. 중요한 일정이나 촬영, 여행을 앞두고 있다면 그 사실을 먼저 알리고 일정상 고려할 부분이 있는지 질문하는 것이 좋습니다. 관리 방법은 개인 상태와 안내 기준에 따라 달라질 수 있으므로 인터넷에서 본 일반적인 방법을 그대로 적용하기보다 담당자가 제공한 안내를 우선해야 합니다. 예상하지 못한 불편함이나 궁금한 변화가 생겼을 때 어느 채널로 문의할 수 있는지도 확인해 두세요. 스스로 판단하기 어려운 상황을 미리 구분해 두면 이후 대응이 한결 명확해집니다.',
    },
    {
      heading: '7. 비용과 추가 일정은 확인된 안내만 기준으로 삼으세요',
      body: '가격이나 추가 방문 여부는 게시물의 오래된 정보나 다른 사람의 경험을 그대로 믿지 말고 상담 시점의 공식 안내를 확인하세요. 포함되는 범위, 별도로 결정해야 하는 항목, 일정 변경 기준처럼 실제 선택에 영향을 주는 조건을 구체적으로 질문하는 편이 좋습니다. 이 글에서는 확인되지 않은 금액이나 횟수를 제시하지 않습니다. 상담에서 들은 내용이 이해한 것과 같은지 마지막에 다시 요약해 보는 것도 도움이 됩니다. 결정해야 할 내용과 아직 확인되지 않은 내용을 나누어 메모하면 성급한 선택을 줄일 수 있습니다.',
    },
    {
      heading: '8. 상담 전에 가져갈 질문 체크리스트',
      body: '원하는 인상과 피하고 싶은 느낌은 무엇인지, 현재 눈썹 상태와 기존 시술 흔적에서 고려할 점이 있는지, 디자인은 어떤 순서로 확인하고 조정하는지 질문해 보세요. 색과 농도를 정할 때 어떤 요소를 함께 보는지, 과정 중 의사를 전달할 시점이 있는지, 시술 후 관리에서 본인 일정과 충돌하는 부분이 있는지도 확인하세요. 문제가 생기거나 추가 설명이 필요할 때 문의할 방법, 공식적으로 확인할 수 있는 위치와 운영 정보도 함께 점검하면 좋습니다. 질문을 모두 외우기보다 휴대전화 메모에 저장해 상담 중 하나씩 확인하면 빠뜨릴 가능성이 줄어듭니다.',
    },
    {
      heading: '9. 충분히 이해한 뒤 본인의 속도로 결정하세요',
      body: '반영구 눈썹 상담의 목표는 유행하는 답을 빠르게 고르는 것이 아니라 현재 상태와 원하는 인상, 관리 가능성을 함께 살펴보는 데 있습니다. 설명을 들은 뒤에도 이해되지 않는 부분이 남았다면 추가 질문을 하고, 바로 결정해야 한다는 압박을 느끼지 않는 것이 좋습니다. 바이름의 실제 게시물과 위치 정보는 아래 등록된 소유 채널에서 확인할 수 있지만, 주소에 등록되어 있다는 사실만으로 수집되지 않은 세부 내용을 추정해서는 안 됩니다. 방문 전 최신 운영 정보와 상담 가능 여부를 공식 채널에서 다시 확인하고, 개인별 상태에 관한 판단은 현장 상담을 통해 받으세요.',
    },
  ] as const

  const imageSlots = Array.from({ length: imageCount }, (_, index) => ({
    kind: 'image_slot' as const,
    position: index + 1,
    altText: `바이름 반영구 눈썹 상담 안내 ${index + 1}`,
  }))
  const editorBlueprint: NaverBlogDraft['editorBlueprint'][number][] = [
    { kind: 'heading', text: '반영구 눈썹 상담 전 확인할 아홉 가지' },
    { kind: 'paragraph', text: introduction },
    imageSlots[0],
  ]
  sections.forEach((section, index) => {
    editorBlueprint.push({ kind: 'heading', text: section.heading })
    editorBlueprint.push({ kind: 'paragraph', text: section.body })
    if (index === 1) editorBlueprint.push({ kind: 'quote', text: '참고 이미지는 취향을 설명하는 자료이며, 나의 현재 상태를 대신 판단하는 기준은 아닙니다.' })
    if (index === 4) editorBlueprint.push({ kind: 'quote', text: '충분히 이해되지 않은 내용은 바로 결정하지 말고 상담에서 다시 확인해 보세요.' })
    if (index === 7) editorBlueprint.push({ kind: 'quote', text: '확인된 정보와 아직 모르는 내용을 나누어 적는 것이 안전한 선택의 시작입니다.' })
    if (imageSlots[index + 1]) editorBlueprint.push(imageSlots[index + 1])
  })
  for (const imageSlot of imageSlots.slice(sections.length + 1)) editorBlueprint.push(imageSlot)
  editorBlueprint.push(
    { kind: 'link', url: blogUrl, title: '바이름 네이버 블로그에서 실제 게시물 확인하기' },
    { kind: 'link', url: placeUrl, title: '바이름 네이버 플레이스에서 위치와 운영 정보 확인하기' },
    { kind: 'cta', text: '상담 전에 원하는 인상, 현재 눈썹 상태, 궁금한 관리 항목을 메모하고 공식 채널에서 최신 안내를 확인해 보세요.' },
  )

  return Object.freeze({
    title: '반영구 눈썹 상담 전, 나에게 맞는 기준을 확인하는 9가지 질문',
    introduction,
    sections: Object.freeze(sections.map((section) => Object.freeze({ ...section }))),
    editorBlueprint: Object.freeze(editorBlueprint.map((block) => Object.freeze(block))),
    keywords: Object.freeze(['바이름', '반영구눈썹', '눈썹상담', '눈썹디자인', '상담체크리스트', '시술전확인']),
    cta: '상담 전에 원하는 인상과 확인할 질문을 메모하고 바이름의 공식 채널에서 최신 안내를 확인해 보세요.',
    disclosure: '이 글은 상담 전 확인 항목을 정리한 정보성 안내이며 개인별 결과나 시술 가능 여부를 보장하지 않습니다.',
    observations: Object.freeze(['바이름 소유 채널 주소와 사용권 확인 이미지가 작업공간에 등록되어 있습니다.']),
    limitations: Object.freeze(['등록 주소에서 아직 수집되지 않은 가격, 효과, 실제 고객 사례는 포함하지 않았습니다.']),
    evidence: Object.freeze([blogUrl, placeUrl]),
    unresolvedQuestions: Object.freeze(['방문 전 최신 운영 정보와 개인별 상담 가능 여부를 공식 채널에서 확인해야 합니다.']),
    visibility: 'public',
  })
}
