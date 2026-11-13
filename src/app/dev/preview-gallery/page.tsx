import { notFound } from 'next/navigation'
import { ChannelPreview } from '@/features/preview/channel-preview'

const samples = [
  { id: 'normal', title: '대표 게시물', caption: '오늘 전하는 새 소식입니다. #동네', images: ['/images/marketing/v085/industry-food-v1.png', '/images/marketing/v085/industry-education-v1.png'] },
  { id: 'korean', title: '2,200자 한글', caption: '가'.repeat(2200), images: ['/images/marketing/v085/industry-food-v1.png'] },
  { id: 'emoji', title: '이모지만', caption: '😀'.repeat(126), images: [] },
  { id: 'no-image', title: '이미지 없음', caption: '사진이 없는 경우에도 예상 화면을 확인할 수 있어요.', images: [] },
  { id: 'url', title: '긴 URL', caption: `https://example.test/${'a'.repeat(700)}`, images: [] },
] as const

/** Static fixtures only: no auth, user data, remote images, or Supabase calls. */
export default function PreviewGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main className="mx-auto w-full min-w-0 max-w-7xl space-y-10 overflow-x-clip px-3 py-8 text-foreground sm:px-6">
    <h1 className="text-2xl font-bold">채널별 예상 화면 점검</h1>
    {samples.map((sample) => <section key={sample.id} aria-label={sample.title} className="min-w-0 space-y-4">
      <h2 className="text-lg font-semibold">{sample.title}</h2>
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ChannelPreview channel="instagram" contextLabel={sample.title} variant={{ handle: '@서비스', caption: sample.caption, hashtags: ['소식', '동네'], imageUrls: sample.images }} />
        <ChannelPreview channel="threads" contextLabel={sample.title} variant={{ handle: '@서비스', caption: sample.caption, hashtags: ['소식'], imageUrl: sample.images[0] }} />
        <ChannelPreview channel="naver_blog" contextLabel={sample.title} />
        <ChannelPreview channel="daangn_business" contextLabel={sample.title} />
      </div>
    </section>)}
  </main>
}
