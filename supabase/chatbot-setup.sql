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


-- GENERATED from supabase/kb/articles.json by web/scripts/gen-kb-sql.mjs. Safe to re-run.
insert into public.kb_articles (slug, title, content, category) values
  ($kb$about-tricore$kb$, $kb$About Tricore IT Solutions$kb$, $kb$Tricore IT Solutions is an online store for IT products. Customers browse the catalog, choose a product, enter their delivery address and pay with GPay (UPI). When the Tricore team confirms that the money has reached the bank account, the order is shipped to the customer's address, and the customer can follow every step, including the courier and tracking number, under My orders. Product categories shown on the website are: Laptops and Desktops, Networking, Servers and Storage, Security and CCTV, Peripherals, and Software and Licenses. The exact products, prices and stock that are currently available are listed in the PRODUCTS section of the context.$kb$, $kb$core$kb$),
  ($kb$how-ordering-works$kb$, $kb$How ordering works$kb$, $kb$Step 1: Sign in with your Google account and open the Shop. Step 2: Click Buy on a product, which opens the checkout page. Step 3: Enter your delivery address (name, phone number, PIN code and address) and place the order; the item is reserved for you. Step 4: Pay the order amount with GPay or any UPI app by scanning the QR code or using the shown UPI ID, then enter the UPI transaction ID (UTR) from the payment and tap I have paid. Step 5: The Tricore team checks that the money reached the bank account and confirms the payment. Step 6: The order is shipped to your address and the courier name and tracking number appear under My orders. Step 7: The order is marked delivered. The assistant in the chat can start an order for you, but the address and payment are completed on the checkout page. Payment is only by GPay (UPI).$kb$, $kb$core$kb$),
  ($kb$talk-to-human$kb$, $kb$Prices, special deals and the Tricore team$kb$, $kb$The assistant cannot change prices, give discounts or coupons, approve special or bulk deals, or create custom quotes. If a customer wants a lower price or a special deal, the assistant explains it cannot do that itself and asks whether the customer would like to be connected with the Tricore team. Payment is by GPay (UPI) at checkout, and the team confirms the payment before shipping. Exact delivery times, shipping charges, returns and warranty terms are not listed here, so the assistant must say honestly that it does not have them on hand and must not guess.$kb$, $kb$core$kb$),
  ($kb$sign-in$kb$, $kb$Signing in and creating an account$kb$, $kb$Tricore uses Google sign-in only. There is no separate password. New customers create their account by clicking Sign up with Google, and returning customers click Sign in with Google. You must be signed in to open the Shop and to see your orders. The landing page and this assistant are available without signing in.$kb$, $kb$general$kb$),
  ($kb$order-status$kb$, $kb$Order status meanings$kb$, $kb$After signing in, customers can see all their orders under My orders with a step-by-step progress bar. The status meanings are: Awaiting payment means the order is placed and waiting for the customer to pay with GPay. Verifying payment means the customer submitted the UPI transaction ID and the team is checking it in the bank. Payment received means the money reached the bank and the order will be shipped. Shipped means the order was dispatched and the courier name and tracking number are shown. Delivered means the order reached the customer. Cancelled means the order was cancelled. A customer can cancel their own order while it is still awaiting payment.$kb$, $kb$general$kb$),
  ($kb$products-and-stock$kb$, $kb$Products, prices and availability$kb$, $kb$Products, prices and availability are shown in the Shop and in the PRODUCTS section of the context. Prices are in Indian rupees. A product marked out of stock cannot be ordered. Low stock means only a few units are left. The item is reserved when an order is placed, and is returned to stock if the order is cancelled.$kb$, $kb$general$kb$)
on conflict (slug) do update
  set title = excluded.title, content = excluded.content, category = excluded.category, updated_at = now();
