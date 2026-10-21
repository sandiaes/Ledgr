-- aal2 enforcement test. Proves a password-only (aal1) session cannot read or write,
-- and an MFA (aal2) session of the SAME user can.
--
-- Run as the `postgres` role (Supabase SQL Editor, or `psql "$DB_URL" -f this-file`)
-- AFTER applying 20261020000001_require_aal2.sql.
-- Everything is ROLLED BACK at the end: no data is kept.
-- Any failed check raises an exception. Success prints 'aal2 enforcement: ALL CHECKS PASSED'.

begin;

insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-4000-8000-00000000000c', 'rls-aal@example.test', 'authenticated', 'authenticated');
-- Import batches are written only with the service-role key; here as postgres.
insert into public.import_batches (user_id, source, transactions_file_sha256) values
  ('cccccccc-0000-4000-8000-00000000000c', 'test', repeat('c', 64));

set local role authenticated;

-- ---------------------------------------------------------------------------
-- aal2 session: create one row in every table, then read and modify it.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal2"}', true);

insert into public.accounts (id, name, account_type) values
  ('c0000000-0000-4000-8000-000000000001', 'Broker', 'broker');
insert into public.assets (id, name, asset_type, trading_currency, price_source) values
  ('c0000000-0000-4000-8000-000000000002', 'CA Série F', 'certificado_aforro', 'EUR', 'ca_accrual');
insert into public.transactions
  (id, account_id, asset_id, type, trade_date, quantity, unit_price, currency, fx_rate_to_eur, notes) values
  ('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'subscription', '2024-03-01', 1000, 1, 'EUR', 1, 'original');
insert into public.ca_series (id, code, name, subscription_start, term_months) values
  ('c0000000-0000-4000-8000-000000000004', 'F', 'Série F', '2023-06-05', 180);
insert into public.ca_subscriptions (id, series_id, transaction_id) values
  ('c0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000004',
   'c0000000-0000-4000-8000-000000000003');
insert into public.ca_factors (subscription_id, month, factor, source) values
  ('c0000000-0000-4000-8000-000000000005', '2026-10-01', 1.01, 'test');
insert into public.prices (asset_id, price_date, close, currency, source) values
  ('c0000000-0000-4000-8000-000000000002', '2026-01-02', 1.01, 'EUR', 'manual');
insert into public.fx_rates (currency, rate_date, rate_to_eur, source) values
  ('USD', '2026-01-02', 0.92, 'ecb');
insert into public.portfolio_snapshots
  (snapshot_date, total_value_eur, total_cost_basis_eur, net_contributions_eur, cash_eur,
   stock_value_eur, etf_value_eur, crypto_value_eur, certificado_aforro_value_eur) values
  ('2026-01-02', 1010, 1000, 1000, 0, 0, 0, 0, 1010);

-- 1. aal2 CAN read every table and update / delete its own rows.
do $$
declare n int;
begin
  assert (select count(*) from public.accounts) = 1,            'aal2 cannot read accounts';
  assert (select count(*) from public.assets) = 1,              'aal2 cannot read assets';
  assert (select count(*) from public.transactions) = 1,        'aal2 cannot read transactions';
  assert (select count(*) from public.ca_series) = 1,           'aal2 cannot read ca_series';
  assert (select count(*) from public.ca_subscriptions) = 1,    'aal2 cannot read ca_subscriptions';
  assert (select count(*) from public.ca_factors) = 1,          'aal2 cannot read ca_factors';
  assert (select count(*) from public.import_batches) = 1,      'aal2 cannot read import_batches';
  assert (select count(*) from public.prices) = 1,              'aal2 cannot read prices';
  assert (select count(*) from public.fx_rates) = 1,            'aal2 cannot read fx_rates';
  assert (select count(*) from public.portfolio_snapshots) = 1, 'aal2 cannot read snapshots';

  update public.transactions set notes = 'edited at aal2';
  get diagnostics n = row_count; assert n = 1, 'aal2 cannot update transactions';

  delete from public.fx_rates;
  get diagnostics n = row_count; assert n = 1, 'aal2 cannot delete fx_rates';
  insert into public.fx_rates (currency, rate_date, rate_to_eur, source)
    values ('USD', '2026-01-02', 0.92, 'ecb');
end $$;

-- ---------------------------------------------------------------------------
-- aal1 session (same user, password only): sees nothing, changes nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal1"}', true);

-- 2. aal1 reads return no rows.
do $$
begin
  assert (select count(*) from public.accounts) = 0,            'aal1 can read accounts';
  assert (select count(*) from public.assets) = 0,              'aal1 can read assets';
  assert (select count(*) from public.transactions) = 0,        'aal1 can read transactions';
  assert (select count(*) from public.ca_series) = 0,           'aal1 can read ca_series';
  assert (select count(*) from public.ca_subscriptions) = 0,    'aal1 can read ca_subscriptions';
  assert (select count(*) from public.ca_factors) = 0,          'aal1 can read ca_factors';
  assert (select count(*) from public.import_batches) = 0,      'aal1 can read import_batches';
  assert (select count(*) from public.prices) = 0,              'aal1 can read prices';
  assert (select count(*) from public.fx_rates) = 0,            'aal1 can read fx_rates';
  assert (select count(*) from public.portfolio_snapshots) = 0, 'aal1 can read snapshots';
end $$;

-- 3. aal1 updates and deletes affect 0 rows.
do $$
declare n int;
begin
  update public.transactions set notes = 'edited at aal1';
  get diagnostics n = row_count; assert n = 0, 'aal1 updated transactions';
  update public.transactions set deleted_at = now();
  get diagnostics n = row_count; assert n = 0, 'aal1 soft-deleted transactions';
  update public.accounts set name = 'aal1';
  get diagnostics n = row_count; assert n = 0, 'aal1 updated accounts';
  delete from public.prices;
  get diagnostics n = row_count; assert n = 0, 'aal1 deleted prices';
  delete from public.fx_rates;
  get diagnostics n = row_count; assert n = 0, 'aal1 deleted fx_rates';
  delete from public.portfolio_snapshots;
  get diagnostics n = row_count; assert n = 0, 'aal1 deleted snapshots';
end $$;

-- 4. aal1 inserts are rejected (RLS violation), on every table type.
do $$
declare stmt text;
begin
  foreach stmt in array array[
    $q$insert into public.accounts (name, account_type) values ('x', 'broker')$q$,
    $q$insert into public.assets (name, asset_type, trading_currency) values ('x', 'etf', 'EUR')$q$,
    $q$insert into public.ca_series (code, name, subscription_start, term_months)
         values ('Z', 'x', '2026-01-01', 12)$q$,
    $q$insert into public.fx_rates (currency, rate_date, rate_to_eur, source)
         values ('GBP', '2026-01-02', 1.17, 'x')$q$,
    $q$insert into public.ca_factors (subscription_id, month, factor, source)
         values ('c0000000-0000-4000-8000-000000000005', '2026-11-01', 1.02, 'x')$q$,
    $q$insert into public.import_batches (source, transactions_file_sha256)
         values ('x', repeat('d', 64))$q$,
    $q$insert into public.portfolio_snapshots
         (snapshot_date, total_value_eur, total_cost_basis_eur, net_contributions_eur, cash_eur,
          stock_value_eur, etf_value_eur, crypto_value_eur, certificado_aforro_value_eur)
         values ('2026-01-03', 0, 0, 0, 0, 0, 0, 0, 0)$q$
  ] loop
    begin
      execute stmt;
      raise exception 'aal1 insert succeeded: %', stmt;
    exception when insufficient_privilege then null;  -- 42501, expected
    end;
  end loop;
end $$;

-- 5. A token with no `aal` claim at all is treated like aal1 (fails closed).
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.transactions) = 0, 'token without aal can read';
end $$;

-- 6. Back at aal2: the data is intact and the aal1 attempts left no trace.
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  assert (select notes from public.transactions) = 'edited at aal2', 'aal1 changed a transaction';
  assert (select deleted_at from public.transactions) is null,       'aal1 soft-deleted a transaction';
  assert (select name from public.accounts) = 'Broker',              'aal1 changed an account';
  assert (select count(*) from public.accounts) = 1,                 'aal1 inserted an account';
  assert (select count(*) from public.prices) = 1,                   'aal1 deleted a price';
  assert (select count(*) from public.fx_rates) = 1,                 'aal1 changed fx_rates';
  assert (select count(*) from public.portfolio_snapshots) = 1,      'aal1 changed snapshots';
  assert (select count(*) from public.ca_factors) = 1,               'aal1 inserted a ca_factor';
end $$;

-- 7. Every table in public carries a restrictive aal2 policy (guards future tables).
reset role;
do $$
declare missing text;
begin
  select string_agg(t.tablename, ', ') into missing
  from pg_tables t
  where t.schemaname = 'public'
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.tablename
        and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
        and p.qual like '%aal2%' and p.with_check like '%aal2%'
    );
  assert missing is null, 'No restrictive aal2 policy on: ' || coalesce(missing, '');
end $$;

select 'aal2 enforcement: ALL CHECKS PASSED' as result;

rollback;
