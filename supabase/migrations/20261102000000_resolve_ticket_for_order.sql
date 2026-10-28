-- When a customer cancels their own order, resolve the linked support ticket too.

create or replace function public.resolve_ticket_for_order(p_order uuid, p_note text default 'Order cancelled by the customer.')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ref  text := upper(left(p_order::text, 8));
  v_tid  uuid;
  v_note text := btrim(coalesce(p_note, 'Order cancelled by the customer.'));
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  -- the order must belong to this customer
  if not exists (select 1 from public.orders where id = p_order and user_id = v_user) then
    raise exception 'Order not found';
  end if;

  select id into v_tid
    from public.support_requests
   where question ilike '%Order ref: #' || v_ref || '%'
   order by created_at desc
   limit 1;

  if v_tid is null then return; end if;

  perform set_config('app.skip_status_notice', '1', true);
  insert into public.ticket_comments (ticket_id, author_role, body)
    values (v_tid, 'system', v_note);
  update public.support_requests set status = 'resolved' where id = v_tid;
  perform set_config('app.skip_status_notice', '', true);
end;
$$;

revoke all on function public.resolve_ticket_for_order(uuid, text) from public, anon;
grant execute on function public.resolve_ticket_for_order(uuid, text) to authenticated;
