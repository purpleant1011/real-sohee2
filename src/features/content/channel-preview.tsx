import type { ChannelContent } from './channel-content-schema'

type NaverContent = Extract<ChannelContent, { channel: 'naver_blog' }>

function NaverPreview({ content }: Readonly<{ content: NaverContent }>) {
  if (content.editorBlocks) {
    return <article>
      <h2>{content.title}</h2>
      {content.editorBlocks.map((block, index) => {
        const key = `${block.kind}-${index}`
        if (block.kind === 'paragraph') return <p data-naver-block="paragraph" key={key}>{block.text}</p>
        if (block.kind === 'heading') return <h3 data-naver-block="heading" key={key}>{block.text}</h3>
        if (block.kind === 'quote') return <blockquote data-naver-block="quote" key={key}>{block.text}</blockquote>
        if (block.kind === 'image') return <figure data-naver-block="image" key={key}>
          <div aria-label={block.altText} role="img">이미지 {index + 1}</div>
          <figcaption>{block.altText}</figcaption>
        </figure>
        if (block.kind === 'link') return <a data-naver-block="link" href={block.url} key={key} rel="noreferrer" target="_blank">{block.title}</a>
        if (block.kind === 'map') return <div data-naver-block="map" key={key}>📍 {block.placeName}</div>
        return <p data-naver-block="cta" key={key}>{block.text}</p>
      })}
    </article>
  }
  return <article>
    <h2>{content.title}</h2>
    <p>{content.introduction}</p>
    {content.sections.map((section) => <section key={section.heading}><h3>{section.heading}</h3><p>{section.body}</p></section>)}
    <ol aria-label="블로그 이미지 위치">{content.imagePlacements.map((image, index) => <li aria-label={`이미지 ${index + 1}: ${image.altText}`} key={image.mediaId}>이미지 {index + 1}: {image.altText}</li>)}</ol>
    <p>{content.cta}</p>
  </article>
}

export function ChannelPreview({ content }: Readonly<{ content: ChannelContent }>) {
  switch (content.channel) {
    case 'naver_blog': return <NaverPreview content={content} />
    case 'daangn_business': return <article><h2>{content.title}</h2><p>{content.targetNeighborhood}</p><p>{content.body}</p><p>{content.localCta}</p></article>
    case 'naver_place': return <article><h2>{content.title}</h2><p>새소식</p><p>{content.body}</p><time>{content.validUntil}</time></article>
    case 'instagram': return <article><p>{content.caption}</p>{content.slides.map((slide) => <p key={slide.mediaId}>{slide.altText}</p>)}<p>{content.cta}</p></article>
    case 'threads': return <article>{content.segments.map((segment) => <p key={segment}>{segment}</p>)}<p>{content.question}</p></article>
  }
}
