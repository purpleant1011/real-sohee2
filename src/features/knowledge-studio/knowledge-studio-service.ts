export interface SecretKnowledgeItem {
  knowledgeId: string;
  workspaceId: string;
  category: 'TECHNIQUE_RECIPE' | 'STORE_STRENGTH' | 'PRICING_POLICY' | 'CONSULTING_GUIDE' | 'BANNED_GUIDELINE';
  title: string;
  content: string;
  priority: number; // 1 ~ 10
  isActive: boolean;
  appliedCount: number;
  lastTaughtAt: string;
}

export class KnowledgeStudioService {
  private knowledgeBase: Map<string, SecretKnowledgeItem> = new Map();

  /**
   * 사장님의 고유 비법 지식 등록 및 교육 (ANI-888)
   */
  teachKnowledge(params: {
    workspaceId: string;
    category: SecretKnowledgeItem['category'];
    title: string;
    content: string;
    priority?: number;
  }): SecretKnowledgeItem {
    const { workspaceId, category, title, content, priority = 5 } = params;

    const knowledgeId = `know_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const item: SecretKnowledgeItem = {
      knowledgeId,
      workspaceId,
      category,
      title,
      content,
      priority,
      isActive: true,
      appliedCount: 0,
      lastTaughtAt: new Date().toISOString(),
    };

    this.knowledgeBase.set(knowledgeId, item);
    return item;
  }

  /**
   * 콘텐츠 생성 및 응대 런타임에 주입할 비법 컨텍스트 컴파일
   */
  compileKnowledgeContext(workspaceId: string): string {
    const items = Array.from(this.knowledgeBase.values()).filter(
      (k) => k.workspaceId === workspaceId && k.isActive
    );

    if (items.length === 0) {
      return '등록된 매장 고유 비법 지식이 없습니다. 기본 브랜드 가이드라인을 준수합니다.';
    }

    const lines: string[] = ['[매장 고유 비법 지식 교육 내용]'];
    for (const item of items) {
      lines.push(`- [${item.category}] ${item.title}: ${item.content}`);
      item.appliedCount++;
    }

    return lines.join('\n');
  }

  listKnowledge(workspaceId: string): SecretKnowledgeItem[] {
    return Array.from(this.knowledgeBase.values()).filter((k) => k.workspaceId === workspaceId);
  }
}
