# Importing the spreadsheet (one-off)

`scripts/import` loads the two tables from your Excel into Supabase: the **transactions** table
and the **certificados de aforro (CA)** table. It runs on your computer only, with the
service-role key from a git-ignored `.env`; nothing of it ships in an app.

- **dry-run** (the default) validates every row, prints the detected CSV settings, counts and
  totals, and writes detailed reports. It never writes to the database.
- **commit** does the same, then writes everything in one transaction after you type the
  project reference. Any rejected row blocks it.
- **undo** removes exactly the rows of one import batch, after you type its id.

Re-running never duplicates rows (each row has an `import_row_hash`), and the same file is
refused a second time. The console shows counts, settings and totals only; row details go
to `import-data/reports/`, which is git-ignored.

All commands below are for **Git Bash** on Windows, run from the repository folder. No admin
rights are needed. PowerShell works the same way (use `Copy-Item` for `cp`, `mkdir` as is).

---

## 1. One-time setup

```bash
cd ~/path/to/Ledgr        # the repository; keep it outside OneDrive or any synced folder
pnpm install
mkdir -p import-data      # git-ignored: your real files and the reports live here
```

## 2. Apply the database migrations

You have already applied migrations up to `20261020000001_require_aal2.sql`. Apply only these
six, **in this order**, each as its own query in Dashboard → SQL Editor (paste the file, Run):

1. `supabase/migrations/20261021000001_withholding_tax_and_optional_cash.sql`
2. `supabase/migrations/20261021000002_transfer_type.sql` (run it alone: Postgres cannot
   use a new enum value in the same transaction that adds it)
3. `supabase/migrations/20261021000003_transfer_columns.sql`
4. `supabase/migrations/20261021000004_ca_factors.sql`
5. `supabase/migrations/20261021000005_import_bookkeeping.sql`
6. `supabase/migrations/20261021000006_import_functions.sql`

Then run these three tests in the SQL Editor. Each rolls back everything it creates and must
end with its `ALL CHECKS PASSED` line:

- `supabase/tests/rls_isolation.sql`
- `supabase/tests/rls_aal2.sql`
- `supabase/tests/import_functions.sql` (only `service_role` can run the import functions;
  undo deletes only the given batch's rows)

If you use the Supabase CLI instead (`npx supabase db push`), do not also paste files in the
SQL Editor: the editor does not record migration history.

## 3. Export the two tables from Excel

Do this once per table.

1. Select the whole table, **header row included** (click a cell in it, then `Ctrl+A`).
   Leave out any totals row.
2. `Ctrl+C`, then `Ctrl+N` (new workbook), click A1, **Home → Paste → Paste Values**.
3. Check the number formats: Excel writes numbers **as displayed**. Select the Units and
   Order Price columns (and Ratio in the CA table), **Format Cells → Number → General**, so
   every decimal is written. A rounded Order Price makes the value check reject the row.
4. **File → Save As → Browse**, choose **CSV UTF-8 (Comma delimited) (\*.csv)**. Plain
   **CSV (Comma delimited)** also works: with Portuguese settings Excel then uses semicolons
   and decimal commas, which the importer detects.
5. Save into the `import-data` folder of the repository as:
   - `transactions.csv`: columns Month, Type, Transact Type, Ticker/Type, Units, Order
     Price, Order Value, Broker
   - `ca.csv`: columns Type, Order Date, Units, Ratio
6. Answer **Yes / Keep current format** to Excel's warnings, close the new workbook without
   saving it as `.xlsx`.

Optional: a third file `import-data/holdings.csv` with two columns `ticker,units` (your
spreadsheet's current holdings, total per ticker). The dry run then diffs the totals.

## 4. Fill in the asset mapping

```bash
cp fixtures/asset_mapping.csv import-data/asset_mapping.csv
```

One row per ticker: `ticker, asset_type, name, isin, exchange, currency, price_symbol,
type_override`. `asset_type` and `currency` are pre-filled from the data. The importer
refuses to run until every row it needs is complete:

- Every cell except `type_override` must be filled. Write `-` for "none, on purpose"
  (e.g. no ISIN for bitcoin). A blank cell is never read as "none".
- `asset_type`: `stock`, `etf`, `crypto` or `certificado_aforro`. If the data shows a ticker
  with two types, set `type_override` to the right one (SXR8 in your data: `etf`).
- `isin`: copy it from your broker (Degiro shows it per product). Its check digit is
  verified. Never guess one; leave `-` if you do not know.
- `currency`: `EUR`. Other currencies are refused: the spreadsheet has no FX rates.
- `price_symbol`: `provider:symbol`, e.g. `yahoo:VWCE.DE`, or `-` for none yet.

If your real file has tickers the fixture does not, the dry run lists them and writes
`asset_mapping.missing.csv` in the report folder with the rows to add.

## 5. Create the importer's .env

```bash
cp scripts/import/.env.example scripts/import/.env
notepad scripts/import/.env
```

- `SUPABASE_URL`: Dashboard → Project Settings → API (Data API) → Project URL
  (`https://<project-ref>.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY`: Dashboard → Project Settings → API Keys → a **secret** key
  (`sb_secret_…`), or the legacy `service_role` key. Never the anon/publishable key; the
  importer refuses it.
- `LEDGR_USER_ID`: Dashboard → Authentication → Users → your user → **UID**. Every row is
  written with it (the service role bypasses RLS, so it is set explicitly).

This file is git-ignored. Never paste the key anywhere else. Delete the file when you are done
(step 9).

## 6. Dry run

```bash
pnpm importer --ca import-data/ca.csv --ratio-month 2026-10
```

`--ratio-month` is the month your CA table's Ratio column is for: each Ratio becomes that
subscription's factor for that month. Add `--holdings import-data/holdings.csv` to diff
against your spreadsheet. Add `--offline` to run without the database (no "already
imported" checks).

Check the first lines: **Detected CSV settings** (encoding, delimiter, decimal separator,
date order). If one is wrong, rerun with `--delimiter semicolon`, `--decimal ,`,
`--date-format dmy` or `--encoding windows-1252` (these apply to the two exported tables;
the mapping and holdings files are always detected). Then open the report folder it prints:

| File                                                | What it shows                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `summary.txt`                                       | settings, counts, totals                                                     |
| `rejects.csv`                                       | every rejected row: file, line, check, reason, the row as read               |
| `skips.csv`, `warnings.csv`                         | empty rows, rows already imported; non-blocking notes                        |
| `duplicates.csv`                                    | groups of identical rows and their keys                                      |
| `rows.csv`, `ca_subscriptions.csv`                  | every accepted row, CA rows grouped into subscriptions                       |
| `reconciliation_positions.csv`                      | per (broker, ticker): units, net invested (units × price), Excel order value |
| `reconciliation_types.csv`, `reconciliation_ca.csv` | totals per asset type; CA value per subscription (units × factor)            |
| `holdings_diff.csv`                                 | with `--holdings`: ledger vs spreadsheet units per ticker                    |

Fix the causes in Excel or in the mapping file, export again, and rerun until it says
**Ready to commit**. Until then the command exits with an error code, so pnpm adds an
`ELIFECYCLE` line at the end; that is expected. What blocks:

- **type conflict**: a ticker with more than one Type → `type_override`.
- **unknown ticker** / **incomplete mapping**: complete `asset_mapping.csv`.
- **unmapped broker**: only Degiro, IBKR, Kraken and Aforro are known.
- **sign mismatch**: Buy needs positive Units and Order Value, Sell negative.
- **value mismatch**: Order Value ≠ Units × Order Price beyond the rounding of the numbers as
  written (often a rounded display format, see step 3.3).
- **sell exceeds holdings**: a sell for more than that broker holds at that point (earlier
  months, then file order within the month).
- **duplicate**: identical rows. If they really are separate orders, put the key from
  `duplicates.csv` on its own line in `import-data/allowed-duplicates.txt`.
- **total row** / **unreadable row**: a totals line or a row with a missing or bad cell.
  Completely empty rows are skipped, not rejected.
- **ca**: CA price not 1, a CA sell (not supported yet), or the CA table not matching the
  CA rows of the transactions table (units per series and month).

Order prices are taken as EUR with `fx_rate 1`, fees as 0. Nothing about tax is computed.

## 7. Commit

Only after you have reviewed the dry run:

```bash
pnpm importer commit --commit --ca import-data/ca.csv --ratio-month 2026-10
```

It repeats every check against the live database, prints the **target Supabase project
reference** and asks you to type it. Anything else cancels with nothing written. On success
it prints the **batch id** and the undo command, verifies the database holds exactly the
rows sent, and writes the reports again. Keep the batch id.

## 8. Undo

```bash
pnpm importer undo --batch <batch id>
```

It shows the project and how many rows of each table the batch holds, then asks for the first
8 characters of the batch id. It deletes only that batch's rows, all or nothing. It refuses
while rows outside the batch still use the batch's accounts or assets (a later batch, or
something you entered in the app): undo the later batch first. After an undo the same files
can be imported again.

## 9. Afterwards

- Delete `scripts/import/.env` (`rm scripts/import/.env`), or at least the key line.
- Keep or delete `import-data/`; it is never committed.
- **New rows later**: export the transactions table again and run the same commands without
  `--ca` (only rows not yet imported are added). If you added certificados, export the CA
  table too and pass `--ca` and `--ratio-month`. The same file twice is refused.
- **New CA ratios**: export the CA table again and pass `--ratio-month` for the new month.
  Each month's factor is a new record; a different factor for a month already recorded is
  rejected (correct it in the SQL Editor if it was wrong).
