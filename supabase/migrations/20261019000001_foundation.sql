-- Foundation: shared types, helpers and default privileges.
--
-- Conventions used by every table in this schema:
--   * id          uuid PK, default gen_random_uuid(); clients may supply their own
--                 UUID (v4 or v7) so rows can be created offline / imported idempotently.
--   * user_id     owner, default auth.uid(), FK to auth.users. RLS compares it to auth.uid().
--   * created_at / updated_at  timestamptz; updated_at maintained by trigger.
--   * deleted_at  soft delete, only on user-editable tables.
--   * Money, quantities, prices, rates: numeric(38,18). Never float.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.asset_type as enum ('stock', 'etf', 'crypto', 'certificado_aforro');

create type public.account_type as enum ('broker', 'exchange', 'wallet', 'platform');

create type public.transaction_type as enum (
  'buy',
  'sell',
  'dividend',
  'fee',
  'deposit',
  'withdrawal',
  'interest',
  'subscription',
  'redemption'
);

-- ISO 4217-style code: three upper-case letters.
create domain public.currency_code as char(3)
  check (value ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the anon role never touches application tables.
-- authenticated gets table privileges; RLS decides which rows.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
