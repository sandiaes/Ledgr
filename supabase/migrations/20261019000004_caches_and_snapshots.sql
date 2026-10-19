-- Daily caches (prices, fx_rates) and derived portfolio_snapshots.
-- These are regenerable, so no soft delete: hard DELETE is allowed for the owner.

-- ---------------------------------------------------------------------------
-- prices: one close per asset per day, in the asset's trading currency.
-- ---------------------------------------------------------------------------

create table public.prices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id    uuid not null,
  price_date  date not null,
  close       numeric(38, 18) not null check (close >= 0),
  currency    public.currency_code not null,
  source      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (asset_id, user_id) references public.assets (id, user_id) on delete cascade,
  -- Also serves "price of asset X on/before date D" lookups and range scans.
  unique (asset_id, price_date)
);

create index prices_user_date_idx on public.prices (user_id, price_date);

create trigger prices_set_updated_at
  before update on public.prices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- fx_rates: EUR per 1 unit of `currency`, per day. EUR itself is implicit (= 1).
-- ---------------------------------------------------------------------------

create table public.fx_rates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  currency    public.currency_code not null check (currency <> 'EUR'),
  rate_date   date not null,
  rate_to_eur numeric(38, 18) not null check (rate_to_eur > 0),
  source      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, currency, rate_date)
);

create trigger fx_rates_set_updated_at
  before update on public.fx_rates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- portfolio_snapshots: one row per day, all values in EUR, computed by packages/core.
-- Per-type breakdown is stored as columns (not jsonb) to keep values numeric.
-- ---------------------------------------------------------------------------

create table public.portfolio_snapshots (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  snapshot_date             date not null,
  total_value_eur           numeric(38, 18) not null,
  total_cost_basis_eur      numeric(38, 18) not null,
  net_contributions_eur     numeric(38, 18) not null,   -- cumulative deposits - withdrawals
  cash_eur                  numeric(38, 18) not null,
  stock_value_eur           numeric(38, 18) not null,
  etf_value_eur             numeric(38, 18) not null,
  crypto_value_eur          numeric(38, 18) not null,
  certificado_aforro_value_eur numeric(38, 18) not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

create trigger portfolio_snapshots_set_updated_at
  before update on public.portfolio_snapshots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: full CRUD for the owner.
-- ---------------------------------------------------------------------------

alter table public.prices              enable row level security;
alter table public.fx_rates            enable row level security;
alter table public.portfolio_snapshots enable row level security;

revoke all on public.prices, public.fx_rates, public.portfolio_snapshots from anon, authenticated;
grant select, insert, update, delete
  on public.prices, public.fx_rates, public.portfolio_snapshots to authenticated;

create policy prices_owner on public.prices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy fx_rates_owner on public.fx_rates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy portfolio_snapshots_owner on public.portfolio_snapshots for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
