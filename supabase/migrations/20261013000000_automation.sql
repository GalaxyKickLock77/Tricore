-- Less manual work for the admin:
--   1) unpaid orders expire automatically (stock goes back)
--   2) every order / ticket event can trigger an email through the app's /api/notify endpoint
--   3) AI ticket summary fields
-- Nothing here changes who may see or do what; it only automates and notifies.

-- ───────── settings ─────────
insert into public.store_settings (key, value) values ('support_email', ''), ('unpaid_expiry_hours', '24')
on conflict (key) do nothing;

create or replace function public.admin_set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_val text := btrim(coalesce(p_value, ''));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_key not in ('upi_id', 'upi_name', 'payment_note', 'support_email', 'unpaid_expiry_hours') then raise exception 'Unknown setting'; end if;
  if char_length(v_val) > 200 then raise exception 'Value is too long'; end if;
  if p_key = 'upi_id' and v_val <> '' and v_val !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,40}$' then
    raise exception 'That does not look like a UPI ID (for example name@bank)';
  end if;
  if p_key = 'support_email' and v_val <> '' and v_val !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;
  if p_key = 'unpaid_expiry_hours' and (v_val !~ '^[0-9]{1,3}$' or v_val::int < 1 or v_val::int > 720) then
    raise exception 'Enter a number of hours between 1 and 720';
  end if;
  insert into public.store_settings (key, value) values (p_key, v_val)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- the support email is public (the chat's "Email us" button needs it, also for visitors)
create function public.get_support_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select value from public.store_settings where key = 'support_email'), '') $$;
revoke all on function public.get_support_email() from public;
grant execute on function public.get_support_email() to anon, authenticated;

-- ───────── automatic expiry of unpaid orders ─────────
create function public.expire_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := 24;
  r       record;
  n       integer := 0;
begin
  -- scheduled jobs have no signed-in user; a signed-in caller must be an admin
  if (select auth.uid()) is not null and not public.is_admin() then raise exception 'Admins only'; end if;
  begin
    v_hours := coalesce(nullif((select value from public.store_settings where key = 'unpaid_expiry_hours'), '')::integer, 24);
  exception when others then
    v_hours := 24;
  end;

  for r in
    select id, product_id, quantity from public.orders
     where status = 'awaiting_payment' and created_at < now() - make_interval(hours => v_hours)
     for update skip locked
  loop
    update public.orders set status = 'cancelled', cancelled_reason = 'Not paid within ' || v_hours || ' hours' where id = r.id;
    update public.products set stock = stock + r.quantity where id = r.product_id;
    insert into public.order_events (order_id, status, note, actor_role)
    values (r.id, 'cancelled', 'Cancelled automatically: payment was not received within ' || v_hours || ' hours.', 'system');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.expire_unpaid_orders() from public, anon;
grant execute on function public.expire_unpaid_orders() to authenticated;

-- run every 30 minutes where pg_cron is available (the admin Orders page also runs it as a fallback)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-unpaid-orders', '*/30 * * * *', 'select public.expire_unpaid_orders()');
  end if;
exception when others then
  raise notice 'pg_cron is not enabled, skipping the schedule: %', sqlerrm;
end $$;

-- ───────── notifications (email) ─────────
-- Private settings the browser can never read: where to send events and the shared secret.
create table public.app_config (
  key   text primary key,
  value text not null default ''
);
revoke all on public.app_config from anon, authenticated;
alter table public.app_config enable row level security;      -- no policies: nobody but the database owner
insert into public.app_config (key, value) values ('notify_url', ''), ('notify_secret', '') on conflict (key) do nothing;

create function public.send_notification(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url from public.app_config where key = 'notify_url';
  select value into v_secret from public.app_config where key = 'notify_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return; end if;     -- not configured: do nothing
  if to_regnamespace('net') is null then return; end if;                             -- pg_net not installed
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, p_payload, jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret);
exception when others then
  raise warning 'notification failed: %', sqlerrm;                                    -- never break an order or ticket
end;
$$;
revoke all on function public.send_notification(jsonb) from public, anon, authenticated;

create function public.trg_order_event_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       record;
  v_event text;
  v_admin text;
begin
  if new.actor_role = 'system' and new.note = 'Order recorded' then return new; end if;
  v_event := case new.status
    when 'awaiting_payment'   then case when new.actor_role = 'admin' then 'payment_rejected' else 'order_placed' end
    when 'payment_submitted'  then 'payment_submitted'
    when 'paid'               then 'payment_confirmed'
    when 'shipped'            then 'shipped'
    when 'delivered'          then 'delivered'
    when 'cancelled'          then 'cancelled'
  end;
  if v_event is null then return new; end if;

  select ord.id, ord.quantity, ord.total, ord.courier, ord.tracking_number, ord.tracking_url,
         ord.payment_reference, pr.name as product, p.email as customer_email
    into o
    from public.orders ord
    join public.products pr on pr.id = ord.product_id
    join public.profiles p on p.id = ord.user_id
   where ord.id = new.order_id;
  if not found then return new; end if;

  select value into v_admin from public.store_settings where key = 'support_email';
  perform public.send_notification(jsonb_build_object(
    'type', 'order', 'event', v_event, 'ref', upper(left(o.id::text, 8)),
    'product', o.product, 'quantity', o.quantity, 'total', o.total,
    'courier', o.courier, 'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url,
    'payment_reference', o.payment_reference, 'note', new.note,
    'customer_email', o.customer_email, 'admin_email', coalesce(v_admin, '')));
  return new;
end;
$$;
create trigger order_events_notify after insert on public.order_events
  for each row execute function public.trg_order_event_notify();

create function public.trg_ticket_opened_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin text;
begin
  select value into v_admin from public.store_settings where key = 'support_email';
  perform public.send_notification(jsonb_build_object(
    'type', 'ticket', 'event', 'opened', 'ref', upper(left(new.id::text, 8)),
    'contact', new.contact, 'question', left(new.question, 1500), 'admin_email', coalesce(v_admin, '')));
  return new;
end;
$$;
create trigger support_requests_notify after insert on public.support_requests
  for each row execute function public.trg_ticket_opened_notify();

create function public.trg_ticket_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       record;
  v_admin text;
begin
  if new.is_internal then return new; end if;                                          -- internal notes are never emailed
  select id, contact into t from public.support_requests where id = new.ticket_id;
  if not found then return new; end if;
  select value into v_admin from public.store_settings where key = 'support_email';
  perform public.send_notification(jsonb_build_object(
    'type', 'ticket', 'event', case when new.author_role = 'admin' then 'reply' else 'customer_reply' end,
    'ref', upper(left(t.id::text, 8)), 'contact', t.contact, 'body', left(new.body, 1500),
    'admin_email', coalesce(v_admin, '')));
  return new;
end;
$$;
create trigger ticket_comments_notify after insert on public.ticket_comments
  for each row execute function public.trg_ticket_comment_notify();

-- ───────── AI summary fields on tickets ─────────
alter table public.support_requests
  add column if not exists ai_summary  text,
  add column if not exists ai_category text,
  add column if not exists ai_priority text check (ai_priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists ai_at       timestamptz;

create function public.admin_set_ticket_ai(p_ticket uuid, p_summary text, p_category text, p_priority text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'Invalid priority'; end if;
  update public.support_requests
     set ai_summary = left(btrim(coalesce(p_summary, '')), 300),
         ai_category = left(btrim(coalesce(p_category, 'other')), 30),
         ai_priority = p_priority,
         ai_at = now()
   where id = p_ticket;
  if not found then raise exception 'Ticket not found'; end if;
end;
$$;
revoke all on function public.admin_set_ticket_ai(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_ticket_ai(uuid, text, text, text) to authenticated;
