-- ATH · Planificación (pestaña propia, #/planificacion): las tareas del diagrama de Gantt.
-- Se corre en Supabase → SQL Editor → New query → pegar todo → Run.
-- Va DESPUÉS de todos los demás, incluso de meetings.sql (necesita esquema.sql: soy_del_equipo() y mi_slug()).
-- Se puede volver a correr sin romper nada: no borra ni cambia ninguna tarea.

-- ── Tareas ───────────────────────────────────────────────────────────
-- Una fila = una barra del Gantt. inicio y fin son días enteros (los dos cuentan).
-- hito        = un punto clave (una entrega, una fecha límite): se dibuja como un rombo.
-- depende_de  = la tarea que tiene que terminar antes que esta empiece (o nada).
-- estado      = lo que se marcó a mano; «atrasada» y «en curso» los calcula también la pantalla
--               con las fechas (src/planificacion/reglas.js).
-- Los tres crean, cambian y borran cualquier tarea: el plan es de todos.
create table if not exists public.planificacion_tareas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  proyecto       text,
  responsable    text,
  inicio         date not null default current_date,
  fin            date not null default current_date,
  avance         smallint not null default 0,
  estado         text not null default 'pendiente',
  depende_de     uuid references public.planificacion_tareas (id) on delete set null,
  hito           boolean not null default false,
  notas          text,
  orden          integer not null default 0,
  creado_por     text default public.mi_slug(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Las reglas de cada columna, aparte: así, si la tabla ya existía, igual quedan al día.
alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_titulo_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_titulo_check check (char_length(btrim(titulo)) between 1 and 120);

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_proyecto_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_proyecto_check check (char_length(proyecto) <= 80);

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_responsable_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_responsable_check
  check (responsable is null or responsable in ('aostri', 'tomas', 'hassan'));

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_fechas_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_fechas_check check (fin >= inicio);

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_avance_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_avance_check check (avance between 0 and 100);

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_estado_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_estado_check
  check (estado in ('pendiente', 'en_curso', 'atrasada', 'hecha'));

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_depende_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_depende_check check (depende_de is null or depende_de <> id);

alter table public.planificacion_tareas drop constraint if exists planificacion_tareas_notas_check;
alter table public.planificacion_tareas
  add constraint planificacion_tareas_notas_check check (char_length(notas) <= 2000);

comment on table public.planificacion_tareas is 'Tareas e hitos del Gantt (pestaña Planificación). responsable y creado_por = slugs.';

create index if not exists planificacion_tareas_proyecto_idx on public.planificacion_tareas (proyecto, orden);
create index if not exists planificacion_tareas_inicio_idx on public.planificacion_tareas (inicio);
create index if not exists planificacion_tareas_depende_idx on public.planificacion_tareas (depende_de);

-- ── Fecha de la última modificación, sola ────────────────────────────
-- (tocar_actualizado() de esquema.sql escribe en «actualizado»; esta tabla usa «actualizado_en»)
create or replace function public.planificacion_tocar_actualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists planificacion_tareas_actualizado on public.planificacion_tareas;
create trigger planificacion_tareas_actualizado
  before update on public.planificacion_tareas
  for each row execute function public.planificacion_tocar_actualizado();

-- ── Reglas (RLS) ─────────────────────────────────────────────────────
-- Los tres ven, crean, cambian y borran todo. De afuera, nadie ve nada.
alter table public.planificacion_tareas enable row level security;

revoke all on public.planificacion_tareas from anon;
grant select, insert, update, delete on public.planificacion_tareas to authenticated;

drop policy if exists "el equipo ve el plan" on public.planificacion_tareas;
create policy "el equipo ve el plan" on public.planificacion_tareas
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "el equipo suma tareas al plan" on public.planificacion_tareas;
create policy "el equipo suma tareas al plan" on public.planificacion_tareas
  for insert to authenticated
  with check (public.soy_del_equipo());

drop policy if exists "el equipo cambia el plan" on public.planificacion_tareas;
create policy "el equipo cambia el plan" on public.planificacion_tareas
  for update to authenticated
  using (public.soy_del_equipo())
  with check (public.soy_del_equipo());

drop policy if exists "el equipo borra tareas del plan" on public.planificacion_tareas;
create policy "el equipo borra tareas del plan" on public.planificacion_tareas
  for delete to authenticated
  using (public.soy_del_equipo());

-- ── En vivo: lo que mueve uno en el Gantt se mueve solo en la pantalla de los otros dos ──
do $$
begin
  alter publication supabase_realtime add table public.planificacion_tareas;
exception when duplicate_object then null;
end
$$;
