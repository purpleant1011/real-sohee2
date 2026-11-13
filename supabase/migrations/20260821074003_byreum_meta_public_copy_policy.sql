insert into public.harness_rules (
  workspace_id,
  rule_key,
  rule_type,
  title,
  description,
  structured_rule,
  applies_to_channels,
  status,
  version,
  source_knowledge_fact_ids,
  source_message_id,
  approved_by_user_id,
  approved_at,
  review_reason,
  created_by_user_id
)
select
  current_rule.workspace_id,
  current_rule.rule_key,
  current_rule.rule_type,
  replace(current_rule.title, 'V1.0', 'V1.1'),
  current_rule.description,
  current_rule.structured_rule || jsonb_build_object(
    'publicCopyPolicy', jsonb_build_object(
      'excludeInternalProductionCopy', true,
      'prohibitedFragments', jsonb_build_array(
        'AI를 활용해 제작한 이미지와 문안입니다.',
        'AI 제작',
        'AI 생성',
        'AI 초안',
        '게시 전 검토',
        '검토용 초안',
        '자동 게시'
      ),
      'systemManagedFields', jsonb_build_array('disclosure', 'generationEvidence')
    )
  ),
  current_rule.applies_to_channels,
  'active',
  2,
  current_rule.source_knowledge_fact_ids,
  current_rule.source_message_id,
  current_rule.approved_by_user_id,
  statement_timestamp(),
  '사용자 승인에 따라 내부 AI 제작 및 운영 문구를 공개 문안에서 제외함',
  current_rule.created_by_user_id
from public.harness_rules as current_rule
where current_rule.rule_key in ('byreum-instagram-text-v1', 'byreum-threads-text-v1')
  and current_rule.rule_type = 'text_generation'
  and current_rule.status = 'active'
  and current_rule.version = 1
on conflict (workspace_id, rule_key, version) do update set
  title = excluded.title,
  description = excluded.description,
  structured_rule = excluded.structured_rule,
  applies_to_channels = excluded.applies_to_channels,
  status = excluded.status,
  source_knowledge_fact_ids = excluded.source_knowledge_fact_ids,
  source_message_id = excluded.source_message_id,
  approved_by_user_id = excluded.approved_by_user_id,
  approved_at = excluded.approved_at,
  review_reason = excluded.review_reason,
  updated_at = statement_timestamp();

update public.harness_rules
set status = 'retired', updated_at = statement_timestamp()
where rule_key in ('byreum-instagram-text-v1', 'byreum-threads-text-v1')
  and rule_type = 'text_generation'
  and status = 'active'
  and version = 1;
