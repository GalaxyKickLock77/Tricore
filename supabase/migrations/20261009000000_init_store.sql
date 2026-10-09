-- Tricore Store: profiles, products, orders with Row Level Security.

-- ───────── profiles ─────────
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Every new auth user gets a profile with role 'user'. Admins are promoted manually (see README).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Used by RLS policies. SECURITY DEFINER avoids recursive policy evaluation on profiles.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ───────── products ─────────
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  description text,
  price       numeric(10, 2) not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  image_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ───────── orders ─────────
create table public.orders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity   integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  status     text not null default 'pending'
             check (status in ('pending', 'paid', 'shipped', 'cancelled')),
  created_at timestamptz not null default now()
);

create index orders_user_id_idx on public.orders (user_id);
create index orders_product_id_idx on public.orders (product_id);

-- ───────── privileges (least privilege; RLS still applies on top) ─────────
revoke all on public.profiles, public.products, public.orders from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;   -- role is NOT updatable by clients

grant select, insert, update, delete on public.products to authenticated;

grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;        -- inserts happen only via place_order()

-- ───────── Row Level Security ─────────
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- profiles
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- products
create policy "products: read active, admin reads all" on public.products
  for select to authenticated
  using (is_active or public.is_admin());

create policy "products: admin insert" on public.products
  for insert to authenticated with check (public.is_admin());

create policy "products: admin update" on public.products
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "products: admin delete" on public.products
  for delete to authenticated using (public.is_admin());

-- orders
create policy "orders: read own or admin" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "orders: admin update status" on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────── place_order: the only way to create an order ─────────
create function public.place_order(p_product_id uuid, p_quantity integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_price numeric(10, 2);
  v_order uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  -- Lock the row so concurrent buyers cannot oversell.
  select price into v_price
  from public.products
  where id = p_product_id and is_active
  for update;

  if not found then
    raise exception 'Product not available';
  end if;

  update public.products
     set stock = stock - p_quantity
   where id = p_product_id and stock >= p_quantity;

  if not found then
    raise exception 'Insufficient stock';
  end if;

  insert into public.orders (user_id, product_id, quantity, unit_price)
  values (v_user, p_product_id, p_quantity, v_price)
  returning id into v_order;

  return v_order;
end;
$$;

revoke all on function public.place_order(uuid, integer) from public, anon;
grant execute on function public.place_order(uuid, integer) to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
