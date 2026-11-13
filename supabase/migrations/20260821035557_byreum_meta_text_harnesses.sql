do $$
declare
  target_workspace_id uuid;
  actor_user_id uuid;
  source_id uuid;
  candidate_id uuid;
  fact_id uuid;
  approved_time timestamptz := statement_timestamp();
begin
  select member.workspace_id, member.user_id
  into target_workspace_id, actor_user_id
  from public.workspace_members as member
  join auth.users as account on account.id = member.user_id
  where lower(account.email) = 'test@example.com'
    and member.status = 'active'
    and member.role in ('owner', 'manager')
  order by case member.role when 'owner' then 0 else 1 end, member.created_at
  limit 1;

  if target_workspace_id is null or actor_user_id is null then
    return;
  end if;

  select source.id into source_id
  from public.knowledge_sources as source
  where source.workspace_id = target_workspace_id
    and source.display_name = '바이름 Instagram·Threads 텍스트 하네스 V1.0 사용자 승인'
  order by source.created_at
  limit 1;

  if source_id is null then
    insert into public.knowledge_sources (
      workspace_id, source_type, provider_mode, display_name, status,
      refresh_policy, version, created_by_user_id
    ) values (
      target_workspace_id, 'manual', 'registered_only',
      '바이름 Instagram·Threads 텍스트 하네스 V1.0 사용자 승인',
      'approved',
      jsonb_build_object('immutableVersion', '1.0.0', 'sourceDate', '2026-08-21'),
      1, actor_user_id
    ) returning id into source_id;
  end if;

  select candidate.id into candidate_id
  from public.knowledge_candidates as candidate
  where candidate.workspace_id = target_workspace_id
    and candidate.knowledge_source_id = source_id
    and candidate.category = 'byreum_meta_text_harness'
  order by candidate.created_at
  limit 1;

  if candidate_id is null then
    insert into public.knowledge_candidates (
      workspace_id, knowledge_source_id, category, content, source_location,
      confidence, status, version, review_reason, reviewed_by_user_id,
      reviewed_at, created_by_user_id
    ) values (
      target_workspace_id, source_id, 'byreum_meta_text_harness',
      '바이름은 계약된 운영 대상 브랜드이며, 눈썹 문신과 눈썹 반영구 상담 주제로 Instagram과 Threads 홍보 콘텐츠를 제작한다. 인천 청라 및 인근 생활권, 얼굴형·눈매·골격·표정·기존 눈썹 결·평소 메이크업을 고려한 상담 기준을 사용한다. 가격, 경력, 자격, 통증, 유지 기간, 결과 보장, 후기를 확인 없이 단정하지 않는다.',
      '사용자가 2026-08-21에 바이름 Instagram·Threads 실제 게시 콘텐츠 생성과 최종 게시를 승인함',
      1, 'approved', 1,
      '바이름 Instagram 2건과 Threads 2건의 실제 게시를 위한 채널별 텍스트 하네스 승인',
      actor_user_id, approved_time, actor_user_id
    ) returning id into candidate_id;
  end if;

  select fact.id into fact_id
  from public.knowledge_facts as fact
  where fact.workspace_id = target_workspace_id
    and fact.source_candidate_id = candidate_id
    and fact.status = 'active'
  order by fact.created_at
  limit 1;

  if fact_id is null then
    insert into public.knowledge_facts (
      workspace_id, category, content, status, source_candidate_id,
      approved_by_user_id, approved_at, valid_from
    )
    select candidate.workspace_id, candidate.category, candidate.content,
      'active', candidate.id, actor_user_id, approved_time, approved_time
    from public.knowledge_candidates as candidate
    where candidate.workspace_id = target_workspace_id and candidate.id = candidate_id
    returning id into fact_id;
  end if;

  insert into public.harness_rules (
    workspace_id, rule_key, rule_type, title, description, structured_rule,
    applies_to_channels, status, version, source_knowledge_fact_ids,
    approved_by_user_id, approved_at, review_reason, created_by_user_id
  ) values (
    target_workspace_id, 'byreum-instagram-text-v1', 'text_generation',
    '바이름 Instagram 텍스트 하네스 V1.0',
    '바이름 눈썹 문신과 눈썹 반영구 상담을 위한 Instagram 원본 홍보 문안 생성 규칙',
    jsonb_build_object(
      'brandName', '바이름',
      'serviceCategory', '눈썹 문신과 눈썹 반영구 상담',
      'primaryLocation', '인천 청라 및 인근 생활권',
      'purpose', '시각적인 상담 기준과 고객 질문을 보여주고 부담 없는 문의로 이어진다.',
      'tone', '차분하고 정확하며 결정을 재촉하지 않는다.',
      'consultationCriteria', jsonb_build_array('얼굴형', '눈매', '골격', '표정', '기존 눈썹 결', '평소 메이크업'),
      'structure', jsonb_build_array('고객의 일상 고민', '상담에서 확인할 기준', '개인차 안내', '부담 없는 문의'),
      'prohibitedClaims', jsonb_build_array('결과 보장', '통증 단정', '유지 기간 단정', '확인되지 않은 가격·경력·자격·후기'),
      'sourceUrls', jsonb_build_array('https://blog.naver.com/larlds', 'https://naver.me/5xgJJEBa')
    ),
    array['instagram']::text[], 'active', 1, array[fact_id]::uuid[],
    actor_user_id, approved_time,
    '사용자가 Instagram 2건의 생성과 실제 게시를 승인함', actor_user_id
  ) on conflict (workspace_id, rule_key, version) do update set
    title = excluded.title,
    description = excluded.description,
    structured_rule = excluded.structured_rule,
    applies_to_channels = excluded.applies_to_channels,
    status = excluded.status,
    source_knowledge_fact_ids = excluded.source_knowledge_fact_ids,
    approved_by_user_id = excluded.approved_by_user_id,
    approved_at = excluded.approved_at,
    review_reason = excluded.review_reason,
    updated_at = statement_timestamp();

  insert into public.harness_rules (
    workspace_id, rule_key, rule_type, title, description, structured_rule,
    applies_to_channels, status, version, source_knowledge_fact_ids,
    approved_by_user_id, approved_at, review_reason, created_by_user_id
  ) values (
    target_workspace_id, 'byreum-threads-text-v1', 'text_generation',
    '바이름 Threads 텍스트 하네스 V1.0',
    '바이름 눈썹 상담 기준과 고객 질문을 대화형으로 풀어내는 Threads 원본 문안 생성 규칙',
    jsonb_build_object(
      'brandName', '바이름',
      'serviceCategory', '눈썹 문신과 눈썹 반영구 상담',
      'primaryLocation', '인천 청라 및 인근 생활권',
      'purpose', '원장 관점의 관찰과 고객이 자주 묻는 질문을 짧고 진솔하게 풀어낸다.',
      'tone', '짧고 대화체로 쓰되 과장하거나 시술 결과를 단정하지 않는다.',
      'consultationCriteria', jsonb_build_array('얼굴형', '눈매', '표정', '기존 눈썹 결', '평소 메이크업'),
      'structure', jsonb_build_array('한 문장 관찰', '짧은 이유', '고객에게 던지는 질문', '부담 없는 상담 안내'),
      'prohibitedClaims', jsonb_build_array('결과 보장', '통증 단정', '유지 기간 단정', '확인되지 않은 가격·경력·자격·후기'),
      'sourceUrls', jsonb_build_array('https://blog.naver.com/larlds', 'https://naver.me/5xgJJEBa')
    ),
    array['threads']::text[], 'active', 1, array[fact_id]::uuid[],
    actor_user_id, approved_time,
    '사용자가 Threads 2건의 생성과 실제 게시를 승인함', actor_user_id
  ) on conflict (workspace_id, rule_key, version) do update set
    title = excluded.title,
    description = excluded.description,
    structured_rule = excluded.structured_rule,
    applies_to_channels = excluded.applies_to_channels,
    status = excluded.status,
    source_knowledge_fact_ids = excluded.source_knowledge_fact_ids,
    approved_by_user_id = excluded.approved_by_user_id,
    approved_at = excluded.approved_at,
    review_reason = excluded.review_reason,
    updated_at = statement_timestamp();
end
$$;
