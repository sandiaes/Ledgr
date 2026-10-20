-- Require multi-factor authentication (aal2) for every row of every table.
--
-- Each policy below is RESTRICTIVE: Postgres combines it with AND on top of the existing
-- owner policies (user_id = auth.uid()). A request now needs BOTH:
--   1. to be the row's owner, and
--   2. a session token whose `aal` claim is 'aal2' (password + authenticator code).
-- A password-only session (aal1), or a token without an `aal` claim, matches no rows:
-- reads return nothing, writes are rejected.
--
-- Not affected (by design): the `postgres` role (SQL Editor) and the service-role key,
-- which bypass RLS. That is what makes recovery possible; see docs/recovery.md.
-- Undo script: supabase/recovery/disable_aal2.sql.

create policy assets_require_aal2 on public.assets
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy accounts_require_aal2 on public.accounts
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy transactions_require_aal2 on public.transactions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy ca_series_require_aal2 on public.ca_series
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy ca_subscriptions_require_aal2 on public.ca_subscriptions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy prices_require_aal2 on public.prices
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy fx_rates_require_aal2 on public.fx_rates
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy portfolio_snapshots_require_aal2 on public.portfolio_snapshots
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
