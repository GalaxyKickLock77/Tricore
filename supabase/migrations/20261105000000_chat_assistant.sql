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
