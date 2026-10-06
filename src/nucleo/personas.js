// Los tres del equipo en la tabla «personas», en vivo: si uno se cambia el nombre, los otros lo ven al instante.
import { EQUIPO } from './config.js';

const CLAVE_PRUEBA = 'ath-prueba-nombres';

/** Carga a los tres, se asegura de que exista la fila propia y escucha los cambios. */
export async function prepararPersonas(app, { id, slug }) {
  if (!app.conectado) {
    prepararModoPrueba(app, slug);
    return;
  }

  const base = EQUIPO.find((p) => p.slug === slug);
  // La primera vez que alguien entra, se crea su fila (si ya existe, no se toca).
  const { error: errorAlta } = await app.supabase
    .from('personas')
    .upsert({ id, slug, nombre: base.nombre, rol: base.rol }, { onConflict: 'id', ignoreDuplicates: true });
  if (errorAlta) throw errorAlta;

  await recargar(app, id);

  app.supabase
    .channel('personas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personas' }, () => recargar(app, id))
    .subscribe();
}

async function recargar(app, idPropio) {
  const { data, error } = await app.supabase.from('personas').select('id, slug, nombre, rol');
  if (error) {
    console.error(error);
    app.avisar('No pude traer los nombres del equipo.', 'error');
    return;
  }
  // Los tres siempre, en orden A·T·H; el que todavía no entró nunca queda con su nombre de fábrica.
  app.personas = EQUIPO.map((base) => {
    const fila = data.find((f) => f.slug === base.slug);
    return { id: fila?.id ?? null, slug: base.slug, nombre: fila?.nombre ?? base.nombre, rol: fila?.rol ?? base.rol };
  });
  app.persona = app.personas.find((p) => p.id === idPropio) ?? app.persona;
  app.emitir('personas', app.personas);
  app.emitir('persona', app.persona);
}

/** Cambia el nombre propio. Devuelve un texto de error o null si salió bien. */
export async function cambiarMiNombre(app, nombre) {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio) return 'Escribí un nombre.';
  if (limpio.length > 40) return 'Que tenga 40 letras como mucho.';

  if (!app.conectado) {
    const guardados = JSON.parse(localStorage.getItem(CLAVE_PRUEBA) ?? '{}');
    guardados[app.persona.slug] = limpio;
    localStorage.setItem(CLAVE_PRUEBA, JSON.stringify(guardados));
    prepararModoPrueba(app, app.persona.slug);
    return null;
  }

  const { error } = await app.supabase.from('personas').update({ nombre: limpio }).eq('id', app.persona.id);
  if (error) {
    console.error(error);
    return 'No se pudo guardar. Fijate la conexión y probá de nuevo.';
  }
  return null;
}

// Sin Supabase: los nombres viven solo en esta compu, para poder mirar la app.
function prepararModoPrueba(app, slug) {
  const guardados = JSON.parse(localStorage.getItem(CLAVE_PRUEBA) ?? '{}');
  app.personas = EQUIPO.map((base) => ({
    id: `prueba-${base.slug}`,
    slug: base.slug,
    nombre: guardados[base.slug] ?? base.nombre,
    rol: base.rol,
  }));
  app.persona = app.personas.find((p) => p.slug === slug);
  app.emitir('personas', app.personas);
  app.emitir('persona', app.persona);
}
