-- ATH · GitHub (parte 4): qué repo va con cada cliente, el usuario de GitHub de cada uno y la caché.
-- Se corre DESPUÉS de esquema.sql: Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede volver a correr sin romper nada.

-- ── Qué repo va con cada cliente ─────────────────────────────────────
-- Tabla propia (no toca la de clientes). cliente_id es el id del cliente como texto,
-- así sirve sea número o uuid.
create table if not exists public.github_repos (
  cliente_id      text primary key check (char_length(cliente_id) between 1 and 64),
  repo            text not null check (repo ~ '^[A-Za-z0-9._-]{1,100}$'),
  url_publicada   text check (url_publicada is null or (url_publicada ~ '^https://[^\s]+$' and char_length(url_publicada) <= 300)),
  actualizado_por text default public.mi_slug(),
  actualizado     timestamptz not null default now()
);

comment on table public.github_repos is 'Repo de la organización de GitHub atado a cada cliente, y la dirección donde está publicada su página.';

drop trigger if exists github_repos_actualizado on public.github_repos;
create trigger github_repos_actualizado
  before update on public.github_repos
  for each row execute function public.tocar_actualizado();

alter table public.github_repos enable row level security;
revoke all on public.github_repos from anon;
grant select, insert, update, delete on public.github_repos to authenticated;

drop policy if exists "el equipo ve los repos" on public.github_repos;
create policy "el equipo ve los repos" on public.github_repos
  for select to authenticated using (public.soy_del_equipo());

drop policy if exists "el equipo ata repos" on public.github_repos;
create policy "el equipo ata repos" on public.github_repos
  for insert to authenticated with check (public.soy_del_equipo());

drop policy if exists "el equipo cambia repos" on public.github_repos;
create policy "el equipo cambia repos" on public.github_repos
  for update to authenticated using (public.soy_del_equipo()) with check (public.soy_del_equipo());

drop policy if exists "el equipo desata repos" on public.github_repos;
create policy "el equipo desata repos" on public.github_repos
  for delete to authenticated using (public.soy_del_equipo());

-- ── El usuario de GitHub de cada uno (para saber qué cambios son de Hassan) ──
create table if not exists public.github_personas (
  slug         text primary key check (slug in ('aostri', 'tomas', 'hassan')),
  login_github text not null check (login_github ~ '^[A-Za-z0-9-]{1,39}$')
);

alter table public.github_personas enable row level security;
revoke all on public.github_personas from anon;
grant select, insert, update, delete on public.github_personas to authenticated;

drop policy if exists "el equipo ve los usuarios" on public.github_personas;
create policy "el equipo ve los usuarios" on public.github_personas
  for select to authenticated using (public.soy_del_equipo());

drop policy if exists "el equipo carga usuarios" on public.github_personas;
create policy "el equipo carga usuarios" on public.github_personas
  for all to authenticated using (public.soy_del_equipo()) with check (public.soy_del_equipo());

-- ── Caché de respuestas de GitHub ────────────────────────────────────
-- Solo la usa la función «github» (con su clave de servicio). Sin reglas = la página no la ve.
create table if not exists public.github_cache (
  clave       text primary key,
  datos       jsonb not null,
  actualizado timestamptz not null default now()
);
alter table public.github_cache enable row level security;
revoke all on public.github_cache from anon, authenticated;

-- ── En vivo: si uno ata un repo, los otros lo ven al instante ────────
do $$
begin
  alter publication supabase_realtime add table public.github_repos;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.github_personas;
exception
  when duplicate_object then null;
end
$$;
