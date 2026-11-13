import { CHANNEL_CAPABILITIES } from './v085-content'
import styles from './v085-marketing.module.css'

export function ChannelCapabilityTable() {
  return <section aria-labelledby="channels-title" className={styles.channelsSection} id="channels"><header className={styles.sectionHeading}><p>연결 수준까지 구매 전에 확인합니다</p><h2 id="channels-title">채널 로고보다, 소희가 어디까지 일하는지가 중요합니다.</h2></header><div className={styles.channelTableWrap} role="region" aria-label="채널별 연결 수준 표" tabIndex={0}><table aria-label="채널별 연결 수준"><thead><tr><th scope="col">채널</th><th scope="col">고객 행동</th><th scope="col">소희가 준비하는 일</th><th scope="col">사장님이 마무리하는 일</th><th scope="col">현재 검증 상태</th></tr></thead><tbody>{CHANNEL_CAPABILITIES.map((channel) => <tr key={channel.id}><th scope="row">{channel.name}</th><td>{channel.customerAction}</td><td>{channel.soheeWork}</td><td>{channel.ownerFinish}</td><td><span>{channel.mode}</span></td></tr>)}</tbody></table></div></section>
}
