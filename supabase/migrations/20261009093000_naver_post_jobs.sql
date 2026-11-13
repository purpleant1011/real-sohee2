-- Naver post jobs: atomic claiming, deduplication and credit reconciliation for Naver blog posts.
CREATE TABLE public.naver_post_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  content_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  version_id uuid REFERENCES public.content_versions(id) ON DELETE SET NULL,
  credit_reconcile_needed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT naver_post_jobs_workspace_request_key UNIQUE (workspace_id, request_key)
);

CREATE INDEX naver_post_jobs_workspace_status_idx
  ON public.naver_post_jobs(workspace_id, status, created_at DESC);

ALTER TABLE public.naver_post_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.naver_post_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.naver_post_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.naver_post_jobs TO service_role;

-- RLS: only owner/manager of the workspace can select
CREATE POLICY naver_post_jobs_managers_select ON public.naver_post_jobs
  FOR SELECT TO authenticated
  USING ((SELECT private.has_workspace_role(workspace_id, ARRAY['owner', 'manager']::text[])));

CREATE POLICY naver_post_jobs_service_write ON public.naver_post_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Atomic claim helper: serializes per (workspace_id, request_key).
-- Returns JSON { kind: 'acquired'|'running'|'succeeded', jobId, contentId, versionId }
CREATE OR REPLACE FUNCTION public.claim_naver_post_job(
  p_workspace_id uuid,
  p_request_key uuid,
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job public.naver_post_jobs%ROWTYPE;
BEGIN
  -- Per-workspace and request-key transaction advisory lock
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('naver_post_job:' || p_workspace_id::text || ':' || p_request_key::text, 0)
  );

  SELECT * INTO v_job FROM public.naver_post_jobs
    WHERE workspace_id = p_workspace_id AND request_key = p_request_key;

  IF FOUND THEN
    IF v_job.status = 'running' THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'running', 'jobId', v_job.id);
    ELSIF v_job.status = 'succeeded' THEN
      RETURN pg_catalog.jsonb_build_object(
        'kind', 'succeeded',
        'jobId', v_job.id,
        'contentId', v_job.content_id,
        'versionId', v_job.version_id
      );
    ELSIF v_job.status = 'failed' THEN
      -- Failed allows a fresh attempt with the same key only if no version was saved
      IF v_job.version_id IS NULL AND v_job.content_id IS NULL THEN
        UPDATE public.naver_post_jobs
          SET status = 'running', user_id = p_user_id, updated_at = now()
          WHERE id = v_job.id
          RETURNING * INTO v_job;
        RETURN pg_catalog.jsonb_build_object('kind', 'acquired', 'jobId', v_job.id);
      ELSE
        RETURN pg_catalog.jsonb_build_object(
          'kind', 'succeeded',
          'jobId', v_job.id,
          'contentId', v_job.content_id,
          'versionId', v_job.version_id
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.naver_post_jobs (workspace_id, request_key, user_id, status)
    VALUES (p_workspace_id, p_request_key, p_user_id, 'running')
    RETURNING * INTO v_job;

  RETURN pg_catalog.jsonb_build_object('kind', 'acquired', 'jobId', v_job.id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_naver_post_job(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_naver_post_job(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_naver_post_job(
  p_workspace_id uuid,
  p_request_key uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_credit_reconcile_needed boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.naver_post_jobs
    SET status = 'succeeded',
        content_id = p_content_id,
        version_id = p_version_id,
        credit_reconcile_needed = COALESCE(p_credit_reconcile_needed, credit_reconcile_needed),
        updated_at = now()
    WHERE workspace_id = p_workspace_id AND request_key = p_request_key;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_naver_post_job(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_naver_post_job(uuid, uuid, uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_naver_post_job(
  p_workspace_id uuid,
  p_request_key uuid,
  p_credit_reconcile_needed boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.naver_post_jobs
    SET status = 'failed',
        credit_reconcile_needed = COALESCE(p_credit_reconcile_needed, credit_reconcile_needed),
        updated_at = now()
    WHERE workspace_id = p_workspace_id AND request_key = p_request_key;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_naver_post_job(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_naver_post_job(uuid, uuid, boolean) TO service_role;
