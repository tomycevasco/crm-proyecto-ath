-- ATH · Meetings (pestaña propia, #/meetings): reuniones y horarios ocupados de los tres.
-- Se corre en Supabase → SQL Editor → New query → pegar todo → Run.
-- Va DESPUÉS de todos los demás (necesita esquema.sql: soy_del_equipo() y mi_slug()).
-- Se puede volver a correr sin romper nada: no borra ninguna reunión ni ningún bloqueo.

-- ── Reuniones ────────────────────────────────────────────────────────
-- Una reunión la crea uno («organiza») y puede sumar a los otros («invitados»).
-- Los tres la ven en el calendario de todos; solo quien la organiza la cambia o la borra.
create table if not exists public.meetings_reuniones (
  id        bigint generated always as identity primary key,
  titulo    text not null check (char_length(btrim(titulo)) between 1 and 120),
  inicio    timestamptz not null,
  fin       timestamptz not null,
  organiza  text not null default public.mi_slug() check (organiza in ('aostri', 'tomas', 'hassan')),
  invitados text[] not null default '{}',
  notas     text check (char_length(notas) <= 1000),
  creado    timestamptz not null default now()
);

-- Las reglas de cada columna, aparte: así, si la tabla ya existía, igual quedan al día.
alter table public.meetings_reuniones drop constraint if exists meetings_reuniones_fin_check;
alter table public.meetings_reuniones
  add constraint meetings_reuniones_fin_check check (fin > inicio);

alter table public.meetings_reuniones drop constraint if exists meetings_reuniones_invitados_check;
alter table public.meetings_reuniones
  add constraint meetings_reuniones_invitados_check
  check (invitados <@ array['aostri', 'tomas', 'hassan']::text[]);

comment on table public.meetings_reuniones is 'Reuniones del equipo (pestaña Meetings). organiza e invitados = slugs.';

create index if not exists meetings_reuniones_inicio_idx on public.meetings_reuniones (inicio);

-- ── Horarios ocupados ────────────────────────────────────────────────
-- tipo 'semanal'    = se repite cada semana: dia_semana (0 = domingo … 6 = sábado; 7 también es
--                     domingo) de hora_desde a hora_hasta. Si hora_hasta es antes, cruza la medianoche.
--                     Con fecha_desde / fecha_hasta, vale solo entre esas fechas.
-- tipo 'puntual'    = un día (fecha_desde, y fecha_hasta si son varios), con horas o el día entero.
-- tipo 'vacaciones' = de fecha_desde a fecha_hasta, días enteros.
-- para_todos        = lo bloquea para los tres (ej. «la noche no»), aunque lo haya puesto uno.
-- La noche general (22 a 7) la pone la pantalla sola: no hace falta guardarla acá.
create table if not exists public.meetings_bloqueos (
  id          bigint generated always as identity primary key,
  persona     text not null default public.mi_slug() check (persona in ('aostri', 'tomas', 'hassan')),
  tipo        text not null default 'semanal',
  dia_semana  smallint,
  hora_desde  time,
  hora_hasta  time,
  fecha_desde date,
  fecha_hasta date,
  motivo      text check (char_length(motivo) <= 200),
  para_todos  boolean not null default false,
  creado      timestamptz not null default now()
);

alter table public.meetings_bloqueos drop constraint if exists meetings_bloqueos_tipo_check;
alter table public.meetings_bloqueos
  add constraint meetings_bloqueos_tipo_check check (tipo in ('semanal', 'puntual', 'vacaciones'));

alter table public.meetings_bloqueos drop constraint if exists meetings_bloqueos_dia_check;
alter table public.meetings_bloqueos
  add constraint meetings_bloqueos_dia_check check (dia_semana between 0 and 7);

-- Que cada tipo traiga lo que necesita, y que las fechas no vayan al revés.
alter table public.meetings_bloqueos drop constraint if exists meetings_bloqueos_datos_check;
alter table public.meetings_bloqueos
  add constraint meetings_bloqueos_datos_check check (
    (fecha_hasta is null or fecha_desde is not null)
    and (fecha_hasta is null or fecha_hasta >= fecha_desde)
    and case tipo
      when 'semanal'    then dia_semana is not null and hora_desde is not null and hora_hasta is not null
      when 'puntual'    then fecha_desde is not null
      when 'vacaciones' then fecha_desde is not null and fecha_hasta is not null
      else false
    end
  );

comment on table public.meetings_bloqueos is 'Horarios ocupados de cada uno (pestaña Meetings): semanal, puntual o vacaciones.';

create index if not exists meetings_bloqueos_persona_idx on public.meetings_bloqueos (persona);

-- ── Reglas (RLS) ─────────────────────────────────────────────────────
-- Los tres ven todo (el calendario de todos). Cada uno crea, cambia y borra solo lo suyo.
alter table public.meetings_reuniones enable row level security;
alter table public.meetings_bloqueos enable row level security;

revoke all on public.meetings_reuniones from anon;
revoke all on public.meetings_bloqueos from anon;
grant select, insert, update, delete on public.meetings_reuniones to authenticated;
grant select, insert, update, delete on public.meetings_bloqueos to authenticated;

-- Reuniones
drop policy if exists "el equipo ve las reuniones" on public.meetings_reuniones;
create policy "el equipo ve las reuniones" on public.meetings_reuniones
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "cada uno crea sus reuniones" on public.meetings_reuniones;
create policy "cada uno crea sus reuniones" on public.meetings_reuniones
  for insert to authenticated
  with check (public.soy_del_equipo() and organiza = public.mi_slug());

drop policy if exists "cada uno cambia sus reuniones" on public.meetings_reuniones;
create policy "cada uno cambia sus reuniones" on public.meetings_reuniones
  for update to authenticated
  using (organiza = public.mi_slug())
  with check (organiza = public.mi_slug());

drop policy if exists "cada uno borra sus reuniones" on public.meetings_reuniones;
create policy "cada uno borra sus reuniones" on public.meetings_reuniones
  for delete to authenticated
  using (organiza = public.mi_slug());

-- Horarios ocupados
drop policy if exists "el equipo ve los horarios" on public.meetings_bloqueos;
create policy "el equipo ve los horarios" on public.meetings_bloqueos
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "cada uno pone sus horarios" on public.meetings_bloqueos;
create policy "cada uno pone sus horarios" on public.meetings_bloqueos
  for insert to authenticated
  with check (public.soy_del_equipo() and persona = public.mi_slug());

drop policy if exists "cada uno cambia sus horarios" on public.meetings_bloqueos;
create policy "cada uno cambia sus horarios" on public.meetings_bloqueos
  for update to authenticated
  using (persona = public.mi_slug())
  with check (persona = public.mi_slug());

drop policy if exists "cada uno borra sus horarios" on public.meetings_bloqueos;
create policy "cada uno borra sus horarios" on public.meetings_bloqueos
  for delete to authenticated
  using (persona = public.mi_slug());

-- ── En vivo: lo que pone uno aparece solo en el calendario de los otros dos ──
do $$
begin
  alter publication supabase_realtime add table public.meetings_reuniones;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.meetings_bloqueos;
exception when duplicate_object then null;
end
$$;
