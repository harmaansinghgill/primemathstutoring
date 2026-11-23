-- Prime Maths Tutoring student area, part 3: sending the emails.
-- Run this last, once the send-emails Edge Function is deployed (see README.md).
-- Replace YOUR-PROJECT-REF below with your project's reference (the part before .supabase.co).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A random password the scheduler shows the email sender, so nobody else can set it off.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pmt_email_secret',
  'Lets the scheduler call the send-emails function');
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'pmt_project_url', 'This project''s address');

-- Every two minutes: if any notifications are waiting, ask the Edge Function to email them.
select cron.schedule('pmt-send-emails', '*/2 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pmt_project_url') || '/functions/v1/send-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-pmt-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pmt_email_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
  where exists (select 1 from public.notifications where email_status is null and created_at < now() - interval '1 minute');
$$);

-- Every day at 16:05 UTC (just after school): due date reminders and missing work.
select cron.schedule('pmt-due-reminders', '5 16 * * *', $$ select public.queue_due_reminders(); $$);

-- Live updates: new messages and notifications appear without refreshing the page.
alter publication supabase_realtime add table public.messages, public.notifications;
