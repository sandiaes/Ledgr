-- Stops the daily jobs (Dashboard -> SQL Editor). The functions stay deployed.
select cron.unschedule('ledgr-fx-daily');
select cron.unschedule('ledgr-prices-daily');
select cron.unschedule('ledgr-snapshot-daily');
drop function if exists public.ledgr_call_job(text);
