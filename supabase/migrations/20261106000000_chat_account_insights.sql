-- Assistant insight data (replaces chat_account_context from the chat_assistant migration).
-- Every count, status and history figure the chat assistant is allowed to say is computed here,
-- from live tables, under the CALLER's own row level security rules: a customer sees only their own
-- orders and tickets, an admin sees the whole store. Nothing is stored or canned in application code.
-- The words customers use ("closed", "completed", "unpaid") are mapped to real status values through
-- an editable row in app_config, so the vocabulary can change without a deploy.

-- ───────── status vocabulary (data, not code) ─────────
insert into public.app_config (key, value) values
  ('assistant_status_vocabulary', '{
     "ticket": {
       "pending_definition": "open + in_progress",
       "aliases": {
         "closed": "resolved", "completed": "resolved", "done": "resolved", "finished": "resolved",
         "resolved": "resolved",
         "pending": "open + in_progress", "waiting": "open + in_progress", "unresolved": "open + in_progress",
         "active": "open + in_progress", "open": "open", "new": "open",
         "in progress": "in_progress", "in_progress": "in_progress", "assigned": "in_progress"
       }
     },
     "order": {
       "pending_definition": "awaiting_payment + payment_submitted",
       "needs_action_definition": "payment_submitted (to verify) + paid (to ship)",
       "aliases": {
         "unpaid": "awaiting_payment", "awaiting payment": "awaiting_payment", "new": "awaiting_payment",
         "pending": "awaiting_payment + payment_submitted",
         "submitted": "payment_submitted", "verifying": "payment_submitted", "under verification": "payment_submitted",
         "paid": "paid", "confirmed": "paid", "verified": "paid",
         "shipped": "shipped", "dispatched": "shipped", "on the way": "shipped", "in transit": "shipped",
         "delivered": "delivered", "completed": "delivered", "received": "delivered",
         "cancelled": "cancelled", "canceled": "cancelled", "refunded": "cancelled"
       }
     }
   }')
on conflict (key) do nothing;

-- Only these keys may be read through this helper, so private config (notify_secret) stays private.
create or replace function public.assistant_public_config(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when value ~ '^\s*[\[{]' then value::jsonb else null end
    from public.app_config
   where key = p_key and key = 'assistant_status_vocabulary';
$$;

-- ───────── live, permission-aware figures for the assistant ─────────
create or replace function public.chat_account_context(p_resource text default 'all')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resource text := lower(btrim(coalesce(p_resource, 'all')));
  v_admin    boolean := coalesce(public.is_admin(), false);
  v_tickets  jsonb := null;
  v_orders   jsonb := null;
  v_catalog  jsonb := null;
begin
  if (select auth.uid()) is null then
    raise exception 'Please sign in';
  end if;
  if v_resource not in ('orders', 'tickets', 'catalog', 'all') then
    raise exception 'Resource must be orders, tickets, catalog or all';
  end if;

  -- ── support tickets ──
  -- A ticket counts as closed when the system logged the change to Resolved; a ticket resolved
  -- before that log existed falls back to its last update, so nothing is silently missed.
  if v_resource in ('tickets', 'all') then
    with base as (
      select t.id,
             upper(left(t.id::text, 8))                                            as ref,
             t.status,
             left(t.question, 240)                                                 as question,
             t.created_at,
             t.updated_at,
             coalesce((select max(c.created_at) from public.ticket_comments c
                        where c.ticket_id = t.id and c.author_role = 'system'
                          and c.body = 'Status changed to Resolved'), t.updated_at) as resolved_at,
             not exists (select 1 from public.ticket_comments c
                          where c.ticket_id = t.id and c.author_role = 'admin'
                            and not c.is_internal)                                  as awaiting_first_reply
      from public.support_requests t
    )
    select jsonb_build_object(
      'total',                 (select count(*) from base),
      'pending',               (select count(*) from base where status in ('open', 'in_progress')),
      'open',                  (select count(*) from base where status = 'open'),
      'in_progress',           (select count(*) from base where status = 'in_progress'),
      'resolved',              (select count(*) from base where status = 'resolved'),
      'awaiting_first_reply',  (select count(*) from base where status <> 'resolved' and awaiting_first_reply),
      'created_within_7_days',  (select count(*) from base where created_at  >= now() - interval '7 days'),
      'created_within_30_days', (select count(*) from base where created_at  >= now() - interval '30 days'),
      'resolved_within_7_days',  (select count(*) from base where status = 'resolved' and resolved_at >= now() - interval '7 days'),
      'resolved_within_30_days', (select count(*) from base where status = 'resolved' and resolved_at >= now() - interval '30 days'),
      'by_status', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'status', s.status, 'count', s.n, 'last_activity_at', s.last_at) order by s.status), '[]'::jsonb)
        from (select status, count(*) as n, max(updated_at) as last_at from base group by status) s
      ),
      'recent', (
        select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
        from (select ref, status, question, awaiting_first_reply, created_at, updated_at
              from base order by created_at desc limit 10) r
      ),
      'recently_resolved', (
        select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
        from (select ref, status, resolved_at
              from base where status = 'resolved' order by resolved_at desc limit 5) r
      )
    ) into v_tickets;
  end if;

  -- ── orders ──
  if v_resource in ('orders', 'all') then
    with base as (
      select o.id,
             upper(left(o.id::text, 8)) as ref,
             o.status,
             o.quantity,
             o.unit_price,
             o.total,
             o.created_at,
             o.paid_at,
             o.shipped_at,
             o.delivered_at,
             o.courier,
             o.tracking_number,
             o.payment_method,
             p.name as product_name
      from public.orders o
      left join public.products p on p.id = o.product_id
    )
    select jsonb_build_object(
      'total',              (select count(*) from base),
      'awaiting_payment',   (select count(*) from base where status = 'awaiting_payment'),
      'payment_submitted',  (select count(*) from base where status = 'payment_submitted'),
      'paid',               (select count(*) from base where status = 'paid'),
      'shipped',            (select count(*) from base where status = 'shipped'),
      'delivered',          (select count(*) from base where status = 'delivered'),
      'cancelled',          (select count(*) from base where status = 'cancelled'),
      'pending',            (select count(*) from base where status in ('awaiting_payment', 'payment_submitted')),
      'needs_action',       (select count(*) from base where status in ('payment_submitted', 'paid')),
      'created_within_7_days',  (select count(*) from base where created_at >= now() - interval '7 days'),
      'created_within_30_days', (select count(*) from base where created_at >= now() - interval '30 days'),
      'paid_within_30_days',    (select count(*) from base where paid_at is not null and paid_at >= now() - interval '30 days'),
      'value_collected_within_30_days',
        (select coalesce(sum(total), 0) from base where paid_at is not null and paid_at >= now() - interval '30 days'),
      'value_awaiting_payment',
        (select coalesce(sum(total), 0) from base where status = 'awaiting_payment'),
      'by_status', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'status', s.status, 'count', s.n, 'latest_order_created_at', s.last_at) order by s.status), '[]'::jsonb)
        from (select status, count(*) as n, max(created_at) as last_at from base group by status) s
      ),
      'recent', (
        select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
        from (select ref, status, product_name, quantity, unit_price, total, created_at,
                     courier, tracking_number, payment_method
              from base order by created_at desc limit 10) r
      )
    ) into v_orders;
  end if;

  -- ── catalogue and stock (row level security: an admin also counts inactive products) ──
  if v_resource in ('catalog', 'all') then
    select jsonb_build_object(
      'products_total',            (select count(*) from public.products),
      'products_active',           (select count(*) from public.products where is_active),
      'products_out_of_stock',     (select count(*) from public.products where is_active and stock <= 0),
      'products_low_stock',        (select count(*) from public.products where is_active and stock between 1 and 5),
      'products_in_stock',         (select count(*) from public.products where is_active and stock > 5),
      'knowledge_articles_published', (select count(*) from public.kb_articles where is_published),
      'out_of_stock', (
        select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'stock', x.stock)), '[]'::jsonb)
        from (select name, stock from public.products where is_active and stock <= 0 order by name limit 15) x
      ),
      'low_stock', (
        select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'stock', x.stock)), '[]'::jsonb)
        from (select name, stock from public.products where is_active and stock between 1 and 5 order by stock asc, name limit 15) x
      ),
      'cheapest', (
        select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'price', x.price, 'stock', x.stock)), '[]'::jsonb)
        from (select name, price, stock from public.products where is_active order by price asc limit 5) x
      ),
      'dearest', (
        select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'price', x.price, 'stock', x.stock)), '[]'::jsonb)
        from (select name, price, stock from public.products where is_active order by price desc limit 5) x
      )
    ) into v_catalog;
  end if;

  return jsonb_build_object(
    'as_of', now(),
    'viewer_is_admin', v_admin,
    'viewer_scope', case
      when v_admin then 'admin: every order, ticket and product in the store'
      else 'customer: only this account''s own orders and tickets'
    end,
    'status_vocabulary', public.assistant_public_config('assistant_status_vocabulary'),
    'currency', 'INR',
    'orders',  v_orders,
    'tickets', v_tickets,
    'catalog', v_catalog
  );
end;
$$;

revoke all on function public.chat_account_context(text) from public, anon;
revoke all on function public.assistant_public_config(text) from public, anon;
grant execute on function public.chat_account_context(text) to authenticated;
grant execute on function public.assistant_public_config(text) to authenticated;
