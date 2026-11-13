import type { NaverCategory } from './types'

/** One row as the extension reads it from the editor's category dropdown. */
export interface RawCategoryItem {
  id: string
  label: string
  /** 0 = top level, 1 = sub-category. Deeper values are treated as sub-categories. */
  depth: number
}

const SUB_PREFIX = /^(?:하위\s*카테고리\s+|[└ㄴ]\s*)/

export function normalizeCategories(raw: readonly RawCategoryItem[]): NaverCategory[] {
  const result: NaverCategory[] = []
  const seen = new Set<string>()
  let currentTopLevelId: string | null = null
  for (const item of raw) {
    const id = item.id.trim()
    const name = item.label.trim().replace(SUB_PREFIX, '').trim()
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    if (item.depth <= 0) {
      currentTopLevelId = id
      result.push({ id, name, parentId: null })
    } else {
      result.push({ id, name, parentId: currentTopLevelId })
    }
  }
  return result
}

export function findCategory(categories: readonly NaverCategory[], id: string | null | undefined): NaverCategory | undefined {
  if (!id) return undefined
  return categories.find((category) => category.id === id)
}

/** A saved choice is only valid while the synced list still contains it. */
export function isCategoryStillValid(categories: readonly NaverCategory[], id: string | null | undefined): boolean {
  return findCategory(categories, id) !== undefined
}

export function formatCategoryPath(categories: readonly NaverCategory[], category: NaverCategory): string {
  if (category.parentId === null) return category.name
  const parent = findCategory(categories, category.parentId)
  return parent ? `${parent.name} > ${category.name}` : category.name
}
