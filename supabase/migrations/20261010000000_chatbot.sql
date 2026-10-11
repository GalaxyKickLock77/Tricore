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
  -- basic abuse control: at most 5 requests per contact per hour
  if (select count(*) from public.support_requests
       where contact = v_contact and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests. Our team will get back to you soon.';
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
