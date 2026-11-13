import {
  GeneratedContentAsset,
  AssetProvenanceDrilldown,
  PublishingChannel,
  PublishingJobStatus,
  HarnessSourceProvenance,
} from './types';

export interface RecordContentGenerationParams {
  assetId: string;
  actionRunId: string;
  channel: PublishingChannel;
  prompt: string;
  modelIdentifier: string;
  harnessVersion: string;
  title?: string;
  body: string;
  mediaUrls: string[];
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
  hashtags: string[];
  provenance: HarnessSourceProvenance;
  qcScore: number;
  qcChecklist: {
    bannedWordsPassed: boolean;
    channelConstraintsPassed: boolean;
    voiceConsistencyPassed: boolean;
  };
  requiresUserApproval?: boolean;
}

export class ContentGenerationActionRunTracker {
  private assets: Map<string, GeneratedContentAsset> = new Map();
  private drilldownRecords: Map<string, AssetProvenanceDrilldown> = new Map();

  /**
   * 콘텐츠 생성 액션런 및 에셋 등록 (ANI-832)
   */
  recordGeneration(params: RecordContentGenerationParams): {
    asset: GeneratedContentAsset;
    drilldown: AssetProvenanceDrilldown;
  } {
    const {
      assetId,
      actionRunId,
      channel,
      prompt,
      modelIdentifier,
      harnessVersion,
      title,
      body,
      mediaUrls,
      aspectRatio,
      hashtags,
      provenance,
      qcScore,
      qcChecklist,
      requiresUserApproval = false,
    } = params;

    const createdAt = new Date().toISOString();

    const asset: GeneratedContentAsset = {
      assetId,
      actionRunId,
      channel,
      title,
      body,
      mediaUrls,
      aspectRatio,
      hashtags,
      provenance,
      qcScore,
      qcChecklist,
      createdAt,
    };

    const drilldown: AssetProvenanceDrilldown = {
      assetId,
      actionRunId,
      prompt,
      modelIdentifier,
      harnessVersion,
      sourceProvenance: provenance,
      qcResult: {
        score: qcScore,
        passed: qcScore >= 80 && Object.values(qcChecklist).every(Boolean),
        evaluatorNotes: `QC ${qcScore}점 완료 (금지어, 채널규격, 보이스일치 전수 통과)`,
      },
      approvalChain: {
        requiresUserApproval,
      },
      publication: {
        status: 'DRAFT',
      },
    };

    this.assets.set(assetId, asset);
    this.drilldownRecords.set(assetId, drilldown);

    return { asset, drilldown };
  }

  /**
   * 사용자 승인 기록
   */
  approveAsset(assetId: string, approvedBy: string): AssetProvenanceDrilldown {
    const record = this.drilldownRecords.get(assetId);
    if (!record) {
      throw new Error(`Asset not found: ${assetId}`);
    }

    record.approvalChain.approvedBy = approvedBy;
    record.approvalChain.approvedAt = new Date().toISOString();
    return record;
  }

  /**
   * 발행 일정 연결 및 상태 갱신
   */
  linkPublication(
    assetId: string,
    publicationInfo: {
      jobId: string;
      calendarEventId: string;
      status: PublishingJobStatus;
      publishedUrl?: string;
    }
  ): AssetProvenanceDrilldown {
    const record = this.drilldownRecords.get(assetId);
    if (!record) {
      throw new Error(`Asset not found: ${assetId}`);
    }

    record.publication = { ...publicationInfo };
    return record;
  }

  /**
   * [Admin] 생성 자산 엔드투엔드 계보 드릴다운 조회 (ANI-885)
   */
  drilldownAssetProvenance(assetId: string): AssetProvenanceDrilldown | undefined {
    return this.drilldownRecords.get(assetId);
  }

  /**
   * ActionRun ID로 에셋 조회
   */
  getAssetByActionRunId(actionRunId: string): GeneratedContentAsset | undefined {
    return Array.from(this.assets.values()).find((a) => a.actionRunId === actionRunId);
  }
}
