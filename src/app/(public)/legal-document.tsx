import type React from 'react'
import Link from 'next/link'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import styles from '@/features/marketing/marketing.module.css'

export type LegalArticle = {
  articleNumber?: number | string
  content: React.ReactNode
  id: string
  title: string
}

export type LegalDocumentProps = {
  articles: readonly LegalArticle[]
  description?: string
  effectiveDate?: string
  title: string
}

export function OperatorNote({
  children,
  item,
  message,
}: {
  children?: React.ReactNode
  item?: string
  message?: string
}) {
  const noteContent = item ?? message ?? children
  return (
    <aside aria-label="운영자 확정 필요" className={styles.operatorNote} role="note">
      <span className={styles.operatorNoteTag}>[운영자 확정 필요: {noteContent}]</span>
    </aside>
  )
}

function formatArticleHeading(article: LegalArticle, index: number) {
  const numberStr =
    typeof article.articleNumber === 'number'
      ? `제${article.articleNumber}조`
      : typeof article.articleNumber === 'string'
        ? article.articleNumber
        : `제${index + 1}조`

  return `${numberStr} (${article.title})`
}

export function LegalDocument({
  articles,
  description,
  effectiveDate = '확정 전',
  title,
}: LegalDocumentProps) {
  return (
    <article className={`${styles.legalPage} ${styles.legalDocContainer}`}>
      <aside aria-label="초안 안내" className={styles.legalDraftBanner} role="status">
        <span className={styles.legalDraftBannerBadge}>초안</span>
        <span>
          초안 — 법률 검토 전: 실제 서비스 운영 및 결제 개시 전 전문 법무 검토와 운영자 확정이 필요합니다.
        </span>
      </aside>

      <p className={styles.kicker}>운영 정책 안내</p>
      <h1>{title}</h1>
      <p className={styles.legalEffectiveDate}>시행일: {effectiveDate}</p>
      {description ? <p className={styles.legalLead}>{description}</p> : null}

      {articles.length > 0 ? (
        <nav aria-label="목차" className={styles.legalToc}>
          <p className={styles.legalTocHeading}>목차</p>
          <ol className={styles.legalTocList}>
            {articles.map((article, index) => {
              const label = formatArticleHeading(article, index)
              return (
                <li key={article.id}>
                  <a href={`#${article.id}`}>{label}</a>
                </li>
              )
            })}
          </ol>
        </nav>
      ) : null}

      <div className={styles.legalSections}>
        {articles.map((article, index) => {
          const headingLabel = formatArticleHeading(article, index)
          return (
            <section className={styles.legalArticle} id={article.id} key={article.id}>
              <h2 className={styles.legalArticleHeading}>{headingLabel}</h2>
              <div className={styles.legalArticleBody}>
                {typeof article.content === 'string' ? <p>{article.content}</p> : article.content}
              </div>
            </section>
          )
        })}

        <section className={styles.legalContact}>
          <h2 className={styles.legalArticleHeading}>문의 경로</h2>
          <p>
            본 정책 또는 서비스 이용에 관한 문의는 공식 지원 이메일(
            <a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a>)로 접수해 주시기 바랍니다.
            요금 기준 및 플랜 정보는 <Link href="/pricing">요금 안내</Link>에서 확인하실 수 있습니다.
          </p>
        </section>
      </div>
    </article>
  )
}
