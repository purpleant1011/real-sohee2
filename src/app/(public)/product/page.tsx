import Image from 'next/image'
import { ProductStory } from '@/features/marketing/product-story'
import { MARKETING_ASSETS } from '@/features/marketing/v085-assets'
import styles from '@/features/marketing/v085-marketing.module.css'

export default function ProductPage() {
  const asset = MARKETING_ASSETS.organizedDay
  return <div className={styles.detailPage}><section className={styles.detailHero}><div><p>소희 V0.9 제품</p><h1>고객 반응에서 다음 성장 행동까지.</h1><span>소희는 게시물을 만드는 도구가 아니라, 여러 채널의 고객 신호를 오늘의 일로 바꾸고 결과를 다음 실험으로 돌려주는 운영실입니다.</span></div><Image alt={asset.alt} height={asset.height} sizes="(max-width: 760px) 100vw, 52vw" src={asset.src} width={asset.width} /></section><section className={styles.flowStatement}><div><strong>신호 포착</strong><span>놓치면 안 되는 고객과 변화를 찾습니다.</span></div><i aria-hidden="true">→</i><div><strong>대응과 행동</strong><span>답변, 상담, 콘텐츠와 승인을 준비합니다.</span></div><i aria-hidden="true">→</i><div><strong>예약과 재방문</strong><span>실제 결과와 다음 관계를 확인합니다.</span></div></section><ProductStory /></div>
}
