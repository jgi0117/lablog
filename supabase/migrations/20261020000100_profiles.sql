-- 프로필(표시 이름) 표. 로그인 설계는 docs/phase9/erd.md 참고.
-- 다시 실행해도 안전하다.

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

-- 가입(= 운영자가 사용자를 만들 때) 즉시 프로필 행을 만든다. 표시 이름 기본값은 이메일 앞부분.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 있는 사용자의 프로필 채우기
insert into public.profiles (id, display_name)
select id, split_part(coalesce(email, ''), '@', 1) from auth.users
on conflict (id) do nothing;
