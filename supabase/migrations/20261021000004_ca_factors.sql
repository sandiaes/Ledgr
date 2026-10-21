-- Certificados de aforro valued by official monthly factors.
--
-- A factor is the official value of one unit of a subscription (EUR, net, as AforroNet
-- shows it), in force from `month` (the 1st of that month) on. The value of a
-- subscription on a date = units still held x its latest factor whose month is on or
-- before that date. Every monthly factor is its own row: one per (subscription, month),
-- never updated (a trigger enforces this for every role, the service role included).
--
-- This replaces ca_subscriptions.manual_value. The rule-based accrual (the ca_series rule
-- columns) stays available as an optional model; it is not the default valuation.

-- ---------------------------------------------------------------------------
-- ca_subscriptions: drop the manual override (its check constraint goes with it).
-- ---------------------------------------------------------------------------

alter table public.ca_subscriptions
  drop column manual_value,
  drop column manual_value_date;

-- ---------------------------------------------------------------------------
-- ca_series: these rule columns are only needed by the optional accrual model, so a
-- series can be recorded by code and name alone.
-- ---------------------------------------------------------------------------

alter table public.ca_series
  alter column subscription_start drop not null,
  alter column term_months drop not null;

comment on column public.ca_series.term_months is
  'Optional accrual model only. Null: this series cannot be valued by accrual.';

-- ---------------------------------------------------------------------------
-- ca_factors
-- ---------------------------------------------------------------------------

create table public.ca_factors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subscription_id uuid not null,
  month           date not null check (extract(day from month) = 1),
  factor          numeric(38, 18) not null check (factor > 0),   -- EUR per unit, net
  source          text not null check (length(trim(source)) > 0), -- e.g. 'aforronet', 'excel'
  notes           text,
  created_at      timestamptz not null default now(),

  foreign key (subscription_id, user_id) references public.ca_subscriptions (id, user_id),

  -- One factor per subscription and month. Also serves "latest on or before" lookups.
  unique (subscription_id, month)
);

create index ca_factors_user_id_idx on public.ca_factors (user_id);

comment on table public.ca_factors is
  'Official monthly unit value of a CA subscription. Rows are never updated; a new month is a new row.';

-- Rows are immutable. Fires for every role (the postgres and service roles included).
create function public.reject_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Rows of % are never updated: insert a new row instead', tg_table_name;
end;
$$;

create trigger ca_factors_reject_update
  before update on public.ca_factors
  for each row execute function public.reject_update();

-- ---------------------------------------------------------------------------
-- RLS: the owner may read and insert. No UPDATE (immutable) and no DELETE grant.
-- ---------------------------------------------------------------------------

alter table public.ca_factors enable row level security;

revoke all on public.ca_factors from anon, authenticated;
grant select, insert on public.ca_factors to authenticated;

create policy ca_factors_owner on public.ca_factors for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy ca_factors_require_aal2 on public.ca_factors
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
