-- Sandbox-only ledger: never updates orders, inventory or customer notifications.
create table public.phonepe_sandbox_payments (
  id uuid primary key,
  merchant_order_id text not null unique,
  provider_order_id text unique,
  amount integer not null default 100 check (amount = 100),
  state text not null default 'CREATED' check (state in ('CREATED','PENDING','COMPLETED','FAILED')),
  checkout_url text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checked_at timestamptz,
  error_code text,
  refund_id text unique,
  provider_refund_id text unique,
  refund_state text check (refund_state in ('REQUESTED','PENDING','COMPLETED','FAILED')),
  refund_approved_by uuid references auth.users(id),
  refund_approved_at timestamptz,
  refund_dispatch_at timestamptz,
  refund_error_code text,
  check (merchant_order_id = 'TC_TEST_' || id::text),
  check (refund_id is null or refund_id = 'TC_REF_' || id::text)
);
create table public.phonepe_sandbox_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.phonepe_sandbox_payments(id),
  kind text not null check (kind in ('payment','refund')),
  state text not null,
  source text not null,
  created_at timestamptz not null default now()
);
alter table public.phonepe_sandbox_payments enable row level security;
alter table public.phonepe_sandbox_events enable row level security;
revoke all on public.phonepe_sandbox_payments, public.phonepe_sandbox_events from anon, authenticated;
grant select on public.phonepe_sandbox_payments, public.phonepe_sandbox_events to authenticated;
grant all on public.phonepe_sandbox_payments, public.phonepe_sandbox_events to service_role;
grant usage, select on sequence public.phonepe_sandbox_events_id_seq to service_role;
create policy "sandbox payments: admin read" on public.phonepe_sandbox_payments for select to authenticated using (public.is_admin());
create policy "sandbox events: admin read" on public.phonepe_sandbox_events for select to authenticated using (public.is_admin());

create function public.record_phonepe_sandbox(p_id uuid, p_kind text, p_provider text, p_amount integer,
  p_state text, p_source text, p_error text default null, p_checkout text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.phonepe_sandbox_payments; previous text;
begin
  select * into r from public.phonepe_sandbox_payments where id = p_id for update;
  if not found then raise exception 'Unknown sandbox payment'; end if;
  if p_amount is null or p_amount <> r.amount or nullif(p_provider,'') is null then raise exception 'Invalid amount or provider ID'; end if;
  if p_state is null or p_state not in ('PENDING','COMPLETED','FAILED') then raise exception 'Invalid state'; end if;
  if p_kind = 'payment' then
    if r.provider_order_id is not null and r.provider_order_id <> p_provider then raise exception 'Order mismatch'; end if;
    previous := r.state;
    -- Terminal success is never downgraded. Failure can reconcile to success, never back to pending.
    if r.state = 'COMPLETED' or (r.state = 'FAILED' and p_state = 'PENDING') then
      update public.phonepe_sandbox_payments set checked_at = now() where id = p_id;
      return;
    end if;
    update public.phonepe_sandbox_payments set provider_order_id = p_provider, state = p_state,
      error_code = left(p_error,100), checkout_url = coalesce(p_checkout,checkout_url), checked_at = now(), updated_at = now() where id = p_id;
  elsif p_kind = 'refund' then
    if r.refund_id is null then raise exception 'Refund not approved'; end if;
    if r.provider_refund_id is not null and r.provider_refund_id <> p_provider then raise exception 'Refund mismatch'; end if;
    previous := r.refund_state;
    if r.refund_state = 'COMPLETED' or (r.refund_state = 'FAILED' and p_state = 'PENDING') then return; end if;
    update public.phonepe_sandbox_payments set provider_refund_id = p_provider, refund_state = p_state,
      refund_error_code = left(p_error,100), updated_at = now() where id = p_id;
  else raise exception 'Invalid kind'; end if;
  if previous is distinct from p_state then
    insert into public.phonepe_sandbox_events(payment_id,kind,state,source) values(p_id,p_kind,p_state,left(p_source,40));
  end if;
end;
$$;

-- Persist approval and a stable refund ID BEFORE contacting PhonePe.
-- Exactly one full refund request is supported per test payment, even after failure.
create function public.reserve_phonepe_sandbox_refund(p_id uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.phonepe_sandbox_payments; is_new boolean := false; may_submit boolean := false;
begin
  if not exists(select 1 from public.profiles where id = p_admin and role = 'admin') then raise exception 'Admins only'; end if;
  select * into r from public.phonepe_sandbox_payments where id = p_id for update;
  if not found or r.state <> 'COMPLETED' then raise exception 'Only completed payments can be refunded'; end if;
  if r.refund_id is null then
    update public.phonepe_sandbox_payments set refund_id = 'TC_REF_' || id::text, refund_state = 'REQUESTED',
      refund_approved_by = p_admin, refund_approved_at = now(), refund_dispatch_at = now(), updated_at = now() where id = p_id returning * into r;
    insert into public.phonepe_sandbox_events(payment_id,kind,state,source) values(p_id,'refund','REQUESTED','admin');
    is_new := true;
    may_submit := true;
  elsif r.refund_state = 'REQUESTED' and r.refund_dispatch_at < now() - interval '90 seconds' then
    -- A single retry worker may recover a crash/timeout, using the exact same refund ID.
    update public.phonepe_sandbox_payments set refund_dispatch_at = now() where id = p_id returning * into r;
    may_submit := true;
  end if;
  return jsonb_build_object('payment',to_jsonb(r),'is_new',is_new,'may_submit',may_submit);
end;
$$;
revoke all on function public.record_phonepe_sandbox(uuid,text,text,integer,text,text,text,text) from public, anon, authenticated;
revoke all on function public.reserve_phonepe_sandbox_refund(uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_phonepe_sandbox(uuid,text,text,integer,text,text,text,text) to service_role;
grant execute on function public.reserve_phonepe_sandbox_refund(uuid,uuid) to service_role;
