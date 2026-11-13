import { ChannelCapabilityTable } from '@/features/marketing/channel-capability-table'
import styles from '@/features/marketing/v085-marketing.module.css'

export default function ChannelsPage() {
  return <div className={styles.detailPage}><header className={styles.detailIntro}><p>연결 채널</p><h1>자동화라는 한마디 대신, 실제 가능한 범위를 보여드립니다.</h1><span>공식 연결, 감독형 실행과 사용자 최종 게시를 구분해 구매 전에 어디까지 소희가 준비하는지 확인할 수 있습니다.</span></header><ChannelCapabilityTable /></div>
}
