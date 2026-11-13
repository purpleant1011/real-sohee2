grant select, insert on public.business_profiles to authenticated;
grant update (business_name, industry, location, summary)
on public.business_profiles to authenticated;

grant select, insert on public.brand_profiles to authenticated;
grant update (voice, keywords, prohibited_terms)
on public.brand_profiles to authenticated;

grant select, insert, delete on public.channel_connections to authenticated;
grant update (channel, status, account_label, external_account_id)
on public.channel_connections to authenticated;

grant select, insert, delete on public.workspace_members to authenticated;
grant update (role, status) on public.workspace_members to authenticated;

grant select, insert on public.notification_preferences to authenticated;
grant update (approval_events, schedule_events, publish_events)
on public.notification_preferences to authenticated;

grant select, insert on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
