-- Customers can no longer reopen a resolved ticket by replying; they must open a new one.

create or replace function public.add_ticket_comment(p_ticket uuid, p_body text, p_internal boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_admin    boolean := public.is_admin();
  v_owner    uuid;
  v_status   text;
  v_internal boolean := v_admin and coalesce(p_internal, false);
  v_body     text := btrim(coalesce(p_body, ''));
  v_id       uuid;
  v_new      text;
begin
  if v_uid is null then
    raise exception 'Please sign in';
  end if;
  select user_id, status into v_owner, v_status from public.support_requests where id = p_ticket;
  if not found or (not v_admin and v_owner is distinct from v_uid) then
    raise exception 'Ticket not found';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Please write a message (up to 2000 characters)';
  end if;
  if not v_admin and (select count(*) from public.ticket_comments
                      where ticket_id = p_ticket and author_id = v_uid
                        and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many messages. Please wait a little.';
  end if;

  -- admin first public reply moves open -> in_progress; customers cannot reopen resolved tickets
  v_new := case
    when v_admin and not v_internal and v_status = 'open' then 'in_progress'
    else v_status end;

  if v_new <> v_status then
    perform set_config('app.skip_status_notice', '1', true);
    update public.support_requests set status = v_new where id = p_ticket;
    perform set_config('app.skip_status_notice', '', true);
  end if;

  insert into public.ticket_comments (ticket_id, author_id, author_role, body, is_internal)
  values (p_ticket, v_uid, case when v_admin then 'admin' else 'customer' end, v_body, v_internal)
  returning id into v_id;
  return v_id;
end;
$$;
