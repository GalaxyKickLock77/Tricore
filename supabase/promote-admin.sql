-- Run in the Supabase SQL editor (runs as postgres) AFTER the person has signed up.
update public.profiles set role = 'admin' where email = 'bharanipersonal3@gmail.com';

-- Also demote the old admin (optional): valid roles are 'user' and 'admin'
update public.profiles set role = 'user' where email = 'bharani007dharan@gmail.com';
