import { LegalDocument, type LegalArticle } from './legal-document'

export type LegalDraftProps = {
  description: string
  effectiveDate?: string
  sections: readonly [string, string][]
  title: string
}

export function LegalDraft({
  description,
  effectiveDate,
  sections,
  title,
}: LegalDraftProps) {
  const articles: LegalArticle[] = sections.map(([heading, copy], index) => ({
    id: `section-${index + 1}`,
    title: heading,
    articleNumber: index + 1,
    content: copy,
  }))

  return (
    <LegalDocument
      articles={articles}
      description={description}
      effectiveDate={effectiveDate}
      title={title}
    />
  )
}
