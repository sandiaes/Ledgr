-- transfer: moves `quantity` units of `asset_id` from `account_id` to
-- `transfer_to_account_id`. Not a sale: no proceeds, no gain, cost basis unchanged
-- (lots are pooled across accounts). unit_price and amount are null; `fees` is an
-- optional cash fee in `currency` at `fx_rate_to_eur`.

alter table public.transactions
  add column transfer_to_account_id uuid,
  -- Same-owner FK, as for account_id.
  add foreign key (transfer_to_account_id, user_id) references public.accounts (id, user_id),
  drop constraint transactions_shape,
  add constraint transactions_shape check (
    case
      when type in ('buy', 'sell', 'subscription', 'redemption') then
        asset_id is not null
        and quantity is not null and quantity > 0
        and unit_price is not null and unit_price >= 0
        and amount is null
      when type = 'transfer' then
        asset_id is not null
        and quantity is not null and quantity > 0
        and unit_price is null
        and amount is null
      else
        quantity is null
        and unit_price is null
        and amount is not null and amount > 0
    end
  ),
  add constraint transactions_transfer_target check (
    (type = 'transfer') = (transfer_to_account_id is not null)
    and (transfer_to_account_id is null or transfer_to_account_id <> account_id)
  );

-- Receiving account's view and FK support.
create index transactions_transfer_to_account_id_idx
  on public.transactions (transfer_to_account_id)
  where transfer_to_account_id is not null;
