-- Prime Maths Tutoring student area, part 2: messages, notifications and tutor notes.
-- Run this after schema.sql: SQL Editor, New query, paste everything, Run.
--
-- What it adds:
--   * Each student has a tutor, and optionally a parent or guardian who gets email updates.
--   * Messages: one conversation per student with their tutors, and comments on each piece of homework.
--   * Notifications: created automatically when homework is set, handed in or marked, when a message
--     arrives, and as due dates get close. They show in the student area and can be emailed.
--   * Email settings: everyone chooses which emails they get.
--   * Tutor notes: private notes about a student that only tutors can see.

-- Students' tutors and parents (only tutors and admins can change these) --------------------------

alter table public.profiles add column tutor_id uuid references public.profiles (id) on delete set null;
alter table public.profiles add column parent_name text not null default '';
alter table public.profiles add column parent_email text not null default '';
alter table public.profiles add column parent_updates boolean not null default false;

-- Who hears about a student's work: their own tutor, otherwise whoever set the homework, otherwise every admin.
create or replace function public.tutors_for(p_student uuid, p_homework uuid default null) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  result uuid[];
begin
  select array[p.tutor_id] into result
  from public.profiles p join public.profiles t on t.id = p.tutor_id and t.role in ('tutor', 'admin')
  where p.id = p_student;
  if result is not null then return result; end if;
  if p_homework is not null then
    select array[h.created_by] into result
    from public.homework h join public.profiles t on t.id = h.created_by and t.role in ('tutor', 'admin')
    where h.id = p_homework;
    if result is not null then return result; end if;
  end if;
  select coalesce(array_agg(id), '{}') into result from public.profiles where role = 'admin';
  return result;
end;
$$;

-- Students can see their tutors' names (and nothing else about them), so messages show who sent them.
create or replace function public.staff_names() returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), 'Your tutor') from public.profiles p
  where p.role in ('tutor', 'admin') and auth.uid() is not null;
$$;

-- Email settings ------------------------------------------------------------------------------------

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  email_new_homework boolean not null default true,
  email_reminders boolean not null default true,
  email_marked boolean not null default true,
  email_messages boolean not null default true,
  email_handed_in boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "Read your own email settings" on public.notification_prefs
  for select using (user_id = auth.uid());
create policy "Save your own email settings" on public.notification_prefs
  for insert with check (user_id = auth.uid());
create policy "Change your own email settings" on public.notification_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Notifications ---------------------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('homework_set', 'due_7', 'due_3', 'due_1', 'overdue', 'missing', 'handed_in', 'marked', 'message')),
  title text not null,
  body text not null default '',
  homework_id uuid references public.homework (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,   -- the student it's about
  count integer not null default 1,                                    -- messages are grouped
  dedupe_key text unique,
  read_at timestamptz,
  email_status text,          -- empty while waiting; then sent, off, failed, not_configured or expired
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_email_idx on public.notifications (created_at) where email_status is null;

alter table public.notifications enable row level security;

create policy "See your own notifications" on public.notifications
  for select using (user_id = auth.uid());
create policy "Mark your own notifications as read" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Clear your own notifications" on public.notifications
  for delete using (user_id = auth.uid());

-- Notifications are only ever created by the database itself.
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text,
  p_homework uuid, p_student uuid, p_dedupe text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  added integer;
begin
  if p_user is null then return false; end if;
  insert into public.notifications (user_id, kind, title, body, homework_id, student_id, dedupe_key)
  values (p_user, p_kind, p_title, coalesce(p_body, ''), p_homework, p_student, p_dedupe)
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added > 0;
end;
$$;

create or replace function public.short_date(d date) returns text
language sql stable set search_path = public as $$ select trim(to_char(d, 'Dy FMDD Mon')) $$;

-- Homework set for a student
create or replace function public.on_homework_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h public.homework;
begin
  select * into h from public.homework where id = new.homework_id;
  perform public.notify(new.student_id, 'homework_set', 'New homework: ' || h.title,
    concat_ws('. ',
      case when h.due_date is not null then 'Due ' || public.short_date(h.due_date) end,
      case when h.self_mark_questions <> '' then 'Mark ' || h.self_mark_questions || ' yourself' end),
    h.id, new.student_id, 'set:' || h.id || ':' || new.student_id);
  return new;
end;
$$;
create trigger notify_homework_assigned after insert on public.homework_students
  for each row execute function public.on_homework_assigned();

-- Handed in (tells the tutor) and marked (tells the student)
create or replace function public.on_submission_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h public.homework;
  who text;
  late boolean;
  tutor uuid;
begin
  select * into h from public.homework where id = new.homework_id;
  if tg_op = 'INSERT' then
    select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
    late := h.due_date is not null and (new.submitted_at at time zone 'Europe/London')::date > h.due_date;
    foreach tutor in array public.tutors_for(new.student_id, h.id) loop
      perform public.notify(tutor, 'handed_in', who || ' handed in ' || h.title,
        concat_ws('. ', case when late then 'Handed in late' end,
          case when new.self_mark is not null then 'Self-mark ' || new.self_mark end,
          case when new.note <> '' then '"' || left(new.note, 120) || '"' end),
        h.id, new.student_id, 'in:' || new.id || ':' || tutor);
    end loop;
  elsif new.marked_at is not null and (old.marked_at is null or old.marked_at is distinct from new.marked_at) then
    perform public.notify(new.student_id, 'marked',
      case when old.marked_at is null then 'Marked: ' else 'Mark updated: ' end || h.title,
      concat_ws('. ',
        case when new.mark is not null then 'Your mark: ' || new.mark end,
        case when new.feedback is not null then 'Your tutor left feedback' end),
      h.id, new.student_id, 'marked:' || new.id || ':' || extract(epoch from new.marked_at));
  end if;
  return new;
end;
$$;
create trigger notify_submission after insert or update on public.submissions
  for each row execute function public.on_submission_change();

-- Messages --------------------------------------------------------------------------------------------
-- One conversation per student. A message can be about a piece of homework (a comment on it).

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  homework_id uuid references public.homework (id) on delete set null,
  body text not null default '',
  files jsonb not null default '[]',
  created_at timestamptz not null default now(),
  check (length(trim(body)) > 0 or jsonb_array_length(files) > 0),
  check (length(body) <= 5000)
);
create index messages_student_idx on public.messages (student_id, created_at);

alter table public.messages enable row level security;

create policy "Students see their conversation, staff see all" on public.messages
  for select using (student_id = auth.uid() or public.is_staff());
create policy "Write in your own conversation" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and (student_id = auth.uid() or public.is_staff())
    and (homework_id is null or exists (
      select 1 from public.homework_students hs where hs.homework_id = messages.homework_id and hs.student_id = messages.student_id))
  );
create policy "Remove your own messages, staff remove any" on public.messages
  for delete using (sender_id = auth.uid() or public.is_staff());

create or replace function public.protect_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.sender_id := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;
create trigger protect_message before insert on public.messages
  for each row execute function public.protect_message();

-- A new message tells the other side. Several unread messages are grouped into one notification.
create or replace function public.on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender public.profiles;
  recipients uuid[];
  r uuid;
  preview text;
  hw_title text;
  existing public.notifications;
begin
  select * into sender from public.profiles where id = new.sender_id;
  if new.homework_id is not null then select title into hw_title from public.homework where id = new.homework_id; end if;
  preview := case when length(trim(new.body)) > 0 then left(regexp_replace(new.body, '\s+', ' ', 'g'), 160) else 'Sent a file' end;
  if hw_title is not null then preview := 'About ' || hw_title || ': ' || preview; end if;
  if new.sender_id = new.student_id then
    recipients := public.tutors_for(new.student_id, new.homework_id);
  else
    recipients := array[new.student_id];
  end if;
  foreach r in array recipients loop
    continue when r = new.sender_id;
    select * into existing from public.notifications
      where user_id = r and kind = 'message' and student_id = new.student_id and read_at is null and email_status is null
      order by created_at desc limit 1;
    if existing.id is not null then
      update public.notifications
        set count = existing.count + 1,
            title = (existing.count + 1) || ' new messages from ' || coalesce(nullif(sender.full_name, ''), sender.email),
            body = preview, homework_id = coalesce(new.homework_id, existing.homework_id)
        where id = existing.id;
    else
      perform public.notify(r, 'message', 'New message from ' || coalesce(nullif(sender.full_name, ''), sender.email),
        preview, new.homework_id, new.student_id, 'msg:' || new.id || ':' || r);
    end if;
  end loop;
  return new;
end;
$$;
create trigger notify_message after insert on public.messages
  for each row execute function public.on_message();

-- When each person last read each conversation (for unread counts)
create table public.thread_reads (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, student_id)
);

alter table public.thread_reads enable row level security;

create policy "See your own read markers" on public.thread_reads
  for select using (user_id = auth.uid());
create policy "Save your own read markers" on public.thread_reads
  for insert with check (user_id = auth.uid() and (student_id = auth.uid() or public.is_staff()));
create policy "Update your own read markers" on public.thread_reads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid() and (student_id = auth.uid() or public.is_staff()));

-- Private tutor notes ---------------------------------------------------------------------------------

create table public.tutor_notes (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  notes text not null default '',
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.tutor_notes enable row level security;

create policy "Only tutors see and write notes" on public.tutor_notes
  for all using (public.is_staff()) with check (public.is_staff());

-- Due date reminders ------------------------------------------------------------------------------------
-- Run once a day (see email-schedule.sql). Students hear 7 days, 3 days and 1 day before a due date,
-- and the day after if it's missing; their tutor hears the day after too.
create or replace function public.queue_due_reminders(p_today date default (now() at time zone 'Europe/London')::date)
returns integer
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  rec record;
  d integer;
  kind text;
  title text;
  tutor uuid;
  made integer := 0;
begin
  for rec in
    select h.id as homework_id, h.title as hw_title, h.due_date, h.created_at, hs.student_id,
           coalesce(nullif(p.full_name, ''), p.email) as student_name
    from public.homework_students hs
    join public.homework h on h.id = hs.homework_id
    join public.profiles p on p.id = hs.student_id
    where h.due_date is not null
      and h.due_date between p_today - 1 and p_today + 7
      and not exists (select 1 from public.submissions s where s.homework_id = h.id and s.student_id = hs.student_id)
  loop
    d := rec.due_date - p_today;
    kind := case d when 7 then 'due_7' when 3 then 'due_3' when 1 then 'due_1' when -1 then 'overdue' end;
    continue when kind is null;
    -- No reminder on the day it was set: the "new homework" notice already gives the due date.
    continue when kind <> 'overdue' and (rec.created_at at time zone 'Europe/London')::date >= p_today;
    title := case kind
      when 'due_7' then 'Due in a week: '
      when 'due_3' then 'Due in 3 days: '
      when 'due_1' then 'Due tomorrow: '
      else 'Missing: ' end || rec.hw_title;
    if public.notify(rec.student_id, kind, title,
      case when kind = 'overdue' then 'This was due ' || public.short_date(rec.due_date) || '. Hand it in as soon as you can, or message your tutor.'
           else 'Due ' || public.short_date(rec.due_date) || '. You haven''t handed it in yet.' end,
      rec.homework_id, rec.student_id, kind || ':' || rec.homework_id || ':' || rec.student_id) then
      made := made + 1;
    end if;
    if kind = 'overdue' then
      foreach tutor in array public.tutors_for(rec.student_id, rec.homework_id) loop
        perform public.notify(tutor, 'missing', rec.student_name || ' hasn''t handed in ' || rec.hw_title,
          'It was due ' || public.short_date(rec.due_date) || '.',
          rec.homework_id, rec.student_id, 'missing:' || rec.homework_id || ':' || rec.student_id || ':' || tutor);
      end loop;
    end if;
  end loop;
  return made;
end;
$$;

-- Emails ------------------------------------------------------------------------------------------------
-- The email sender (an Edge Function) calls these. Each notification is emailed at most once, and only if
-- the person wants that kind of email. Parents get copies of new homework, reminders and marks if turned on.

create or replace function public.email_category(kind text) returns text
language sql immutable set search_path = public as $$
  select case
    when kind = 'homework_set' then 'new_homework'
    when kind in ('due_7', 'due_3', 'due_1', 'overdue', 'missing') then 'reminders'
    when kind = 'marked' then 'marked'
    when kind = 'message' then 'messages'
    when kind = 'handed_in' then 'handed_in'
  end
$$;

create or replace function public.claim_emails(p_wait interval default interval '1 minute')
returns table (id uuid, user_id uuid, email text, full_name text, role text, kind text, title text, body text,
  homework_id uuid, student_id uuid, created_at timestamptz, parent_email text, parent_name text, parent_copy boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- Anything older than two days is no longer worth emailing.
  update public.notifications n set email_status = 'expired'
    where n.email_status is null and n.created_at < now() - interval '2 days';
  -- Turned off in their settings
  update public.notifications n set email_status = 'off'
    from public.notification_prefs p
    where n.email_status is null and p.user_id = n.user_id and n.created_at < now() - p_wait
      and not case public.email_category(n.kind)
        when 'new_homework' then p.email_new_homework
        when 'reminders' then p.email_reminders
        when 'marked' then p.email_marked
        when 'messages' then p.email_messages
        when 'handed_in' then p.email_handed_in
        else true end;
  return query
  with claimed as (
    update public.notifications n set email_status = 'sending'
    where n.id in (
      select x.id from public.notifications x
      where x.email_status is null and x.created_at < now() - p_wait
      order by x.created_at
      for update skip locked
      limit 200)
    returning n.*
  )
  select c.id, c.user_id, pr.email, pr.full_name, pr.role, c.kind, c.title, c.body, c.homework_id, c.student_id, c.created_at,
         pr.parent_email, pr.parent_name,
         (pr.role = 'student' and pr.parent_updates and pr.parent_email <> ''
           and c.kind in ('homework_set', 'due_3', 'due_1', 'overdue', 'marked')) as parent_copy
  from claimed c join public.profiles pr on pr.id = c.user_id
  order by c.user_id, c.created_at;
end;
$$;

create or replace function public.finish_emails(p_ids uuid[], p_status text) returns void
language sql security definer set search_path = public as $$
  update public.notifications set email_status = p_status,
    emailed_at = case when p_status = 'sent' then now() else emailed_at end
  where id = any (p_ids);
$$;

-- Files attached to messages: messages/<student id>/<file> ---------------------------------------------

create policy "Students open files in their conversation" on storage.objects
  for select using (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'messages'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
create policy "Students attach files in their conversation" on storage.objects
  for insert with check (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'messages'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Access ---------------------------------------------------------------------------------------------------

grant select, insert, update, delete on public.notification_prefs, public.messages, public.thread_reads,
  public.tutor_notes to authenticated;
-- Supabase gives new tables full access by default, so take that back: people can only read, clear, and
-- mark their own notifications as read.
revoke insert, update, truncate, references, trigger on public.notifications from authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on public.notification_prefs, public.notifications, public.messages, public.thread_reads,
  public.tutor_notes from anon;

revoke execute on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;
revoke execute on function public.tutors_for(uuid, uuid), public.notify(uuid, text, text, text, uuid, uuid, text),
  public.on_homework_assigned(), public.on_submission_change(), public.protect_message(), public.on_message(),
  public.queue_due_reminders(date), public.claim_emails(interval), public.finish_emails(uuid[], text)
  from public, anon, authenticated;
