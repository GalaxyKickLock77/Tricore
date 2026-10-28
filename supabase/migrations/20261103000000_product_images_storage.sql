-- Product images storage bucket (public read, admin write)

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- anyone can read product images
create policy "product images: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

-- only admins can upload/update/delete
create policy "product images: admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "product images: admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "product images: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
