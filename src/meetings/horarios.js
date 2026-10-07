// Reglas de horario de Meetings: lógica pura (sin pantalla ni Supabase).
//
// Recibe las filas de las dos tablas y devuelve los eventos listos para dibujar:
//   { id, titulo, inicio: Date, fin: Date, tipo: 'bloqueo' | 'reunion', persona }
// `persona` es el slug ('aostri' | 'tomas' | 'hassan') o 'todos' (noche general y
// bloqueos marcados «para todos»).
//
// Cómo se usa desde la pantalla (src/modulos/meetings.js):
//
//   import { eventosDelRango, partirPorDia, NOCHE } from '../meetings/horarios.js';
//   const eventos = eventosDelRango(
//     { desde: lunes, hasta: domingoSiguiente },      // Date (hasta = sin incluir)
//     { reuniones: filasReuniones, bloqueos: filasBloqueos },
//   );
//   const porDia = partirPorDia(eventos);             // para una grilla de semana
//
// Datos de entrada (como vienen de Supabase):
//   meetings_reuniones: id, titulo, inicio, fin (timestamptz), organiza (slug), invitados (slug[]), notas
//   meetings_bloqueos:  id, persona (slug), tipo ('semanal' | 'puntual' | 'vacaciones'),
//                       dia_semana (0 = domingo … 6 = sábado, como getDay() y extract(dow) de Postgres;
//                                   también acepta 7 = domingo),
//                       hora_desde, hora_hasta ('HH:MM' o 'HH:MM:SS'),
//                       fecha_desde, fecha_hasta ('AAAA-MM-DD'), motivo, para_todos (bool)
//
// Reglas:
// - semanal: se repite cada semana ese día, de hora_desde a hora_hasta. Si hora_hasta es igual o
//   anterior a hora_desde, cruza la medianoche (ej. 22:00 a 07:00). Si trae fecha_desde/fecha_hasta,
//   solo vale entre esas fechas.
// - puntual: un día (fecha_desde; fecha_hasta opcional) con horas; sin horas = el día entero.
//   Si hay varias fechas y horas, son esas horas en cada día del rango.
// - vacaciones: de fecha_desde a fecha_hasta inclusive, días enteros.
// - para_todos: el bloqueo vale para los tres (persona = 'todos'; quién lo puso queda en `de`).
// - noche general: de 22:00 a 07:00 bloqueado para todos (se puede apagar con { noche: false }).
// Las filas con datos rotos se saltean (no rompen el calendario).

export const PERSONAS = ['aostri', 'tomas', 'hassan'];
export const TODOS = 'todos';
export const NOCHE = Object.freeze({ desde: '22:00', hasta: '07:00', titulo: 'Noche (no disponible)' });

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// ───────────── Lo principal ─────────────

/**
 * Todos los eventos (bloqueos + reuniones) que tocan el rango, ordenados por inicio.
 * @param {{desde: Date|string, hasta: Date|string}} rango  hasta = sin incluir
 * @param {{reuniones?: object[], bloqueos?: object[]}} datos
 * @param {{noche?: boolean|{desde:string,hasta:string,titulo?:string}, recortar?: boolean}} opciones
 *   recortar (por defecto true): los eventos que se pasan del rango se cortan en el borde.
 */
export function eventosDelRango(rango, datos = {}, opciones = {}) {
  const eventos = [
    ...bloqueosDelRango(rango, datos.bloqueos || [], opciones),
    ...reunionesDelRango(rango, datos.reuniones || [], opciones),
  ];
  return ordenar(eventos);
}

/** Solo los bloqueos (semanales, puntuales, vacaciones y la noche general), ya expandidos. */
export function bloqueosDelRango(rango, filas = [], opciones = {}) {
  const r = leerRango(rango);
  if (!r) return [];
  const eventos = [];

  if (opciones.noche !== false) {
    const noche = typeof opciones.noche === 'object' && opciones.noche ? { ...NOCHE, ...opciones.noche } : NOCHE;
    eventos.push(...nocheDelRango(r, noche));
  }

  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') continue;
    let partes = [];
    if (fila.tipo === 'semanal') partes = expandirSemanal(fila, r);
    else if (fila.tipo === 'puntual') partes = expandirPuntual(fila, r);
    else if (fila.tipo === 'vacaciones') partes = expandirVacaciones(fila, r);
    eventos.push(...partes);
  }

  return ordenar(recortarTodos(eventos, r, opciones.recortar !== false));
}

/** Las reuniones que tocan el rango, como eventos. */
export function reunionesDelRango(rango, filas = [], opciones = {}) {
  const r = leerRango(rango);
  if (!r) return [];
  const eventos = [];
  for (const fila of filas) {
    const ev = reunionAEvento(fila);
    if (ev && seTocan(ev.inicio, ev.fin, r.desde, r.hasta)) eventos.push(ev);
  }
  return ordenar(recortarTodos(eventos, r, opciones.recortar !== false));
}

/** Una fila de meetings_reuniones → evento (o null si está rota). */
export function reunionAEvento(fila) {
  if (!fila || typeof fila !== 'object') return null;
  const inicio = leerMomento(fila.inicio);
  const fin = leerMomento(fila.fin);
  if (!inicio || !fin || fin <= inicio) return null;
  const invitados = Array.isArray(fila.invitados) ? fila.invitados.filter((p) => typeof p === 'string') : [];
  const organiza = typeof fila.organiza === 'string' ? fila.organiza : '';
  return {
    id: `reunion-${fila.id}`,
    titulo: textoLimpio(fila.titulo) || 'Reunión',
    inicio,
    fin,
    tipo: 'reunion',
    persona: organiza,
    // Extras para la pantalla:
    filaId: fila.id,
    invitados,
    participantes: [...new Set([organiza, ...invitados].filter(Boolean))],
    notas: textoLimpio(fila.notas),
  };
}

// ───────────── Para preguntar «¿está libre?» ─────────────

/** ¿Este evento le toca a esa persona? (los de 'todos' le tocan a cualquiera; las reuniones, a sus participantes). */
export function esDePersona(evento, persona) {
  if (!evento) return false;
  if (evento.persona === TODOS) return true;
  if (evento.tipo === 'reunion') return (evento.participantes || [evento.persona]).includes(persona);
  return evento.persona === persona;
}

/** Los eventos de una persona (incluye los «para todos» y las reuniones donde está invitada). */
export function eventosDePersona(eventos, persona) {
  return eventos.filter((ev) => esDePersona(ev, persona));
}

/**
 * Lo que choca con un horario para una o varias personas.
 * @returns {object[]} los eventos que se pisan (vacío = libre)
 */
export function conflictos(eventos, personas, inicio, fin, { ignorarId } = {}) {
  const a = leerMomento(inicio);
  const b = leerMomento(fin);
  if (!a || !b || b <= a) return [];
  const lista = Array.isArray(personas) ? personas : [personas];
  return eventos.filter((ev) =>
    ev.id !== ignorarId &&
    seTocan(ev.inicio, ev.fin, a, b) &&
    lista.some((p) => esDePersona(ev, p)));
}

/** true si todas esas personas están libres en ese horario. */
export function estanLibres(eventos, personas, inicio, fin, opciones) {
  return conflictos(eventos, personas, inicio, fin, opciones).length === 0;
}

/**
 * Los huecos libres en común dentro de un rango (para proponer horario de reunión).
 * @param {number} minutosMinimos  descarta huecos más cortos que esto
 * @returns {{inicio: Date, fin: Date}[]}
 */
export function huecosLibres(eventos, personas, rango, minutosMinimos = 30) {
  const r = leerRango(rango);
  if (!r) return [];
  const lista = Array.isArray(personas) ? personas : [personas];
  const ocupados = eventos
    .filter((ev) => lista.some((p) => esDePersona(ev, p)) && seTocan(ev.inicio, ev.fin, r.desde, r.hasta))
    .map((ev) => [Math.max(+ev.inicio, +r.desde), Math.min(+ev.fin, +r.hasta)])
    .sort((x, y) => x[0] - y[0]);

  const huecos = [];
  let cursor = +r.desde;
  for (const [a, b] of ocupados) {
    if (a > cursor) huecos.push([cursor, a]);
    if (b > cursor) cursor = b;
  }
  if (cursor < +r.hasta) huecos.push([cursor, +r.hasta]);
  return huecos
    .filter(([a, b]) => b - a >= minutosMinimos * 60000)
    .map(([a, b]) => ({ inicio: new Date(a), fin: new Date(b) }));
}

// ───────────── Para dibujar ─────────────

/**
 * Corta los eventos que cruzan la medianoche en un pedazo por día (ej. la noche 22:00–07:00
 * queda en 22:00–24:00 de un día y 00:00–07:00 del siguiente).
 * Cada pedazo trae `dia` ('AAAA-MM-DD'), `diaEntero` (bool) y `original` (el evento sin cortar).
 * @returns {Map<string, object[]>} día → pedazos, ordenados por inicio
 */
export function partirPorDia(eventos) {
  const porDia = new Map();
  for (const ev of eventos) {
    let cursor = new Date(ev.inicio);
    while (cursor < ev.fin) {
      const medianoche = sumarDias(inicioDelDia(cursor), 1);
      const corte = ev.fin < medianoche ? ev.fin : medianoche;
      const dia = fechaTexto(cursor);
      const pedazo = {
        ...ev,
        inicio: new Date(cursor),
        fin: new Date(corte),
        dia,
        diaEntero: +cursor === +inicioDelDia(cursor) && +corte === +medianoche,
        original: ev,
      };
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(pedazo);
      cursor = corte;
    }
  }
  for (const lista of porDia.values()) ordenar(lista);
  return porDia;
}

/** Texto corto para un bloqueo, ej. «Todos los lunes de 10:00 a 19:00». Sirve para listar las reglas de cada uno. */
export function describirBloqueo(fila) {
  if (!fila) return '';
  const horas = fila.hora_desde && fila.hora_hasta
    ? `de ${horaCorta(fila.hora_desde)} a ${horaCorta(fila.hora_hasta)}`
    : 'todo el día';
  const todos = fila.para_todos ? ' (para todos)' : '';
  if (fila.tipo === 'semanal') {
    const dia = DIAS[normalizarDia(fila.dia_semana)];
    if (!dia) return `Cada semana ${horas}${todos}`;
    return `Todos los ${dia.endsWith('s') ? dia : dia + 's'} ${horas}${todos}`;
  }
  if (fila.tipo === 'vacaciones') {
    return `Vacaciones del ${fechaCorta(fila.fecha_desde)} al ${fechaCorta(fila.fecha_hasta || fila.fecha_desde)}${todos}`;
  }
  if (fila.tipo === 'puntual') {
    const hasta = fila.fecha_hasta && fila.fecha_hasta !== fila.fecha_desde ? ` al ${fechaCorta(fila.fecha_hasta)}` : '';
    return `${hasta ? 'Del' : 'El'} ${fechaCorta(fila.fecha_desde)}${hasta} ${horas}${todos}`;
  }
  return '';
}

/**
 * Revisa una fila antes de guardarla. Devuelve un texto de error para mostrar, o '' si está bien.
 * (La base igual tiene que validar: esto es para avisar rápido en el formulario.)
 */
export function validarBloqueo(fila) {
  if (!fila || !['semanal', 'puntual', 'vacaciones'].includes(fila.tipo)) return 'Elegí qué tipo de bloqueo es.';
  if (!fila.para_todos && !PERSONAS.includes(fila.persona)) return 'Falta de quién es el bloqueo.';
  const conHoras = fila.hora_desde || fila.hora_hasta;
  if (conHoras && (minutosDeHora(fila.hora_desde) == null || minutosDeHora(fila.hora_hasta) == null)) {
    return 'Poné la hora de inicio y la de fin.';
  }
  if (conHoras && minutosDeHora(fila.hora_desde) === minutosDeHora(fila.hora_hasta)) {
    return 'La hora de inicio y la de fin no pueden ser iguales.';
  }
  if (fila.tipo === 'semanal') {
    if (normalizarDia(fila.dia_semana) == null) return 'Elegí el día de la semana.';
    if (!conHoras) return 'Poné de qué hora a qué hora.';
  } else {
    if (!leerFecha(fila.fecha_desde)) return 'Elegí la fecha.';
    if (fila.tipo === 'vacaciones' && !leerFecha(fila.fecha_hasta)) return 'Elegí hasta qué fecha.';
  }
  if (fila.fecha_desde && fila.fecha_hasta && leerFecha(fila.fecha_hasta) < leerFecha(fila.fecha_desde)) {
    return 'La fecha de fin no puede ser antes que la de inicio.';
  }
  return '';
}

// ───────────── Fechas (ayudas que también puede usar la pantalla) ─────────────

/** 'AAAA-MM-DD' de una fecha, en hora local. */
export function fechaTexto(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Lee 'AAAA-MM-DD' como medianoche LOCAL (new Date('2026-10-07') la toma en UTC y corre un día). */
export function leerFecha(valor) {
  if (valor instanceof Date) return isNaN(valor) ? null : inicioDelDia(valor);
  if (typeof valor !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

export function inicioDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Suma días respetando el cambio de horario (por eso no suma 24 h a mano). */
export function sumarDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
}

/** El lunes a las 00:00 de la semana de esa fecha. */
export function inicioDeSemana(fecha) {
  const d = inicioDelDia(fecha);
  return sumarDias(d, -((d.getDay() + 6) % 7));
}

// ───────────── Por dentro ─────────────

function expandirSemanal(fila, r) {
  const dia = normalizarDia(fila.dia_semana);
  const desde = minutosDeHora(fila.hora_desde);
  const hasta = minutosDeHora(fila.hora_hasta);
  if (dia == null || desde == null || hasta == null || desde === hasta) return [];
  const validoDesde = leerFecha(fila.fecha_desde);
  const validoHasta = leerFecha(fila.fecha_hasta);

  const eventos = [];
  // Arranca un día antes para agarrar lo que cruza la medianoche y cae al principio del rango.
  for (let d = sumarDias(inicioDelDia(r.desde), -1); d < r.hasta; d = sumarDias(d, 1)) {
    if (d.getDay() !== dia) continue;
    if (validoDesde && d < validoDesde) continue;
    if (validoHasta && d > validoHasta) continue;
    const ev = armarBloqueo(fila, d, desde, hasta);
    if (seTocan(ev.inicio, ev.fin, r.desde, r.hasta)) eventos.push(ev);
  }
  return eventos;
}

function expandirPuntual(fila, r) {
  const primero = leerFecha(fila.fecha_desde);
  if (!primero) return [];
  const ultimo = leerFecha(fila.fecha_hasta) || primero;
  if (ultimo < primero) return [];

  const desde = minutosDeHora(fila.hora_desde);
  const hasta = minutosDeHora(fila.hora_hasta);
  // Sin horas (o con horas rotas): el día entero, como las vacaciones.
  if (desde == null || hasta == null || desde === hasta) {
    return diasEnteros(fila, primero, ultimo, r);
  }
  const eventos = [];
  for (let d = primero; d <= ultimo; d = sumarDias(d, 1)) {
    const ev = armarBloqueo(fila, d, desde, hasta);
    if (seTocan(ev.inicio, ev.fin, r.desde, r.hasta)) eventos.push(ev);
  }
  return eventos;
}

function expandirVacaciones(fila, r) {
  const primero = leerFecha(fila.fecha_desde);
  if (!primero) return [];
  const ultimo = leerFecha(fila.fecha_hasta) || primero;
  if (ultimo < primero) return [];
  return diasEnteros(fila, primero, ultimo, r);
}

// Un solo evento de primero 00:00 a (ultimo + 1) 00:00. partirPorDia lo corta por día si hace falta.
function diasEnteros(fila, primero, ultimo, r) {
  const inicio = primero;
  const fin = sumarDias(ultimo, 1);
  if (!seTocan(inicio, fin, r.desde, r.hasta)) return [];
  return [{
    ...baseBloqueo(fila),
    id: `bloqueo-${fila.id}-${fechaTexto(primero)}`,
    inicio,
    fin,
  }];
}

function armarBloqueo(fila, dia, desde, hasta) {
  const inicio = conMinutos(dia, desde);
  // hasta <= desde → termina al día siguiente (ej. 22:00 a 07:00). 24:00 = medianoche siguiente.
  const fin = hasta > desde ? conMinutos(dia, hasta) : conMinutos(sumarDias(dia, 1), hasta);
  return {
    ...baseBloqueo(fila),
    id: `bloqueo-${fila.id}-${fechaTexto(dia)}`,
    inicio,
    fin,
  };
}

function baseBloqueo(fila) {
  const motivo = textoLimpio(fila.motivo);
  const titulo = motivo || (fila.tipo === 'vacaciones' ? 'Vacaciones' : 'Ocupado');
  return {
    titulo,
    tipo: 'bloqueo',
    persona: fila.para_todos ? TODOS : fila.persona,
    // Extras para la pantalla:
    filaId: fila.id,
    de: fila.persona,          // quién lo cargó (aunque sea «para todos»)
    clase: fila.tipo,          // 'semanal' | 'puntual' | 'vacaciones' | 'noche'
    paraTodos: Boolean(fila.para_todos),
  };
}

function nocheDelRango(r, noche) {
  const desde = minutosDeHora(noche.desde);
  const hasta = minutosDeHora(noche.hasta);
  if (desde == null || hasta == null || desde === hasta) return [];
  const eventos = [];
  for (let d = sumarDias(inicioDelDia(r.desde), -1); d < r.hasta; d = sumarDias(d, 1)) {
    const inicio = conMinutos(d, desde);
    const fin = hasta > desde ? conMinutos(d, hasta) : conMinutos(sumarDias(d, 1), hasta);
    if (!seTocan(inicio, fin, r.desde, r.hasta)) continue;
    eventos.push({
      id: `noche-${fechaTexto(d)}`,
      titulo: noche.titulo || NOCHE.titulo,
      inicio,
      fin,
      tipo: 'bloqueo',
      persona: TODOS,
      filaId: null,
      de: null,
      clase: 'noche',
      paraTodos: true,
    });
  }
  return eventos;
}

function recortarTodos(eventos, r, recortar) {
  if (!recortar) return eventos;
  return eventos.map((ev) => {
    if (ev.inicio >= r.desde && ev.fin <= r.hasta) return ev;
    return {
      ...ev,
      inicio: ev.inicio < r.desde ? new Date(r.desde) : ev.inicio,
      fin: ev.fin > r.hasta ? new Date(r.hasta) : ev.fin,
      recortado: true,
    };
  });
}

function leerRango(rango) {
  if (!rango) return null;
  const desde = leerMomento(rango.desde);
  const hasta = leerMomento(rango.hasta);
  if (!desde || !hasta || hasta <= desde) return null;
  return { desde, hasta };
}

// Fechas solas ('AAAA-MM-DD') en hora local; el resto (timestamptz, Date) tal cual.
function leerMomento(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return leerFecha(valor);
  const d = new Date(valor);
  return isNaN(d) ? null : d;
}

// 'HH:MM' o 'HH:MM:SS' → minutos desde la medianoche (0 a 1440). null si no se entiende.
function minutosDeHora(valor) {
  if (typeof valor !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(valor.trim());
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

function conMinutos(dia, minutos) {
  const d = new Date(dia);
  d.setHours(0, minutos, 0, 0); // setHours(0, 600) = 10:00; 1440 = medianoche siguiente
  return d;
}

function normalizarDia(valor) {
  const n = Number(valor);
  if (valor === null || valor === '' || !Number.isInteger(n) || n < 0 || n > 7) return null;
  return n % 7; // 7 (domingo ISO) → 0
}

function seTocan(a1, b1, a2, b2) {
  return a1 < b2 && b1 > a2;
}

function ordenar(eventos) {
  return eventos.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin || String(x.id).localeCompare(String(y.id)));
}

function textoLimpio(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function horaCorta(valor) {
  const m = minutosDeHora(valor);
  return m == null ? '?' : `${dos(Math.floor(m / 60))}:${dos(m % 60)}`;
}

function fechaCorta(valor) {
  const d = leerFecha(valor);
  return d ? `${d.getDate()}/${d.getMonth() + 1}` : '?';
}

function dos(n) {
  return String(n).padStart(2, '0');
}
