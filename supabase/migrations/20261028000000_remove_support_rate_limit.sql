-- Remove the per-contact rate limit from create_support_request.

create or replace function public.create_support_request(
  p_contact text, p_question text, p_reason text default null, p_transcript jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_contact text := btrim(coalesce(p_contact, ''));
  v_question text := btrim(coalesce(p_question, ''));
begin
  if char_length(v_contact) < 3 or char_length(v_contact) > 200 then
    raise exception 'Please provide a valid email or phone number';
  end if;
  if char_length(v_question) < 1 or char_length(v_question) > 2000 then
    raise exception 'Please describe what you need (up to 2000 characters)';
  end if;
  if octet_length(coalesce(p_transcript, '[]'::jsonb)::text) > 20000 then
    raise exception 'Conversation is too long';
  end if;

  insert into public.support_requests (user_id, contact, question, reason, transcript)
  values ((select auth.uid()), v_contact, v_question, left(p_reason, 500), coalesce(p_transcript, '[]'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_support_request(text, text, text, jsonb) from public;
grant execute on function public.create_support_request(text, text, text, jsonb) to anon, authenticated;
