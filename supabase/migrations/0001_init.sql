-- Første mann til mølla — Supabase schema
--
-- Idempotent: trygt å kjøre på nytt. Inneholder tabeller, RLS-policies,
-- SECURITY DEFINER-funksjoner (med search_path), Realtime-publication og
-- oppsett for ett-team-modellen.
--
-- Kjør i Supabase SQL-editor i denne rekkefølgen:
--   1. Lim inn og kjør HELE denne fila
--   2. Opprett minst én auth-bruker (Authentication → Users → Add user)
--   3. Kjør seed-kommandoen i bunnen av fila for å opprette teamet

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  initials text not null check (char_length(initials) between 1 and 4),
  color text not null check (color in ('coral','navy','lime','purple','peach','mint','rose','sand')),
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index if not exists team_members_team_idx on public.team_members (team_id);
create index if not exists team_members_user_idx on public.team_members (user_id);

create table if not exists public.status_updates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  day date not null default (now() at time zone 'Europe/Oslo')::date,
  status text not null check (status in ('Ikke startet','På vei','I nærheten','På plass','Gått videre')),
  arrival_order int,
  updated_at timestamptz not null default now(),
  unique (member_id, day)
);

create index if not exists status_updates_team_day_idx on public.status_updates (team_id, day);

create table if not exists public.card_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  from_member_id uuid not null references public.team_members(id) on delete cascade,
  to_member_id uuid not null references public.team_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists card_requests_team_idx on public.card_requests (team_id, created_at desc);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  kind text not null check (kind in ('status','request','system')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_team_idx on public.activity_events (team_id, created_at desc);

-- ----- Row Level Security -----

alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.status_updates enable row level security;
alter table public.card_requests enable row level security;
alter table public.activity_events enable row level security;

create or replace function public.is_team_member(team uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members
    where team_id = team and user_id = auth.uid()
  );
$$;

create or replace function public.the_team()
returns table(id uuid, name text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select id, name from public.teams order by created_at asc limit 1;
$$;

-- Dropp eksisterende policies hvis de finnes, slik at vi trygt kan re-kjøre.
drop policy if exists "teams read"          on public.teams;
drop policy if exists "members read"       on public.team_members;
drop policy if exists "members insert self" on public.team_members;
drop policy if exists "members update self" on public.team_members;
drop policy if exists "status read"        on public.status_updates;
drop policy if exists "status upsert self" on public.status_updates;
drop policy if exists "status update self" on public.status_updates;
drop policy if exists "requests read"      on public.card_requests;
drop policy if exists "requests insert self" on public.card_requests;
drop policy if exists "requests resolve"   on public.card_requests;
drop policy if exists "activity read"      on public.activity_events;
drop policy if exists "activity insert"    on public.activity_events;

create policy "teams read" on public.teams
  for select using (auth.uid() is not null);

create policy "members read" on public.team_members
  for select using (public.is_team_member(team_id));
create policy "members insert self" on public.team_members
  for insert with check (user_id = auth.uid());
create policy "members update self" on public.team_members
  for update using (user_id = auth.uid());

create policy "status read" on public.status_updates
  for select using (public.is_team_member(team_id));
create policy "status upsert self" on public.status_updates
  for insert with check (
    public.is_team_member(team_id)
    and exists (
      select 1 from public.team_members m
      where m.id = member_id and m.user_id = auth.uid()
    )
  );
create policy "status update self" on public.status_updates
  for update using (
    exists (
      select 1 from public.team_members m
      where m.id = member_id and m.user_id = auth.uid()
    )
  );

create policy "requests read" on public.card_requests
  for select using (public.is_team_member(team_id));
create policy "requests insert self" on public.card_requests
  for insert with check (
    public.is_team_member(team_id)
    and exists (
      select 1 from public.team_members m
      where m.id = from_member_id and m.user_id = auth.uid()
    )
  );
-- En forespørsel kan markeres som resolved av enten avsenderen eller
-- mottakeren (sistnevnte er normalflyten — mottaker kvitterer).
create policy "requests resolve" on public.card_requests
  for update using (
    public.is_team_member(team_id)
    and exists (
      select 1 from public.team_members m
      where m.id in (from_member_id, to_member_id)
        and m.user_id = auth.uid()
    )
  )
  with check (
    public.is_team_member(team_id)
    and exists (
      select 1 from public.team_members m
      where m.id in (from_member_id, to_member_id)
        and m.user_id = auth.uid()
    )
  );

create policy "activity read" on public.activity_events
  for select using (public.is_team_member(team_id));
create policy "activity insert" on public.activity_events
  for insert with check (public.is_team_member(team_id));

-- ----- Realtime (idempotent) -----
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'status_updates'
  ) then
    alter publication supabase_realtime add table public.status_updates;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_requests'
  ) then
    alter publication supabase_realtime add table public.card_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_events'
  ) then
    alter publication supabase_realtime add table public.activity_events;
  end if;
end $$;

-- SEED: Opprett "Team 6" etter at du har laget minst én auth-bruker.
-- 1. Kjør denne spørringen for å finne en user_id:
--      select id, email from auth.users;
-- 2. Kopier UUID-en og erstatt 'din-user-id-her' i neste linje:
--      insert into public.teams (name, created_by) values
--        ('Team 6', 'din-user-id-her');
