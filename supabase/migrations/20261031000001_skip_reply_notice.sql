-- Make admin-posted automated notes (skip_reply_notice=1) not send a "team replied" email.

create or replace function public.trg_ticket_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       record;
  v_admin text;
begin
  if new.is_internal then return new; end if;

  select id, contact, status into t from public.support_requests where id = new.ticket_id;
  if not found then return new; end if;

  select value into v_admin from public.store_settings where key = 'support_email';

  if new.author_role = 'system' then
    if coalesce(current_setting('app.skip_status_notice', true), '') = '1' then return new; end if;
    perform public.send_notification(jsonb_build_object(
      'type', 'ticket', 'event', 'status', 'ref', upper(left(t.id::text, 8)),
      'contact', t.contact, 'status',
      case t.status when 'open' then 'Open' when 'in_progress' then 'In progress' else 'Resolved' end,
      'admin_email', coalesce(v_admin, '')));
    return new;
  end if;

  -- automated admin notes (skip_reply_notice) are visible in the thread but not emailed
  if new.author_role = 'admin' and coalesce(current_setting('app.skip_reply_notice', true), '') = '1' then
    return new;
  end if;

  perform public.send_notification(jsonb_build_object(
    'type', 'ticket', 'event', case when new.author_role = 'admin' then 'reply' else 'customer_reply' end,
    'ref', upper(left(t.id::text, 8)), 'contact', t.contact, 'body', left(new.body, 1500),
    'status', case t.status when 'open' then 'Open' when 'in_progress' then 'In progress' else 'Resolved' end,
    'admin_email', coalesce(v_admin, '')));
  return new;
end;
$$;
