-- ATH · Mi espacio y Paint: bloques de cada uno, dibujos del Paint y sorpresas.
-- Se corre DESPUÉS de supabase/esquema.sql (usa soy_del_equipo(), mi_slug() y tocar_actualizado()).
-- Supabase → SQL Editor → New query → pegar todo → Run. Se puede volver a correr sin romper nada.

-- ── Bloques: el espacio de cada uno ──────────────────────────────────
-- contenido (jsonb) según el tipo:
--   lista   { items: [{ id, texto, hecho }] }
--   notas   { texto }
--   tablero { columnas: [{ id, titulo, tarjetas: [{ id, texto }] }] }
--   links   { links: [{ id, titulo, url }] }        (solo http/https)
--   ideas   { ideas: [{ id, texto, color 0-3 }] }
--   dibujo  { dibujoId }                            (id de public.dibujos)
create table if not exists public.bloques (
  id          uuid primary key default gen_random_uuid(),
  dueno       text not null check (dueno in ('aostri', 'tomas', 'hassan')),
  tipo        text not null check (tipo in ('lista', 'notas', 'tablero', 'links', 'ideas', 'dibujo')),
  titulo      text not null default '' check (char_length(titulo) <= 80),
  contenido   jsonb not null default '{}'::jsonb check (jsonb_typeof(contenido) = 'object' and pg_column_size(contenido) <= 200000),
  privado     boolean not null default false,
  orden       double precision not null default 0,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

comment on table public.bloques is 'Mi espacio: los bloques de cada uno. Los ven los tres (salvo los privados); los toca solo su dueño.';
create index if not exists bloques_dueno_orden on public.bloques (dueno, orden);

drop trigger if exists bloques_actualizado on public.bloques;
create trigger bloques_actualizado
  before update on public.bloques
  for each row execute function public.tocar_actualizado();

-- ── Dibujos del Paint (la imagen va en la caja «dibujos» de Storage) ──
create table if not exists public.dibujos (
  id          uuid primary key default gen_random_uuid(),
  dueno       text not null check (dueno in ('aostri', 'tomas', 'hassan')),
  titulo      text not null check (char_length(btrim(titulo)) between 1 and 60),
  ruta        text not null unique check (ruta ~ '^(aostri|tomas|hassan)/[0-9a-f-]{36}\.png$' and split_part(ruta, '/', 1) = dueno),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

comment on table public.dibujos is 'La galería del Paint: la ven los tres; cada uno toca solo los suyos.';
create index if not exists dibujos_actualizado on public.dibujos (actualizado desc);

-- ── Sorpresas: un sticker o un dibujo que uno le deja a otro ─────────
create table if not exists public.sorpresas (
  id        uuid primary key default gen_random_uuid(),
  de        text not null check (de in ('aostri', 'tomas', 'hassan')),
  para      text not null check (para in ('aostri', 'tomas', 'hassan')),
  tipo      text not null check (tipo in ('sticker', 'dibujo')),
  sticker   text check (sticker ~ '^[a-z-]{1,40}$'),
  dibujo_id uuid references public.dibujos (id) on delete cascade,
  mensaje   text check (char_length(mensaje) <= 140),
  vista     boolean not null default false,
  creado    timestamptz not null default now(),
  check (de <> para),
  check ((tipo = 'sticker' and sticker is not null) or (tipo = 'dibujo' and dibujo_id is not null))
);

comment on table public.sorpresas is 'Bromas: la ve solo quien la manda y quien la recibe. Solo el que la recibe la marca como vista.';
create index if not exists sorpresas_para on public.sorpresas (para, vista);

-- ── Reglas (RLS) ─────────────────────────────────────────────────────
alter table public.bloques enable row level security;
alter table public.dibujos enable row level security;
alter table public.sorpresas enable row level security;

revoke all on public.bloques, public.dibujos, public.sorpresas from anon;
revoke all on public.bloques, public.dibujos, public.sorpresas from authenticated;
grant select, insert, delete on public.bloques, public.dibujos, public.sorpresas to authenticated;
grant update (tipo, titulo, contenido, privado, orden) on public.bloques to authenticated; -- el dueño no se cambia
grant update (titulo, actualizado) on public.dibujos to authenticated;
grant update (vista) on public.sorpresas to authenticated;

-- Bloques: los ven los tres (los privados, solo su dueño); los toca solo su dueño.
drop policy if exists "bloques: ver" on public.bloques;
create policy "bloques: ver" on public.bloques for select to authenticated
  using (public.soy_del_equipo() and (dueno = public.mi_slug() or not privado));
drop policy if exists "bloques: crear los míos" on public.bloques;
create policy "bloques: crear los míos" on public.bloques for insert to authenticated
  with check (public.soy_del_equipo() and dueno = public.mi_slug());
drop policy if exists "bloques: cambiar los míos" on public.bloques;
create policy "bloques: cambiar los míos" on public.bloques for update to authenticated
  using (dueno = public.mi_slug()) with check (dueno = public.mi_slug());
drop policy if exists "bloques: borrar los míos" on public.bloques;
create policy "bloques: borrar los míos" on public.bloques for delete to authenticated
  using (dueno = public.mi_slug());

-- Dibujos: galería común; cada uno toca los suyos.
drop policy if exists "dibujos: ver" on public.dibujos;
create policy "dibujos: ver" on public.dibujos for select to authenticated
  using (public.soy_del_equipo());
drop policy if exists "dibujos: crear los míos" on public.dibujos;
create policy "dibujos: crear los míos" on public.dibujos for insert to authenticated
  with check (public.soy_del_equipo() and dueno = public.mi_slug());
drop policy if exists "dibujos: cambiar los míos" on public.dibujos;
create policy "dibujos: cambiar los míos" on public.dibujos for update to authenticated
  using (dueno = public.mi_slug()) with check (dueno = public.mi_slug());
drop policy if exists "dibujos: borrar los míos" on public.dibujos;
create policy "dibujos: borrar los míos" on public.dibujos for delete to authenticated
  using (dueno = public.mi_slug());

-- Sorpresas: las ven el que manda y el que recibe; el que recibe la marca vista; cualquiera de los dos la borra.
drop policy if exists "sorpresas: ver" on public.sorpresas;
create policy "sorpresas: ver" on public.sorpresas for select to authenticated
  using (public.soy_del_equipo() and public.mi_slug() in (de, para));
drop policy if exists "sorpresas: mandar" on public.sorpresas;
create policy "sorpresas: mandar" on public.sorpresas for insert to authenticated
  with check (public.soy_del_equipo() and de = public.mi_slug() and vista = false);
drop policy if exists "sorpresas: marcar vista" on public.sorpresas;
create policy "sorpresas: marcar vista" on public.sorpresas for update to authenticated
  using (para = public.mi_slug()) with check (para = public.mi_slug());
drop policy if exists "sorpresas: borrar" on public.sorpresas;
create policy "sorpresas: borrar" on public.sorpresas for delete to authenticated
  using (public.mi_slug() in (de, para));

-- ── Caja «dibujos» de Storage: privada, solo PNG/WebP de hasta 5 MB ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dibujos', 'dibujos', false, 5242880, array['image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Cuánto ocupan los dibujos (para frenar antes de llenar el plan gratis).
create or replace function public.espacio_dibujos()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)
  from storage.objects
  where bucket_id = 'dibujos'
$$;
revoke all on function public.espacio_dibujos() from public, anon;
grant execute on function public.espacio_dibujos() to authenticated;

-- Cada uno sube en su carpeta (tomas/…, aostri/…, hassan/…); ver, los tres; tope total 200 MB.
drop policy if exists "dibujos: el equipo ve" on storage.objects;
create policy "dibujos: el equipo ve" on storage.objects for select to authenticated
  using (bucket_id = 'dibujos' and public.soy_del_equipo());
drop policy if exists "dibujos: subo en mi carpeta" on storage.objects;
create policy "dibujos: subo en mi carpeta" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dibujos'
    and public.soy_del_equipo()
    and (storage.foldername(name))[1] = public.mi_slug()
    and public.espacio_dibujos() < 200 * 1024 * 1024
  );
drop policy if exists "dibujos: cambio en mi carpeta" on storage.objects;
create policy "dibujos: cambio en mi carpeta" on storage.objects for update to authenticated
  using (bucket_id = 'dibujos' and (storage.foldername(name))[1] = public.mi_slug())
  with check (bucket_id = 'dibujos' and (storage.foldername(name))[1] = public.mi_slug());
drop policy if exists "dibujos: borro en mi carpeta" on storage.objects;
create policy "dibujos: borro en mi carpeta" on storage.objects for delete to authenticated
  using (bucket_id = 'dibujos' and (storage.foldername(name))[1] = public.mi_slug());

-- ── En vivo: los cambios les llegan a los otros al instante ──────────
do $$
declare
  tabla text;
begin
  foreach tabla in array array['bloques', 'dibujos', 'sorpresas'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tabla);
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$$;
