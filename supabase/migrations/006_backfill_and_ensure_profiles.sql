-- Run this entire file in Supabase → SQL Editor (fixes missing profiles + 404 on ensure_user_profile)

-- 1) Backfill profiles for existing auth users
insert into public.profiles (id, email, display_name, role)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'username',
    split_part(u.email, '@', 1)
  ),
  'USER'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 2) Allow users to insert their own profile (fallback)
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 3) RPC: ensure profile exists (used by Angular app)
create or replace function public.ensure_user_profile(p_user_id uuid default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile public.profiles;
begin
  v_user_id := coalesce(p_user_id, auth.uid());
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if not (auth.uid() = v_user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if found then
    return v_profile;
  end if;

  insert into public.profiles (id, email, display_name, role)
  select
    u.id,
    u.email,
    coalesce(
      u.raw_user_meta_data ->> 'display_name',
      u.raw_user_meta_data ->> 'username',
      split_part(u.email, '@', 1)
    ),
    'USER'
  from auth.users u
  where u.id = v_user_id
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'User not found in auth.users: %', v_user_id;
  end if;

  return v_profile;
end;
$$;

grant execute on function public.ensure_user_profile(uuid) to authenticated;

-- 4) Patch create topic RPC to auto-ensure profile
create or replace function public.create_study_topic_with_reviews(
  p_title text,
  p_study_date date,
  p_subject text default null,
  p_description text default null,
  p_resource_url text default null,
  p_user_id uuid default null
)
returns public.study_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_topic public.study_topics;
  v_offsets integer[] := array[1, 3, 7, 14, 30, 60];
  v_offset integer;
  v_idx integer := 0;
begin
  v_user_id := coalesce(p_user_id, auth.uid());
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if not (auth.uid() = v_user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  perform public.ensure_user_profile(v_user_id);

  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'Title is required.';
  end if;

  if p_study_date is null then
    raise exception 'Study date is required.';
  end if;

  insert into public.study_topics (
    user_id, title, study_date, subject, description, resource_url, current_step_offset
  ) values (
    v_user_id, trim(p_title), p_study_date, p_subject, p_description, p_resource_url, 0
  )
  returning * into v_topic;

  foreach v_offset in array v_offsets loop
    v_idx := v_idx + 1;
    insert into public.study_reviews (
      topic_id, user_id, step_order, day_offset, review_date, status
    ) values (
      v_topic.id,
      v_user_id,
      v_idx,
      v_offset,
      p_study_date + v_offset,
      'PENDING'
    );
  end loop;

  return v_topic;
end;
$$;
