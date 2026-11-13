-- Operator console read RPCs: restore EXECUTE for the signed-in session role.
-- ANI-1140 left these callable by service_role only, but every operator page calls them with the
-- cookie session client, so each call failed with "permission denied" and the console showed 0.
-- Each function authorises itself (auth.uid(), active operator membership, AAL2/MFA, permission key)
-- before returning anything, so granting EXECUTE does not widen data access. Write RPCs are untouched.
do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'get_current_operator_setup_context','get_operator_audit_event_detail','get_operator_onboarding_overview',
        'get_operator_system_observations','get_operator_system_observations_v2','get_operator_workspace_detail',
        'list_operator_admin_approval_requests','list_operator_admin_selector_options','list_operator_admins',
        'list_operator_audit_events','list_operator_audit_export_jobs','list_operator_billing_overview',
        'list_operator_channel_connections','list_operator_channel_connections_v2','list_operator_document_reconsent_targets',
        'list_operator_incidents','list_operator_publish_operations','list_operator_support_sessions',
        'list_operator_support_sessions_v2','list_operator_workspaces')
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
-- Rollback: revoke execute on the functions above from authenticated.
