-- Prices, snapshot flags and job_runs test (migrations 20261022000001 and 20261022000002).
--
-- Run as the `postgres` role (Supabase SQL Editor, or `psql "$DB_URL" -f this-file`)
-- AFTER applying both migrations. Everything is ROLLED BACK at the end: no data is kept.
-- Any failed check raises an exception. Success prints 'prices and jobs: ALL CHECKS PASSED'.

begin;

insert into auth.users (id, email, aud, role) values
  ('dddddddd-0000-4000-8000-00000000000d', 'prices-a@example.test', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-00000000000e', 'prices-b@example.test', 'authenticated', 'authenticated');

-- As postgres (like the service role, which bypasses RLS and sets user_id explicitly).
insert into public.assets (id, user_id, name, asset_type, ticker, exchange, trading_currency, price_source, price_source_id) values
  ('d0000000-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-00000000000d', 'Apple', 'stock', 'AAPL', 'XNAS', 'EUR', 'tiingo', 'AAPL'),
  ('d0000000-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-00000000000d', 'VWCE', 'etf', 'VWCE', 'XETR', 'EUR', 'alphavantage', 'VWCE.DEX');
insert into public.job_runs (user_id, job, trigger, started_at, finished_at, status, counts, issues) values
  ('dddddddd-0000-4000-8000-00000000000d', 'prices', 'cron', now(), now(), 'ok', '{"rows": 3}', '[]');

-- 1. The listing-currency correction (same statement as the migration) fixes US listings only.
update public.assets set trading_currency = 'USD'
where exchange in ('XNAS', 'XNYS', 'XASE') and trading_currency = 'EUR' and deleted_at is null;
do $$
begin
  assert (select trading_currency from public.assets where ticker = 'AAPL') = 'USD', 'AAPL not USD';
  assert (select trading_currency from public.assets where ticker = 'VWCE') = 'EUR', 'VWCE changed';
end $$;

-- 2. Column checks.
do $$
declare msg text;
begin
  insert into public.prices (user_id, asset_id, price_date, close, currency, source, split_factor) values
    ('dddddddd-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-000000000001', '2022-06-06', 124.79, 'USD', 'tiingo', 20);

  msg := 'no error';
  begin
    insert into public.prices (user_id, asset_id, price_date, close, currency, source, split_factor) values
      ('dddddddd-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-000000000001', '2022-06-07', 1, 'USD', 'tiingo', 1);
  exception when check_violation then msg := 'rejected';
  end;
  assert msg = 'rejected', 'split_factor 1 accepted';

  msg := 'no error';
  begin
    insert into public.portfolio_snapshots
      (user_id, snapshot_date, total_value_eur, total_cost_basis_eur, net_contributions_eur,
       stock_value_eur, etf_value_eur, crypto_value_eur, certificado_aforro_value_eur, ca_value_source)
    values ('dddddddd-0000-4000-8000-00000000000d', '2024-01-02', 1, 1, 1, 0, 0, 0, 1, 'factor');
  exception when check_violation then msg := 'rejected';
  end;
  assert msg = 'rejected', 'ca_value_source without as_of/age accepted';

  insert into public.portfolio_snapshots
    (user_id, snapshot_date, total_value_eur, total_cost_basis_eur, net_contributions_eur,
     stock_value_eur, etf_value_eur, crypto_value_eur, certificado_aforro_value_eur,
     stale, stale_asset_count, ca_value_source, ca_value_as_of, ca_value_age_days, ca_value_stale, valuation_flags)
  values ('dddddddd-0000-4000-8000-00000000000d', '2024-01-03', 1, 1, 1, 0, 0, 0, 1,
          true, 1, 'factor', '2023-11-01', 63, true,
          '[{"asset_id":"x","source":"factor","as_of":"2023-11-01","age_days":63,"stale":true}]');

  msg := 'no error';
  begin
    insert into public.job_runs (user_id, job, trigger, started_at, finished_at, status) values
      ('dddddddd-0000-4000-8000-00000000000d', 'deploy', 'cron', now(), now(), 'ok');
  exception when check_violation then msg := 'rejected';
  end;
  assert msg = 'rejected', 'unknown job accepted';
end $$;

-- 3. job_runs: the owner (aal2) can read, nobody can write through the API.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-4000-8000-00000000000d","role":"authenticated","aal":"aal2"}', true);
do $$
declare msg text;
begin
  assert (select count(*) from public.job_runs) = 1, 'owner cannot read job_runs';
  assert (select count(*) from public.prices) = 1, 'owner cannot read prices';
  msg := 'no error';
  begin
    insert into public.job_runs (job, trigger, started_at, finished_at, status)
    values ('fx', 'cron', now(), now(), 'ok');
  exception when insufficient_privilege then msg := 'refused';
  end;
  assert msg = 'refused', 'owner could insert job_runs';
  msg := 'no error';
  begin
    update public.job_runs set status = 'failed';
  exception when insufficient_privilege then msg := 'refused';
  end;
  assert msg = 'refused', 'owner could update job_runs';
  msg := 'no error';
  begin
    delete from public.job_runs;
  exception when insufficient_privilege then msg := 'refused';
  end;
  assert msg = 'refused', 'owner could delete job_runs';
end $$;

-- Password-only session of the same user: nothing.
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-4000-8000-00000000000d","role":"authenticated","aal":"aal1"}', true);
do $$
begin
  assert (select count(*) from public.job_runs) = 0, 'aal1 can read job_runs';
end $$;

-- Another user (aal2): nothing.
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-4000-8000-00000000000e","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  assert (select count(*) from public.job_runs) = 0, 'B can read A''s job_runs';
  assert (select count(*) from public.prices) = 0, 'B can read A''s prices';
  assert (select count(*) from public.portfolio_snapshots) = 0, 'B can read A''s snapshots';
end $$;

-- anon: no access at all.
reset role;
set local role anon;
do $$
declare msg text := 'no error';
begin
  begin
    perform count(*) from public.job_runs;
  exception when insufficient_privilege then msg := 'refused';
  end;
  assert msg = 'refused', 'anon can read job_runs';
end $$;

-- 4. Every table in public has RLS enabled.
reset role;
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert missing is null, 'RLS disabled on: ' || coalesce(missing, '');
end $$;

select 'prices and jobs: ALL CHECKS PASSED' as result;

rollback;
