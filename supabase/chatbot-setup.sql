-- Tricore chatbot: knowledge base (RAG source), human-handoff requests, and retrieval function.

-- ───────── knowledge base ─────────
create table public.kb_articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  content      text not null,
  category     text not null default 'general',   -- 'core' articles are ALWAYS given to the bot
  is_published boolean not null default true,
  updated_at   timestamptz not null default now(),
  fts          tsvector generated always as (
                 setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                 setweight(to_tsvector('english', coalesce(content, '')), 'B')
               ) stored
);
create index kb_articles_fts_idx on public.kb_articles using gin (fts);

-- ───────── human handoff ─────────
create table public.support_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  contact    text not null check (char_length(contact) between 3 and 200),
  question   text not null check (char_length(question) between 1 and 2000),
  reason     text check (reason is null or char_length(reason) <= 500),
  transcript jsonb not null default '[]'::jsonb,
  status     text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index support_requests_status_idx on public.support_requests (status, created_at desc);

-- ───────── privileges ─────────
revoke all on public.kb_articles, public.support_requests from anon, authenticated;
grant select on public.kb_articles to anon, authenticated;
grant insert, update, delete on public.kb_articles to authenticated;       -- RLS limits writes to admins
grant select on public.support_requests to authenticated;                   -- RLS limits to admins
grant update (status) on public.support_requests to authenticated;          -- inserts only via create_support_request()

alter table public.kb_articles enable row level security;
alter table public.support_requests enable row level security;

create policy "kb: read published" on public.kb_articles
  for select to anon, authenticated using (is_published or public.is_admin());
create policy "kb: admin insert" on public.kb_articles
  for insert to authenticated with check (public.is_admin());
create policy "kb: admin update" on public.kb_articles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "kb: admin delete" on public.kb_articles
  for delete to authenticated using (public.is_admin());

create policy "support: admin read" on public.support_requests
  for select to authenticated using (public.is_admin());
create policy "support: admin update" on public.support_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────── create_support_request: how a customer reaches a human ─────────
create function public.create_support_request(
  p_contact text, p_question text, p_reason text default null, p_transcript jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_contact text := btrim(coalesce(p_contact, ''));
  v_question text := btrim(coalesce(p_question, ''));
begin
  if char_length(v_contact) < 3 or char_length(v_contact) > 200 then
    raise exception 'Please provide a valid email or phone number';
  end if;
  if char_length(v_question) < 1 or char_length(v_question) > 2000 then
    raise exception 'Please describe what you need (up to 2000 characters)';
  end if;
  if octet_length(coalesce(p_transcript, '[]'::jsonb)::text) > 20000 then
    raise exception 'Conversation is too long';
  end if;

  insert into public.support_requests (user_id, contact, question, reason, transcript)
  values ((select auth.uid()), v_contact, v_question, left(p_reason, 500), coalesce(p_transcript, '[]'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- ───────── chat_context: retrieval for the bot (RAG) ─────────
-- Returns the most relevant knowledge articles (core ones always) and the live product catalog.
create function public.chat_context(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_words    text[];
  v_tsq      tsquery;
  v_articles jsonb;
  v_products jsonb;
begin
  v_words := array(
    select w
    from unnest(string_to_array(regexp_replace(lower(coalesce(left(p_query, 1000), '')), '[^a-z0-9]+', ' ', 'g'), ' ')) as w
    where char_length(w) > 1
    limit 20
  );
  if array_length(v_words, 1) is not null then
    v_tsq := to_tsquery('english', array_to_string(v_words, ' | '));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', slug, 'title', title, 'content', content)), '[]'::jsonb)
    into v_articles
  from (
    select a.slug, a.title, a.content
    from public.kb_articles a
    where a.is_published
      and (a.category = 'core' or (v_tsq is not null and a.fts @@ v_tsq))
    order by (a.category = 'core') desc,
             case when v_tsq is null then 0 else ts_rank(a.fts, v_tsq) end desc
    limit 7
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           'product:' || p.id,
           'name',         p.name,
           'price_usd',    p.price,
           'availability', case when p.stock <= 0 then 'out of stock'
                                when p.stock <= 5 then 'low stock'
                                else 'in stock' end,
           'description',  left(coalesce(p.description, ''), 200)
         )), '[]'::jsonb)
    into v_products
  from (
    select * from public.products
    where is_active
    order by (v_tsq is not null
              and to_tsvector('english', name || ' ' || coalesce(description, '')) @@ v_tsq) desc,
             created_at desc
    limit 20
  ) p;

  return jsonb_build_object('articles', v_articles, 'products', v_products);
end;
$$;

revoke all on function public.create_support_request(text, text, text, jsonb) from public;
revoke all on function public.chat_context(text) from public;
grant execute on function public.create_support_request(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.chat_context(text) to anon, authenticated;

-- kb_articles' read policy calls is_admin() for anonymous visitors too (it simply returns false for them).
grant execute on function public.is_admin() to anon;


-- chat_context v2: the bot sees MORE of the catalog and can tell when its product list is partial.
-- Always includes the 3 cheapest, 3 most expensive and 10 newest active products, plus every product
-- that matches the customer's words (best matches first), up to 30 products in total.
create or replace function public.chat_context(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_words    text[];
  v_tsq      tsquery;
  v_articles jsonb;
  v_products jsonb;
  v_total    integer;
begin
  v_words := array(
    select w
    from unnest(string_to_array(regexp_replace(lower(coalesce(left(p_query, 1000), '')), '[^a-z0-9]+', ' ', 'g'), ' ')) as w
    where char_length(w) > 1
    limit 20
  );
  if array_length(v_words, 1) is not null then
    v_tsq := to_tsquery('english', array_to_string(v_words, ' | '));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', slug, 'title', title, 'content', content)), '[]'::jsonb)
    into v_articles
  from (
    select a.slug, a.title, a.content
    from public.kb_articles a
    where a.is_published
      and (a.category = 'core' or (v_tsq is not null and a.fts @@ v_tsq))
    order by (a.category = 'core') desc,
             case when v_tsq is null then 0 else ts_rank(a.fts, v_tsq) end desc
    limit 7
  ) s;

  select count(*)::int into v_total from public.products where is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           'product:' || x.id,
           'name',         x.name,
           'price_usd',    x.price,
           'availability', case when x.stock <= 0 then 'out of stock'
                                when x.stock <= 5 then 'low stock'
                                else 'in stock' end,
           'description',  left(coalesce(x.description, ''), 200)
         ) order by x.rel desc, x.new_rank), '[]'::jsonb)
    into v_products
  from (
    select *
    from (
      select p.id, p.name, p.price, p.stock, p.description,
             case when v_tsq is not null
                       and to_tsvector('english', p.name || ' ' || coalesce(p.description, '')) @@ v_tsq
                  then ts_rank(to_tsvector('english', p.name || ' ' || coalesce(p.description, '')), v_tsq)
                  else 0 end as rel,
             row_number() over (order by p.price asc)       as cheap_rank,
             row_number() over (order by p.price desc)      as dear_rank,
             row_number() over (order by p.created_at desc) as new_rank
      from public.products p
      where p.is_active
    ) r
    where r.rel > 0 or r.cheap_rank <= 3 or r.dear_rank <= 3 or r.new_rank <= 10
    order by r.rel desc, r.new_rank
    limit 30
  ) x;

  return jsonb_build_object('articles', v_articles, 'products', v_products, 'total_products', v_total);
end;
$$;

revoke all on function public.chat_context(text) from public;
grant execute on function public.chat_context(text) to anon, authenticated;


-- Live, permission-aware account data for the AI assistant.
-- SECURITY INVOKER is intentional: existing RLS limits customers to their own rows and admins to all rows.
create or replace function public.chat_account_context(p_resource text default 'all')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resource text := lower(btrim(coalesce(p_resource, 'all')));
  v_orders   jsonb := null;
  v_tickets  jsonb := null;
begin
  if (select auth.uid()) is null then
    raise exception 'Please sign in';
  end if;
  if v_resource not in ('orders', 'tickets', 'all') then
    raise exception 'Resource must be orders, tickets, or all';
  end if;

  if v_resource in ('tickets', 'all') then
    select jsonb_build_object(
      'total', (select count(*) from public.support_requests),
      'pending', (select count(*) from public.support_requests where status in ('open', 'in_progress')),
      'open', (select count(*) from public.support_requests where status = 'open'),
      'in_progress', (select count(*) from public.support_requests where status = 'in_progress'),
      'resolved', (select count(*) from public.support_requests where status = 'resolved'),
      'pending_definition', 'open + in_progress',
      'recent', (
        select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
        from (
          select upper(left(id::text, 8)) as ref,
                 status,
                 left(question, 240) as question,
                 created_at,
                 updated_at
          from public.support_requests
          order by created_at desc
          limit 10
        ) r
      )
    ) into v_tickets;
  end if;

  if v_resource in ('orders', 'all') then
    select jsonb_build_object(
      'total', (select count(*) from public.orders),
      'awaiting_payment', (select count(*) from public.orders where status = 'awaiting_payment'),
      'payment_submitted', (select count(*) from public.orders where status = 'payment_submitted'),
      'paid', (select count(*) from public.orders where status = 'paid'),
      'shipped', (select count(*) from public.orders where status = 'shipped'),
      'delivered', (select count(*) from public.orders where status = 'delivered'),
      'cancelled', (select count(*) from public.orders where status = 'cancelled'),
      'recent', (
        select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
        from (
          select o.id,
                 o.quantity,
                 o.unit_price,
                 o.total,
                 o.status,
                 o.created_at,
                 o.courier,
                 o.tracking_number,
                 o.tracking_url,
                 p.name as product_name
          from public.orders o
          left join public.products p on p.id = o.product_id
          order by o.created_at desc
          limit 10
        ) r
      )
    ) into v_orders;
  end if;

  return jsonb_build_object(
    'viewer_scope', case when public.is_admin() then 'admin: all visible records' else 'customer: own records only' end,
    'orders', v_orders,
    'tickets', v_tickets
  );
end;
$$;

revoke all on function public.chat_account_context(text) from public, anon;
grant execute on function public.chat_account_context(text) to authenticated;


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


-- GENERATED from supabase/kb/articles.json by web/scripts/gen-kb-sql.mjs. Safe to re-run.
insert into public.kb_articles (slug, title, content, category) values
  ($kb$about-tricore$kb$, $kb$About Tricore IT Solutions$kb$, $kb$Tricore IT Solutions is an online store for IT products. Customers browse the shop, choose a product, enter their delivery address and place the order; the item is reserved for them. Every order opens a support ticket automatically, and the Tricore team uses that ticket to confirm the order and arrange payment and delivery with the customer. Once the team confirms payment the order is shipped, and every step including the courier name and tracking number appears under My orders. Product categories are Laptops and Desktops, Networking, Servers and Storage, Security and CCTV, Peripherals, and Software and Licenses. Exact products, prices and stock available now are in the PRODUCTS section of the context.$kb$, $kb$core$kb$),
  ($kb$how-ordering-works$kb$, $kb$How ordering works$kb$, $kb$Step 1: Sign in with your Google account and open the Shop. Step 2: Click Buy on a product, which opens the checkout page. Step 3: Enter your delivery address (name, phone number, PIN code and address) and tap Place order; the item is reserved for you and the total is shown. Step 4: A support ticket is opened automatically for the order and the team contacts you on it to confirm the order and arrange payment and delivery. Step 5: Once the team receives your payment the order moves to Payment received and is prepared for shipping. Step 6: The courier name and tracking number appear under My orders. Step 7: The order is marked delivered. The assistant can start an order for you, but the address and payment are completed on the checkout page and in the support ticket.$kb$, $kb$core$kb$),
  ($kb$how-payment-works$kb$, $kb$How payment works$kb$, $kb$The Tricore team arranges payment with each customer personally; the website does not take payment on its own. After an order is placed the item is reserved and a support ticket is opened. The team replies on that ticket with the exact amount and how to pay, confirms it when the money arrives, and then the order is shipped. Until then the order shows as Awaiting payment, and while it does the customer can cancel it under My orders. The assistant must never name, recommend or invent any payment app, wallet, card, gateway, bank account, UPI ID, QR code, payment link or extra charge, and must never change an amount or a deadline. Asked how to pay before the team has replied, it says the team will confirm the payment details on that order's support ticket and offers to connect the customer with the team now.$kb$, $kb$core$kb$),
  ($kb$talk-to-human$kb$, $kb$Prices, special deals and the Tricore team$kb$, $kb$The assistant cannot change prices, give discounts or coupons, approve special or bulk deals, or create custom quotes. If a customer wants a lower price or a special deal, it explains that it cannot do that itself and asks whether the customer would like to be connected with the Tricore team. Each order is confirmed by the team through its support ticket, and that ticket is where payment is arranged. Exact delivery times, shipping charges, returns and warranty terms are not in the knowledge base, so the assistant must say honestly that it does not have them on hand, must not guess, and may offer to connect the customer with the team.$kb$, $kb$core$kb$),
  ($kb$sign-in$kb$, $kb$Signing in and creating an account$kb$, $kb$Tricore uses Google sign-in only. There is no separate password. New customers create their account by clicking Sign up with Google, and returning customers click Sign in with Google. You must be signed in to open the Shop and to see your orders. The landing page and this assistant are available without signing in.$kb$, $kb$general$kb$),
  ($kb$order-status$kb$, $kb$Order status meanings$kb$, $kb$After signing in, customers can see all their orders under My orders with a step-by-step progress bar. Awaiting payment means the order is placed, the item is reserved, and the team will contact you on the order's support ticket to arrange payment; you can cancel the order yourself while it is in this state. Payment received means the team has confirmed your payment and the order is being prepared. Shipped means the order was dispatched and the courier name and tracking number are shown. Delivered means the order reached you. Cancelled means you cancelled it, the team cancelled it, or it passed the unpaid-order time limit, and the item went back into stock. A few older orders may also show Payment submitted, where the team was checking a payment reference the customer sent.$kb$, $kb$general$kb$),
  ($kb$products-and-stock$kb$, $kb$Products, prices and availability$kb$, $kb$Products, prices and availability are shown in the Shop and in the PRODUCTS section of the context. Prices are in Indian rupees. A product marked out of stock cannot be ordered. Low stock means only a few units are left. The item is reserved when an order is placed and goes back into stock if the order is cancelled.$kb$, $kb$general$kb$)
on conflict (slug) do update
  set title = excluded.title, content = excluded.content, category = excluded.category, updated_at = now();
