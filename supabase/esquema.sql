-- ATH · esquema de base (parte 1: la entrada y los tres del equipo)
-- Se corre una vez en Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede volver a correr sin romper nada. Cada módulo suma después su propio archivo .sql.

-- ── ¿Quién puede entrar? ─────────────────────────────────────────────
-- Solo las 3 cuentas que crea Tomás a mano (el registro de cuentas nuevas va APAGADO en Supabase).
-- Los ingresos anónimos no cuentan aunque alguien los prenda por error.
-- Los módulos usan esta función en sus reglas: «using (public.soy_del_equipo())».
create or replace function public.soy_del_equipo()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- ── Los tres ─────────────────────────────────────────────────────────
create table if not exists public.personas (
  id          uuid primary key references auth.users (id) on delete cascade,
  slug        text not null unique check (slug in ('aostri', 'tomas', 'hassan')),
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 40),
  rol         text check (char_length(rol) <= 60),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

comment on table public.personas is 'Los tres de ATH. id = su cuenta de Supabase; slug = aostri | tomas | hassan.';

-- El slug de quien está usando la app (para las reglas de los módulos: «dueno = public.mi_slug()»).
create or replace function public.mi_slug()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select slug from public.personas where id = auth.uid()
$$;

-- Fecha de la última modificación, sola.
create or replace function public.tocar_actualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado := now();
  return new;
end;
$$;

drop trigger if exists personas_actualizado on public.personas;
create trigger personas_actualizado
  before update on public.personas
  for each row execute function public.tocar_actualizado();

-- ── Reglas (RLS): de afuera nadie ve nada; adentro, cada uno toca solo su fila ──
alter table public.personas enable row level security;

revoke all on public.personas from anon;
revoke all on public.personas from authenticated;
grant select, insert on public.personas to authenticated;
grant update (nombre, rol) on public.personas to authenticated;  -- el slug no se cambia

drop policy if exists "el equipo ve a los tres" on public.personas;
create policy "el equipo ve a los tres" on public.personas
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "cada uno crea su fila" on public.personas;
create policy "cada uno crea su fila" on public.personas
  for insert to authenticated
  with check (public.soy_del_equipo() and id = auth.uid());

drop policy if exists "cada uno cambia su fila" on public.personas;
create policy "cada uno cambia su fila" on public.personas
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── En vivo: los cambios de personas les llegan a los otros al instante ──
do $$
begin
  alter publication supabase_realtime add table public.personas;
exception
  when duplicate_object then null;
end
$$;
