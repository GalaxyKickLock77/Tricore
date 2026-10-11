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
