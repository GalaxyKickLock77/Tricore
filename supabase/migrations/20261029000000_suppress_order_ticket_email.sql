-- Suppress the "ticket opened" email for order-related tickets (those are already
-- announced by the order_placed email), so customers/admins get one email per order.

create or replace function public.trg_ticket_opened_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin text;
begin
  if new.reason is not null and new.reason ilike 'Order placed%' then
    return new;   -- order flow handles its own emails
  end if;
  select value into v_admin from public.store_settings where key = 'support_email';
  perform public.send_notification(jsonb_build_object(
    'type', 'ticket', 'event', 'opened', 'ref', upper(left(new.id::text, 8)),
    'contact', new.contact, 'question', left(new.question, 1500), 'admin_email', coalesce(v_admin, '')));
  return new;
end;
$$;
-- trigger already exists; replacing the function is enough
