-- Prime Maths Tutoring student area
-- Run this once in Supabase: SQL Editor, New query, paste everything, Run.
--
-- Who can do what:
--   * Students can only see their own homework, their own submissions and the resources for their subjects.
--   * Students can hand in homework, but cannot change marks or feedback.
--   * Tutors and admins can see everything, set homework, mark it and share resources.
--   * Only admins can change someone's role.
-- Nobody can create an account from the website: accounts are added in the Supabase dashboard.

-- People -----------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'tutor', 'admin')),
  subjects text[] not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('tutor', 'admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Every new account gets a profile automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins can change roles; nobody can change their own id or email from the website.
-- Changes made in the Supabase dashboard (where nobody is logged in) are always allowed.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  new.id := old.id;
  new.email := old.email;
  return new;
end;
$$;

create trigger protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile();

alter table public.profiles enable row level security;

create policy "See your own profile, staff see everyone" on public.profiles
  for select using (id = auth.uid() or public.is_staff());
create policy "Staff edit profiles" on public.profiles
  for update using (public.is_staff()) with check (public.is_staff());
create policy "Admins remove profiles" on public.profiles
  for delete using (public.is_admin());

-- Homework ---------------------------------------------------------------------------------------

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  title text not null,
  instructions text not null default '',
  due_date date,
  attachment_path text,
  attachment_name text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Which students each piece of homework is set for.
create table public.homework_students (
  homework_id uuid not null references public.homework (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  primary key (homework_id, student_id)
);

alter table public.homework enable row level security;
alter table public.homework_students enable row level security;

create policy "Students see homework set for them, staff see all" on public.homework
  for select using (
    public.is_staff()
    or exists (select 1 from public.homework_students hs where hs.homework_id = homework.id and hs.student_id = auth.uid())
  );
create policy "Staff set homework" on public.homework
  for insert with check (public.is_staff());
create policy "Staff edit homework" on public.homework
  for update using (public.is_staff()) with check (public.is_staff());
create policy "Staff remove homework" on public.homework
  for delete using (public.is_staff());

create policy "Students see their own assignments, staff see all" on public.homework_students
  for select using (student_id = auth.uid() or public.is_staff());
create policy "Staff assign homework" on public.homework_students
  for insert with check (public.is_staff());
create policy "Staff unassign homework" on public.homework_students
  for delete using (public.is_staff());

-- Handing in -------------------------------------------------------------------------------------

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homework (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  files jsonb not null default '[]',
  note text not null default '',
  submitted_at timestamptz not null default now(),
  mark text,
  feedback text,
  marked_at timestamptz,
  unique (homework_id, student_id)
);

-- Students can hand in and change their work until it is marked, but marks and feedback are staff only.
create or replace function public.protect_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.student_id := auth.uid();
    new.mark := null;
    new.feedback := null;
    new.marked_at := null;
    new.submitted_at := now();
  else
    if old.marked_at is not null then
      raise exception 'This homework has already been marked';
    end if;
    new.homework_id := old.homework_id;
    new.student_id := old.student_id;
    new.mark := old.mark;
    new.feedback := old.feedback;
    new.marked_at := old.marked_at;
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

create trigger protect_submission
  before insert or update on public.submissions
  for each row execute function public.protect_submission();

alter table public.submissions enable row level security;

create policy "Students see their own work, staff see all" on public.submissions
  for select using (student_id = auth.uid() or public.is_staff());
create policy "Students hand in homework set for them" on public.submissions
  for insert with check (
    student_id = auth.uid()
    and exists (select 1 from public.homework_students hs where hs.homework_id = submissions.homework_id and hs.student_id = auth.uid())
  );
create policy "Students update their own work, staff mark it" on public.submissions
  for update using (student_id = auth.uid() or public.is_staff())
  with check (student_id = auth.uid() or public.is_staff());
create policy "Staff remove submissions" on public.submissions
  for delete using (public.is_staff());

-- Resources (slides, notes, guides) -----------------------------------------------------------------

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  subject text not null,              -- a subject, or 'all' for every student
  title text not null,
  description text not null default '',
  file_path text,
  file_name text,
  student_id uuid references public.profiles (id) on delete cascade,  -- set to share with one student only
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.resources enable row level security;

create policy "Students see resources for their subjects, staff see all" on public.resources
  for select using (
    public.is_staff()
    or (
      (subject = 'all' or subject = any (coalesce((select p.subjects from public.profiles p where p.id = auth.uid()), '{}'::text[])))
      and (student_id is null or student_id = auth.uid())
    )
  );
create policy "Staff add resources" on public.resources
  for insert with check (public.is_staff());
create policy "Staff edit resources" on public.resources
  for update using (public.is_staff()) with check (public.is_staff());
create policy "Staff remove resources" on public.resources
  for delete using (public.is_staff());

-- Files --------------------------------------------------------------------------------------------
-- One private bucket, organised as:
--   homework/<homework id>/<file>            set by tutors
--   submissions/<student id>/<homework id>/<file>  handed in by students
--   resources/<resource id>/<file>           shared by tutors

insert into storage.buckets (id, name, public, file_size_limit)
values ('portal', 'portal', false, 52428800)
on conflict (id) do nothing;

create policy "Staff manage all portal files" on storage.objects
  for all using (bucket_id = 'portal' and public.is_staff())
  with check (bucket_id = 'portal' and public.is_staff());

-- These rely on the table rules above: a student can only open a file if they can see its homework or resource.
create policy "Students open homework files set for them" on storage.objects
  for select using (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'homework'
    and exists (select 1 from public.homework h where h.id::text = (storage.foldername(name))[2])
  );
create policy "Students open resources shared with them" on storage.objects
  for select using (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'resources'
    and exists (select 1 from public.resources r where r.id::text = (storage.foldername(name))[2])
  );
create policy "Students open their own hand-ins" on storage.objects
  for select using (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
create policy "Students upload their own hand-ins" on storage.objects
  for insert with check (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
create policy "Students remove their own hand-ins" on storage.objects
  for delete using (
    bucket_id = 'portal' and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
