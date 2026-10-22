-- assets.trading_currency is the LISTING currency: the currency the price provider quotes
-- the asset in. Transactions carry their own currency and fx_rate_to_eur, so this column
-- never affects cost basis or gains; it tells the price fetcher what currency to expect.
--
-- The importer wrote 'EUR' for every asset (orders are EUR at fx 1). That is wrong for
-- listings on US exchanges, which quote in USD. This corrects them by exchange (MIC).
-- Xetra (XETR) listings and crypto quoted in EUR (BTCEUR) stay EUR.
--
-- Safe to re-run: it only touches rows that still say EUR.

comment on column public.assets.trading_currency is
  'Listing currency: what the price provider quotes (USD for XNAS/XNYS/XASE, EUR for XETR and BTCEUR). Transactions carry their own currency.';

update public.assets
set trading_currency = 'USD'
where exchange in ('XNAS', 'XNYS', 'XASE')
  and trading_currency = 'EUR'
  and deleted_at is null;
