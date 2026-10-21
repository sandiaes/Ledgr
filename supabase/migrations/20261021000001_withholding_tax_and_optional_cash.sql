-- Withholding tax on income rows, optional cash in snapshots, and the meaning of the
-- certificado manual value.

-- ---------------------------------------------------------------------------
-- transactions.withholding_tax
-- Tax withheld at source on a dividend or interest row, in `currency`, as recorded from
-- the broker statement (never computed). `amount` stays gross; the cash received is
-- amount - withholding_tax - fees. Withholding is not a fee.
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column withholding_tax numeric(38, 18),
  add constraint transactions_withholding_tax_check check (
    withholding_tax is null
    or (
      type in ('dividend', 'interest')
      and withholding_tax >= 0
      and withholding_tax <= amount
    )
  );

-- ---------------------------------------------------------------------------
-- portfolio_snapshots.cash_eur
-- Cash is only tracked when the ledger records deposits. Otherwise cash_eur is null and
-- total_value_eur is the positions alone.
-- ---------------------------------------------------------------------------

alter table public.portfolio_snapshots
  alter column cash_eur drop not null;

comment on column public.portfolio_snapshots.cash_eur is
  'Cash in EUR; null when cash is not tracked (no deposits recorded). Included in total_value_eur only when not null.';

-- ---------------------------------------------------------------------------
-- ca_subscriptions.manual_value
-- ---------------------------------------------------------------------------

comment on column public.ca_subscriptions.manual_value is
  'What AforroNet shows on manual_value_date, net (after the withholding on every capitalisation so far), in EUR, for the units still held on that date.';
