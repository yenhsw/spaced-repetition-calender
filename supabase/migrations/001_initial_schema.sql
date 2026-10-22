-- Spaced Repetition Calendar - Initial Schema
-- Run in Supabase SQL Editor or via Supabase CLI

-- ============================================================
-- PROFILES
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  role text not null default 'USER' check (role in ('USER', 'ADMIN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_role_idx on public.profiles (role);

-- Auto-create profile when Supabase Auth creates a user (default role = USER)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'USER'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- HELPER: is_admin()
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'ADMIN'
  );
$$;

-- Prevent users from changing their own role
create or replace function public.prevent_role_self_elevation()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.id
     and not public.is_admin()
     and new.role is distinct from old.role then
    raise exception 'Users cannot update their own role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_elevation on public.profiles;
create trigger profiles_prevent_role_elevation
  before update on public.profiles
  for each row execute function public.prevent_role_self_elevation();

-- ============================================================
-- STUDY TOPICS
-- ============================================================
create table if not exists public.study_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  subject text,
  resource_url text,
  study_date date not null,
  current_step_offset integer not null default 0 check (current_step_offset >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_topics_user_id_idx on public.study_topics (user_id);
create index if not exists study_topics_study_date_idx on public.study_topics (study_date);

drop trigger if exists study_topics_updated_at on public.study_topics;
create trigger study_topics_updated_at
  before update on public.study_topics
  for each row execute function public.set_updated_at();

-- ============================================================
-- STUDY REVIEWS (dynamic schedule per topic)
-- ============================================================
create table if not exists public.study_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic_id uuid not null references public.study_topics (id) on delete cascade,
  step_order integer not null check (step_order > 0),
  day_offset integer not null check (day_offset > 0),
  review_date date not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, day_offset)
);

create index if not exists study_reviews_topic_id_idx on public.study_reviews (topic_id);
create index if not exists study_reviews_user_id_idx on public.study_reviews (user_id);
create index if not exists study_reviews_review_date_idx on public.study_reviews (review_date);
create index if not exists study_reviews_status_idx on public.study_reviews (status);

drop trigger if exists study_reviews_updated_at on public.study_reviews;
create trigger study_reviews_updated_at
  before update on public.study_reviews
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.study_topics enable row level security;
alter table public.study_reviews enable row level security;

-- PROFILES
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

create policy "Users can update own profile except role"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy "Admins can update any profile"
  on public.profiles for update
  using (public.is_admin());

-- STUDY TOPICS
create policy "Users can view own study topics"
  on public.study_topics for select
  using (auth.uid() = user_id);

create policy "Admins can view all study topics"
  on public.study_topics for select
  using (public.is_admin());

create policy "Users can insert own study topics"
  on public.study_topics for insert
  with check (auth.uid() = user_id);

create policy "Admins can insert study topics for any user"
  on public.study_topics for insert
  with check (public.is_admin());

create policy "Users can update own study topics"
  on public.study_topics for update
  using (auth.uid() = user_id);

create policy "Admins can update any study topic"
  on public.study_topics for update
  using (public.is_admin());

create policy "Users can delete own study topics"
  on public.study_topics for delete
  using (auth.uid() = user_id);

create policy "Admins can delete any study topic"
  on public.study_topics for delete
  using (public.is_admin());

-- STUDY REVIEWS
create policy "Users can view own study reviews"
  on public.study_reviews for select
  using (auth.uid() = user_id);

create policy "Admins can view all study reviews"
  on public.study_reviews for select
  using (public.is_admin());

create policy "Users can insert own study reviews"
  on public.study_reviews for insert
  with check (auth.uid() = user_id);

create policy "Admins can insert study reviews for any user"
  on public.study_reviews for insert
  with check (public.is_admin());

create policy "Users can update own study reviews"
  on public.study_reviews for update
  using (auth.uid() = user_id);

create policy "Admins can update any study review"
  on public.study_reviews for update
  using (public.is_admin());

create policy "Users can delete own future pending reviews"
  on public.study_reviews for delete
  using (
    auth.uid() = user_id
    and status = 'PENDING'
    and review_date > current_date
  );

create policy "Admins can delete future pending reviews"
  on public.study_reviews for delete
  using (
    public.is_admin()
    and status = 'PENDING'
    and review_date > current_date
  );
