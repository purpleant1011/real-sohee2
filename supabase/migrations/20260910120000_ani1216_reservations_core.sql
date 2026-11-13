-- ANI-1216: Salon Customer Appointment & Booking Spine Table
-- Enables atomic reservation persistence, slot locking, and linkage to marketing missions

create table if not exists public.reservations (
  id text primary key, -- 'bk_' || uuid
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid references public.marketing_missions(id) on delete set null,
  slot_id text not null,
  customer_id text not null,
  customer_name text not null default '고객님',
  customer_phone text,
  service_id text not null default 'srv_default_treatment',
  service_name text not null default '1:1 맞춤 디자인 시술',
  status text not null default 'CONFIRMED' check (status in ('PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
  deposit_krw integer not null default 0,
  total_amount_krw integer not null default 120000,
  channel_source text not null default 'INSTAGRAM_DM',
  proof_id text,
  evidence_id text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Slot uniqueness constraint: prevent double booking on confirmed reservations
create unique index if not exists idx_reservations_active_slot
  on public.reservations (workspace_id, slot_id)
  where status = 'CONFIRMED';

create index if not exists idx_reservations_workspace_customer
  on public.reservations (workspace_id, customer_id);

create index if not exists idx_reservations_workspace_mission
  on public.reservations (workspace_id, mission_id);

create index if not exists idx_reservations_workspace_status
  on public.reservations (workspace_id, status);

-- Enable RLS
alter table public.reservations enable row level security;

-- Workspace member access policy
create policy "reservations_workspace_isolation"
  on public.reservations
  for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );
