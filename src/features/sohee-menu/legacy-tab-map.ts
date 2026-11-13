export type SoheeTab = 'studio' | 'teach' | 'work' | 'tools'

/** 일하는 방식 탭 안에서 스크롤·펼침 대상이 되는 구역 */
export type WorkSection = 'rules' | 'autonomy' | 'recipes' | 'campaigns' | 'routines' | 'briefing' | 'evaluation' | 'reports'

export interface ResolvedTab {
  tab: SoheeTab
  section?: WorkSection
}

const WORK_SECTIONS: ReadonlySet<string> = new Set<WorkSection>([
  'rules', 'autonomy', 'recipes', 'campaigns', 'routines', 'briefing', 'evaluation', 'reports',
])

const MAP: Readonly<Record<string, ResolvedTab>> = {
  studio: { tab: 'studio' },
  teach: { tab: 'teach' },
  profile: { tab: 'teach' },
  settings: { tab: 'teach' },
  lineage: { tab: 'teach' },
  knowledge: { tab: 'teach' },
  work: { tab: 'work' },
  rules: { tab: 'work', section: 'rules' },
  command: { tab: 'work', section: 'autonomy' },
  campaigns: { tab: 'work', section: 'campaigns' },
  routines: { tab: 'work', section: 'routines' },
  briefing: { tab: 'work', section: 'briefing' },
  learning: { tab: 'work', section: 'recipes' },
  training: { tab: 'work', section: 'recipes' },
  evaluation: { tab: 'work', section: 'evaluation' },
  reports: { tab: 'work', section: 'reports' },
  tools: { tab: 'tools' },
  capabilities: { tab: 'tools' },
  channels: { tab: 'tools' },
  plugins: { tab: 'tools' },
}

export function resolveSoheeTab(rawTab: string | null | undefined, rawSection?: string | null): ResolvedTab {
  const base = (rawTab && MAP[rawTab]) || { tab: 'studio' as const }
  if (base.tab === 'work' && !base.section && rawSection && WORK_SECTIONS.has(rawSection)) {
    return { tab: 'work', section: rawSection as WorkSection }
  }
  return { ...base }
}

