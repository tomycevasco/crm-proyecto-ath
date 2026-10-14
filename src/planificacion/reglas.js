// Reglas de Planificación: lógica pura (sin pantalla ni Supabase).
//
// Una tarea (como viene de la tabla planificacion_tareas):
//   { id, titulo, proyecto, responsable (slug), inicio, fin ('AAAA-MM-DD', ambos inclusive),
//     avance (0-100), estado, depende_de (id de otra tarea o null), hito (bool), notas, orden }
//
// Las fechas se manejan siempre como texto 'AAAA-MM-DD' (igual que el tipo `date` de Postgres)
// y las cuentas se hacen en UTC, así el cambio de horario no corre un día.
// Nada de acá cambia lo que recibe: las funciones que «mueven» devuelven tareas nuevas.
//
// Cómo se usa desde la pantalla (src/modulos/planificacion.js):
//
//   import { estadoDe, moverTarea, avancePorProyecto, cargaPorPersona, proximosHitos }
//     from '../planificacion/reglas.js';
//   const { tareas: nuevas, cambiadas } = moverTarea(tareas, id, { dias: 3 });
//   // guardar en la base solo las `cambiadas` (la movida + las que empujó)

export const ESTADOS = Object.freeze({
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  atrasada: 'Atrasada',
  hecha: 'Hecha',
});

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const UN_DIA = 86400000;

// ───────────── Fechas ─────────────

// Convierte 'AAAA-MM-DD' (o un Date) en un Date a las 00:00 UTC; null si no es una fecha válida.
export function aFecha(valor) {
  if (valor instanceof Date) {
    return isNaN(valor) ? null : new Date(Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
  if (!m) return null;
  const fecha = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Descarta cosas como 2026-02-31 (que Date convierte solo en 3 de marzo)
  return fecha.getUTCMonth() === +m[2] - 1 ? fecha : null;
}

// Pasa un Date (o 'AAAA-MM-DD') a texto 'AAAA-MM-DD'; null si no es válida.
export function aISO(valor) {
  const fecha = valor instanceof Date && !isNaN(valor)
    ? new Date(Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()))
    : aFecha(valor);
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

// La fecha de hoy en la compu de quien usa el CRM, como 'AAAA-MM-DD'.
export function hoyISO(ahora = new Date()) {
  return aISO(aFecha(ahora));
}

// Suma (o resta, con negativos) días a una fecha 'AAAA-MM-DD'.
export function sumarDias(fecha, dias) {
  const f = aFecha(fecha);
  if (!f) return null;
  return aISO(new Date(f.getTime() + Math.round(dias) * UN_DIA));
}

// Días que hay de `desde` a `hasta` (0 si son el mismo día; negativo si `hasta` es antes).
export function diasEntre(desde, hasta) {
  const a = aFecha(desde);
  const b = aFecha(hasta);
  if (!a || !b) return null;
  return Math.round((b - a) / UN_DIA);
}

// Cuántos días dura una tarea, contando el primero y el último (inicio = fin → 1).
export function duracion(tarea) {
  const d = diasEntre(tarea?.inicio, tarea?.fin);
  return d === null ? 0 : Math.max(1, d + 1);
}

// Fecha corta para mostrar: «14 oct» (agrega el año si no es el actual, y el día con { dia: true }).
export function formatearFecha(fecha, { dia = false, anio, hoy = hoyISO() } = {}) {
  const f = aFecha(fecha);
  if (!f) return '';
  const conAnio = anio ?? f.getUTCFullYear() !== aFecha(hoy)?.getUTCFullYear();
  let texto = `${f.getUTCDate()} ${MESES[f.getUTCMonth()]}`;
  if (conAnio) texto += ` ${f.getUTCFullYear()}`;
  if (dia) texto = `${DIAS[f.getUTCDay()]} ${texto}`;
  return texto;
}

// Rango para mostrar: «14 → 20 oct», «28 oct → 3 nov» o un solo día si empieza y termina igual.
export function formatearRango(inicio, fin, opciones = {}) {
  const a = aFecha(inicio);
  const b = aFecha(fin);
  if (!a || !b) return '';
  if (a.getTime() === b.getTime()) return formatearFecha(inicio, opciones);
  const mismoMes = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const desde = mismoMes && !opciones.dia ? String(a.getUTCDate()) : formatearFecha(inicio, opciones);
  return `${desde} → ${formatearFecha(fin, opciones)}`;
}

// Texto relativo a hoy: «hoy», «mañana», «en 5 días», «hace 2 días», «ayer».
export function formatearFaltan(fecha, hoy = hoyISO()) {
  const d = diasEntre(hoy, fecha);
  if (d === null) return '';
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  return d > 0 ? `en ${d} días` : `hace ${-d} días`;
}

// ───────────── Validar ─────────────

// Revisa una tarea antes de guardarla; devuelve { ok, errores: { campo: 'mensaje' } }.
// Si se le pasan las demás tareas, también controla que la dependencia exista y no haga un círculo.
export function validarTarea(tarea, tareas = []) {
  const errores = {};
  if (!String(tarea?.titulo ?? '').trim()) errores.titulo = 'Poné un título.';
  if (!aFecha(tarea?.inicio)) errores.inicio = 'Elegí la fecha de inicio.';
  if (!aFecha(tarea?.fin)) errores.fin = 'Elegí la fecha de fin.';
  if (!errores.inicio && !errores.fin && !inicioAntesDeFin(tarea.inicio, tarea.fin)) {
    errores.fin = 'El fin no puede ser antes del inicio.';
  }
  const avance = Number(tarea?.avance ?? 0);
  if (!Number.isFinite(avance) || avance < 0 || avance > 100) errores.avance = 'El avance va de 0 a 100.';
  if (tarea?.depende_de) {
    if (tarea.depende_de === tarea.id) {
      errores.depende_de = 'Una tarea no puede depender de sí misma.';
    } else if (tareas.length && !tareas.some((t) => t.id === tarea.depende_de)) {
      errores.depende_de = 'La tarea de la que depende ya no existe.';
    } else if (tareas.length && haceCirculo(tareas, tarea.id, tarea.depende_de)) {
      errores.depende_de = 'Esa dependencia hace un círculo (una espera a la otra y al revés).';
    }
  }
  return { ok: Object.keys(errores).length === 0, errores };
}

// true si `inicio` es igual o anterior a `fin` (y las dos son fechas válidas).
export function inicioAntesDeFin(inicio, fin) {
  const d = diasEntre(inicio, fin);
  return d !== null && d >= 0;
}

// true si poner que `id` dependa de `dependeDe` armaría un círculo de dependencias.
export function haceCirculo(tareas, id, dependeDe) {
  const porId = indexar(tareas);
  const vistos = new Set();
  let actual = dependeDe;
  while (actual) {
    if (actual === id) return true;
    if (vistos.has(actual)) return true; // ya había un círculo de antes
    vistos.add(actual);
    actual = porId.get(actual)?.depende_de ?? null;
  }
  return false;
}

// ───────────── Estado ─────────────

// Avance como número entero de 0 a 100 (lo que venga roto cuenta como 0).
export function avanceDe(tarea) {
  const n = Math.round(Number(tarea?.avance ?? 0));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

// Estado según fechas y avance: hecha (100 % o marcada hecha), atrasada (pasó el fin),
// en_curso (ya empezó) o pendiente (todavía no empieza).
export function estadoDe(tarea, hoy = hoyISO()) {
  if (avanceDe(tarea) >= 100 || tarea?.estado === 'hecha') return 'hecha';
  const fin = diasEntre(hoy, tarea?.fin);
  if (fin !== null && fin < 0) return 'atrasada';
  const inicio = diasEntre(hoy, tarea?.inicio);
  if (inicio !== null && inicio <= 0) return 'en_curso';
  return 'pendiente';
}

// El nombre del estado para mostrar («En curso»).
export function nombreEstado(estado) {
  return ESTADOS[estado] ?? '';
}

// true si la tarea empezó antes de que terminara aquella de la que depende.
export function arrancaAntesDeTiempo(tarea, tareas) {
  const previa = tarea?.depende_de ? indexar(tareas).get(tarea.depende_de) : null;
  if (!previa) return false;
  const d = diasEntre(previa.fin, tarea.inicio);
  return d !== null && d < 1;
}

// ───────────── Mover y empujar ─────────────

// Mueve una tarea y empuja hacia adelante las que dependen de ella (en cadena), para que cada una
// arranque al día siguiente de que termine la anterior. No tira para atrás a nadie.
// `cambio`: { dias } (corre la tarea entera) o { inicio, fin } (fechas nuevas, ej. al estirarla).
// Devuelve { tareas: lista nueva completa, cambiadas: solo las que cambiaron (para guardar) }.
export function moverTarea(tareas, id, cambio = {}) {
  const lista = tareas.map((t) => ({ ...t }));
  const porId = indexar(lista);
  const tarea = porId.get(id);
  if (!tarea) return { tareas: lista, cambiadas: [] };

  const cambiadas = new Map();
  if (Number.isFinite(cambio.dias) && cambio.dias !== 0) {
    tarea.inicio = sumarDias(tarea.inicio, cambio.dias);
    tarea.fin = sumarDias(tarea.fin, cambio.dias);
  } else {
    if (aFecha(cambio.inicio)) tarea.inicio = aISO(cambio.inicio);
    if (aFecha(cambio.fin)) tarea.fin = aISO(cambio.fin);
    if (!inicioAntesDeFin(tarea.inicio, tarea.fin)) tarea.fin = tarea.inicio;
  }
  cambiadas.set(tarea.id, tarea);

  // Recorre a las que esperan, a lo ancho; `vistos` corta si hay un círculo viejo en los datos.
  const vistos = new Set([tarea.id]);
  const cola = [tarea];
  while (cola.length) {
    const previa = cola.shift();
    for (const sigue of lista) {
      if (sigue.depende_de !== previa.id || vistos.has(sigue.id)) continue;
      vistos.add(sigue.id);
      const desde = sumarDias(previa.fin, 1);
      const corrimiento = diasEntre(sigue.inicio, desde);
      if (corrimiento > 0) {
        sigue.inicio = sumarDias(sigue.inicio, corrimiento);
        sigue.fin = sumarDias(sigue.fin, corrimiento);
        cambiadas.set(sigue.id, sigue);
      }
      cola.push(sigue);
    }
  }
  return { tareas: lista, cambiadas: [...cambiadas.values()] };
}

// Las tareas que dependen de `id`, directa o indirectamente (para avisar «esto mueve 3 tareas más»).
export function dependientesDe(tareas, id) {
  const resultado = [];
  const vistos = new Set([id]);
  const cola = [id];
  while (cola.length) {
    const actual = cola.shift();
    for (const t of tareas) {
      if (t.depende_de === actual && !vistos.has(t.id)) {
        vistos.add(t.id);
        resultado.push(t);
        cola.push(t.id);
      }
    }
  }
  return resultado;
}

// ───────────── Resúmenes ─────────────

// Avance de un proyecto: promedio del avance de sus tareas pesado por cuántos días dura cada una
// (los hitos no pesan). Devuelve { proyecto, avance, total, hechas, atrasadas, en_curso, pendientes, inicio, fin }.
export function avanceProyecto(tareas, proyecto, hoy = hoyISO()) {
  const delProyecto = tareas.filter((t) => (t.proyecto || '') === (proyecto || ''));
  const resumen = {
    proyecto: proyecto || '',
    avance: 0, total: delProyecto.length,
    hechas: 0, atrasadas: 0, en_curso: 0, pendientes: 0,
    inicio: null, fin: null,
  };
  let peso = 0;
  let suma = 0;
  for (const t of delProyecto) {
    const estado = estadoDe(t, hoy);
    if (estado === 'hecha') resumen.hechas++;
    else if (estado === 'atrasada') resumen.atrasadas++;
    else if (estado === 'en_curso') resumen.en_curso++;
    else resumen.pendientes++;
    const p = t.hito ? 0 : duracion(t);
    peso += p;
    suma += p * (estado === 'hecha' ? 100 : avanceDe(t));
    if (aFecha(t.inicio) && (!resumen.inicio || diasEntre(resumen.inicio, t.inicio) < 0)) resumen.inicio = aISO(t.inicio);
    if (aFecha(t.fin) && (!resumen.fin || diasEntre(resumen.fin, t.fin) > 0)) resumen.fin = aISO(t.fin);
  }
  if (peso > 0) resumen.avance = Math.round(suma / peso);
  else if (resumen.total > 0) resumen.avance = Math.round((resumen.hechas / resumen.total) * 100);
  return resumen;
}

// Un resumen como el de avanceProyecto por cada proyecto que aparece, ordenados por nombre.
export function avancePorProyecto(tareas, hoy = hoyISO()) {
  return proyectosDe(tareas).map((p) => avanceProyecto(tareas, p, hoy));
}

// Los nombres de proyecto que aparecen en las tareas, sin repetir y en orden alfabético.
export function proyectosDe(tareas) {
  return [...new Set(tareas.map((t) => t.proyecto || ''))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

// Carga de cada persona: tareas sin terminar (las que se cruzan con { desde, hasta }, si se pasa),
// cuántas atrasadas y cuántos días de trabajo suman. Devuelve { slug: { tareas, atrasadas, en_curso, dias, lista } }.
// `personas` (slugs) asegura que aparezcan todos aunque no tengan nada; lo sin responsable va en ''.
export function cargaPorPersona(tareas, { personas = [], desde, hasta, hoy = hoyISO() } = {}) {
  const carga = {};
  const vacia = () => ({ tareas: 0, atrasadas: 0, en_curso: 0, dias: 0, lista: [] });
  for (const p of personas) carga[p] = vacia();
  for (const t of tareas) {
    const estado = estadoDe(t, hoy);
    if (estado === 'hecha' || t.hito) continue;
    if (desde && diasEntre(desde, t.fin) < 0) continue;
    if (hasta && diasEntre(t.inicio, hasta) < 0) continue;
    const quien = t.responsable || '';
    const c = (carga[quien] ??= vacia());
    c.tareas++;
    if (estado === 'atrasada') c.atrasadas++;
    if (estado === 'en_curso') c.en_curso++;
    c.dias += duracion(t);
    c.lista.push(t);
  }
  return carga;
}

// Los hitos que faltan (sin hacer), del más cercano al más lejano, con { tarea, faltan (días), atrasado }.
// Los atrasados van primero. `dias` limita cuántos días para adelante mirar; `limite`, cuántos devolver.
export function proximosHitos(tareas, { hoy = hoyISO(), dias = Infinity, limite = Infinity } = {}) {
  return tareas
    .filter((t) => t.hito && estadoDe(t, hoy) !== 'hecha' && aFecha(t.fin))
    .map((t) => {
      const faltan = diasEntre(hoy, t.fin);
      return { tarea: t, faltan, atrasado: faltan < 0 };
    })
    .filter((h) => h.faltan <= dias)
    .sort((a, b) => a.faltan - b.faltan)
    .slice(0, limite);
}

// Primer y último día de un grupo de tareas ({ inicio, fin }), para saber qué rango dibujar.
export function rangoDe(tareas) {
  let inicio = null;
  let fin = null;
  for (const t of tareas) {
    if (aFecha(t.inicio) && (!inicio || diasEntre(inicio, t.inicio) < 0)) inicio = aISO(t.inicio);
    if (aFecha(t.fin) && (!fin || diasEntre(fin, t.fin) > 0)) fin = aISO(t.fin);
  }
  return { inicio, fin };
}

// Ordena tareas por proyecto, después por `orden` y después por inicio (devuelve una lista nueva).
export function ordenarTareas(tareas) {
  return [...tareas].sort((a, b) =>
    (a.proyecto || '').localeCompare(b.proyecto || '', 'es')
    || (Number(a.orden) || 0) - (Number(b.orden) || 0)
    || (diasEntre(b.inicio, a.inicio) ?? 0)
    || String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es'));
}

// ───────────── Ayudas internas ─────────────

function indexar(tareas) {
  return new Map(tareas.map((t) => [t.id, t]));
}
