-- RLS isolation test. Proves user B cannot read or modify user A's data.
--
-- Run as the `postgres` role (Supabase SQL editor, or `psql "$DB_URL" -f this-file`).
-- Everything runs inside one transaction and is ROLLED BACK at the end: no data is kept.
-- Any failed check raises an exception and aborts. Success prints 'RLS isolation: ALL CHECKS PASSED'.

begin;

-- Two throwaway users (fixed UUIDs, rolled back at the end).
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'rls-a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'rls-b@example.test', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- As user A: create one row in every table.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}', true);

insert into public.accounts (id, name, account_type) values
  ('a0000000-0000-4000-8000-000000000001', 'A broker', 'broker');
insert into public.assets (id, name, asset_type, isin, trading_currency, price_source, price_source_id) values
  ('a0000000-0000-4000-8000-000000000002', 'A ETF', 'etf', 'IE00BK5BQT80', 'EUR', 'yahoo', 'VWCE.DE');
insert into public.transactions
  (id, account_id, asset_id, type, trade_date, quantity, unit_price, currency, fx_rate_to_eur, broker_order_id) values
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'buy', '2026-01-02', 1.5, 110.25, 'EUR', 1, 'ORD-1');
insert into public.ca_series (id, code, name, subscription_start, term_months, base_spread, rate_cap) values
  ('a0000000-0000-4000-8000-000000000004', 'F', 'Série F', '2023-06-05', 180, 0, 0.025);
insert into public.assets (id, name, asset_type, trading_currency, price_source) values
  ('a0000000-0000-4000-8000-000000000005', 'CA Série F', 'certificado_aforro', 'EUR', 'ca_accrual');
insert into public.transactions
  (id, account_id, asset_id, type, trade_date, quantity, unit_price, currency, fx_rate_to_eur) values
  ('a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000005', 'subscription', '2024-03-01', 1000, 1, 'EUR', 1);
insert into public.ca_subscriptions (series_id, transaction_id) values
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000006');
insert into public.prices (asset_id, price_date, close, currency, source) values
  ('a0000000-0000-4000-8000-000000000002', '2026-01-02', 111.00, 'EUR', 'yahoo');
insert into public.fx_rates (currency, rate_date, rate_to_eur, source) values
  ('USD', '2026-01-02', 0.92, 'ecb');
insert into public.portfolio_snapshots
  (snapshot_date, total_value_eur, total_cost_basis_eur, net_contributions_eur, cash_eur,
   stock_value_eur, etf_value_eur, crypto_value_eur, certificado_aforro_value_eur) values
  ('2026-01-02', 1166.5, 1165.375, 1165.375, 0, 0, 166.5, 0, 1000);

-- Sanity: A sees their own rows (so the checks below are not vacuously true).
do $$
begin
  assert (select count(*) from public.accounts) = 1,            'A should see 1 account';
  assert (select count(*) from public.assets) = 2,              'A should see 2 assets';
  assert (select count(*) from public.transactions) = 2,        'A should see 2 transactions';
  assert (select count(*) from public.ca_series) = 1,           'A should see 1 ca_series';
  assert (select count(*) from public.ca_subscriptions) = 1,    'A should see 1 ca_subscription';
  assert (select count(*) from public.prices) = 1,              'A should see 1 price';
  assert (select count(*) from public.fx_rates) = 1,            'A should see 1 fx_rate';
  assert (select count(*) from public.portfolio_snapshots) = 1, 'A should see 1 snapshot';
end $$;

-- ---------------------------------------------------------------------------
-- As user B: try to read and tamper with A's data.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}', true);

-- 1. B reads nothing from any table.
do $$
begin
  assert (select count(*) from public.accounts) = 0,            'B can read accounts';
  assert (select count(*) from public.assets) = 0,              'B can read assets';
  assert (select count(*) from public.transactions) = 0,        'B can read transactions';
  assert (select count(*) from public.ca_series) = 0,           'B can read ca_series';
  assert (select count(*) from public.ca_subscriptions) = 0,    'B can read ca_subscriptions';
  assert (select count(*) from public.prices) = 0,              'B can read prices';
  assert (select count(*) from public.fx_rates) = 0,            'B can read fx_rates';
  assert (select count(*) from public.portfolio_snapshots) = 0, 'B can read snapshots';
end $$;

-- 2. B's UPDATE / DELETE against A's rows affect 0 rows.
do $$
declare n int;
begin
  update public.transactions set notes = 'pwned' where id = 'a0000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count; assert n = 0, 'B updated A''s transaction';

  update public.transactions set deleted_at = now();
  get diagnostics n = row_count; assert n = 0, 'B soft-deleted A''s transactions';

  update public.assets set name = 'pwned';
  get diagnostics n = row_count; assert n = 0, 'B updated A''s assets';

  delete from public.prices;
  get diagnostics n = row_count; assert n = 0, 'B deleted A''s prices';

  delete from public.fx_rates;
  get diagnostics n = row_count; assert n = 0, 'B deleted A''s fx_rates';

  delete from public.portfolio_snapshots;
  get diagnostics n = row_count; assert n = 0, 'B deleted A''s snapshots';
end $$;

-- 3. B cannot insert rows owned by A (RLS WITH CHECK).
do $$
begin
  begin
    insert into public.accounts (user_id, name, account_type)
      values ('aaaaaaaa-0000-4000-8000-00000000000a', 'planted', 'broker');
    raise exception 'B inserted a row owned by A';
  exception when insufficient_privilege then null;  -- 42501: RLS violation, expected
  end;
end $$;

-- 4. B cannot attach own rows to A's account/asset (composite same-owner FKs).
insert into public.accounts (id, name, account_type) values
  ('b0000000-0000-4000-8000-000000000001', 'B broker', 'broker');
do $$
begin
  begin
    insert into public.transactions (account_id, asset_id, type, trade_date, quantity, unit_price, currency, fx_rate_to_eur)
      values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
              'buy', '2026-01-02', 1, 1, 'EUR', 1);
    raise exception 'B referenced A''s asset';
  exception when foreign_key_violation then null;  -- 23503, expected
  end;
  begin
    insert into public.prices (asset_id, price_date, close, currency, source)
      values ('a0000000-0000-4000-8000-000000000002', '2026-01-03', 1, 'EUR', 'x');
    raise exception 'B wrote a price for A''s asset';
  exception when foreign_key_violation then null;
  end;
end $$;

-- 5. B cannot hand a row over to A (UPDATE WITH CHECK).
do $$
begin
  begin
    update public.accounts set user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'
      where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'B reassigned own row to A';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. Hard DELETE on ledger tables is refused even for the owner.
do $$
begin
  begin
    delete from public.accounts where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'authenticated can hard-delete accounts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 7. The anon role (no login) has no access at all.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['accounts','assets','transactions','ca_series','ca_subscriptions',
                           'prices','fx_rates','portfolio_snapshots'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'anon can read %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- 8. Every table in public has RLS enabled.
reset role;
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert missing is null, 'RLS disabled on: ' || coalesce(missing, '');
end $$;

select 'RLS isolation: ALL CHECKS PASSED' as result;

rollback;
