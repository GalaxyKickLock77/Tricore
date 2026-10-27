-- Run in the Supabase SQL editor (runs as postgres) AFTER the person has signed up.
update public.profiles set role = 'admin' where email = 'bharani007dharan@gmail.com';
