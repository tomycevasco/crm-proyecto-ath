-- ATH · Muro de ideas (pantalla propia, #/muro).
-- Se corre en Supabase → SQL Editor → New query → pegar todo → Run.
-- Va DESPUÉS de esquema.sql y de inicio.sql (si se vuelve a correr inicio.sql, correr este de nuevo después).
-- Se puede volver a correr sin romper nada. No borra ninguna idea: usa la misma tabla ideas_muro de antes.

-- ── La tabla (si ya existía por inicio.sql, se deja como está) ───────
-- Papelitos de colores. «apoyos» = los que le dieron «me copa» (se toca con apoyar_idea()).
create table if not exists public.ideas_muro (
  id          bigint generated always as identity primary key,
  texto       text not null check (char_length(btrim(texto)) between 1 and 500),
  color       text not null default 'amarillo' check (color in ('amarillo', 'rosa', 'celeste', 'verde', 'lila')),
  autor       text not null default public.mi_slug() check (autor in ('aostri', 'tomas', 'hassan')),
  apoyos      text[] not null default '{}',
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- Lo nuevo: en qué anda cada idea. 'suelta' (recién pegada) · 'en marcha' (la hacemos) · 'hecha'.
alter table public.ideas_muro
  add column if not exists estado text not null default 'suelta';

alter table public.ideas_muro drop constraint if exists ideas_muro_estado_check;
alter table public.ideas_muro
  add constraint ideas_muro_estado_check check (estado in ('suelta', 'en marcha', 'hecha'));

comment on table public.ideas_muro is 'El muro de ideas del equipo (pantalla «Ideas», #/muro).';

create index if not exists ideas_muro_creado_idx on public.ideas_muro (creado desc);

drop trigger if exists ideas_muro_actualizado on public.ideas_muro;
create trigger ideas_muro_actualizado
  before update on public.ideas_muro
  for each row execute function public.tocar_actualizado();

-- ── Reglas (RLS) ─────────────────────────────────────────────────────
-- Los tres ven todo el muro. Cada uno pega, retoca y despega SUS ideas.
-- El estado lo mueve cualquiera de los tres, pero solo con mover_idea() (abajo).
alter table public.ideas_muro enable row level security;

revoke all on public.ideas_muro from anon;
revoke all on public.ideas_muro from authenticated;
grant select, delete on public.ideas_muro to authenticated;
grant insert (texto, color) on public.ideas_muro to authenticated;  -- autor lo pone la base
grant update (texto, color) on public.ideas_muro to authenticated;

drop policy if exists "el equipo ve el muro" on public.ideas_muro;
create policy "el equipo ve el muro" on public.ideas_muro
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "cada uno pega sus ideas" on public.ideas_muro;
create policy "cada uno pega sus ideas" on public.ideas_muro
  for insert to authenticated
  with check (public.soy_del_equipo() and autor = public.mi_slug());

drop policy if exists "cada uno cambia sus ideas" on public.ideas_muro;
create policy "cada uno cambia sus ideas" on public.ideas_muro
  for update to authenticated
  using (autor = public.mi_slug())
  with check (autor = public.mi_slug());

drop policy if exists "cada uno despega sus ideas" on public.ideas_muro;
create policy "cada uno despega sus ideas" on public.ideas_muro
  for delete to authenticated
  using (autor = public.mi_slug());

-- ── «Me copa» / «ya no»: suma o saca a quien llama de los apoyos (de cualquier idea) ──
create or replace function public.apoyar_idea(idea bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  yo text := public.mi_slug();
  resultado text[];
begin
  if not public.soy_del_equipo() or yo is null then
    raise exception 'Solo el equipo puede apoyar ideas';
  end if;
  update public.ideas_muro
     set apoyos = case when yo = any (apoyos) then array_remove(apoyos, yo) else array_append(apoyos, yo) end
   where id = idea
  returning apoyos into resultado;
  return resultado;
end;
$$;

revoke execute on function public.apoyar_idea(bigint) from public, anon;
grant execute on function public.apoyar_idea(bigint) to authenticated;

-- ── Mover una idea: 'suelta' → 'en marcha' → 'hecha' (cualquiera de los tres) ──
create or replace function public.mover_idea(idea bigint, a text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.soy_del_equipo() or public.mi_slug() is null then
    raise exception 'Solo el equipo puede mover ideas';
  end if;
  if a not in ('suelta', 'en marcha', 'hecha') then
    raise exception 'Estado desconocido';
  end if;
  update public.ideas_muro set estado = a where id = idea;
  return a;
end;
$$;

revoke execute on function public.mover_idea(bigint, text) from public, anon;
grant execute on function public.mover_idea(bigint, text) to authenticated;

-- ── «Lo último que pasó»: que los links de las ideas lleven al muro ───
-- (si inicio.sql todavía no se corrió, esto se saltea sin error)
do $$
begin
  if to_regprocedure('public.conectar_actividad(text, text)') is not null then
    perform public.conectar_actividad('ideas_muro', 'muro');
  end if;
  if to_regclass('public.actividad') is not null then
    update public.actividad set ruta = 'muro' where tabla = 'ideas_muro' and ruta is distinct from 'muro';
  end if;
end
$$;

-- ── En vivo ──────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.ideas_muro;
exception
  when duplicate_object then null;
end
$$;
