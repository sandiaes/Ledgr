-- Transfers of units between accounts. The enum value is added on its own: Postgres
-- does not allow a new enum value to be used in the transaction that adds it, so the
-- columns and constraints that mention it are in the next migration.

alter type public.transaction_type add value 'transfer';
