create index artifact_slides_batch_idx
  on public.artifact_slides (workspace_id, artifact_id, batch_id);

create index conversation_artifacts_work_item_idx
  on public.conversation_artifacts (workspace_id, work_item_id)
  where work_item_id is not null;

create index conversation_artifacts_version_idx
  on public.conversation_artifacts (workspace_id, version_id)
  where version_id is not null;
