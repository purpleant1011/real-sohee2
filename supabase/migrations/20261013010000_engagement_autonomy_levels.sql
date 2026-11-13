-- Migration: 20261013010000_engagement_autonomy_levels.sql
-- Description: Add autonomy_level and default_tone to engagement_policies

alter table public.engagement_policies
  add column if not exists autonomy_level text not null default 'L1_MANUAL'
    check (autonomy_level in ('L1_MANUAL', 'L2_ASSISTED', 'L3_AUTONOMOUS')),
  add column if not exists default_tone text not null default 'friendly'
    check (default_tone in ('witty', 'polite', 'friendly'));
