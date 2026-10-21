-- Bookkeeping for the one-off spreadsheet importer (scripts/import).
--
-- import_batches: one row per importer `commit`. Written only with the service-role key
-- (which bypasses RLS, so the importer sets user_id explicitly); the owner can read it.
-- Each source file's sha256 may be imported once (until that batch is undone).
--
-- Every row the importer creates carries import_batch_id, so `undo --batch` removes
-- exactly that batch's rows. Imported transactions also carry import_row_hash: sha256 of
-- the normalized source fields plus an occurrence counter (identical rows can be
-- legitimate), unique per user, so re-running never creates a duplicate.
--
-- transactions.trade_date_precision records that a date is only known to the month; such
-- dates are stored as the 1st. Within a date, rows keep their file order through
-- created_at, which the importer sets explicitly increasing.

create type public.date_precision as enum ('day', 'month');

-- ---------------------------------------------------------------------------
-- import_batches
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source                   text not null check (length(trim(source)) > 0),  -- e.g. 'excel-csv'
  transactions_file_sha256 text not null check (transactions_file_sha256 ~ '^[0-9a-f]{64}$'),
  ca_file_sha256           text check (ca_file_sha256 ~ '^[0-9a-f]{64}$'),
  -- Month the CA file's ratios are the factors for (the importer's --ratio-month).
  ca_ratio_month           date check (extract(day from ca_ratio_month) = 1),
  -- Detected CSV settings (delimiter, encoding, decimal, date format). Never financial values.
  settings                 jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at               timestamptz not null default now(),
  undone_at                timestamptz,
  unique (id, user_id),
  check ((ca_file_sha256 is null) = (ca_ratio_month is null))
);

-- The same file cannot be imported twice while its batch stands.
create unique index import_batches_transactions_file_key
  on public.import_batches (user_id, transactions_file_sha256)
  where undone_at is null;

create unique index import_batches_ca_file_key
  on public.import_batches (user_id, ca_file_sha256)
  where ca_file_sha256 is not null and undone_at is null;

-- ---------------------------------------------------------------------------
-- import_batch_id on every table the importer writes to (same-owner FK).
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column import_batch_id uuid,
  add foreign key (import_batch_id, user_id) references public.import_batches (id, user_id);

alter table public.assets
  add column import_batch_id uuid,
  add foreign key (import_batch_id, user_id) references public.import_batches (id, user_id);

alter table public.ca_series
  add column import_batch_id uuid,
  add foreign key (import_batch_id, user_id) references public.import_batches (id, user_id);

alter table public.ca_subscriptions
  add column import_batch_id uuid,
  add foreign key (import_batch_id, user_id) references public.import_batches (id, user_id);

alter table public.ca_factors
  add column import_batch_id uuid,
  add foreign key (import_batch_id, user_id) references public.import_batches (id, user_id);

alter table public.transactions
  add column import_batch_id uuid,
  add column import_row_hash text check (import_row_hash ~ '^[0-9a-f]{64}$'),
  add column trade_date_precision public.date_precision not null default 'day',
  add foreign key (import_batch_id, user_id) references public.import_batches (id, user_id),
  add constraint transactions_import_row_hash_needs_batch
    check (import_row_hash is null or import_batch_id is not null),
  add constraint transactions_month_precision_on_the_first
    check (trade_date_precision = 'day' or extract(day from trade_date) = 1);

-- Idempotent imports. Deliberately NOT partial on deleted_at (as for broker_order_id), so
-- re-importing a file cannot resurrect a row you soft-deleted.
create unique index transactions_user_import_row_hash_key
  on public.transactions (user_id, import_row_hash)
  where import_row_hash is not null;

create index accounts_import_batch_id_idx
  on public.accounts (import_batch_id) where import_batch_id is not null;
create index assets_import_batch_id_idx
  on public.assets (import_batch_id) where import_batch_id is not null;
create index ca_series_import_batch_id_idx
  on public.ca_series (import_batch_id) where import_batch_id is not null;
create index ca_subscriptions_import_batch_id_idx
  on public.ca_subscriptions (import_batch_id) where import_batch_id is not null;
create index ca_factors_import_batch_id_idx
  on public.ca_factors (import_batch_id) where import_batch_id is not null;
create index transactions_import_batch_id_idx
  on public.transactions (import_batch_id) where import_batch_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: read-only for the owner. Only the service-role key writes batches.
-- ---------------------------------------------------------------------------

alter table public.import_batches enable row level security;

revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;

create policy import_batches_owner on public.import_batches for select to authenticated
  using (user_id = (select auth.uid()));

create policy import_batches_require_aal2 on public.import_batches
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
