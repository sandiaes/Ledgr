-- Daily prices, valuation flags on snapshots, and a log of scheduled/script runs.
--
-- prices.close stays the RAW close as quoted that day, in the listing currency. The
-- provider's split ratio is stored on the split date; packages/core derives split-adjusted
-- closes from it at read time (the ledger records post-split units). Dividend-adjusted
-- closes are never stored: dividends belong in the ledger.
--
-- Rows are written by the Edge Functions and the local backfill script with the service
-- role (which bypasses RLS), so both set user_id explicitly.

-- ---------------------------------------------------------------------------
-- prices.split_factor
-- ---------------------------------------------------------------------------

alter table public.prices
  add column split_factor numeric(38, 18)
    check (split_factor is null or (split_factor > 0 and split_factor <> 1));

comment on column public.prices.close is
  'Raw (unadjusted) close as quoted on price_date, in `currency` (the listing currency).';
comment on column public.prices.split_factor is
  'New shares per old share for a split effective on price_date (20 for 20:1, 0.01 for 1:100); null on other days.';

-- ---------------------------------------------------------------------------
-- portfolio_snapshots: valuation flags (dates and ages only, never amounts)
-- ---------------------------------------------------------------------------

alter table public.portfolio_snapshots
  add column stale boolean not null default false,
  add column stale_asset_count integer not null default 0 check (stale_asset_count >= 0),
  add column ca_value_source text check (ca_value_source in ('factor', 'subscription', 'mixed')),
  add column ca_value_as_of date,
  add column ca_value_age_days integer check (ca_value_age_days >= 0),
  add column ca_value_stale boolean not null default false,
  add column valuation_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(valuation_flags) = 'array'),
  add constraint portfolio_snapshots_ca_value_fields check (
    (ca_value_source is null) = (ca_value_as_of is null)
    and (ca_value_source is null) = (ca_value_age_days is null)
  );

comment on column public.portfolio_snapshots.net_contributions_eur is
  'Net invested: buys and subscriptions minus sells and redemptions, in EUR at trade rates. Deposits and withdrawals are not counted.';
comment on column public.portfolio_snapshots.stale is
  'True when any price used is older than the staleness limit, a trade price stood in for a missing price, or the CA value is older than its limit.';
comment on column public.portfolio_snapshots.ca_value_source is
  'How certificados were valued: by factor, by subscription price (no factor yet), or mixed across subscriptions.';
comment on column public.portfolio_snapshots.ca_value_as_of is
  'Oldest valuation date across certificado subscriptions: the factor month, or the subscription date when no factor exists yet.';
comment on column public.portfolio_snapshots.valuation_flags is
  'Per asset: {asset_id, source (price|trade|factor|subscription|accrual), as_of, age_days, stale}. No amounts.';

-- ---------------------------------------------------------------------------
-- job_runs: one row per run of a daily function or local script command.
-- counts holds integers only; issues holds {asset_id?, code, date?}. No amounts, no prices.
-- ---------------------------------------------------------------------------

create table public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job         text not null check (job in ('fx', 'prices', 'snapshots', 'resolve')),
  trigger     text not null check (trigger in ('cron', 'script')),
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  status      text not null check (status in ('ok', 'partial', 'failed')),
  counts      jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  issues      jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  created_at  timestamptz not null default now(),
  check (finished_at >= started_at)
);

create index job_runs_user_started_idx on public.job_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- RLS: read-only for the owner. Only the service role writes runs.
-- ---------------------------------------------------------------------------

alter table public.job_runs enable row level security;

revoke all on public.job_runs from anon, authenticated;
grant select on public.job_runs to authenticated;

create policy job_runs_owner on public.job_runs for select to authenticated
  using (user_id = (select auth.uid()));

create policy job_runs_require_aal2 on public.job_runs
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
