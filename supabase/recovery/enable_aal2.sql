-- Turns the aal2 (MFA) requirement back on after supabase/recovery/disable_aal2.sql.
--
-- Recreates the restrictive *_require_aal2 policy on every table, as the migrations
-- define them (20261020000001_require_aal2.sql and the later migrations that added
-- tables). Safe to run more than once. Keep this list in step with new tables:
-- supabase/tests/rls_aal2.sql fails if any table lacks the policy.
--
-- Run in the Supabase Dashboard -> SQL Editor. See docs/recovery.md.

begin;

drop policy if exists assets_require_aal2 on public.assets;
create policy assets_require_aal2 on public.assets
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists accounts_require_aal2 on public.accounts;
create policy accounts_require_aal2 on public.accounts
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists transactions_require_aal2 on public.transactions;
create policy transactions_require_aal2 on public.transactions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists ca_series_require_aal2 on public.ca_series;
create policy ca_series_require_aal2 on public.ca_series
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists ca_subscriptions_require_aal2 on public.ca_subscriptions;
create policy ca_subscriptions_require_aal2 on public.ca_subscriptions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists ca_factors_require_aal2 on public.ca_factors;
create policy ca_factors_require_aal2 on public.ca_factors
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists import_batches_require_aal2 on public.import_batches;
create policy import_batches_require_aal2 on public.import_batches
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists prices_require_aal2 on public.prices;
create policy prices_require_aal2 on public.prices
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists fx_rates_require_aal2 on public.fx_rates;
create policy fx_rates_require_aal2 on public.fx_rates
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists portfolio_snapshots_require_aal2 on public.portfolio_snapshots;
create policy portfolio_snapshots_require_aal2 on public.portfolio_snapshots
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- Expect one *_require_aal2 policy per table.
select tablename, policyname, permissive
from pg_policies
where schemaname = 'public' and policyname like '%_require_aal2'
order by tablename;

commit;
