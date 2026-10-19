-- Ledger: assets, accounts, transactions.
-- The transactions table is the source of truth; everything else is derived.

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------

create table public.assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  asset_type       public.asset_type not null,
  isin             text check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  ticker           text,
  exchange         text,                       -- e.g. MIC code 'XETR', or crypto venue
  trading_currency public.currency_code not null,
  -- Price-source mapping: which provider to ask, and the id it knows this asset by.
  -- e.g. ('yahoo', 'VWCE.DE'), ('coingecko', 'bitcoin'), ('manual', null), ('ca_accrual', null)
  price_source     text not null default 'manual',
  price_source_id  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  -- Target for composite FKs so children can only reference the same owner's asset.
  unique (id, user_id)
);

create unique index assets_user_isin_key
  on public.assets (user_id, isin)
  where isin is not null and deleted_at is null;

create index assets_user_id_idx on public.assets (user_id);

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

create table public.accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),  -- e.g. 'Trade Republic', 'Ledger Nano', 'AforroNet'
  account_type public.account_type not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (id, user_id)
);

create index accounts_user_id_idx on public.accounts (user_id);

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
-- Field semantics by type (all amounts in `currency`):
--   buy, sell, subscription, redemption : asset required; quantity > 0; unit_price >= 0
--   dividend, interest                  : asset optional (cash interest has none); amount > 0
--   deposit, withdrawal, fee            : asset optional;                         amount > 0
--   fees : always >= 0, charged on top of the trade (never negative).

create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id        uuid not null,
  asset_id          uuid,
  type              public.transaction_type not null,
  trade_date        date not null,
  quantity          numeric(38, 18),
  unit_price        numeric(38, 18),
  amount            numeric(38, 18),
  fees              numeric(38, 18) not null default 0 check (fees >= 0),
  currency          public.currency_code not null,
  fx_rate_to_eur    numeric(38, 18) not null check (fx_rate_to_eur > 0), -- EUR per 1 unit of `currency`
  broker_order_id   text,
  tax_declared_year smallint check (tax_declared_year between 2000 and 2100),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  unique (id, user_id),

  -- Same-owner FKs: a transaction cannot point at another user's account or asset.
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (asset_id, user_id)   references public.assets (id, user_id),

  constraint transactions_eur_rate_is_one
    check (currency <> 'EUR' or fx_rate_to_eur = 1),

  constraint transactions_shape check (
    case
      when type in ('buy', 'sell', 'subscription', 'redemption') then
        asset_id is not null
        and quantity is not null and quantity > 0
        and unit_price is not null and unit_price >= 0
        and amount is null
      else
        quantity is null
        and unit_price is null
        and amount is not null and amount > 0
    end
  )
);

-- Idempotent imports: one broker order id per account. Deliberately NOT partial on
-- deleted_at, so re-importing a file cannot resurrect a row you soft-deleted.
create unique index transactions_account_broker_order_key
  on public.transactions (account_id, broker_order_id)
  where broker_order_id is not null;

-- Holdings / FIFO per asset in date order.
create index transactions_user_asset_date_idx
  on public.transactions (user_id, asset_id, trade_date)
  where deleted_at is null;

-- Full ledger in date order (XIRR, TWR, snapshots).
create index transactions_user_date_idx
  on public.transactions (user_id, trade_date)
  where deleted_at is null;

-- Per-account view and FK support.
create index transactions_account_date_idx
  on public.transactions (account_id, trade_date);

create index transactions_asset_id_idx on public.transactions (asset_id);

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- User-editable tables: no DELETE policy. Rows are soft-deleted via UPDATE of
-- deleted_at; hard deletes are refused for the authenticated role.
-- SELECT does not filter deleted_at (the app does), otherwise the soft-delete
-- UPDATE would make the row invisible to itself and fail.
-- ---------------------------------------------------------------------------

alter table public.assets       enable row level security;
alter table public.accounts     enable row level security;
alter table public.transactions enable row level security;

revoke all on public.assets, public.accounts, public.transactions from anon, authenticated;
grant select, insert, update on public.assets, public.accounts, public.transactions to authenticated;

create policy assets_select on public.assets for select to authenticated
  using (user_id = (select auth.uid()));
create policy assets_insert on public.assets for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy assets_update on public.assets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy accounts_select on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy accounts_update on public.accounts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy transactions_select on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy transactions_update on public.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
