import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CreativeStudioCard } from '@/features/creative/creative-studio-card'
import type { VisualBrief } from '@/features/creative/visual-brief-types'
import type { MediaAsset } from '@/features/media/media-asset-types'
import type { VisualSemanticQCResult } from '@/features/creative/visual-semantic-qc'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'

// Mock next/image
vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} />,
}))

describe('CreativeStudioCard (ANI-1086, ANI-1107)', () => {
  const dummyBrief: VisualBrief = {
    briefVersion: 'v10.0',
    workspaceId: 'ws-bakery',
    contentVersionId: 'ver-1',
    businessContext: {
      name: '달콤 베이커리',
      industry: 'bakery',
      keywords: ['수제 디저트', '타르트', '베이커리'],
      targetAudience: '디저트 애호가',
    },
    productContext: {
      name: '단호박 타르트',
      description: '가을 단호박을 듬뿍 넣은 수제 크림 타르트',
      ingredientsOrMaterials: ['단호박', '타르트지', '생크림'],
      sellingPoints: ['단호박 크림', '수제 타르트 시트'],
    },
    channelSpec: {
      channel: 'instagram',
      aspectRatio: '1:1',
    },
    creativeDirection: {
      heroSubject: '바삭한 타르트 시트 위에 올려진 노란 단호박 크림 타르트',
      environment: '따뜻한 목재 베이커리 테이블 위',
      composition: '클로즈업 45도 앵글',
      lighting: '자연광',
      colorPalette: ['#FFA500', '#8B4513'],
      stylePreset: 'artisan_craft',
    },
    negativeConstraints: {
      forbiddenTokens: ['헤어살롱', '미용실'],
      textRendering: 'NO_TEXT_IN_IMAGE',
      prohibitedDomains: ['beauty'],
    },
    captionSummary: '가을을 담은 달콤한 단호박 타르트가 완성되었습니다.',
    promptText: 'A close-up shot of pumpkin tart on wooden table',
    promptDigest: 'p'.repeat(64),
    createdAt: new Date().toISOString(),
  }

  const dummyAsset: MediaAsset = {
    id: 'asset-tart-01',
    workspace_id: 'ws-bakery',
    bucket_id: 'content-media',
    object_path: 'ws-bakery/tart.png',
    kind: 'content',
    source_type: 'GENERATED_OPENAI',
    mime_type: 'image/png',
    size_bytes: 1500000,
    width: 1024,
    height: 1024,
    sha256_digest: 'a'.repeat(64),
    rights_status: 'confirmed',
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: {},
    created_by: 'user-1',
    created_at: new Date().toISOString(),
  }

  const passQC: VisualSemanticQCResult = {
    decision: 'PASS',
    score: 0.95,
    passed: true,
    reasons: ['영역 일치'],
    violations: [],
    evidence: {
      captionKeywords: ['단호박', '타르트'],
      briefHeroSubject: '단호박 크림 타르트',
      mediaProvenance: 'GENERATED_OPENAI',
      mediaSha256: 'a'.repeat(64),
      checkedRules: ['DOMAIN_CONSISTENCY'],
    },
    evaluatedAt: new Date().toISOString(),
  }

  const failQC: VisualSemanticQCResult = {
    decision: 'FAIL',
    score: 0.15,
    passed: false,
    reasons: ['PROHIBITED_ELEMENT_DETECTED: salon', 'SUBJECT_MISMATCH'],
    violations: ['미용실 관련 요소 감지'],
    evidence: {
      captionKeywords: ['단호박', '타르트'],
      briefHeroSubject: '단호박 크림 타르트',
      mediaProvenance: 'GENERATED_OPENAI',
      mediaSha256: 'a'.repeat(64),
      checkedRules: ['DOMAIN_CONSISTENCY'],
    },
    evaluatedAt: new Date().toISOString(),
  }

  it('renders Visual Brief and real media asset preview', () => {
    render(
      <CreativeStudioCard
        brief={dummyBrief}
        mediaAsset={dummyAsset}
        qcResult={passQC}
      />
    )

    expect(screen.getByText(/단호박 타르트가 완성되었습니다/)).toBeDefined()
    expect(screen.getByText(/OpenAI gpt-image-2/)).toBeDefined()
    expect(screen.getByText(/시각 정합성 통과/)).toBeDefined()
  })

  it('strictly disables approval button when QC outcome is FAIL and shows alert', () => {
    render(
      <CreativeStudioCard
        brief={dummyBrief}
        mediaAsset={dummyAsset}
        qcResult={failQC}
      />
    )

    const approveButton = screen.getByRole('button', { name: /이 원고 \+ 이 이미지 승인/ })
    expect(approveButton).toBeDefined()
    expect(approveButton.getAttribute('disabled')).not.toBeNull()

    expect(screen.getByText(/이미지-원고 불일치 감지/)).toBeDefined()
  })

  it('strictly disables approval button when media asset is missing (no fake preview)', () => {
    render(
      <CreativeStudioCard
        brief={dummyBrief}
        mediaAsset={null}
        qcResult={passQC}
      />
    )

    const approveButton = screen.getByRole('button', { name: /이 원고 \+ 이 이미지 승인/ })
    expect(approveButton.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByText(/생성된 이미지가 없습니다/)).toBeDefined()
  })

  it('enables approval when QC PASS, rights confirmed, and media asset present', () => {
    const onApproveMock = vi.fn()
    render(
      <CreativeStudioCard
        brief={dummyBrief}
        mediaAsset={dummyAsset}
        qcResult={passQC}
        rightsConfirmed={true}
        onApprove={onApproveMock}
      />
    )

    const approveButton = screen.getByRole('button', { name: /이 원고 \+ 이 이미지 승인/ })
    expect(approveButton.getAttribute('disabled')).toBeNull()

    fireEvent.click(approveButton)
    expect(onApproveMock).toHaveBeenCalled()
  })

  it('triggers onRegenerateImage when regenerate button is clicked', () => {
    const onRegenerateMock = vi.fn()
    render(
      <CreativeStudioCard
        brief={dummyBrief}
        mediaAsset={dummyAsset}
        qcResult={passQC}
        onRegenerateImage={onRegenerateMock}
      />
    )

    const regenButton = screen.getByRole('button', { name: /이미지 다시 생성/ })
    fireEvent.click(regenButton)
    expect(onRegenerateMock).toHaveBeenCalled()
  })

  it('shows publish button when bundle is already approved', () => {
    const onPublishMock = vi.fn()
    const approvedBundle: CreativeBundle = {
      bundleId: 'b-1',
      workspaceId: 'ws-bakery',
      contentId: 'cnt-1',
      versionId: 'ver-1',
      channel: 'instagram',
      caption: '테스트',
      hashtags: [],
      orderedMedia: [],
      creativeBriefVersion: 'v10.0',
      bundleFingerprint: 'f'.repeat(64),
      approvalStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    render(
      <CreativeStudioCard
        bundle={approvedBundle}
        brief={dummyBrief}
        mediaAsset={dummyAsset}
        qcResult={passQC}
        onPublishNow={onPublishMock}
      />
    )

    const publishButton = screen.getByRole('button', { name: /지금 바로 채널에 게시/ })
    expect(publishButton).toBeDefined()
    fireEvent.click(publishButton)
    expect(onPublishMock).toHaveBeenCalled()
  })
})
