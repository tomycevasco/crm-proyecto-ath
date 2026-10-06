# Investigación · GitHub en el CRM ATH (Agente 6 · 06/10/2026)

Parte 4 del plan: cada cliente atado a un repo privado de la organización, con últimos cambios,
ramas, vista previa y «Ver cómo quedó», y los cambios de Hassan en otras ramas como pendientes.
Parte de `INVESTIGACION-integraciones.md` (sección 1) y lo ajusta a lo que **de verdad** armó la
tanda 1.

## En criollo

- La clave de GitHub (solo lectura) vive en Supabase, adentro de una «función» que corre allá. La
  página le pide «dame el resumen del repo X» y la función contesta con datos ya masticados. La clave
  nunca llega al navegador.
- Guardamos las respuestas 5 minutos para no gastar pedidos de GitHub.
- La pantalla nueva **Proyectos** muestra los repos de cada cliente; la ficha de cada proyecto trae
  cambios, ramas, la vista previa adentro y el botón «Ver cómo quedó». Los cambios de Hassan aparecen
  arriba como «Para revisar», con «Revisar en GitHub» (aprobar se hace allá, como dice el plan).

## 1. Lo que ya hay y cambia la guía anterior

| La guía de integraciones asumía | Lo que armó la base (Agente 1) | Qué hago |
|---|---|---|
| Tabla `miembros` y `es_del_equipo()` | Tabla `personas` (id = cuenta, `slug`) y `soy_del_equipo()` / `mi_slug()` | Uso `personas` y `soy_del_equipo()` |
| Funciones en `supabase/functions/github/` | Mi carpeta es `servidor/github/` | El código va ahí; Tomás lo pega en el editor de funciones del panel de Supabase (o lo copia a `supabase/functions/github/` si usa la línea de comandos). Lo explico en `servidor/github/LEEME.md` |
| Columnas `repo` y `url_publicada` en `clientes` | `clientes` es del Agente 4 (trabaja en paralelo; no sé si su id es número o uuid) | Tabla **propia** `github_repos (cliente_id text, repo, url_publicada)`. Sin depender del archivo del otro |
| Pendientes de Hassan pintados en el Inicio | El Inicio es del Agente 5 | Los muestro en mi pantalla y dejo un **enganche**: cualquier elemento con `data-github-pendientes` o `data-github-cliente="ID"` se llena solo (ver 5) |

## 2. Cómo se protege la clave (decidido)

- **Clave fina de GitHub** (fine-grained token), dueña = la organización, todo en *Read-only*:
  Metadata, Contents, Pull requests, Commit statuses, Deployments **y Checks** (Cloudflare Pages
  avisa la vista previa con «checks», no con deployments). Vence en ≤ 1 año. Una GitHub App sería
  más «pro», pero para 3 personas y solo lectura la clave fina alcanza.
- **Edge Function `github`**: la organización la fija el servidor (`GITHUB_ORG`), el nombre del repo
  se valida (`^[A-Za-z0-9._-]{1,100}$`), las ramas van con `encodeURIComponent`, errores en criollo
  sin detalles internos, CORS solo para nuestras direcciones (`ORIGENES_PERMITIDOS`).
- **Quién llama**: Supabase pasó a las claves nuevas (`sb_publishable_…`) y firmas asimétricas.
  Como en ATH siempre hay sesión iniciada, supabase-js manda el token de la persona en
  `Authorization` y el chequeo de fábrica (`verify_jwt`) sirve; igual, adentro la función confirma
  con `auth.getUser()` y que esa cuenta esté en `personas`. (Si alguna vez da «JWT is invalid», la
  salida conocida es apagar `verify_jwt` y dejar solo el chequeo de adentro.)
- **Versión de la API de GitHub**: `2026-03-10` (la nueva; sacó `merge_commit_sha` de los pedidos de
  cambio: no lo usamos).

## 3. Qué se le pide a GitHub (acciones de la función)

| Acción | Devuelve | Pedidos a GitHub |
|---|---|---|
| `repos` | repos de la organización (para elegir cuál va con cada cliente) | 1 |
| `resumen` (repo) | rama principal, 10 últimos cambios, ramas con «cuántos cambios adelante» y autores, pedidos de cambio abiertos, vista previa | ~5 a 20 |
| `pendientes` | ramas con cambios de Hassan sin juntar, en los repos atados a clientes | sale de la caché de `resumen` |

Caché de 5 minutos en `github_cache` (solo la función la toca). Con 5.000 pedidos por hora no se
llega nunca al límite. Botón «Actualizar» para forzar (máximo 1 vez por minuto por repo).

## 4. La vista previa

En este orden:
1. **Netlify**: estado del último cambio (`commits/{sha}/status`, contexto `netlify/…`) →
   `target_url`. Para pedidos de cambio: `deploy-preview-N--sitio.netlify.app`.
2. **Cloudflare Pages**: «checks» del último cambio (`commits/{sha}/check-runs`) → el link que viene
   en el resumen del check. Si no, se arma: rama `fix/api` → `https://fix-api.proyecto.pages.dev`.
3. **La dirección publicada** que se cargó a mano para ese cliente (`url_publicada`).

Antes de meterla en el `iframe`: solo `https:`, y dominio `*.netlify.app`, `*.pages.dev` o el mismo
de la `url_publicada`. `iframe` con `sandbox`, `referrerpolicy="no-referrer"` y `loading="lazy"`.
Algunos sitios no se dejan mostrar adentro de otra página: por eso **siempre** va «Ver cómo quedó»
(nueva pestaña) y un texto chico «¿No se ve? Abrila aparte».

## 5. Cómo lo armo (pantalla y enganches)

- `src/modulos/github.js` registra **Proyectos** (`#/github`, ícono 🐙, orden 25, entre Clientes e
  Mi espacio). `#/github` = lista de clientes con repo + «Para revisar»; `#/github/ID` = el proyecto
  de ese cliente. Ahí también se elige el repo de la organización y se carga la dirección publicada.
- Lee los clientes de la tabla `clientes` del Agente 4 si existe (`id`, `nombre`); si no está, avisa
  «Primero cargá clientes» sin romperse.
- **Enganches para los otros módulos** (sin tocar sus archivos):
  - `<div data-github-cliente="12"></div>` en la ficha del cliente → se llena con el repo, los
    últimos cambios y «Ver cómo quedó».
  - `<div data-github-pendientes></div>` en el Inicio → se llena con los cambios de Hassan para revisar.
  - y `app.github` con `pedir(accion, extra)` y `pendientes()` por si prefieren pintarlo ellos.
- **En vivo**: `github_repos` va con Realtime (si uno ata un repo, los otros lo ven al instante). Lo
  de GitHub se refresca al abrir y con «Actualizar»; un webhook de GitHub queda para más adelante.
- **Modo prueba** (sin Supabase): datos de ejemplo para poder ver la pantalla.
- Todo lo que viene de GitHub (mensajes, ramas, títulos) se pinta con `textContent`.

## 6. Tablas (`supabase/github.sql`)

- `github_cache (clave, datos jsonb, actualizado)` — RLS prendido y **sin** reglas: la página no la ve.
- `github_personas (slug, login_github)` — el usuario de GitHub de cada uno (para saber cuáles son
  de Hassan). El equipo lee y edita.
- `github_repos (cliente_id text pk, repo, url_publicada, actualizado_por, actualizado)` — el
  equipo lee y edita, con chequeos de formato (`repo` con el mismo patrón; `url_publicada` empieza
  con `https://`).

## Fuentes

- [Supabase · Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Supabase · Migrar a las claves publishable/secret](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Discusión «JWT is invalid» con las claves 2026](https://github.com/orgs/supabase/discussions/41834)
- [GitHub · API REST versión 2026-03-10](https://github.blog/changelog/2026-03-12-rest-api-version-2026-03-10-is-now-available/)
- [GitHub · Cambios que rompen (2026-03-10)](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes?apiVersion=2026-03-10)
- [Cloudflare Pages · integración con GitHub (checks y previews)](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- `INVESTIGACION-integraciones.md` (Agente 3), sección 1.

**Resumen:** la clave de GitHub queda en una función de Supabase y la página solo recibe datos masticados, con caché de 5 minutos.
Armo una pantalla «Proyectos» propia, una tabla propia que ata cliente↔repo, y enganches para que Clientes e Inicio muestren lo de GitHub sin tocar sus archivos.
