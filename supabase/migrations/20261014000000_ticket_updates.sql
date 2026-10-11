-- Ticket updates the customer can see and get by email:
--   * every status change is written into the ticket thread (visible to the customer)
--   * the customer is emailed on a status change, and every team reply email shows the status
--   * "unread replies" counter for customers

-- thread entries can now also come from the system (status changes)
alter table public.ticket_comments drop constraint if exists ticket_comments_author_role_check;
alter table public.ticket_comments
  add constraint ticket_comments_author_role_check check (author_role in ('admin', 'customer', 'system'));
-- keep entries written in one transaction in the order they were written
alter table public.ticket_comments alter column created_at set default clock_timestamp();

alter table public.support_requests add column if not exists customer_last_seen timestamptz;

-- ───────── status changes are logged in the thread ─────────
create function public.trg_ticket_status_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ticket_comments (ticket_id, author_role, body)
  values (new.id, 'system', 'Status changed to ' || case new.status when 'open' then 'Open' when 'in_progress' then 'In progress' else 'Resolved' end);
  return new;
end;
$$;
create trigger support_requests_status_log
  after update of status on public.support_requests
  for each row when (old.status is distinct from new.status)
  execute function public.trg_ticket_status_log();

-- ───────── emails: status changes and team replies (with the status) ─────────
create or replace function public.trg_ticket_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t        record;
  v_admin  text;
  v_status text;
begin
  if new.is_internal then return new; end if;                                          -- internal notes are never emailed
  select id, contact, status into t from public.support_requests where id = new.ticket_id;
  if not found then return new; end if;
  v_status := case t.status when 'open' then 'Open' when 'in_progress' then 'In progress' else 'Resolved' end;
  select value into v_admin from public.store_settings where key = 'support_email';

  if new.author_role = 'system' then
    -- a status change made together with a reply is announced inside that reply's email
    if coalesce(current_setting('app.skip_status_notice', true), '') = '1' then return new; end if;
    perform public.send_notification(jsonb_build_object(
      'type', 'ticket', 'event', 'status', 'ref', upper(left(t.id::text, 8)),
      'contact', t.contact, 'status', v_status, 'admin_email', coalesce(v_admin, '')));
    return new;
  end if;

  perform public.send_notification(jsonb_build_object(
    'type', 'ticket', 'event', case when new.author_role = 'admin' then 'reply' else 'customer_reply' end,
    'ref', upper(left(t.id::text, 8)), 'contact', t.contact, 'body', left(new.body, 1500),
    'status', v_status, 'admin_email', coalesce(v_admin, '')));
  return new;
end;
$$;

-- add_ticket_comment: update the status first, so the reply email already shows the new status
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
  v_new      text;
  v_internal boolean := v_admin and coalesce(p_internal, false);
  v_body     text := btrim(coalesce(p_body, ''));
  v_id       uuid;
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

  v_new := case
    when v_admin and not v_internal and v_status = 'open' then 'in_progress'      -- first public reply
    when not v_admin and v_status = 'resolved' then 'open'                       -- customer replied: reopen
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

-- ───────── unread replies for customers ─────────
create function public.mark_ticket_seen(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_requests set customer_last_seen = now()
   where id = p_ticket and user_id = (select auth.uid());
end;
$$;

create function public.my_unread_ticket_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.support_requests t
   where t.user_id = (select auth.uid())
     and exists (
       select 1 from public.ticket_comments c
        where c.ticket_id = t.id and not c.is_internal and c.author_role in ('admin', 'system')
          and c.created_at > coalesce(t.customer_last_seen, '-infinity'::timestamptz)
     )
$$;

revoke all on function public.mark_ticket_seen(uuid) from public, anon;
revoke all on function public.my_unread_ticket_count() from public, anon;
grant execute on function public.mark_ticket_seen(uuid) to authenticated;
grant execute on function public.my_unread_ticket_count() to authenticated;

-- live updates for customers and admins (Supabase Realtime; rules still apply to who receives what)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ticket_comments;
    alter publication supabase_realtime add table public.support_requests;
  end if;
exception when duplicate_object then
  null;
end $$;
