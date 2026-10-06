-- ATH · Clientes y posibles clientes (parte 2)
-- Se corre DESPUÉS de esquema.sql: Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede volver a correr sin romper nada.
--
-- Todo lo de acá es COMÚN a los tres: cualquiera del equipo ve, crea, cambia y borra.
-- «creado_por» se llena solo con el slug de quien lo crea (para «Hassan sumó una tarea»).

-- ── Clientes y posibles clientes ─────────────────────────────────────
-- Un posible cliente es un cliente en estado contactado / charlando / presupuesto.
-- Al pasar a «ganado» ya es cliente; «perdido» queda guardado por si vuelve.
create table if not exists public.clientes (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (char_length(btrim(nombre)) between 1 and 120),
  contacto     text check (char_length(contacto) <= 120),          -- con quién se habla
  telefono     text check (char_length(telefono) <= 40),
  correo       text check (char_length(correo) <= 200),
  web          text check (char_length(web) <= 500 and (web = '' or web ~* '^https?://')),
  rubro        text check (char_length(rubro) <= 80),
  descripcion  text check (char_length(descripcion) <= 4000),       -- qué quiere / de qué se trata
  estado       text not null default 'contactado'
               check (estado in ('contactado', 'charlando', 'presupuesto', 'ganado', 'perdido')),
  responsable  text check (responsable in ('aostri', 'tomas', 'hassan')),  -- quién lo sigue
  orden        double precision not null default extract(epoch from now()),  -- posición en su columna
  -- Los llena la parte de GitHub (Agente 6): solo el nombre del repo y la dirección publicada.
  repo         text check (repo is null or repo ~ '^[A-Za-z0-9._-]{1,100}$'),
  url_publicada text check (url_publicada is null or url_publicada ~* '^https://'),
  creado_por   text default public.mi_slug(),
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now()
);

-- Si la tabla ya existía de antes (por ejemplo, la creó otra parte), sumar lo que falte.
alter table public.clientes add column if not exists repo text;
alter table public.clientes add column if not exists url_publicada text;

comment on table public.clientes is 'Clientes y posibles clientes de ATH (tablero común).';

-- ── Tareas (con responsable) ─────────────────────────────────────────
-- cliente_id es opcional: así Inicio y el agente también pueden anotar tareas sueltas.
create table if not exists public.tareas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid references public.clientes (id) on delete cascade,
  titulo      text not null check (char_length(btrim(titulo)) between 1 and 200),
  responsable text check (responsable in ('aostri', 'tomas', 'hassan')),
  vence       date,
  hecha       boolean not null default false,
  hecha_en    timestamptz,
  creado_por  text default public.mi_slug(),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
alter table public.tareas add column if not exists vence date;
alter table public.tareas add column if not exists hecha boolean not null default false;
alter table public.tareas add column if not exists hecha_en timestamptz;

create index if not exists tareas_cliente on public.tareas (cliente_id);
create index if not exists tareas_responsable on public.tareas (responsable) where not hecha;

-- ── Notas e ideas de cada cliente ────────────────────────────────────
create table if not exists public.cliente_notas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  tipo        text not null default 'nota' check (tipo in ('nota', 'idea')),
  texto       text not null check (char_length(btrim(texto)) between 1 and 4000),
  creado_por  text default public.mi_slug(),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists cliente_notas_cliente on public.cliente_notas (cliente_id);

-- ── Links (Drive, Figma, Instagram, lo que sea) ──────────────────────
create table if not exists public.cliente_links (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  titulo      text check (char_length(titulo) <= 120),
  url         text not null check (char_length(url) <= 2000 and url ~* '^https?://'),
  creado_por  text default public.mi_slug(),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists cliente_links_cliente on public.cliente_links (cliente_id);

-- ── Plata: lo que cobramos y lo que gastamos, en pesos o dólares ─────
-- Los totales se hacen por moneda (nunca se mezclan pesos con dólares).
create table if not exists public.cliente_plata (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  tipo        text not null default 'cobro' check (tipo in ('cobro', 'gasto')),
  concepto    text not null check (char_length(btrim(concepto)) between 1 and 160),
  monto       numeric(14, 2) not null check (monto > 0 and monto < 1000000000000),
  moneda      text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  fecha       date not null default current_date,
  pagado      boolean not null default false,               -- cobrado / pagado
  creado_por  text default public.mi_slug(),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists cliente_plata_cliente on public.cliente_plata (cliente_id);

-- ── Archivos: los datos acá, el archivo en la caja privada «archivos» ─
create table if not exists public.archivos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  ruta        text not null unique check (ruta ~ '^clientes/[0-9a-f-]{36}/'),  -- clientes/<cliente_id>/<uuid>-<nombre>
  nombre      text not null check (char_length(nombre) between 1 and 255),    -- el nombre original, para mostrar
  tamano      bigint not null check (tamano > 0 and tamano <= 52428800),
  tipo        text not null check (char_length(tipo) <= 120),
  subido_por  text default public.mi_slug(),
  creado      timestamptz not null default now()
);
create index if not exists archivos_cliente on public.archivos (cliente_id);

-- ── Fecha de la última modificación, sola (la función está en esquema.sql) ──
do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'tareas', 'cliente_notas', 'cliente_links', 'cliente_plata'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_actualizado', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tocar_actualizado()',
      t || '_actualizado', t);
  end loop;
end
$$;

-- Al marcar una tarea como hecha se anota cuándo (para «Lo último que pasó»).
create or replace function public.tarea_hecha_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hecha and not coalesce(old.hecha, false) then
    new.hecha_en := now();
  elsif not new.hecha then
    new.hecha_en := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tareas_hecha_en on public.tareas;
create trigger tareas_hecha_en
  before insert or update of hecha on public.tareas
  for each row execute function public.tarea_hecha_en();

-- ── Reglas (RLS): de afuera nadie ve nada; adentro, todo es de los tres ──
do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'tareas', 'cliente_notas', 'cliente_links', 'cliente_plata', 'archivos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists "el equipo ve" on public.%I', t);
    execute format('create policy "el equipo ve" on public.%I for select to authenticated using (public.soy_del_equipo())', t);

    execute format('drop policy if exists "el equipo crea" on public.%I', t);
    execute format('create policy "el equipo crea" on public.%I for insert to authenticated with check (public.soy_del_equipo())', t);

    execute format('drop policy if exists "el equipo cambia" on public.%I', t);
    execute format('create policy "el equipo cambia" on public.%I for update to authenticated using (public.soy_del_equipo()) with check (public.soy_del_equipo())', t);

    execute format('drop policy if exists "el equipo borra" on public.%I', t);
    execute format('create policy "el equipo borra" on public.%I for delete to authenticated using (public.soy_del_equipo())', t);
  end loop;
end
$$;

-- Los archivos no se editan: se sube uno nuevo y se borra el viejo.
revoke update on public.archivos from authenticated;

-- ── En vivo: lo que cambia uno lo ven los otros al instante ──────────
do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'tareas', 'cliente_notas', 'cliente_links', 'cliente_plata', 'archivos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$$;

-- ── La caja privada de archivos (Storage) ────────────────────────────
-- Privada: nadie de afuera baja nada, ni con la dirección. 50 MB por archivo, sin videos, sin SVG ni HTML.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('archivos', 'archivos', false, 52428800, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- .pptx
  'application/zip', 'application/x-zip-compressed'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cuánto ocupa todo (archivos + dibujos del Paint). El plan gratis da 1 GB.
create or replace function public.espacio_usado()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)
  from storage.objects
  where bucket_id in ('archivos', 'dibujos')
$$;

revoke execute on function public.espacio_usado() from anon;
grant execute on function public.espacio_usado() to authenticated;

drop policy if exists "archivos: el equipo ve" on storage.objects;
create policy "archivos: el equipo ve" on storage.objects
  for select to authenticated
  using (bucket_id = 'archivos' and public.soy_del_equipo());

-- Subir solo si queda lugar (frena en ~950 MB para no pasarse del giga).
drop policy if exists "archivos: el equipo sube" on storage.objects;
create policy "archivos: el equipo sube" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'archivos'
    and public.soy_del_equipo()
    and (storage.foldername(name))[1] = 'clientes'
    and public.espacio_usado() < 950 * 1024 * 1024
  );

drop policy if exists "archivos: el equipo borra" on storage.objects;
create policy "archivos: el equipo borra" on storage.objects
  for delete to authenticated
  using (bucket_id = 'archivos' and public.soy_del_equipo());
