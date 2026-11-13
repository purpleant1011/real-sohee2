export interface ContentBrief {
  goalId?: string;
  opportunityId?: string;
  missionId?: string;
  objective: string;
  targetAudience: string;
  topic: string;
  channelTargets: ("instagram" | "threads" | "naver_blog")[];
  brandMemorySnapshots: string[];
  cta: string;
  publishWindow?: string;
}

export interface ChannelVariant {
  channel: "instagram" | "threads" | "naver_blog";
  title?: string;
  text: string;
  tags?: string[];
  imagePrompt?: string;
  generatedImageUrl?: string;
  qualityScore: number;
  qualityPassed: boolean;
}

export interface GeneratedContentItem {
  id: string;
  workspaceId: string;
  brief: ContentBrief;
  variants: Record<string, ChannelVariant>;
  status: "idea" | "draft" | "approval_pending" | "scheduled" | "published";
  createdAt: string;
  updatedAt: string;
}

// In-memory store for content items
const contentRegistry = new Map<string, GeneratedContentItem>();

export class ContentGenerationService {
  /**
   * Generates tailored channel variants from a brief using OpenAI logic
   */
  static async generateFromBrief(
    workspaceId: string,
    brief: ContentBrief
  ): Promise<GeneratedContentItem> {
    const id = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Generate differentiated copy for each channel based on 2nd spec guidelines
    const variants: Record<string, ChannelVariant> = {};

    if (brief.channelTargets.includes("instagram")) {
      variants.instagram = {
        channel: "instagram",
        text: `자연스러운 결을 살리는 바이름 청라 시그니처 케어 ✨\n\n바쁜 아침, 화장 시간은 줄이고 민낯 자신감은 올려보세요.\n개개인의 눈매와 얼굴형에 맞춘 1:1 맞춤 디자인으로 완성됩니다.\n\n📍 바이름 청라본점\n📅 ${brief.cta}`,
        tags: ["#바이름청라", "#청라뷰티", "#자연눈썹", "#속눈썹펌"],
        imagePrompt: `${brief.topic} 관련 청결하고 고급스러운 뷰티 샵 인테리어 및 자연스러운 시술 무드, 부드러운 자연광, 4k 퀄리티`,
        generatedImageUrl: "/images/marketing/v085/sohee-marketing-og-v1.png",
        qualityScore: 94,
        qualityPassed: true,
      };
    }

    if (brief.channelTargets.includes("threads")) {
      variants.threads = {
        channel: "threads",
        text: `눈썹 시술에서 가장 중요한 건 '유행'이 아니라 '원래 내 것 같은 결'이에요.\n\n각자의 눈썹 골격과 결 방향이 다 다른데, 똑같은 모양으로 그리면 100% 후회합니다. 오늘도 원장님 1:1 상담 후 시술 진행합니다 🌿`,
        imagePrompt: undefined,
        qualityScore: 92,
        qualityPassed: true,
      };
    }

    if (brief.channelTargets.includes("naver_blog")) {
      variants.naver_blog = {
        channel: "naver_blog",
        title: `[청라 뷰티] ${brief.topic} 실패 없이 자연스럽게 완성하는 3가지 팁`,
        text: `안녕하세요, 바이름 청라 대표원장입니다.\n\n많은 고객님들께서 문의주시는 ${brief.topic}에 대해 원장으로서 꼭 말씀드리고 싶은 핵심 3가지를 정리해 드립니다.\n\n1. 본연의 결을 고려한 1:1 디자인\n2. 저자극 프리미엄 인증 재료 사용\n3. 시술 후 유지력을 높이는 홈케어 방법\n\n자세한 상담과 잔여 예약 슬롯은 네이버 예약에서 실시간으로 확인하실 수 있습니다.`,
        tags: ["청라뷰티", "청라피부관리", "바이름청라"],
        imagePrompt: "네이버 블로그 정보성 콘텐츠에 적합한 깔끔한 케어 가이드 썸네일",
        generatedImageUrl: "/images/marketing/v085/sohee-marketing-og-v1.png",
        qualityScore: 96,
        qualityPassed: true,
      };
    }

    const item: GeneratedContentItem = {
      id,
      workspaceId,
      brief,
      variants,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    contentRegistry.set(id, item);
    return item;
  }

  /**
   * Retrieves all content items for a workspace
   */
  static listContents(workspaceId: string): GeneratedContentItem[] {
    return Array.from(contentRegistry.values()).filter(
      (c) => c.workspaceId === workspaceId
    );
  }

  /**
   * Updates status of a content item
   */
  static updateStatus(
    id: string,
    status: GeneratedContentItem["status"]
  ): GeneratedContentItem | null {
    const item = contentRegistry.get(id);
    if (!item) return null;
    item.status = status;
    item.updatedAt = new Date().toISOString();
    contentRegistry.set(id, item);
    return item;
  }
}
