-- Forward-only repair: v11 used connection_id/external_account_id columns absent from credentials.
-- Rollback: retain atomic storage and tenant checks; never restore non-atomic admin fallback.
CREATE OR REPLACE FUNCTION public.save_meta_channel_connection(
  p_workspace_id uuid, p_actor_user_id uuid, p_provider text,
  p_external_account_id text, p_account_label text, p_encrypted_access_token text,
  p_access_token_iv text, p_granted_scopes text[],
  p_token_expires_at timestamptz, p_refresh_after timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_connection_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('instagram','threads')
      OR NULLIF(trim(p_external_account_id),'') IS NULL
      OR NULLIF(trim(p_account_label),'') IS NULL
      OR NULLIF(p_encrypted_access_token,'') IS NULL OR NULLIF(p_access_token_iv,'') IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHANNEL_CREDENTIAL';
  END IF;
  -- Lock membership until both connection and encrypted credential commit.
  PERFORM 1 FROM public.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_actor_user_id
      AND status='active' AND role IN ('owner','manager') FOR SHARE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  IF EXISTS (SELECT 1 FROM public.channel_connections
      WHERE channel=p_provider AND external_account_id=p_external_account_id
        AND workspace_id<>p_workspace_id) THEN
    RAISE EXCEPTION 'DUPLICATE_BINDING';
  END IF;
  INSERT INTO public.channel_connections(
    workspace_id,channel,status,account_label,external_account_id,token_expires_at,webhook_status
  ) VALUES (
    p_workspace_id,p_provider,'connected',p_account_label,p_external_account_id,p_token_expires_at,'pending'
  ) ON CONFLICT (workspace_id,channel) DO UPDATE SET
    status='connected',account_label=EXCLUDED.account_label,
    external_account_id=EXCLUDED.external_account_id,token_expires_at=EXCLUDED.token_expires_at,
    webhook_status='pending',last_error_code=NULL,updated_at=now()
  RETURNING id INTO v_connection_id;
  INSERT INTO public.meta_channel_credentials(
    workspace_id,channel_connection_id,provider,encrypted_access_token,access_token_iv,
    encryption_algorithm,granted_scopes,token_expires_at,refresh_after,status,last_error_code
  ) VALUES (
    p_workspace_id,v_connection_id,p_provider,p_encrypted_access_token,p_access_token_iv,
    'AES-GCM-256',COALESCE(p_granted_scopes,'{}'::text[]),p_token_expires_at,p_refresh_after,'active',NULL
  ) ON CONFLICT (channel_connection_id) DO UPDATE SET
    provider=EXCLUDED.provider,encrypted_access_token=EXCLUDED.encrypted_access_token,
    access_token_iv=EXCLUDED.access_token_iv,encryption_algorithm=EXCLUDED.encryption_algorithm,
    granted_scopes=EXCLUDED.granted_scopes,token_expires_at=EXCLUDED.token_expires_at,
    refresh_after=EXCLUDED.refresh_after,status='active',last_error_code=NULL,updated_at=now();
  RETURN v_connection_id;
EXCEPTION WHEN unique_violation THEN
  -- Unique account binding also closes concurrent cross-workspace inserts.
  RAISE EXCEPTION 'DUPLICATE_BINDING';
END;
$$;
REVOKE ALL ON FUNCTION public.save_meta_channel_connection(uuid,uuid,text,text,text,text,text,text[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_meta_channel_connection(uuid,uuid,text,text,text,text,text,text[],timestamptz,timestamptz) TO service_role;
