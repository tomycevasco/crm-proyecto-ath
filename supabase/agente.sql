-- ATH · el agente de Claude (parte 6)
-- Se corre DESPUÉS de esquema.sql: Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede volver a correr sin romper nada.
--
-- Qué hay acá:
--   agente_config    una sola fila: tope de gasto del mes y modelo (lo ve el equipo, lo cambia solo Tomás)
--   agente_uso       cada vuelta a la API de Claude con su costo (la escribe SOLO la función «agente»)
--   agente_mensajes  la charla de cada uno (cada uno ve y borra SOLO la suya)
--   agente_pedidos   «pedidos de cambio» de la app que anota el agente (el agente no toca código)
--   agente_acciones  lo que hizo cada agente («a Aostri le creó la sección X»): lo ven los tres
--   agente_resumen_mes()  cuánto se gastó este mes, en total y por persona (y cuándo lo usó cada uno)
--   agente_esquema()      qué tablas y columnas puede usar el agente (las que la persona ya puede ver)

-- ── Configuración (una sola fila) ────────────────────────────────────
create table if not exists public.agente_config (
  id          int primary key default 1 check (id = 1),
  tope_usd    numeric(8, 2) not null default 5 check (tope_usd between 0 and 100),
  modelo      text not null default 'claude-sonnet-5'
              check (modelo in ('claude-sonnet-5', 'claude-haiku-4-5-20251001')),
  actualizado timestamptz not null default now()
);
insert into public.agente_config (id) values (1) on conflict do nothing;

drop trigger if exists agente_config_actualizado on public.agente_config;
create trigger agente_config_actualizado
  before update on public.agente_config
  for each row execute function public.tocar_actualizado();

alter table public.agente_config enable row level security;
revoke all on public.agente_config from anon, authenticated;
grant select on public.agente_config to authenticated;
grant update (tope_usd, modelo) on public.agente_config to authenticated;

drop policy if exists "el equipo ve la config" on public.agente_config;
create policy "el equipo ve la config" on public.agente_config
  for select to authenticated
  using (public.soy_del_equipo());

-- La clave de Anthropic la paga Tomás: el tope y el modelo los cambia él.
drop policy if exists "tomas cambia la config" on public.agente_config;
create policy "tomas cambia la config" on public.agente_config
  for update to authenticated
  using (public.soy_del_equipo() and public.mi_slug() = 'tomas')
  with check (public.soy_del_equipo() and public.mi_slug() = 'tomas');

-- ── Uso y gasto ──────────────────────────────────────────────────────
create table if not exists public.agente_uso (
  id         bigint generated always as identity primary key,
  persona    text not null check (persona in ('aostri', 'tomas', 'hassan')),
  modelo     text not null,
  entrada    int not null default 0,   -- input_tokens
  cache_crea int not null default 0,   -- cache_creation_input_tokens
  cache_lee  int not null default 0,   -- cache_read_input_tokens
  salida     int not null default 0,   -- output_tokens
  costo_usd  numeric(10, 6) not null,
  creado     timestamptz not null default now()
);
create index if not exists agente_uso_creado on public.agente_uso (creado);

alter table public.agente_uso enable row level security;
revoke all on public.agente_uso from anon, authenticated;
grant select on public.agente_uso to authenticated;
-- Sin permisos de insert/update/delete: desde la página no se puede tocar. Escribe solo la función.

drop policy if exists "el equipo ve el uso" on public.agente_uso;
create policy "el equipo ve el uso" on public.agente_uso
  for select to authenticated
  using (public.soy_del_equipo());

-- Gasto del mes (el mes de Anthropic va en hora UTC: arranca el 1.º a las 21 h de Argentina).
create or replace function public.agente_resumen_mes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.role() = 'service_role' or public.soy_del_equipo() then
      jsonb_build_object(
        'total',  coalesce(sum(u.costo_usd), 0),
        'aostri', coalesce(sum(u.costo_usd) filter (where u.persona = 'aostri'), 0),
        'tomas',  coalesce(sum(u.costo_usd) filter (where u.persona = 'tomas'), 0),
        'hassan', coalesce(sum(u.costo_usd) filter (where u.persona = 'hassan'), 0),
        'preguntas', count(*),
        -- La última vez que cada uno usó su agente (de cualquier mes)
        'ultima', (
          select coalesce(jsonb_object_agg(x.persona, x.cuando), '{}'::jsonb)
          from (select v.persona, max(v.creado) as cuando from public.agente_uso v group by v.persona) x
        )
      )
    else null
  end
  from public.agente_uso u
  where u.creado >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
$$;
revoke all on function public.agente_resumen_mes() from public, anon;
grant execute on function public.agente_resumen_mes() to authenticated, service_role;

-- ── La charla de cada uno ────────────────────────────────────────────
create table if not exists public.agente_mensajes (
  id        bigint generated always as identity primary key,
  persona   text not null default public.mi_slug() check (persona in ('aostri', 'tomas', 'hassan')),
  rol       text not null check (rol in ('user', 'assistant')),
  contenido text not null check (char_length(contenido) between 1 and 20000),
  creado    timestamptz not null default now()
);
create index if not exists agente_mensajes_persona on public.agente_mensajes (persona, creado);

alter table public.agente_mensajes enable row level security;
revoke all on public.agente_mensajes from anon, authenticated;
grant select, insert, delete on public.agente_mensajes to authenticated;

-- Lo pide el plan: el agente vive solo en tu perfil. Los otros dos no ven tu charla.
drop policy if exists "cada uno ve su charla" on public.agente_mensajes;
create policy "cada uno ve su charla" on public.agente_mensajes
  for select to authenticated
  using (public.soy_del_equipo() and persona = public.mi_slug());

drop policy if exists "cada uno escribe en su charla" on public.agente_mensajes;
create policy "cada uno escribe en su charla" on public.agente_mensajes
  for insert to authenticated
  with check (public.soy_del_equipo() and persona = public.mi_slug());

drop policy if exists "cada uno borra su charla" on public.agente_mensajes;
create policy "cada uno borra su charla" on public.agente_mensajes
  for delete to authenticated
  using (public.soy_del_equipo() and persona = public.mi_slug());

-- ── Pedidos de cambio de la app (el agente los anota; Tomás los hace con Claude Code) ──
create table if not exists public.agente_pedidos (
  id      bigint generated always as identity primary key,
  persona text not null default public.mi_slug() check (persona in ('aostri', 'tomas', 'hassan')),
  texto   text not null check (char_length(btrim(texto)) between 1 and 2000),
  hecho   boolean not null default false,
  creado  timestamptz not null default now()
);

alter table public.agente_pedidos enable row level security;
revoke all on public.agente_pedidos from anon, authenticated;
grant select, insert on public.agente_pedidos to authenticated;
grant update (hecho) on public.agente_pedidos to authenticated;

drop policy if exists "el equipo ve los pedidos" on public.agente_pedidos;
create policy "el equipo ve los pedidos" on public.agente_pedidos
  for select to authenticated
  using (public.soy_del_equipo());

drop policy if exists "cada uno anota a su nombre" on public.agente_pedidos;
create policy "cada uno anota a su nombre" on public.agente_pedidos
  for insert to authenticated
  with check (public.soy_del_equipo() and persona = public.mi_slug());

drop policy if exists "el equipo marca hecho" on public.agente_pedidos;
create policy "el equipo marca hecho" on public.agente_pedidos
  for update to authenticated
  using (public.soy_del_equipo())
  with check (public.soy_del_equipo());

-- ── Lo que hizo cada agente (los tres lo ven, en vivo) ───────────────
-- La escribe SOLO la función «agente» (con permisos de servidor): desde la página no se puede inventar.
-- «persona» = de quién es el agente · «para» = de quién es lo que tocó (ej. el dueño de la sección).
-- Si lo que tocó es privado, el título no se guarda: los otros ven «una sección privada».
create table if not exists public.agente_acciones (
  id       bigint generated always as identity primary key,
  persona  text not null check (persona in ('aostri', 'tomas', 'hassan')),
  accion   text not null check (accion in ('creo', 'cambio', 'borro', 'pidio')),
  tabla    text not null check (char_length(tabla) between 1 and 63),
  registro text check (char_length(registro) <= 64),
  titulo   text check (char_length(titulo) <= 160),
  para     text check (para in ('aostri', 'tomas', 'hassan')),
  privado  boolean not null default false,
  ruta     text check (char_length(ruta) <= 120),
  creado   timestamptz not null default now()
);
create index if not exists agente_acciones_creado on public.agente_acciones (creado desc);

alter table public.agente_acciones enable row level security;
revoke all on public.agente_acciones from anon, authenticated;
grant select on public.agente_acciones to authenticated;
-- Sin insert/update/delete para la página: escribe solo la función.

drop policy if exists "el equipo ve lo que hacen los agentes" on public.agente_acciones;
create policy "el equipo ve lo que hacen los agentes" on public.agente_acciones
  for select to authenticated
  using (public.soy_del_equipo());

-- ── Qué puede usar el agente ─────────────────────────────────────────
-- Corre con los permisos de quien pregunta (no es security definer): solo aparecen las tablas y
-- columnas que esa persona ya puede tocar, con reglas (RLS) prendidas. Las del agente quedan afuera.
create or replace function public.agente_esquema()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.tabla, t.columnas), '{}'::jsonb)
  from (
    select c.table_name as tabla,
           jsonb_agg(c.column_name || ' ' || c.data_type order by c.ordinal_position) as columnas
    from information_schema.columns c
    join pg_catalog.pg_class k on k.relname = c.table_name and k.relkind = 'r'
    join pg_catalog.pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
    where c.table_schema = 'public'
      and k.relrowsecurity
      and c.table_name not like 'agente\_%'
    group by c.table_name
  ) t
$$;
revoke all on function public.agente_esquema() from public, anon;
grant execute on function public.agente_esquema() to authenticated;

-- ── En vivo: el contador y la config se actualizan solos en las tres compus ──
do $$
begin
  alter publication supabase_realtime add table public.agente_uso;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.agente_config;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.agente_pedidos;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.agente_acciones;
exception when duplicate_object then null;
end
$$;
