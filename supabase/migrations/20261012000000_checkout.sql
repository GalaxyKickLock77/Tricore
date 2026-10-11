-- Checkout: delivery address, GPay/UPI payment tracking, admin verification, shipping and order timeline.
-- Order lifecycle: awaiting_payment -> payment_submitted -> paid -> shipped -> delivered   (or cancelled)

-- ───────── order statuses and new columns ─────────
alter table public.orders drop constraint if exists orders_status_check;
update public.orders set status = 'awaiting_payment' where status = 'pending';
alter table public.orders
  add constraint orders_status_check
  check (status in ('awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'cancelled'));
alter table public.orders alter column status set default 'awaiting_payment';

alter table public.orders
  add column if not exists payment_method       text not null default 'gpay_upi',
  add column if not exists payment_reference    text,          -- UPI transaction id (UTR) entered by the customer
  add column if not exists payment_note         text,          -- admin note when a payment could not be verified
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists paid_at              timestamptz,
  add column if not exists shipped_at           timestamptz,
  add column if not exists delivered_at         timestamptz,
  add column if not exists courier              text,
  add column if not exists tracking_number      text,
  add column if not exists tracking_url         text,
  add column if not exists cancelled_reason     text,
  add column if not exists ship_name            text,
  add column if not exists ship_phone           text,
  add column if not exists ship_line1           text,
  add column if not exists ship_line2           text,
  add column if not exists ship_city            text,
  add column if not exists ship_state           text,
  add column if not exists ship_pincode         text,
  add column if not exists ship_country         text,
  add column if not exists total                numeric(12, 2) generated always as (unit_price * quantity) stored;

-- ───────── timeline ─────────
create table public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  status     text not null,
  note       text,
  actor_role text not null check (actor_role in ('customer', 'admin', 'system')),
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

insert into public.order_events (order_id, status, note, actor_role, created_at)
select id, status, 'Order recorded', 'system', created_at from public.orders;

revoke all on public.order_events from anon, authenticated;
grant select on public.order_events to authenticated;
alter table public.order_events enable row level security;
create policy "events: admin read" on public.order_events
  for select to authenticated using (public.is_admin());
create policy "events: owner read" on public.order_events
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- ───────── store settings (UPI id etc.), editable by admins ─────────
create table public.store_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.store_settings (key, value) values
  ('upi_id', ''), ('upi_name', 'Tricore IT Solutions'), ('payment_note', '')
on conflict (key) do nothing;
revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to authenticated;
alter table public.store_settings enable row level security;
create policy "settings: signed-in read" on public.store_settings for select to authenticated using (true);

create function public.admin_set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_key not in ('upi_id', 'upi_name', 'payment_note') then raise exception 'Unknown setting'; end if;
  if char_length(coalesce(p_value, '')) > 200 then raise exception 'Value is too long'; end if;
  if p_key = 'upi_id' and btrim(coalesce(p_value, '')) <> '' and btrim(p_value) !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,40}$' then
    raise exception 'That does not look like a UPI ID (for example name@bank)';
  end if;
  insert into public.store_settings (key, value) values (p_key, btrim(coalesce(p_value, '')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- ───────── orders can only change through the functions below ─────────
drop policy if exists "orders: admin update status" on public.orders;
revoke update on public.orders from authenticated;

-- the old two-argument place_order let people order without an address
drop function if exists public.place_order(uuid, integer);

create function public.place_order(p_product_id uuid, p_quantity integer, p_address jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_price   numeric(10, 2);
  v_order   uuid;
  v_name    text := btrim(coalesce(p_address ->> 'name', ''));
  v_phone   text := regexp_replace(coalesce(p_address ->> 'phone', ''), '[\s-]', '', 'g');
  v_line1   text := btrim(coalesce(p_address ->> 'line1', ''));
  v_line2   text := btrim(coalesce(p_address ->> 'line2', ''));
  v_city    text := btrim(coalesce(p_address ->> 'city', ''));
  v_state   text := btrim(coalesce(p_address ->> 'state', ''));
  v_pin     text := btrim(coalesce(p_address ->> 'pincode', ''));
  v_country text := coalesce(nullif(btrim(coalesce(p_address ->> 'country', '')), ''), 'India');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then raise exception 'Quantity must be between 1 and 50'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'Please enter the full name for delivery'; end if;
  if v_phone !~ '^\+?[0-9]{10,15}$' then raise exception 'Please enter a valid phone number'; end if;
  if char_length(v_line1) not between 5 and 200 then raise exception 'Please enter the delivery address'; end if;
  if char_length(v_line2) > 200 then raise exception 'Address line 2 is too long'; end if;
  if char_length(v_city) not between 2 and 80 then raise exception 'Please enter the city'; end if;
  if char_length(v_state) not between 2 and 80 then raise exception 'Please enter the state'; end if;
  if v_pin !~ '^[0-9]{6}$' then raise exception 'Please enter a valid 6-digit PIN code'; end if;
  if char_length(v_country) > 60 then raise exception 'Country is too long'; end if;

  -- lock the row so concurrent buyers cannot oversell
  select price into v_price from public.products where id = p_product_id and is_active for update;
  if not found then raise exception 'Product not available'; end if;

  update public.products set stock = stock - p_quantity where id = p_product_id and stock >= p_quantity;
  if not found then raise exception 'Insufficient stock'; end if;

  insert into public.orders (user_id, product_id, quantity, unit_price, status,
                             ship_name, ship_phone, ship_line1, ship_line2, ship_city, ship_state, ship_pincode, ship_country)
  values (v_user, p_product_id, p_quantity, v_price, 'awaiting_payment',
          v_name, v_phone, v_line1, nullif(v_line2, ''), v_city, v_state, v_pin, v_country)
  returning id into v_order;

  insert into public.order_events (order_id, status, note, actor_role)
  values (v_order, 'awaiting_payment', 'Order placed. Waiting for your payment.', 'customer');
  return v_order;
end;
$$;

create function public.submit_payment(p_order uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ref  text := btrim(coalesce(p_reference, ''));
  v_o    public.orders;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_o from public.orders where id = p_order and user_id = v_user for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status <> 'awaiting_payment' then raise exception 'This order is not waiting for payment'; end if;
  if v_ref !~ '^[A-Za-z0-9-]{6,40}$' then raise exception 'Please enter the UPI transaction ID from your payment app (letters and numbers only)'; end if;

  update public.orders
     set status = 'payment_submitted', payment_reference = v_ref, payment_submitted_at = now(), payment_note = null
   where id = p_order;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'payment_submitted', 'You submitted payment reference ' || v_ref || '. We are verifying it.', 'customer');
end;
$$;

create function public.cancel_my_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_o    public.orders;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_o from public.orders where id = p_order and user_id = v_user for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status <> 'awaiting_payment' then raise exception 'Only orders that are waiting for payment can be cancelled here'; end if;
  update public.orders set status = 'cancelled', cancelled_reason = 'Cancelled by customer' where id = p_order;
  update public.products set stock = stock + v_o.quantity where id = v_o.product_id;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'cancelled', 'You cancelled this order.', 'customer');
end;
$$;

create function public.admin_confirm_payment(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_o public.orders;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status not in ('awaiting_payment', 'payment_submitted') then raise exception 'Payment can only be confirmed for orders waiting for payment'; end if;
  update public.orders set status = 'paid', paid_at = now(), payment_note = null where id = p_order;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'paid', 'Payment received. We are preparing your order.', 'admin');
end;
$$;

create function public.admin_reject_payment(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o    public.orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if char_length(v_note) < 3 or char_length(v_note) > 300 then raise exception 'Please add a short reason for the customer'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status <> 'payment_submitted' then raise exception 'Only submitted payments can be rejected'; end if;
  update public.orders set status = 'awaiting_payment', payment_note = v_note where id = p_order;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'awaiting_payment', 'We could not verify your payment: ' || v_note || '. Please check and submit the correct transaction ID.', 'admin');
end;
$$;

create function public.admin_ship_order(p_order uuid, p_courier text, p_tracking text, p_url text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o   public.orders;
  v_c   text := btrim(coalesce(p_courier, ''));
  v_t   text := btrim(coalesce(p_tracking, ''));
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if char_length(v_c) not between 2 and 60 then raise exception 'Please enter the courier name'; end if;
  if char_length(v_t) not between 3 and 80 then raise exception 'Please enter the tracking number'; end if;
  if v_url is not null and v_url !~* '^https?://[^\s]{3,250}$' then raise exception 'Tracking link must start with http:// or https://'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status <> 'paid' then raise exception 'Only paid orders can be shipped'; end if;
  update public.orders
     set status = 'shipped', shipped_at = now(), courier = v_c, tracking_number = v_t, tracking_url = v_url
   where id = p_order;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'shipped', 'Shipped with ' || v_c || ', tracking number ' || v_t || '.', 'admin');
end;
$$;

create function public.admin_mark_delivered(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_o public.orders;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status <> 'shipped' then raise exception 'Only shipped orders can be marked delivered'; end if;
  update public.orders set status = 'delivered', delivered_at = now() where id = p_order;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'delivered', 'Delivered. Thank you for shopping with us!', 'admin');
end;
$$;

create function public.admin_cancel_order(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o      public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then raise exception 'Please add a short reason'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.status not in ('awaiting_payment', 'payment_submitted', 'paid') then raise exception 'Shipped or finished orders cannot be cancelled'; end if;
  update public.orders set status = 'cancelled', cancelled_reason = v_reason where id = p_order;
  update public.products set stock = stock + v_o.quantity where id = v_o.product_id;
  insert into public.order_events (order_id, status, note, actor_role)
  values (p_order, 'cancelled', 'Order cancelled: ' || v_reason, 'admin');
end;
$$;

-- ───────── who may call what ─────────
revoke all on function public.admin_set_setting(text, text) from public, anon;
revoke all on function public.place_order(uuid, integer, jsonb) from public, anon;
revoke all on function public.submit_payment(uuid, text) from public, anon;
revoke all on function public.cancel_my_order(uuid) from public, anon;
revoke all on function public.admin_confirm_payment(uuid) from public, anon;
revoke all on function public.admin_reject_payment(uuid, text) from public, anon;
revoke all on function public.admin_ship_order(uuid, text, text, text) from public, anon;
revoke all on function public.admin_mark_delivered(uuid) from public, anon;
revoke all on function public.admin_cancel_order(uuid, text) from public, anon;
grant execute on function public.admin_set_setting(text, text) to authenticated;
grant execute on function public.place_order(uuid, integer, jsonb) to authenticated;
grant execute on function public.submit_payment(uuid, text) to authenticated;
grant execute on function public.cancel_my_order(uuid) to authenticated;
grant execute on function public.admin_confirm_payment(uuid) to authenticated;
grant execute on function public.admin_reject_payment(uuid, text) to authenticated;
grant execute on function public.admin_ship_order(uuid, text, text, text) to authenticated;
grant execute on function public.admin_mark_delivered(uuid) to authenticated;
grant execute on function public.admin_cancel_order(uuid, text) to authenticated;

-- live updates for admins (Supabase Realtime), only where the publication exists
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
