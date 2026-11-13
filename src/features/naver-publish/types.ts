export const NAVER_VISIBILITIES = ['public', 'neighbor', 'mutual_neighbor', 'private'] as const
export type NaverVisibility = (typeof NAVER_VISIBILITIES)[number]

export const NAVER_VISIBILITY_LABELS: Readonly<Record<NaverVisibility, string>> = {
  public: '전체공개',
  neighbor: '이웃공개',
  mutual_neighbor: '서로이웃공개',
  private: '비공개',
}

export interface NaverCategory {
  id: string
  name: string
  /** Naver blogs have two category levels; null means a top-level category. */
  parentId: string | null
}

export type NaverEditorBlock =
  | { kind: 'heading' | 'paragraph' | 'quote' | 'cta'; text: string }
  | { kind: 'image'; mediaId: string; altText: string }
  | { kind: 'link'; url: string; title: string }

export type NaverPackageBlock =
  | { kind: 'heading' | 'paragraph' | 'quote' | 'cta'; text: string }
  | { kind: 'image'; mediaId: string; url: string; altText: string }
  | { kind: 'link'; url: string; title: string }

export interface NaverPublishPackage {
  version: 1
  blogId: string
  title: string
  blocks: NaverPackageBlock[]
  tags: string[]
  category: NaverCategory
  visibility: NaverVisibility
  /** sha256 over the canonical package body. The extension executes only a package whose digest it can recompute. */
  digest: string
}

export type NaverPublishState =
  | 'QUEUED'
  | 'AWAITING_LOGIN'
  | 'RUNNING'
  | 'HANDOFF_REQUIRED'
  | 'PUBLISHED_REPORTED'
  | 'VERIFIED'
  | 'MISMATCH'
  | 'UNKNOWN'
  | 'FAILED'
