// Selection is not approval or permission to generate/publish content.
export function parseBlogStrategySelection(text: string): { selectedIndex: number; constraints?: string } | null {
  const match = /^([1-3])(?:번(?:으로\s*써)?)?(?:\s*[,，]\s*(.{1,300}))?$/u.exec(text.trim())
  if (!match) return null
  return { selectedIndex: Number(match[1]) - 1,
    ...(match[2] ? { constraints: match[2].trim() } : {}) }
}
