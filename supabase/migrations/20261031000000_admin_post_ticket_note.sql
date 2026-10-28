-- Helper: post an automated ticket update (admin) without sending a separate
-- "team replied" email — the order email already covers it.

create or replace function public.admin_post_ticket_note(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  perform set_config('app.skip_reply_notice', '1', true);
  v_id := public.add_ticket_comment(p_ticket, p_body, false);
  perform set_config('app.skip_reply_notice', '', true);
  return v_id;
end;
$$;

revoke all on function public.admin_post_ticket_note(uuid, text) from public, anon;
grant execute on function public.admin_post_ticket_note(uuid, text) to authenticated;
