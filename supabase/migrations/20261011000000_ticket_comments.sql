-- Support tickets: comments/updates, an "in progress" status, and customers can follow their own tickets.

-- statuses: open -> in_progress -> resolved
alter table public.support_requests drop constraint if exists support_requests_status_check;
alter table public.support_requests
  add constraint support_requests_status_check check (status in ('open', 'in_progress', 'resolved'));
alter table public.support_requests add column if not exists updated_at timestamptz not null default now();

create function public.touch_support_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger support_requests_touch
  before update on public.support_requests
  for each row execute function public.touch_support_request();

-- a signed-in customer can read their own tickets (anonymous tickets have no owner)
create policy "support: owner read" on public.support_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- comments
create table public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_requests (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  author_role text not null check (author_role in ('admin', 'customer')),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  is_internal boolean not null default false,   -- internal notes are visible to admins only
  created_at  timestamptz not null default now()
);
create index ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);

revoke all on public.ticket_comments from anon, authenticated;
grant select on public.ticket_comments to authenticated;   -- inserts only through add_ticket_comment()
alter table public.ticket_comments enable row level security;

create policy "comments: admin read" on public.ticket_comments
  for select to authenticated using (public.is_admin());
create policy "comments: owner reads public comments" on public.ticket_comments
  for select to authenticated
  using (
    not is_internal
    and exists (
      select 1 from public.support_requests t
      where t.id = ticket_id and t.user_id = (select auth.uid())
    )
  );

-- the only way to add a comment: admins on any ticket, customers on their own tickets
create function public.add_ticket_comment(p_ticket uuid, p_body text, p_internal boolean default false)
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

  insert into public.ticket_comments (ticket_id, author_id, author_role, body, is_internal)
  values (p_ticket, v_uid, case when v_admin then 'admin' else 'customer' end, v_body, v_internal)
  returning id into v_id;

  update public.support_requests
     set status = case
           when v_admin and not v_internal and v_status = 'open' then 'in_progress'   -- first public reply
           when not v_admin and v_status = 'resolved' then 'open'                    -- customer replied: reopen
           else v_status end
   where id = p_ticket;
  return v_id;
end;
$$;

revoke all on function public.add_ticket_comment(uuid, text, boolean) from public, anon;
grant execute on function public.add_ticket_comment(uuid, text, boolean) to authenticated;
