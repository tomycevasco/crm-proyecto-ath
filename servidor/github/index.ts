// Función «github» de ATH (Supabase Edge Function, Deno).
// La página le pide cosas con supabase.functions.invoke('github', { body: { accion, ... } })
// y ella habla con GitHub usando la clave de SOLO LECTURA, que nunca sale de Supabase.
//
// Acciones:
//   { accion: 'repos' }                          → repos de la organización
//   { accion: 'resumen', repo, forzar? }         → cambios, ramas, pedidos de cambio y vista previa
//   { accion: 'pendientes' }                     → ramas con cambios de Hassan sin juntar
//
// Secretos (Supabase → Edge Functions → Secrets): GITHUB_TOKEN, GITHUB_ORG, ORIGENES_PERMITIDOS.
// Cómo se publica: servidor/github/LEEME.md

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const ORG = Deno.env.get('GITHUB_ORG') ?? '';
const TOKEN = Deno.env.get('GITHUB_TOKEN') ?? '';
const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!;
const VIDA_CACHE_MS = 5 * 60 * 1000;
const PAUSA_FORZAR_MS = 60 * 1000; // «Actualizar» pide de nuevo a GitHub como mucho 1 vez por minuto
const NOMBRE_VALIDO = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_RAMAS = 15;
const MAX_VISTAS_RAMAS = 5;
const MAX_REPOS_PENDIENTES = 30;

// ── Claves de Supabase (acepta el nombre viejo y el nuevo) ──────────
function claveSupabase(vieja: string, nuevas: string): string {
  const directa = Deno.env.get(vieja);
  if (directa) return directa;
  const lista = JSON.parse(Deno.env.get(nuevas) ?? '{}');
  return lista.default ?? Object.values(lista)[0];
}
const CLAVE_PUBLICA = claveSupabase('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const CLAVE_SECRETA = claveSupabase('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');

// ── CORS: solo nuestra app puede llamar desde el navegador ──────────
const ORIGENES = (Deno.env.get('ORIGENES_PERMITIDOS') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function cabecerasCors(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : (ORIGENES[0] ?? ''),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function responder(req: Request, cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cabecerasCors(req), 'Content-Type': 'application/json' },
  });
}

// Error con un mensaje en criollo para mostrar (sin detalles internos).
class ErrorParaMostrar extends Error {
  constructor(public estado: number, mensaje: string) { super(mensaje); }
}

// ── Quién llama: tiene que ser una de las 3 cuentas del equipo ──────
type Llamador = { userId: string; slug: string; db: SupabaseClient };

async function quienLlama(req: Request): Promise<Llamador | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  // db usa la sesión de la persona: respeta las mismas reglas (RLS) que la página.
  const db = createClient(URL_SUPABASE, CLAVE_PUBLICA, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return null;
  const { data: persona } = await db.from('personas').select('slug').eq('id', data.user.id).maybeSingle();
  if (!persona) return null;
  return { userId: data.user.id, slug: persona.slug, db };
}

// Permisos totales: SOLO para la caché. Nunca para lo que pide la persona.
let servicio: SupabaseClient | null = null;
function clienteServicio(): SupabaseClient {
  servicio ??= createClient(URL_SUPABASE, CLAVE_SECRETA, { auth: { persistSession: false } });
  return servicio;
}

// ── Hablar con GitHub ────────────────────────────────────────────────
async function gh(ruta: string): Promise<any> {
  const r = await fetch(`https://api.github.com${ruta}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'crm-ath',
    },
  });
  if (r.ok) return r.json();
  if (r.status === 401) throw new ErrorParaMostrar(502, 'La clave de GitHub venció o está mal. Hay que cargar una nueva en Supabase.');
  if (r.status === 404) throw new ErrorParaMostrar(404, 'No encontré ese repo (o la clave no tiene permiso para verlo).');
  if (r.status === 409) return null; // repo vacío, sin ningún cambio todavía
  if ((r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0') {
    throw new ErrorParaMostrar(503, 'GitHub nos pidió una pausa. Probá en unos minutos.');
  }
  if (r.status === 403) throw new ErrorParaMostrar(403, 'La clave de GitHub no tiene permiso para esto.');
  console.error('GitHub', r.status, ruta, await r.text());
  throw new ErrorParaMostrar(502, 'GitHub no contestó bien. Probá de nuevo.');
}

// Para lo que es un extra (vista previa): si falla o falta el permiso, seguimos sin eso.
async function ghOpcional(ruta: string): Promise<any> {
  try {
    return await gh(ruta);
  } catch (e) {
    if (e instanceof ErrorParaMostrar && e.estado === 503) throw e;
    return null;
  }
}

const enc = encodeURIComponent;

// Trae de la caché si es reciente; si no, pide a GitHub y guarda.
async function conCache<T>(clave: string, traer: () => Promise<T>, forzar = false): Promise<T & { _actualizado?: string }> {
  const db = clienteServicio();
  const { data } = await db.from('github_cache').select('datos, actualizado').eq('clave', clave).maybeSingle();
  const edad = data ? Date.now() - new Date(data.actualizado).getTime() : Infinity;
  if (data && edad < (forzar ? PAUSA_FORZAR_MS : VIDA_CACHE_MS)) {
    return { ...(data.datos as T), _actualizado: data.actualizado };
  }
  const datos = await traer();
  const actualizado = new Date().toISOString();
  await db.from('github_cache').upsert({ clave, datos, actualizado });
  return { ...datos, _actualizado: actualizado };
}

// ── Las acciones ─────────────────────────────────────────────────────
async function listarRepos() {
  const repos = await gh(`/orgs/${enc(ORG)}/repos?type=all&sort=pushed&per_page=100`);
  return {
    repos: repos.map((r: any) => ({
      nombre: r.name,
      descripcion: r.description,
      privado: r.private,
      ramaPrincipal: r.default_branch,
      ultimoCambio: r.pushed_at,
      url: r.html_url,
    })),
  };
}

// La vista previa de un cambio: Netlify (estado del commit) o Cloudflare Pages (checks).
async function vistaPreviaDe(repo: string, sha: string) {
  const base = `/repos/${enc(ORG)}/${enc(repo)}/commits/${enc(sha)}`;
  const estado = await ghOpcional(`${base}/status`);
  const netlify = estado?.statuses?.find((s: any) =>
    s.context?.startsWith('netlify/') && s.state === 'success' && s.target_url?.startsWith('https://'));
  if (netlify) return { url: netlify.target_url, de: 'Netlify' };

  const checks = await ghOpcional(`${base}/check-runs?per_page=20`);
  for (const c of checks?.check_runs ?? []) {
    if (c.conclusion !== 'success') continue;
    const texto = `${c.output?.summary ?? ''} ${c.output?.text ?? ''}`;
    const enlace = texto.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\b/i);
    if (enlace) return { url: enlace[0], de: 'Cloudflare' };
  }

  // Otros servicios que usan «deployments» de GitHub.
  const despliegues = await ghOpcional(`/repos/${enc(ORG)}/${enc(repo)}/deployments?sha=${enc(sha)}&per_page=3`);
  for (const d of despliegues ?? []) {
    const estados = await ghOpcional(`/repos/${enc(ORG)}/${enc(repo)}/deployments/${d.id}/statuses?per_page=1`);
    const ultimo = estados?.[0];
    if (ultimo?.state === 'success' && ultimo.environment_url?.startsWith('https://')) {
      return { url: ultimo.environment_url, de: d.environment };
    }
  }
  return null;
}

async function resumenRepo(repo: string) {
  const r = `/repos/${enc(ORG)}/${enc(repo)}`;
  const info = await gh(r);
  const principal = info.default_branch;
  const [commits, ramas, pulls] = await Promise.all([
    gh(`${r}/commits?per_page=10`),
    gh(`${r}/branches?per_page=100`),
    gh(`${r}/pulls?state=open&per_page=50`),
  ]);
  const listaCommits = commits ?? [];

  // Cada rama comparada con la principal (las más nuevas primero, con tope para no gastar de más).
  const otras = (ramas ?? []).filter((x: any) => x.name !== principal).slice(0, MAX_RAMAS);
  const ramasConDetalle = await Promise.all(otras.map(async (x: any) => {
    const cmp = await ghOpcional(`${r}/compare/${enc(principal)}...${enc(x.name)}`);
    const cambios = cmp?.commits ?? [];
    return {
      nombre: x.name,
      sha: x.commit?.sha ?? null,
      adelante: cmp?.ahead_by ?? 0,
      atras: cmp?.behind_by ?? 0,
      autores: [...new Set(cambios.map((c: any) => c.author?.login).filter(Boolean))],
      ultimo: cambios.at(-1)?.commit?.author?.date ?? null,
      ultimoMensaje: cambios.at(-1)?.commit?.message?.split('\n')[0] ?? null,
      urlComparar: `https://github.com/${enc(ORG)}/${enc(repo)}/compare/${enc(principal)}...${enc(x.name)}`,
      vistaPrevia: null as null | { url: string; de: string },
    };
  }));
  ramasConDetalle.sort((a, b) => (b.ultimo ?? '').localeCompare(a.ultimo ?? ''));

  // Vista previa de las ramas que tienen cambios nuevos (las primeras 5).
  await Promise.all(ramasConDetalle
    .filter((x) => x.adelante > 0 && x.sha)
    .slice(0, MAX_VISTAS_RAMAS)
    .map(async (x) => { x.vistaPrevia = await vistaPreviaDe(repo, x.sha!); }));

  return {
    nombre: info.name,
    descripcion: info.description,
    ramaPrincipal: principal,
    url: info.html_url,
    cambios: listaCommits.map((c: any) => ({
      sha: c.sha.slice(0, 7),
      mensaje: c.commit.message.split('\n')[0], // solo la primera línea
      autor: c.author?.login ?? c.commit.author?.name ?? 'alguien',
      fecha: c.commit.author?.date ?? null,
      url: c.html_url,
    })),
    ramas: ramasConDetalle,
    pedidosAbiertos: (pulls ?? []).map((p: any) => ({
      numero: p.number, titulo: p.title, autor: p.user?.login ?? null, rama: p.head?.ref ?? null,
      fecha: p.updated_at, url: p.html_url,
    })),
    vistaPrevia: listaCommits[0] ? await vistaPreviaDe(repo, listaCommits[0].sha) : null,
  };
}

function validarRepo(repo: unknown): string {
  if (typeof repo !== 'string' || !NOMBRE_VALIDO.test(repo)) throw new ErrorParaMostrar(400, 'Ese nombre de repo no es válido.');
  return repo;
}

async function pendientesHassan(quien: Llamador) {
  // Con la sesión de quien llama: solo ve lo que las reglas le dejan ver.
  const [{ data: atados }, { data: usuarios }] = await Promise.all([
    quien.db.from('github_repos').select('cliente_id, repo').limit(MAX_REPOS_PENDIENTES),
    quien.db.from('github_personas').select('slug, login_github'),
  ]);
  const loginHassan = usuarios?.find((u: any) => u.slug === 'hassan')?.login_github?.toLowerCase();
  if (!loginHassan) return { pendientes: [], falta: 'login_hassan' };

  const pendientes: unknown[] = [];
  for (const a of atados ?? []) {
    if (!NOMBRE_VALIDO.test(a.repo)) continue;
    let r;
    try {
      r = await conCache(`resumen:${a.repo.toLowerCase()}`, () => resumenRepo(a.repo));
    } catch (e) {
      if (e instanceof ErrorParaMostrar && e.estado === 404) continue; // repo borrado o sin permiso
      throw e;
    }
    for (const rama of r.ramas) {
      const deHassan = rama.autores.some((x: string) => x.toLowerCase() === loginHassan);
      if (rama.adelante > 0 && deHassan) {
        const pr = r.pedidosAbiertos.find((p: any) => p.rama === rama.nombre);
        pendientes.push({
          clienteId: a.cliente_id, repo: r.nombre, rama: rama.nombre,
          cambios: rama.adelante, fecha: rama.ultimo, mensaje: rama.ultimoMensaje,
          pedido: pr ? { numero: pr.numero, titulo: pr.titulo } : null,
          urlRevisar: pr?.url ?? rama.urlComparar, // se aprueba en GitHub
          vistaPrevia: rama.vistaPrevia,
        });
      }
    }
  }
  pendientes.sort((x: any, y: any) => (y.fecha ?? '').localeCompare(x.fecha ?? ''));
  return { pendientes };
}

// ── La puerta de entrada ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecerasCors(req) });
  if (req.method !== 'POST') return responder(req, { error: 'Método no permitido.' }, 405);
  try {
    const quien = await quienLlama(req);
    if (!quien) return responder(req, { error: 'Entrá con el código del equipo.' }, 401);
    if (!TOKEN || !ORG) throw new ErrorParaMostrar(503, 'Falta cargar la clave de GitHub en Supabase (GITHUB_TOKEN y GITHUB_ORG).');

    const { accion, repo, forzar } = await req.json().catch(() => ({}));
    if (accion === 'repos') return responder(req, await conCache('repos', listarRepos, forzar === true));
    if (accion === 'resumen') {
      const nombre = validarRepo(repo);
      return responder(req, await conCache(`resumen:${nombre.toLowerCase()}`, () => resumenRepo(nombre), forzar === true));
    }
    if (accion === 'pendientes') return responder(req, await pendientesHassan(quien));
    throw new ErrorParaMostrar(400, 'No conozco esa acción.');
  } catch (e) {
    if (e instanceof ErrorParaMostrar) return responder(req, { error: e.message }, e.estado);
    console.error(e); // queda en los registros de Supabase, no le llega a la página
    return responder(req, { error: 'Algo falló. Probá de nuevo en un rato.' }, 500);
  }
});
