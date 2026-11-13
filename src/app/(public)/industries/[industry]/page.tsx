import Image from 'next/image'
import { notFound } from 'next/navigation'
import { MARKETING_ASSETS } from '@/features/marketing/v085-assets'
import { INDUSTRIES, type IndustrySlug } from '@/features/marketing/v085-content'
import styles from '@/features/marketing/v085-marketing.module.css'

const assetByIndustry = { beauty: MARKETING_ASSETS.beauty, food: MARKETING_ASSETS.food, education: MARKETING_ASSETS.education, 'local-service': MARKETING_ASSETS.localService } as const
export function generateStaticParams() { return INDUSTRIES.map((industry) => ({ industry: industry.slug })) }

export default async function IndustryPage({ params }: Readonly<{ params: Promise<{ industry: string }> }>) {
  const { industry } = await params
  const selected = INDUSTRIES.find((item) => item.slug === industry)
  if (!selected) notFound()
  const asset = assetByIndustry[selected.slug as IndustrySlug]
  return <div className={styles.detailPage}><section className={styles.detailHero}><div><p>{selected.label} 업종</p><h1>{selected.headline}</h1><span>{selected.customerQuestion}</span><dl className={styles.industryDetail}><div><dt>놓치기 쉬운 순간</dt><dd>{selected.missedAction}</dd></div><div><dt>소희가 준비하는 일</dt><dd>{selected.soheeAction}</dd></div><div><dt>이어지는 결과</dt><dd>{selected.outcome}</dd></div></dl></div><Image alt={asset.alt} height={asset.height} sizes="(max-width: 760px) 100vw, 52vw" src={asset.src} width={asset.width} /></section></div>
}
