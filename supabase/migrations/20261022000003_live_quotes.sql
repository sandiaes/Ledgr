-- live_quotes: the latest intraday quote per asset, a cache for the "value now" Edge
-- Function so that opening the app often does not use up the providers' free limits.
-- One row per asset, overwritten on refresh. Regenerable, so hard DELETE is allowed.
--
-- The value-now function reads and writes with the caller's own session token (never the
-- service role), so these policies apply to it: only the owner, only with aal2.
-- Daily history stays in public.prices; nothing here feeds portfolio_snapshots.

create table public.live_quotes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id     uuid not null,
  price        numeric(38, 18) not null check (price > 0),   -- in `currency`, as quoted
  currency     public.currency_code not null,
  trading_day  date not null,          -- the trading day the quote belongs to (exchange date)
  quoted_at    timestamptz not null,   -- the provider's quote or trade time
  fetched_at   timestamptz not null,   -- when Ledgr fetched it (drives the refresh interval)
  source       text not null check (length(trim(source)) > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (asset_id, user_id) references public.assets (id, user_id) on delete cascade,
  unique (asset_id)
);

create index live_quotes_user_id_idx on public.live_quotes (user_id);

create trigger live_quotes_set_updated_at
  before update on public.live_quotes
  for each row execute function public.set_updated_at();

comment on table public.live_quotes is
  'Latest intraday quote per asset (cache for value-now). Not history: daily closes live in prices.';

-- ---------------------------------------------------------------------------
-- RLS: full CRUD for the owner, aal2 required.
-- ---------------------------------------------------------------------------

alter table public.live_quotes enable row level security;

revoke all on public.live_quotes from anon, authenticated;
grant select, insert, update, delete on public.live_quotes to authenticated;

create policy live_quotes_owner on public.live_quotes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy live_quotes_require_aal2 on public.live_quotes
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
