-- Atomic commit and undo for the one-off spreadsheet importer (scripts/import).
--
-- Each function runs in one transaction: a commit writes the whole batch or nothing, an
-- undo removes the whole batch or nothing.
--
-- Security:
--   * EXECUTE is revoked from public, anon and authenticated and granted only to
--     service_role (Supabase's default privileges would otherwise grant it to everyone).
--   * SECURITY INVOKER: they run with the caller's rights. The service role bypasses RLS,
--     so every row is written with the explicit p_user_id, and every reference to an
--     existing account, asset or subscription goes through the same-owner composite FKs,
--     which reject another user's rows.
--   * search_path is fixed to '' and every name is schema-qualified.

-- ---------------------------------------------------------------------------
-- ledgr_import_commit(p_user_id, p_batch) -> the new import_batches.id
--
-- p_batch (all ids are client-generated UUIDs; numbers are JSON strings, never floats):
--   { "source", "transactions_file_sha256", "ca_file_sha256", "ca_ratio_month", "settings",
--     "accounts":         [{ "id", "name", "account_type" }],
--     "assets":           [{ "id", "name", "asset_type", "isin", "ticker", "exchange",
--                            "trading_currency", "price_source", "price_source_id" }],
--     "ca_series":        [{ "id", "code", "name" }],
--     "transactions":     [{ "id", "seq", "account_id", "asset_id", "type", "trade_date",
--                            "trade_date_precision", "quantity", "unit_price", "currency",
--                            "fx_rate_to_eur", "import_row_hash", "notes" }],
--     "ca_subscriptions": [{ "id", "series_id", "transaction_id" }],
--     "ca_factors":       [{ "subscription_id", "month", "factor", "source", "notes" }] }
--
-- Transactions get created_at = start of the call + seq microseconds, so rows of one
-- date keep the file's order (FIFO within a month follows file order).
-- ---------------------------------------------------------------------------

create function public.ledgr_import_commit(p_user_id uuid, p_batch jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid;
  v_base  timestamptz := clock_timestamp();
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  insert into public.import_batches
    (user_id, source, transactions_file_sha256, ca_file_sha256, ca_ratio_month, settings)
  values (
    p_user_id,
    p_batch ->> 'source',
    p_batch ->> 'transactions_file_sha256',
    p_batch ->> 'ca_file_sha256',
    (p_batch ->> 'ca_ratio_month')::date,
    coalesce(p_batch -> 'settings', '{}'::jsonb)
  )
  returning id into v_batch;

  insert into public.accounts (id, user_id, name, account_type, import_batch_id)
  select (a ->> 'id')::uuid, p_user_id, a ->> 'name',
         (a ->> 'account_type')::public.account_type, v_batch
  from jsonb_array_elements(coalesce(p_batch -> 'accounts', '[]'::jsonb)) a;

  insert into public.assets
    (id, user_id, name, asset_type, isin, ticker, exchange, trading_currency,
     price_source, price_source_id, import_batch_id)
  select (a ->> 'id')::uuid, p_user_id, a ->> 'name', (a ->> 'asset_type')::public.asset_type,
         a ->> 'isin', a ->> 'ticker', a ->> 'exchange', a ->> 'trading_currency',
         a ->> 'price_source', a ->> 'price_source_id', v_batch
  from jsonb_array_elements(coalesce(p_batch -> 'assets', '[]'::jsonb)) a;

  insert into public.ca_series (id, user_id, code, name, import_batch_id)
  select (s ->> 'id')::uuid, p_user_id, s ->> 'code', s ->> 'name', v_batch
  from jsonb_array_elements(coalesce(p_batch -> 'ca_series', '[]'::jsonb)) s;

  insert into public.transactions
    (id, user_id, account_id, asset_id, type, trade_date, trade_date_precision, quantity,
     unit_price, currency, fx_rate_to_eur, import_batch_id, import_row_hash, notes, created_at,
     updated_at)
  select (t ->> 'id')::uuid, p_user_id, (t ->> 'account_id')::uuid, (t ->> 'asset_id')::uuid,
         (t ->> 'type')::public.transaction_type, (t ->> 'trade_date')::date,
         (t ->> 'trade_date_precision')::public.date_precision,
         (t ->> 'quantity')::numeric, (t ->> 'unit_price')::numeric, t ->> 'currency',
         (t ->> 'fx_rate_to_eur')::numeric, v_batch, t ->> 'import_row_hash', t ->> 'notes',
         v_base + (t ->> 'seq')::bigint * interval '1 microsecond',
         v_base + (t ->> 'seq')::bigint * interval '1 microsecond'
  from jsonb_array_elements(coalesce(p_batch -> 'transactions', '[]'::jsonb)) t;

  insert into public.ca_subscriptions (id, user_id, series_id, transaction_id, import_batch_id)
  select (s ->> 'id')::uuid, p_user_id, (s ->> 'series_id')::uuid,
         (s ->> 'transaction_id')::uuid, v_batch
  from jsonb_array_elements(coalesce(p_batch -> 'ca_subscriptions', '[]'::jsonb)) s;

  insert into public.ca_factors
    (user_id, subscription_id, month, factor, source, notes, import_batch_id)
  select p_user_id, (f ->> 'subscription_id')::uuid, (f ->> 'month')::date,
         (f ->> 'factor')::numeric, f ->> 'source', f ->> 'notes', v_batch
  from jsonb_array_elements(coalesce(p_batch -> 'ca_factors', '[]'::jsonb)) f;

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- ledgr_import_undo(p_user_id, p_batch_id) -> rows deleted per table
--
-- Deletes exactly the rows carrying import_batch_id = p_batch_id AND user_id = p_user_id,
-- children first, then marks the batch undone (the batch row is kept as a record, and its
-- files may be imported again). Fails, changing nothing, if the batch is not a live batch
-- of that user, or if rows outside the batch still reference it (e.g. a later batch or a
-- manual entry uses an account it created): the FKs refuse the delete.
-- ---------------------------------------------------------------------------

create function public.ledgr_import_undo(p_user_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n      bigint;
begin
  perform 1 from public.import_batches
  where id = p_batch_id and user_id = p_user_id and undone_at is null
  for update;
  if not found then
    raise exception 'No live import batch % for this user', p_batch_id;
  end if;

  delete from public.ca_factors where import_batch_id = p_batch_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('ca_factors', v_n);

  delete from public.ca_subscriptions where import_batch_id = p_batch_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('ca_subscriptions', v_n);

  delete from public.transactions where import_batch_id = p_batch_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('transactions', v_n);

  delete from public.ca_series where import_batch_id = p_batch_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('ca_series', v_n);

  delete from public.assets where import_batch_id = p_batch_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('assets', v_n);

  delete from public.accounts where import_batch_id = p_batch_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('accounts', v_n);

  update public.import_batches set undone_at = now() where id = p_batch_id;

  return v_counts;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service_role only.
-- ---------------------------------------------------------------------------

revoke execute on function public.ledgr_import_commit(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ledgr_import_undo(uuid, uuid)    from public, anon, authenticated;
grant  execute on function public.ledgr_import_commit(uuid, jsonb) to service_role;
grant  execute on function public.ledgr_import_undo(uuid, uuid)    to service_role;
