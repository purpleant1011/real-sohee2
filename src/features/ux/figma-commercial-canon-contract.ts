/**
 * Figma Commercial Employee UX Canon Contract (ANI-1267)
 *
 * Establishes the 10 canonical frames of the V0.91 Commercial Employee UX.
 * Provides compliance validators ensuring that UI views conform strictly
 * to the Figma Canon specifications.
 */

export type FigmaCanonFrameId =
  | 'FRAME_01_TODAY_30SEC'
  | 'FRAME_02_PERSISTENT_DOCK'
  | 'FRAME_03_5SEC_APPROVAL'
  | 'FRAME_04_CONTENT_PIPELINE'
  | 'FRAME_05_CUSTOMER_QUEUES'
  | 'FRAME_06_RESULTS_STORYLINE'
  | 'FRAME_07_MY_SOHEE'
  | 'FRAME_08_FIRST_15MIN_ONBOARDING'
  | 'FRAME_09_MOBILE_375_SHELL'
  | 'FRAME_10_EMPTY_ERROR_STALE';

export interface FigmaCanonFrameSpec {
  frameId: FigmaCanonFrameId;
  frameTitle: string;
  targetSurface: 'OWNER_WEB' | 'OWNER_MOBILE' | 'ALL_SURFACES';
  essentialElements: string[];
  forbiddenElements: string[];
  responsiveBreakpoints: number[];
}

export const FIGMA_CANON_FRAMES: Record<FigmaCanonFrameId, FigmaCanonFrameSpec> = {
  FRAME_01_TODAY_30SEC: {
    frameId: 'FRAME_01_TODAY_30SEC',
    frameTitle: 'Home 30-Second Command Center',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'core_daily_goal',
      'sohee_current_work',
      'decisions_to_make',
      'customer_booking_changes',
      'recent_verified_outcomes',
      'next_action_proposals',
    ],
    forbiddenElements: ['trace_id', 'provider_receipt', 'raw_json', 'fabricated_zero'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_02_PERSISTENT_DOCK: {
    frameId: 'FRAME_02_PERSISTENT_DOCK',
    frameTitle: 'Persistent Sohee Work Console',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'agent_mode_selector',
      'current_working_badge',
      'active_card_summary',
      'chat_and_command_bar',
    ],
    forbiddenElements: ['disconnected_chat', 'stateless_bot'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_03_5SEC_APPROVAL: {
    frameId: 'FRAME_03_5SEC_APPROVAL',
    frameTitle: '5-Second Decision Card',
    targetSurface: 'ALL_SURFACES',
    essentialElements: ['what_preview', 'where_channel', 'when_timing', 'cost_notice', 'reversibility', 'why_goal'],
    forbiddenElements: ['optimistic_only_button', 'missing_fingerprint'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_04_CONTENT_PIPELINE: {
    frameId: 'FRAME_04_CONTENT_PIPELINE',
    frameTitle: 'Content Work Pipeline',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'seven_stage_lane_tracker',
      'mission_context_card',
      'channel_variant_tabs',
      'verified_receipt_link',
    ],
    forbiddenElements: ['unlinked_file_dump', 'stale_version_hiding'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_05_CUSTOMER_QUEUES: {
    frameId: 'FRAME_05_CUSTOMER_QUEUES',
    frameTitle: 'Customer 4 Work Queues',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'now_reply_queue',
      'high_probability_booking_queue',
      'confirmed_booking_queue',
      'human_review_queue',
      'customer_360_detail',
    ],
    forbiddenElements: ['unmasked_pii_export', 'flat_crm_dump'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_06_RESULTS_STORYLINE: {
    frameId: 'FRAME_06_RESULTS_STORYLINE',
    frameTitle: 'Results Storyline & Evidence Confidence',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'five_step_causal_storyline',
      'evidence_confidence_tier_badge',
      'source_chain_drilldown',
      'next_best_action_link',
    ],
    forbiddenElements: ['vanity_only_chart', 'fabricated_zero'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_07_MY_SOHEE: {
    frameId: 'FRAME_07_MY_SOHEE',
    frameTitle: 'My Sohee Employee Education Center',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'store_knowledge_section',
      'operating_rules_section',
      'four_tier_delegation_envelope',
      'channel_connections',
      'learned_fact_status',
    ],
    forbiddenElements: ['opaque_blackbox_settings'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_08_FIRST_15MIN_ONBOARDING: {
    frameId: 'FRAME_08_FIRST_15MIN_ONBOARDING',
    frameTitle: 'First 15-Minute Value Onboarding',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'seven_stage_progress_indicator',
      'business_profile_quick_review',
      'first_safe_mission_picker',
      'quick_5sec_approval_preview',
    ],
    forbiddenElements: ['infinite_config_forms', 'technical_setup_paralysis'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
  FRAME_09_MOBILE_375_SHELL: {
    frameId: 'FRAME_09_MOBILE_375_SHELL',
    frameTitle: 'Mobile 375 Shell & Responsive Dock',
    targetSurface: 'OWNER_MOBILE',
    essentialElements: [
      'bottom_five_axis_nav',
      'sticky_decision_banner',
      'bottom_sheet_agent_console',
      'touch_target_44px_minimum',
    ],
    forbiddenElements: ['horizontal_overflow', 'hidden_primary_cta'],
    responsiveBreakpoints: [375],
  },
  FRAME_10_EMPTY_ERROR_STALE: {
    frameId: 'FRAME_10_EMPTY_ERROR_STALE',
    frameTitle: 'Error, Empty & Stale States',
    targetSurface: 'ALL_SURFACES',
    essentialElements: [
      'business_friendly_error_copy',
      'sohee_action_taken_explanation',
      'owner_action_required_guide',
      'not_observed_indicator',
    ],
    forbiddenElements: ['stack_trace_leak', 'fake_sample_fillers'],
    responsiveBreakpoints: [1440, 1024, 768, 375],
  },
};

export class FigmaCanonContractValidator {
  /**
   * 주어진 UI 요소 셋이 Figma Canon 프레임 규격을 충족하는지 검증
   */
  validateFrameCompliance(
    frameId: FigmaCanonFrameId,
    renderedElementKeys: string[]
  ): { isCompliant: boolean; missingElements: string[]; forbiddenDetected: string[] } {
    const spec = FIGMA_CANON_FRAMES[frameId];
    if (!spec) {
      throw new Error(`존재하지 않는 Figma Canon 프레임 ID입니다: ${frameId}`);
    }

    const renderedSet = new Set(renderedElementKeys);
    const missingElements = spec.essentialElements.filter((elem) => !renderedSet.has(elem));
    const forbiddenDetected = spec.forbiddenElements.filter((elem) => renderedSet.has(elem));

    return {
      isCompliant: missingElements.length === 0 && forbiddenDetected.length === 0,
      missingElements,
      forbiddenDetected,
    };
  }
}
