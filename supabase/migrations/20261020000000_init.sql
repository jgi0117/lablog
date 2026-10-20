-- lablog 초기 스키마 (Phase 9)
-- 앱의 로컬 저장소(IndexedDB)와 같은 모양이다. id는 클라이언트가 만드는 UUID를 그대로 쓰고,
-- 삭제는 deleted_at(소프트 삭제), 동시 수정은 version으로 감지한다.
-- 사용자마다 자기 데이터만 보이도록 모든 표에 owner_id와 RLS(행 수준 보안)를 건다.
--
-- 적용: Supabase 대시보드 > SQL Editor에 이 파일 내용을 붙여 넣고 Run, 또는 `supabase db push`.
-- 다시 실행해도 안전하도록 if not exists / drop policy if exists를 썼다.

-- ---------- 표 ----------

create table if not exists public.projects (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  description text not null default '',
  customer    text not null default '',
  -- 고객 요구 특성(배열). 앱의 Requirement 모양 그대로 저장한다.
  requirements jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer not null default 1 check (version >= 1),
  unique (id, owner_id)
);

create table if not exists public.experiments (
  id            uuid primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id    uuid,
  title         text not null,
  purpose       text not null default '',
  -- 담당자. (앱 필드 owner. owner_id와 헷갈리지 않게 assignee로 둔다)
  assignee      text not null default '',
  tags          text[] not null default '{}',
  status        text not null default 'ready' check (status in ('ready', 'running', 'done')),
  started_at    timestamptz,
  completed_at  timestamptz,
  -- 복제로 만든 실험이면 원본 실험
  source_experiment_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1 check (version >= 1),
  unique (id, owner_id),
  -- 같은 소유자의 프로젝트·원본 실험만 가리킬 수 있다(남의 id를 끼워 넣는 것을 막는다)
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete restrict,
  foreign key (source_experiment_id, owner_id) references public.experiments (id, owner_id) on delete set null (source_experiment_id)
);

create table if not exists public.steps (
  id            uuid primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  experiment_id uuid not null,
  step_order    integer not null check (step_order >= 1),
  content       text not null,
  done          boolean not null default false,
  done_at       timestamptz,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1 check (version >= 1),
  foreign key (experiment_id, owner_id) references public.experiments (id, owner_id) on delete cascade
);

create table if not exists public.data_items (
  id            uuid primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  experiment_id uuid not null,
  kind          text not null check (kind in ('condition', 'result')),
  item_order    integer not null default 1,
  name          text not null default '',
  -- 값은 문자열이다("—", 범위, 단위 없는 값을 허용하려고). 숫자 해석은 앱이 한다.
  value         text not null default '',
  unit          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1 check (version >= 1),
  foreign key (experiment_id, owner_id) references public.experiments (id, owner_id) on delete cascade
);

create table if not exists public.templates (
  id                 uuid primary key,
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name               text not null,
  steps              jsonb not null default '[]'::jsonb,
  default_conditions jsonb not null default '[]'::jsonb,
  result_items       jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  version            integer not null default 1 check (version >= 1)
);

create table if not exists public.deviations (
  id            uuid primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  experiment_id uuid not null,
  step_id       uuid,
  change        text not null,
  reason        text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1 check (version >= 1),
  foreign key (experiment_id, owner_id) references public.experiments (id, owner_id) on delete cascade
);

-- ---------- 인덱스 ----------

create index if not exists experiments_owner_status_updated on public.experiments (owner_id, status, updated_at desc);
create index if not exists experiments_owner_project_updated on public.experiments (owner_id, project_id, updated_at desc);
create index if not exists experiments_owner_deleted on public.experiments (owner_id, deleted_at);
create index if not exists steps_experiment_order on public.steps (experiment_id, step_order);
create index if not exists data_items_experiment_kind on public.data_items (experiment_id, kind, item_order);
create index if not exists deviations_experiment on public.deviations (experiment_id, created_at);
create index if not exists projects_owner on public.projects (owner_id, deleted_at);
create index if not exists templates_owner on public.templates (owner_id, deleted_at);

-- ---------- RLS: 자기 행만 ----------

alter table public.projects    enable row level security;
alter table public.experiments enable row level security;
alter table public.steps       enable row level security;
alter table public.data_items  enable row level security;
alter table public.templates   enable row level security;
alter table public.deviations  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'experiments', 'steps', 'data_items', 'templates', 'deviations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_own', t
    );
    -- 로그인하지 않은 사용자(anon)에게는 아무 권한도 주지 않는다
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
