-- 로컬 V0.7 개발에서만 사용하는 비식별 연결형 예시입니다.
-- 운영 계정, 실제 고객 식별자, 공급자 비밀, 외부 전송 결과는 포함하지 않습니다.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000701',
  'authenticated',
  'authenticated',
  'stage1-seed@sohee.test.invalid',
  null,
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name)
values (
  '10000000-0000-4000-8000-000000000701',
  '소희 V0.7 로컬 예시'
);

insert into public.workspaces (id, name, timezone, created_by)
values (
  '20000000-0000-4000-8000-000000000701',
  '소희 V0.7 예시 작업공간',
  'Asia/Seoul',
  '10000000-0000-4000-8000-000000000701'
);

insert into public.conversation_threads (
  id, workspace_id, kind, title, status, last_message_at
)
values (
  '30000000-0000-4000-8000-000000000701',
  '20000000-0000-4000-8000-000000000701',
  'operations',
  '기본 운영 대화',
  'active',
  '2026-08-10T00:01:00Z'
);

insert into public.messages (
  id, workspace_id, thread_id, role, content, status, client_message_id,
  created_by_user_id, created_at, completed_at
)
values
  (
    '40000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    '30000000-0000-4000-8000-000000000701',
    'user',
    '이번 주 콘텐츠 준비 업무를 정리해 줘.',
    'completed',
    '41000000-0000-4000-8000-000000000701',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:00:00Z',
    '2026-08-10T00:00:01Z'
  ),
  (
    '40000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    '30000000-0000-4000-8000-000000000701',
    'sohee',
    '콘텐츠 업무를 만들었어요. 초안은 검토와 승인 뒤에만 예약할 수 있어요.',
    'completed',
    null,
    null,
    '2026-08-10T00:01:00Z',
    '2026-08-10T00:01:01Z'
  );

insert into public.work_items (
  id, workspace_id, type, title, summary, status, priority, owner_type,
  source_thread_id, source_message_id, created_by, created_at, updated_at
)
values (
  '50000000-0000-4000-8000-000000000701',
  '20000000-0000-4000-8000-000000000701',
  'content',
  '이번 주 콘텐츠 준비',
  '기본 운영 대화에서 생성된 검토 전 콘텐츠 업무입니다.',
  'drafting',
  'normal',
  'shared',
  '30000000-0000-4000-8000-000000000701',
  '40000000-0000-4000-8000-000000000701',
  '10000000-0000-4000-8000-000000000701',
  '2026-08-10T00:01:00Z',
  '2026-08-10T00:01:00Z'
);

update public.messages
set work_item_id = '50000000-0000-4000-8000-000000000701'
where workspace_id = '20000000-0000-4000-8000-000000000701'
  and id = '40000000-0000-4000-8000-000000000702';

insert into public.message_evidence (
  id, workspace_id, message_id, evidence_type, evidence_id, label, excerpt,
  source_timestamp
)
values (
  '60000000-0000-4000-8000-000000000701',
  '20000000-0000-4000-8000-000000000701',
  '40000000-0000-4000-8000-000000000702',
  'work_item',
  '50000000-0000-4000-8000-000000000701',
  '생성된 콘텐츠 업무',
  '이번 주 콘텐츠 준비',
  '2026-08-10T00:01:00Z'
);

insert into public.knowledge_sources (
  id, workspace_id, source_type, provider_mode, display_name, status,
  created_by_user_id, created_at, updated_at
)
values (
  '70000000-0000-4000-8000-000000000701',
  '20000000-0000-4000-8000-000000000701',
  'manual',
  'registered_only',
  'V0.7 운영 정책 예시',
  'approved',
  '10000000-0000-4000-8000-000000000701',
  '2026-08-10T00:02:00Z',
  '2026-08-10T00:02:00Z'
);

insert into public.knowledge_candidates (
  id, workspace_id, knowledge_source_id, category, content, confidence, status,
  conflicts_with_fact_id, version, review_reason, reviewed_by_user_id,
  reviewed_at, created_by_user_id, created_at, updated_at
)
values
  (
    '71000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    '70000000-0000-4000-8000-000000000701',
    'approval_policy',
    '게시 전에는 사용자의 최종 확인이 필요하다.',
    0.99,
    'approved',
    null,
    2,
    'V0.7 승인 경계 예시',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:03:00Z',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:02:10Z',
    '2026-08-10T00:03:00Z'
  ),
  (
    '71000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    '70000000-0000-4000-8000-000000000701',
    'knowledge_policy',
    '승인된 활성 지식만 모델 문맥에 포함한다.',
    0.98,
    'approved',
    null,
    2,
    'V0.7 지식 경계 예시',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:03:10Z',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:02:20Z',
    '2026-08-10T00:03:10Z'
  ),
  (
    '71000000-0000-4000-8000-000000000703',
    '20000000-0000-4000-8000-000000000701',
    '70000000-0000-4000-8000-000000000701',
    'customer_policy',
    '고객 원본 식별자와 원문은 일반 운영 문맥에 저장하지 않는다.',
    0.97,
    'approved',
    null,
    2,
    'V0.7 고객 정보 경계 예시',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:03:20Z',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:02:30Z',
    '2026-08-10T00:03:20Z'
  );

insert into public.knowledge_facts (
  id, workspace_id, category, content, status, source_candidate_id,
  approved_by_user_id, approved_at, valid_from, created_at
)
values
  (
    '72000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    'approval_policy',
    '게시 전에는 사용자의 최종 확인이 필요하다.',
    'active',
    '71000000-0000-4000-8000-000000000701',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:03:00Z',
    '2026-08-10T00:03:00Z',
    '2026-08-10T00:03:00Z'
  ),
  (
    '72000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    'knowledge_policy',
    '승인된 활성 지식만 모델 문맥에 포함한다.',
    'active',
    '71000000-0000-4000-8000-000000000702',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:03:10Z',
    '2026-08-10T00:03:10Z',
    '2026-08-10T00:03:10Z'
  ),
  (
    '72000000-0000-4000-8000-000000000703',
    '20000000-0000-4000-8000-000000000701',
    'customer_policy',
    '고객 원본 식별자와 원문은 일반 운영 문맥에 저장하지 않는다.',
    'active',
    '71000000-0000-4000-8000-000000000703',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:03:20Z',
    '2026-08-10T00:03:20Z',
    '2026-08-10T00:03:20Z'
  );

insert into public.knowledge_candidates (
  id, workspace_id, knowledge_source_id, category, content, confidence, status,
  conflicts_with_fact_id, created_by_user_id, created_at, updated_at
)
values (
  '71000000-0000-4000-8000-000000000704',
  '20000000-0000-4000-8000-000000000701',
  '70000000-0000-4000-8000-000000000701',
  'approval_policy',
  '모든 게시를 자동으로 실행할 수 있다.',
  0.54,
  'conflict',
  '72000000-0000-4000-8000-000000000701',
  '10000000-0000-4000-8000-000000000701',
  '2026-08-10T00:04:00Z',
  '2026-08-10T00:04:00Z'
);

insert into public.harness_rules (
  id, workspace_id, rule_key, rule_type, title, description, structured_rule,
  applies_to_channels, status, version, source_message_id,
  source_knowledge_fact_ids, approved_by_user_id, approved_at, review_reason,
  created_by_user_id, created_at, updated_at
)
values
  (
    '80000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    'approval-before-publish-candidate',
    'approval_boundary',
    '게시 전 확인 후보',
    '후보 상태라서 아직 모델 문맥에는 포함되지 않습니다.',
    '{"action":"request_confirmation","appliesBefore":"publish"}'::jsonb,
    array['instagram', 'threads']::text[],
    'candidate',
    1,
    '40000000-0000-4000-8000-000000000701',
    array['72000000-0000-4000-8000-000000000701']::uuid[],
    null,
    null,
    null,
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:05:00Z',
    '2026-08-10T00:05:00Z'
  ),
  (
    '80000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    'approved-knowledge-only',
    'knowledge_boundary',
    '승인 지식만 사용',
    '승인된 활성 사실만 모델 문맥에 포함합니다.',
    '{"action":"use_active_facts_only"}'::jsonb,
    array['instagram', 'threads', 'naver_blog', 'naver_place']::text[],
    'active',
    2,
    '40000000-0000-4000-8000-000000000701',
    array[
      '72000000-0000-4000-8000-000000000701',
      '72000000-0000-4000-8000-000000000702',
      '72000000-0000-4000-8000-000000000703'
    ]::uuid[],
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:05:10Z',
    'V0.7 예시 활성 규칙',
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:05:00Z',
    '2026-08-10T00:05:10Z'
  );

insert into public.customer_conversations (
  id, workspace_id, channel, external_subject_reference_hash, display_label,
  status, intent, summary, latest_message_at, requires_human_review,
  created_by_user_id, created_at, updated_at
)
values
  (
    '90000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    'instagram',
    repeat('a', 64),
    '인스타그램 고객 예시 01',
    'needs_attention',
    'booking_inquiry',
    '다음 주 예약 가능 시간을 문의한 비식별 예시입니다.',
    '2026-08-10T00:06:00Z',
    true,
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:06:00Z',
    '2026-08-10T00:06:00Z'
  ),
  (
    '90000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    'naver_place',
    repeat('b', 64),
    '네이버 플레이스 고객 예시 02',
    'waiting_customer',
    'service_inquiry',
    '서비스 범위를 안내하고 고객의 추가 확인을 기다리는 예시입니다.',
    '2026-08-10T00:06:10Z',
    false,
    '10000000-0000-4000-8000-000000000701',
    '2026-08-10T00:06:10Z',
    '2026-08-10T00:06:10Z'
  );

insert into public.report_snapshots (
  id, workspace_id, period_start, period_end, status, metrics, source_ready,
  checked_at, created_at
)
values (
  '91000000-0000-4000-8000-000000000701',
  '20000000-0000-4000-8000-000000000701',
  '2026-08-03',
  '2026-08-09',
  'insufficient',
  '{"sourceType":"mock","prototype":true,"summary":"외부 채널과 연결되지 않은 예시입니다."}'::jsonb,
  false,
  '2026-08-10T00:07:00Z',
  '2026-08-10T00:07:00Z'
);

insert into public.operation_events (
  id, workspace_id, event_type, event_key, subject_type, subject_id, payload,
  occurred_at
)
values
  (
    '92000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    'content.plan.created',
    'seed:work-item:50000000-0000-4000-8000-000000000701:planned',
    'work_item',
    '50000000-0000-4000-8000-000000000701',
    '{"workItemId":"50000000-0000-4000-8000-000000000701"}'::jsonb,
    '2026-08-10T00:01:00Z'
  ),
  (
    '92000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    'knowledge.conflict.detected',
    'seed:knowledge-candidate:71000000-0000-4000-8000-000000000704:conflict',
    'knowledge_candidate',
    '71000000-0000-4000-8000-000000000704',
    '{"candidateId":"71000000-0000-4000-8000-000000000704","conflictingFactId":"72000000-0000-4000-8000-000000000701"}'::jsonb,
    '2026-08-10T00:04:00Z'
  );
