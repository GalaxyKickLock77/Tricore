-- Helper used by the app when an admin changes a ticket's status as part of an
-- order action: updates the status without sending a separate "status changed"
-- email (the order/ticket reply email already covers it).

create or replace function public.admin_set_ticket_status(p_ticket uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('open', 'in_progress', 'resolved') then raise exception 'Invalid status'; end if;
  perform set_config('app.skip_status_notice', '1', true);
  update public.support_requests set status = p_status where id = p_ticket;
  perform set_config('app.skip_status_notice', '', true);
  if not found then raise exception 'Ticket not found'; end if;
end;
$$;

revoke all on function public.admin_set_ticket_status(uuid, text) from public, anon;
grant execute on function public.admin_set_ticket_status(uuid, text) to authenticated;
