/** 미입력 템플릿은 승인 행에 남아 있더라도 사업 사실로 사용하지 않는다. */
export function containsFactPlaceholder(content: string): boolean {
  return /\[(?:시그니처\s*메뉴|대표\s*(?:메뉴|서비스)|가게명|상호명|서비스명|가격|영업시간|입력\s*필요)\]|\{\{[^{}]+\}\}/u.test(content.normalize('NFKC'))
}
