-- EMERGENCY ONLY: removes the aal2 (MFA) requirement added by
-- supabase/migrations/20261020000001_require_aal2.sql.
--
-- After this runs, a password-only sign-in can read and write your data again.
-- Ownership rules (RLS on user_id) stay in place: other users still see nothing.
--
-- Run in the Supabase Dashboard -> SQL Editor. Re-enable afterwards by running
-- supabase/recovery/enable_aal2.sql in the SQL Editor.
-- See docs/recovery.md before using this.

begin;

drop policy if exists assets_require_aal2              on public.assets;
drop policy if exists accounts_require_aal2            on public.accounts;
drop policy if exists transactions_require_aal2        on public.transactions;
drop policy if exists ca_series_require_aal2           on public.ca_series;
drop policy if exists ca_subscriptions_require_aal2    on public.ca_subscriptions;
drop policy if exists ca_factors_require_aal2          on public.ca_factors;
drop policy if exists import_batches_require_aal2      on public.import_batches;
drop policy if exists prices_require_aal2              on public.prices;
drop policy if exists fx_rates_require_aal2            on public.fx_rates;
drop policy if exists portfolio_snapshots_require_aal2 on public.portfolio_snapshots;

-- Show what is left: expect only the owner policies, none named *_require_aal2.
select tablename, policyname, permissive
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

commit;
