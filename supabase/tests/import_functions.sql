-- Importer functions test (ledgr_import_commit, ledgr_import_undo).
-- Proves: only service_role may execute them, search_path is fixed, a commit is atomic,
-- and an undo deletes exactly the rows of the given batch of the given user.
--
-- Run as the `postgres` role (Supabase SQL Editor, or `psql "$DB_URL" -f this-file`)
-- AFTER applying 20261021000006_import_functions.sql.
-- Everything is ROLLED BACK at the end: no data is kept.
-- Any failed check raises an exception. Success prints 'import functions: ALL CHECKS PASSED'.

begin;

insert into auth.users (id, email, aud, role) values
  ('dddddddd-0000-4000-8000-00000000000d', 'imp-a@example.test', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-00000000000e', 'imp-b@example.test', 'authenticated', 'authenticated');

-- 1. Privileges and configuration.
do $$
declare
  f text;
begin
  foreach f in array array['public.ledgr_import_commit(uuid, jsonb)',
                           'public.ledgr_import_undo(uuid, uuid)'] loop
    assert not has_function_privilege('anon', f, 'execute'),          'anon can execute ' || f;
    assert not has_function_privilege('authenticated', f, 'execute'), 'authenticated can execute ' || f;
    assert has_function_privilege('service_role', f, 'execute'),      'service_role cannot execute ' || f;
    -- No EXECUTE for PUBLIC (grantee oid 0) in the ACL.
    assert not exists (
      select 1 from pg_proc p, aclexplode(p.proacl) a
      where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ), 'PUBLIC can execute ' || f;
    -- Fixed, empty search_path; runs with the caller's rights.
    assert (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'],
      'search_path not fixed on ' || f;
    assert not (select prosecdef from pg_proc where oid = f::regprocedure),
      f || ' is SECURITY DEFINER';
  end loop;
end $$;

-- 2. A normal authenticated session (even at aal2) and anon cannot call them.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-4000-8000-00000000000d","role":"authenticated","aal":"aal2"}', true);
do $$
declare stmt text;
begin
  foreach stmt in array array[
    $q$select public.ledgr_import_commit('dddddddd-0000-4000-8000-00000000000d',
         '{"source":"x","transactions_file_sha256":"0000000000000000000000000000000000000000000000000000000000000000"}')$q$,
    $q$select public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d',
         'd0000000-0000-4000-8000-000000000000')$q$
  ] loop
    begin
      execute stmt;
      raise exception 'authenticated could run: %', stmt;
    exception when insufficient_privilege then null;  -- 42501, expected
    end;
  end loop;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d',
      'd0000000-0000-4000-8000-000000000000');
    raise exception 'anon could run ledgr_import_undo';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A manual (non-imported) account of user A, and one of user B.
insert into public.accounts (id, user_id, name, account_type) values
  ('d0000000-0000-4000-8000-0000000000a0', 'dddddddd-0000-4000-8000-00000000000d', 'Manual A', 'broker'),
  ('e0000000-0000-4000-8000-0000000000b0', 'eeeeeeee-0000-4000-8000-00000000000e', 'Manual B', 'broker');

-- 3. As service_role: commit three batches (two for A, one for B).
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Batch ids are kept in transaction-local settings (imp.a1, imp.a2, imp.b1).
-- Batch A1: an account, a stock asset, a CA series/asset/subscription/factor and three
-- transactions given out of seq order (seq, not array order, decides created_at).
select set_config('imp.a1', public.ledgr_import_commit(
  'dddddddd-0000-4000-8000-00000000000d',
  $j${
    "source": "test", "transactions_file_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
    "ca_file_sha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "ca_ratio_month": "2026-10-01", "settings": {"delimiter": ","},
    "accounts": [{"id": "d0000000-0000-4000-8000-000000000001", "name": "Degiro", "account_type": "broker"}],
    "assets": [
      {"id": "d0000000-0000-4000-8000-000000000002", "name": "GameStop", "asset_type": "stock",
       "isin": null, "ticker": "GME", "exchange": null, "trading_currency": "EUR",
       "price_source": "manual", "price_source_id": null},
      {"id": "d0000000-0000-4000-8000-000000000003", "name": "CA Série E", "asset_type": "certificado_aforro",
       "isin": null, "ticker": "E", "exchange": null, "trading_currency": "EUR",
       "price_source": "ca_factors", "price_source_id": null}],
    "ca_series": [{"id": "d0000000-0000-4000-8000-000000000004", "code": "E", "name": "Série E"}],
    "transactions": [
      {"id": "d0000000-0000-4000-8000-000000000012", "seq": 2, "account_id": "d0000000-0000-4000-8000-000000000001",
       "asset_id": "d0000000-0000-4000-8000-000000000002", "type": "sell", "trade_date": "2021-02-01",
       "trade_date_precision": "month", "quantity": "5", "unit_price": "40.5", "currency": "EUR",
       "fx_rate_to_eur": "1", "import_row_hash": "a000000000000000000000000000000000000000000000000000000000000002"},
      {"id": "d0000000-0000-4000-8000-000000000011", "seq": 1, "account_id": "d0000000-0000-4000-8000-000000000001",
       "asset_id": "d0000000-0000-4000-8000-000000000002", "type": "buy", "trade_date": "2021-02-01",
       "trade_date_precision": "month", "quantity": "10", "unit_price": "42.1713", "currency": "EUR",
       "fx_rate_to_eur": "1", "import_row_hash": "a000000000000000000000000000000000000000000000000000000000000001"},
      {"id": "d0000000-0000-4000-8000-000000000013", "seq": 3, "account_id": "d0000000-0000-4000-8000-0000000000a0",
       "asset_id": "d0000000-0000-4000-8000-000000000003", "type": "subscription", "trade_date": "2023-01-01",
       "trade_date_precision": "month", "quantity": "36000", "unit_price": "1", "currency": "EUR",
       "fx_rate_to_eur": "1", "import_row_hash": "a000000000000000000000000000000000000000000000000000000000000003"}],
    "ca_subscriptions": [{"id": "d0000000-0000-4000-8000-000000000005",
       "series_id": "d0000000-0000-4000-8000-000000000004", "transaction_id": "d0000000-0000-4000-8000-000000000013"}],
    "ca_factors": [{"subscription_id": "d0000000-0000-4000-8000-000000000005", "month": "2026-10-01",
       "factor": "1.10482", "source": "excel", "notes": null}]
  }$j$::jsonb)::text, true);

-- Batch A2: one more transaction on A1's account (so A1's account is referenced from A2).
select set_config('imp.a2', public.ledgr_import_commit(
  'dddddddd-0000-4000-8000-00000000000d',
  $j${
    "source": "test", "transactions_file_sha256": "3333333333333333333333333333333333333333333333333333333333333333",
    "transactions": [
      {"id": "d0000000-0000-4000-8000-000000000021", "seq": 1, "account_id": "d0000000-0000-4000-8000-0000000000a0",
       "asset_id": "d0000000-0000-4000-8000-000000000002", "type": "buy", "trade_date": "2022-01-01",
       "trade_date_precision": "month", "quantity": "1", "unit_price": "100", "currency": "EUR",
       "fx_rate_to_eur": "1", "import_row_hash": "a000000000000000000000000000000000000000000000000000000000000021"}]
  }$j$::jsonb)::text, true);

-- Batch B1 for user B.
select set_config('imp.b1', public.ledgr_import_commit(
  'eeeeeeee-0000-4000-8000-00000000000e',
  $j${
    "source": "test", "transactions_file_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
    "accounts": [{"id": "e0000000-0000-4000-8000-000000000001", "name": "Degiro", "account_type": "broker"}]
  }$j$::jsonb)::text, true);

do $$
declare
  a1 uuid := current_setting('imp.a1')::uuid;
begin
  -- Every row carries the given user and batch.
  assert (select count(*) from public.transactions
          where import_batch_id = a1 and user_id = 'dddddddd-0000-4000-8000-00000000000d') = 3,
    'A1 transactions not written for A';
  assert (select count(*) from public.ca_factors where import_batch_id = a1) = 1, 'A1 factor missing';
  assert (select factor from public.ca_factors where import_batch_id = a1) = 1.10482,
    'A1 factor value changed in transit';
  -- created_at follows seq: buy (seq 1) < sell (seq 2) < subscription (seq 3).
  assert (select created_at from public.transactions where id = 'd0000000-0000-4000-8000-000000000011')
       < (select created_at from public.transactions where id = 'd0000000-0000-4000-8000-000000000012')
     and (select created_at from public.transactions where id = 'd0000000-0000-4000-8000-000000000012')
       < (select created_at from public.transactions where id = 'd0000000-0000-4000-8000-000000000013'),
    'created_at does not follow seq';
end $$;

-- 4. A commit is atomic: one bad row (A referencing B's account) writes nothing.
do $$
declare before_batches bigint := (select count(*) from public.import_batches);
begin
  begin
    perform public.ledgr_import_commit('dddddddd-0000-4000-8000-00000000000d', $j${
      "source": "test", "transactions_file_sha256": "4444444444444444444444444444444444444444444444444444444444444444",
      "accounts": [{"id": "d0000000-0000-4000-8000-000000000041", "name": "New", "account_type": "broker"}],
      "transactions": [
        {"id": "d0000000-0000-4000-8000-000000000042", "seq": 1, "account_id": "e0000000-0000-4000-8000-000000000001",
         "asset_id": "d0000000-0000-4000-8000-000000000002", "type": "buy", "trade_date": "2022-01-01",
         "trade_date_precision": "month", "quantity": "1", "unit_price": "1", "currency": "EUR",
         "fx_rate_to_eur": "1", "import_row_hash": "a000000000000000000000000000000000000000000000000000000000000042"}]
    }$j$::jsonb);
    raise exception 'commit referencing another user''s account succeeded';
  exception when foreign_key_violation then null;
  end;
  assert (select count(*) from public.import_batches) = before_batches, 'failed commit left a batch';
  assert not exists (select 1 from public.accounts where id = 'd0000000-0000-4000-8000-000000000041'),
    'failed commit left an account';

  -- The same file cannot be committed twice while its batch stands.
  begin
    perform public.ledgr_import_commit('dddddddd-0000-4000-8000-00000000000d', $j${
      "source": "test", "transactions_file_sha256": "1111111111111111111111111111111111111111111111111111111111111111"
    }$j$::jsonb);
    raise exception 'same file committed twice';
  exception when unique_violation then null;
  end;
end $$;

-- A manual (non-imported) transaction of A on A1's GME asset and A's manual account.
reset role;
insert into public.transactions
  (id, user_id, account_id, asset_id, type, trade_date, quantity, unit_price, currency, fx_rate_to_eur)
values ('d0000000-0000-4000-8000-0000000000f1', 'dddddddd-0000-4000-8000-00000000000d',
        'd0000000-0000-4000-8000-0000000000a0', 'd0000000-0000-4000-8000-000000000002',
        'buy', '2024-01-02', 1, 1, 'EUR', 1);
set local role service_role;

-- 5. Undo of A1 is refused while rows outside the batch use its rows (A2's and the manual
--    transaction use A1's GME asset), and the refusal changes nothing.
do $$
declare a1 uuid := current_setting('imp.a1')::uuid;
begin
  begin
    perform public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d', a1);
    raise exception 'undo deleted rows still referenced from outside the batch';
  exception when foreign_key_violation then null;
  end;
  assert (select count(*) from public.transactions where import_batch_id = a1) = 3, 'refused undo deleted rows';
  assert (select undone_at from public.import_batches where id = a1) is null, 'refused undo marked the batch';
end $$;

-- Remove the outside references, then undo A1.
reset role;
delete from public.transactions where id = 'd0000000-0000-4000-8000-0000000000f1';
set local role service_role;
select public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d', current_setting('imp.a2')::uuid);

do $$
declare
  a1 uuid := current_setting('imp.a1')::uuid;
  b1 uuid := current_setting('imp.b1')::uuid;
  counts jsonb;
begin
  -- Undo with the wrong user id is refused and leaves B's batch intact.
  begin
    perform public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d', b1);
    raise exception 'A undid B''s batch';
  exception when raise_exception then
    if sqlerrm not like 'No live import batch%' then raise; end if;
  end;
  assert (select count(*) from public.accounts where import_batch_id = b1) = 1, 'B1 rows touched';

  counts := public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d', a1);
  assert counts = '{"ca_factors":1,"ca_subscriptions":1,"transactions":3,"ca_series":1,"assets":2,"accounts":1}'::jsonb,
    'unexpected undo counts: ' || counts::text;

  -- Only A1's rows are gone.
  assert not exists (select 1 from public.transactions where import_batch_id = a1), 'A1 transactions left';
  assert not exists (select 1 from public.accounts where import_batch_id = a1), 'A1 account left';
  assert (select undone_at from public.import_batches where id = a1) is not null, 'A1 not marked undone';
  assert exists (select 1 from public.accounts where id = 'd0000000-0000-4000-8000-0000000000a0'),
    'manual account of A deleted';
  assert exists (select 1 from public.accounts where id = 'e0000000-0000-4000-8000-0000000000b0'),
    'manual account of B deleted';
  assert (select count(*) from public.accounts where import_batch_id = b1) = 1, 'B1 account deleted';

  -- A batch cannot be undone twice.
  begin
    perform public.ledgr_import_undo('dddddddd-0000-4000-8000-00000000000d', a1);
    raise exception 'undo ran twice';
  exception when raise_exception then
    if sqlerrm not like 'No live import batch%' then raise; end if;
  end;

  -- After undo, the same file may be imported again.
  perform public.ledgr_import_commit('dddddddd-0000-4000-8000-00000000000d', $j${
    "source": "test", "transactions_file_sha256": "1111111111111111111111111111111111111111111111111111111111111111"
  }$j$::jsonb);
end $$;

reset role;
select 'import functions: ALL CHECKS PASSED' as result;

rollback;
