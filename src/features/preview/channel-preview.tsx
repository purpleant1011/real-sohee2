import type { SpecEvaluationResult } from '@/features/vault/channel-spec'
import { channelPreviewAdapters, type ChannelPreviewVariant } from './channel-preview-adapters'
import { PreviewFrame } from './preview-frame'

/** New channels remain honest placeholders until a variant is supplied; with a variant the registered adapter renders. */
export type ChannelPreviewProps =
  | Readonly<{ channel: 'instagram'; variant: ChannelPreviewVariant<'instagram'>; specResult?: SpecEvaluationResult; contextLabel?: string }>
  | Readonly<{ channel: 'threads'; variant: ChannelPreviewVariant<'threads'>; specResult?: SpecEvaluationResult; contextLabel?: string }>
  | Readonly<{ channel: 'naver_blog'; variant?: ChannelPreviewVariant<'naver_blog'>; specResult?: SpecEvaluationResult; contextLabel?: string }>
  | Readonly<{ channel: 'daangn_business'; variant?: ChannelPreviewVariant<'daangn_business'>; specResult?: SpecEvaluationResult; contextLabel?: string }>

export function ChannelPreview(props: ChannelPreviewProps) {
  if (props.channel === 'instagram') {
    const slot = channelPreviewAdapters.instagram.render(props.variant)
    return <PreviewFrame channel="instagram" status={slot.status} specResult={props.specResult} contextLabel={props.contextLabel}>{slot.content}</PreviewFrame>
  }
  if (props.channel === 'threads') {
    const slot = channelPreviewAdapters.threads.render(props.variant)
    return <PreviewFrame channel="threads" status={slot.status} specResult={props.specResult} contextLabel={props.contextLabel}>{slot.content}</PreviewFrame>
  }
  // No fallback to another platform's layout or fabricated sample text/media.
  const slot = props.channel === 'naver_blog'
    ? channelPreviewAdapters.naver_blog.render(props.variant)
    : channelPreviewAdapters.daangn_business.render(props.variant)
  return <PreviewFrame channel={props.channel} status={slot.status} specResult={props.specResult} contextLabel={props.contextLabel}>{slot.content}</PreviewFrame>
}
