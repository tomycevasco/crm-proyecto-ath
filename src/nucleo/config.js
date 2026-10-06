// Lo que la app necesita saber antes de arrancar: Supabase y quiénes son los tres.
const env = import.meta.env;

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_CLAVE = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

// ¿Están cargados los datos de Supabase en el .env? (los del ejemplo no cuentan)
export const HAY_SUPABASE =
  SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('TU-PROYECTO') &&
  SUPABASE_CLAVE.length > 20 &&
  !SUPABASE_CLAVE.includes('xxxx');

// El equipo, en el orden del logo: A·T·H. El color de cada uno está en base.css (--color-<slug>).
// «nombre» es el de fábrica: cada uno lo puede cambiar y se guarda en la tabla personas.
export const EQUIPO = [
  { slug: 'aostri', nombre: 'Aostri', rol: 'Marketing y creatividad', correo: env.VITE_CORREO_AOSTRI ?? '' },
  { slug: 'tomas', nombre: 'Tomás', rol: 'Desarrollo', correo: env.VITE_CORREO_TOMAS ?? '' },
  { slug: 'hassan', nombre: 'Hassan', rol: 'Clientes y código', correo: env.VITE_CORREO_HASSAN ?? '' },
];

export function buscarPorCorreo(correo) {
  const limpio = (correo ?? '').trim().toLowerCase();
  return EQUIPO.find((p) => p.correo.trim().toLowerCase() === limpio) ?? null;
}

export function buscarPorSlug(slug) {
  return EQUIPO.find((p) => p.slug === slug) ?? null;
}
