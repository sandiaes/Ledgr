-- Certificados de Aforro: series rules and per-subscription data needed to accrue value.
--
-- The subscription itself (date, units, amount paid) lives in `transactions`
-- (type = 'subscription'); ca_subscriptions links that ledger row to its series and
-- holds the optional manual override. This keeps the ledger the single source of truth.

-- ---------------------------------------------------------------------------
-- ca_series
-- ---------------------------------------------------------------------------
-- Rate rule per capitalisation period:
--   gross_rate = clamp(reference_rate + base_spread, rate_floor, rate_cap) + loyalty premium(year)
-- loyalty_premiums: [{"from_year": 2, "to_year": 5, "premium": "0.005"}, ...]
-- Premium values are JSON *strings* so they are parsed as decimals, never floats.

create table public.ca_series (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code                       text not null check (length(trim(code)) > 0),  -- 'E', 'F', ...
  name                       text not null,
  subscription_start         date not null,
  subscription_end           date,                      -- null = still open
  term_months                integer not null check (term_months > 0),
  capitalisation_months      integer not null default 3 check (capitalisation_months > 0),
  min_holding_months         integer not null default 3 check (min_holding_months >= 0),
  reference_rate             text not null default 'euribor_3m',
  base_spread                numeric(38, 18) not null default 0,
  rate_floor                 numeric(38, 18),
  rate_cap                   numeric(38, 18),
  loyalty_premiums           jsonb not null default '[]'::jsonb
                               check (jsonb_typeof(loyalty_premiums) = 'array'),
  withholding_tax_rate       numeric(38, 18) not null default 0.28
                               check (withholding_tax_rate between 0 and 1),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  unique (id, user_id),
  check (subscription_end is null or subscription_end >= subscription_start),
  check (rate_floor is null or rate_cap is null or rate_floor <= rate_cap)
);

create unique index ca_series_user_code_key
  on public.ca_series (user_id, code)
  where deleted_at is null;

create trigger ca_series_set_updated_at
  before update on public.ca_series
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ca_subscriptions
-- ---------------------------------------------------------------------------

create table public.ca_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  series_id             uuid not null,
  transaction_id        uuid not null,
  -- Manual override: value (EUR, gross of tax as shown by AforroNet) as of a date.
  -- Accrual starts from here instead of from the subscription when present.
  manual_value          numeric(38, 18) check (manual_value >= 0),
  manual_value_date     date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  foreign key (series_id, user_id)      references public.ca_series (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id),

  -- One ca_subscriptions row per subscription transaction.
  unique (transaction_id),

  check ((manual_value is null) = (manual_value_date is null))
);

create index ca_subscriptions_user_id_idx   on public.ca_subscriptions (user_id);
create index ca_subscriptions_series_id_idx on public.ca_subscriptions (series_id);

create trigger ca_subscriptions_set_updated_at
  before update on public.ca_subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (same pattern as the ledger: no hard deletes, soft delete via UPDATE)
-- ---------------------------------------------------------------------------

alter table public.ca_series        enable row level security;
alter table public.ca_subscriptions enable row level security;

revoke all on public.ca_series, public.ca_subscriptions from anon, authenticated;
grant select, insert, update on public.ca_series, public.ca_subscriptions to authenticated;

create policy ca_series_select on public.ca_series for select to authenticated
  using (user_id = (select auth.uid()));
create policy ca_series_insert on public.ca_series for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy ca_series_update on public.ca_series for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy ca_subscriptions_select on public.ca_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy ca_subscriptions_insert on public.ca_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy ca_subscriptions_update on public.ca_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
