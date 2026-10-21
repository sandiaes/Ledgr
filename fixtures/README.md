# Sample fixtures for the Ledgr importer

Anonymized copies of the Excel data, for building and testing the importer without real figures.
Do not use them for real calculations.

## Files

- `sample_transactions.csv`: 140 rows, same columns as the Excel transactions table
  (Month, Type, Transact Type, Ticker/Type, Units, Order Price, Order Value, Broker)
- `sample_ca.csv`: certificados de aforro table, one row per subscription month
  (Type = series, Order Date, Units, Ratio)
- `asset_mapping.csv`: the importer's asset mapping template, pre-filled from these fixtures
  (asset types, EUR); copy it to `import-data/` and complete it (see `docs/import.md`)

## What was changed

- **Units:** multiplied by a random factor per ticker (the same factor for every row of that ticker,
  so holdings stay consistent and no sell exceeds its holdings).
- **Order Price:** multiplied by a random factor per ticker. CA rows keep Order Price = 1.
- **Order Value:** recalculated as Units x Order Price, rounded to 2 decimals.
- **CA units:** scaled the same way. CA ratios (the factors published for each subscription month)
  are kept as they were.

## What was kept (on purpose, so the tests are realistic)

- Row order, dates (all on the 1st of a month) and the Broker column.
- Tickers, asset types and brokers (Degiro, IBKR, Kraken, Aforro), so the ticker mapping step
  can be tested with all 24 tickers.
- Edge cases: 13 sells with negative units; a ticker (SXR8) held at two brokers and typed as both
  ETFs and Stocks; fractional crypto units; CA rows in pairs per month that group into 3 subscriptions.

## Known format caveat

These files use commas as separators, dots as decimals and ISO dates (YYYY-MM-DD). A CSV exported from
Excel with a Portuguese regional setting may use semicolons, decimal commas and dates like 01/01/2021.
The importer should detect and handle both, and should be tested against a few real-format rows.
