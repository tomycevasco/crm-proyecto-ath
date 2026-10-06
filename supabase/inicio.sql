-- ATH · Inicio común: pendientes, «Lo último que pasó» y el muro de ideas.
-- Se corre en Supabase → SQL Editor → New query → pegar todo → Run.
-- Va DESPUÉS de esquema.sql y conviene correrlo AL FINAL (después de clientes.sql y los demás):
-- así «Lo último que pasó» se engancha solo a las tablas de clientes. Se puede volver a correr sin romper nada.

-- ── Pendientes del equipo ────────────────────────────────────────────
-- «para» = a quién le toca (o 'todos'). Los ve y los tilda cualquiera de los tres.
create table if not exists public.pendientes (
  id          bigint generated always as identity primary key,
  texto       text not null check (char_length(btrim(texto)) between 1 and 200),
  para        text not null default 'todos' check (para in ('aostri', 'tomas', 'hassan', 'todos')),
  hecho       boolean not null default false,
  vence       date,
  creado_por  text not null default public.mi_slug() check (creado_por in ('aostri', 'tomas', 'hassan')),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

comment on table public.pendientes is 'Pendientes sueltos del Inicio (las tareas de cada cliente viven en su ficha).';

create index if not exists pendientes_para_idx on public.pendientes (para, hecho);

drop trigger if exists pendientes_actualizado on public.pendientes;
create trigger pendientes_actualizado
  before update on public.pendientes
  for each row execute function public.tocar_actualizado();

alter table public.pendientes enable row level security;

revoke all on public.pendientes from anon;
revoke all on public.pendientes from authenticated;
grant select, delete on public.pendientes to authenticated;
grant insert (texto, para, vence) on public.pendientes to authenticated;  -- creado_por lo pone la base
grant update (texto, para, hecho, vence) on public.pendientes to authenticated;

drop policy if exists "el equipo ve los pendientes" on public.pendientes;
create policy "el equipo ve los pendientes" on public.pendientes
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "el equipo anota pendientes" on public.pendientes;
create policy "el equipo anota pendientes" on public.pendientes
  for insert to authenticated
  with check (public.soy_del_equipo() and creado_por = public.mi_slug());

drop policy if exists "el equipo tilda pendientes" on public.pendientes;
create policy "el equipo tilda pendientes" on public.pendientes
  for update to authenticated
  using (public.soy_del_equipo())
  with check (public.soy_del_equipo());

-- Borrar: quien lo anotó o a quien le tocaba.
drop policy if exists "borra quien lo anoto o a quien le toca" on public.pendientes;
create policy "borra quien lo anoto o a quien le toca" on public.pendientes
  for delete to authenticated
  using (public.soy_del_equipo() and public.mi_slug() in (creado_por, para));

-- ── Muro de ideas ────────────────────────────────────────────────────
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

comment on table public.ideas_muro is 'El muro de ideas común del Inicio.';

drop trigger if exists ideas_muro_actualizado on public.ideas_muro;
create trigger ideas_muro_actualizado
  before update on public.ideas_muro
  for each row execute function public.tocar_actualizado();

alter table public.ideas_muro enable row level security;

revoke all on public.ideas_muro from anon;
revoke all on public.ideas_muro from authenticated;
grant select, delete on public.ideas_muro to authenticated;
grant insert (texto, color) on public.ideas_muro to authenticated;
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

-- «Me copa» / «ya no»: suma o saca a quien llama de los apoyos (de cualquier idea).
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

-- ── Lo último que pasó ───────────────────────────────────────────────
-- Lo llena solo la base (con el disparador de abajo). Se guardan los últimos 60 días.
create table if not exists public.actividad (
  id        bigint generated always as identity primary key,
  quien     text not null check (quien in ('aostri', 'tomas', 'hassan')),
  accion    text not null check (accion in ('creo', 'cambio', 'completo', 'estado', 'borro')),
  tabla     text not null,
  registro  text,
  titulo    text,
  donde     text,             -- el cliente, si lo que cambió es de un cliente
  detalle   text,             -- ej. el estado nuevo, o para quién es el pendiente
  ruta      text,             -- adónde lleva el link (ej. 'clientes/12')
  creado    timestamptz not null default now()
);

comment on table public.actividad is '«Lo último que pasó» del Inicio. La llena public.anotar_actividad().';

create index if not exists actividad_creado_idx on public.actividad (creado desc);

alter table public.actividad enable row level security;

revoke all on public.actividad from anon;
revoke all on public.actividad from authenticated;
grant select on public.actividad to authenticated;   -- nadie la escribe a mano

drop policy if exists "el equipo ve lo que pasa" on public.actividad;
create policy "el equipo ve lo que pasa" on public.actividad
  for select to authenticated
  using (public.soy_del_equipo());

-- El disparador genérico: anota quién hizo qué en cualquier tabla a la que se enganche.
-- Argumento: la ruta del link, con {campo} para los datos de la fila (ej. 'clientes/{cliente_id}').
create or replace function public.anotar_actividad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  yo        text := public.mi_slug();
  fila      jsonb;
  antes     jsonb;
  hacer     text;
  ruta      text := coalesce(tg_argv[0], '');
  campo     text;
  cliente   text;
  extra     text;
  ignorar   text[] := array['actualizado', 'orden', 'posicion', 'apoyos'];
  k         text;
begin
  -- Sin persona (ej. tareas internas de Supabase): no se anota nada.
  if yo is null then
    return null;
  end if;

  if tg_op = 'DELETE' then
    fila := to_jsonb(old);
    hacer := 'borro';
  elsif tg_op = 'INSERT' then
    fila := to_jsonb(new);
    hacer := 'creo';
  else
    fila := to_jsonb(new);
    antes := to_jsonb(old);
    -- Si solo cambió el orden o la fecha de modificación, no vale la pena contarlo.
    if (fila - ignorar) = (antes - ignorar) then
      return null;
    end if;
    hacer := 'cambio';
    foreach k in array array['hecho', 'hecha', 'completada', 'completado'] loop
      if fila ? k and (fila ->> k) = 'true' and coalesce(antes ->> k, 'false') <> 'true' then
        hacer := 'completo';
      end if;
    end loop;
    if hacer = 'cambio' and fila ? 'estado' and (fila ->> 'estado') is distinct from (antes ->> 'estado') then
      hacer := 'estado';
      extra := left(fila ->> 'estado', 40);
    end if;
    -- Para no llenar la lista: un mismo «cambió» de la misma persona cuenta una vez cada 5 minutos.
    if hacer = 'cambio' and exists (
      select 1 from public.actividad a
       where a.tabla = tg_table_name and a.registro = fila ->> 'id' and a.quien = yo
         and a.accion in ('creo', 'cambio') and a.creado > now() - interval '5 minutes'
    ) then
      return null;
    end if;
  end if;

  -- La ruta del link: {campo} → el dato de la fila.
  for campo in select (regexp_matches(ruta, '\{([a-z_]+)\}', 'g'))[1] loop
    ruta := replace(ruta, '{' || campo || '}', coalesce(fila ->> campo, ''));
  end loop;

  -- Si es algo de un cliente, el nombre del cliente (si la tabla clientes no está, se sigue igual).
  if fila ? 'cliente_id' and to_regclass('public.clientes') is not null then
    begin
      execute 'select to_jsonb(c) ->> ''nombre'' from public.clientes c where c.id::text = $1'
        into cliente using fila ->> 'cliente_id';
    exception when others then
      cliente := null;
    end;
  end if;

  if tg_table_name = 'pendientes' then
    extra := fila ->> 'para';
  end if;

  insert into public.actividad (quien, accion, tabla, registro, titulo, donde, detalle, ruta)
  values (
    yo, hacer, tg_table_name, fila ->> 'id',
    left(coalesce(fila ->> 'titulo', fila ->> 'nombre', fila ->> 'texto', fila ->> 'descripcion', fila ->> 'url'), 120),
    left(cliente, 80), extra, nullif(ruta, '')
  );

  -- Limpieza: lo de hace más de 60 días se va.
  delete from public.actividad where creado < now() - interval '60 days';
  return null;
end;
$$;

revoke execute on function public.anotar_actividad() from public, anon, authenticated;

-- Engancha «Lo último que pasó» a una tabla (si existe). Solo se usa desde el SQL Editor.
--   select public.conectar_actividad('tareas', 'clientes/{cliente_id}');
create or replace function public.conectar_actividad(tabla text, ruta text default null)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if to_regclass(format('public.%I', tabla)) is null then
    return false;
  end if;
  execute format('drop trigger if exists anotar_actividad on public.%I', tabla);
  execute format(
    'create trigger anotar_actividad after insert or update or delete on public.%I
       for each row execute function public.anotar_actividad(%L)',
    tabla, coalesce(ruta, '')
  );
  return true;
end;
$$;

revoke execute on function public.conectar_actividad(text, text) from public, anon, authenticated;

-- Las del Inicio, los clientes y todo lo que cuelga de un cliente (tablas con columna cliente_id).
-- Lo personal de «Mi espacio» NO se engancha: no es del equipo.
do $$
declare
  t text;
begin
  perform public.conectar_actividad('pendientes', 'inicio');
  perform public.conectar_actividad('ideas_muro', 'inicio');
  perform public.conectar_actividad('clientes', 'clientes/{id}');
  for t in
    select distinct c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'cliente_id' and tb.table_type = 'BASE TABLE'
  loop
    perform public.conectar_actividad(t, 'clientes/{cliente_id}');
  end loop;
end
$$;

-- ── Las tareas de los clientes, para mostrarlas en los pendientes ─────
-- Junta las filas de toda tabla «…tarea…» con columna cliente_id (las de la ficha de cada cliente),
-- con el nombre del cliente. Respeta las reglas (RLS) de esas tablas: corre con los permisos de quien pide.
create or replace function public.inicio_tareas_de_clientes()
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t text;
  con_clientes boolean := to_regclass('public.clientes') is not null;
begin
  for t in
    select distinct c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'cliente_id'
       and tb.table_type = 'BASE TABLE' and c.table_name like '%tarea%'
  loop
    begin
      if con_clientes then
        return query execute format(
          'select jsonb_build_object(''tabla'', %L, ''fila'', to_jsonb(x), ''cliente'', to_jsonb(c) ->> ''nombre'')
             from public.%I x left join public.clientes c on c.id::text = to_jsonb(x) ->> ''cliente_id''
            limit 300', t, t);
      else
        return query execute format(
          'select jsonb_build_object(''tabla'', %L, ''fila'', to_jsonb(x)) from public.%I x limit 300', t, t);
      end if;
    exception when others then
      null;  -- si una tabla no se deja leer, se saltea
    end;
  end loop;
end;
$$;

revoke execute on function public.inicio_tareas_de_clientes() from public, anon;
grant execute on function public.inicio_tareas_de_clientes() to authenticated;

-- ── En vivo ──────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.pendientes;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.ideas_muro;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.actividad;
exception
  when duplicate_object then null;
end
$$;
