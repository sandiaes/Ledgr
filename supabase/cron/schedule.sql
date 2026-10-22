-- Schedules the three daily jobs with pg_cron + pg_net. NOT a migration: run it by hand in
-- Dashboard -> SQL Editor only after the functions are deployed and tested (docs/prices.md).
-- Safe to re-run: cron.schedule replaces a job with the same name.
--
-- Prerequisites (docs/prices.md, "Schedule"):
--   * extensions pg_cron and pg_net enabled (Dashboard -> Database -> Extensions)
--   * two Vault secrets, created once in the SQL Editor:
--       select vault.create_secret('https://<project-ref>.supabase.co', 'ledgr_project_url');
--       select vault.create_secret('<the same value as LEDGR_CRON_SECRET>', 'ledgr_cron_secret');
--
-- Times are UTC (pg_cron). Every day, because bitcoin trades at weekends:
--   05:15 fx-daily       ECB rates (published ~16:00 CET the day before)
--   05:25 prices-daily   closes up to yesterday (US close 20:00/21:00 UTC; Xetra 16:30 UTC)
--   05:40 snapshot-daily snapshots from the 1st of last month to yesterday
-- The secret is read from Vault at run time, so it never appears in cron.job.

create or replace function public.ledgr_call_job(fn text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ledgr_project_url')
           || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ledgr-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'ledgr_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;

-- Only the cron runner (postgres) may call it.
revoke all on function public.ledgr_call_job(text) from public, anon, authenticated;

select cron.schedule('ledgr-fx-daily',       '15 5 * * *', $$select public.ledgr_call_job('fx-daily')$$);
select cron.schedule('ledgr-prices-daily',   '25 5 * * *', $$select public.ledgr_call_job('prices-daily')$$);
select cron.schedule('ledgr-snapshot-daily', '40 5 * * *', $$select public.ledgr_call_job('snapshot-daily')$$);
