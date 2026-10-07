// Meetings: pestaña propia (#/meetings), compartida en vivo entre los tres.
// Arriba, el calendario de todos (reuniones + horarios ocupados de cada uno + la noche, que es de todos).
// Abajo, «Mi calendario»: cada uno carga sus bloqueos (cada semana, un día, vacaciones, «para todos»)
// y sus reuniones con invitados; lo que guarda se ve arriba al toque (y en las compus de los otros, en vivo).
// Datos: tablas meetings_reuniones y meetings_bloqueos (supabase/meetings.sql). Sin Supabase, modo prueba en esta compu.
// Las reglas (qué está ocupado cuándo) viven en src/meetings/horarios.js; el dibujo, en src/meetings/calendario.js.
import '../estilos/meetings.css';
import { crearCalendario } from '../meetings/calendario.js';
import {
  eventosDelRango,
  eventosDePersona,
  conflictos,
  describirBloqueo,
  validarBloqueo,
  fechaTexto,
  leerFecha,
  sumarDias,
  inicioDelDia,
  PERSONAS,
  TODOS,
  NOCHE,
} from '../meetings/horarios.js';

// Días para elegir, en el orden de acá (arranca el lunes). valor = getDay() (0 = domingo).
const DIAS_SEMANA = [
  { valor: 1, corto: 'Lun', largo: 'lunes' },
  { valor: 2, corto: 'Mar', largo: 'martes' },
  { valor: 3, corto: 'Mié', largo: 'miércoles' },
  { valor: 4, corto: 'Jue', largo: 'jueves' },
  { valor: 5, corto: 'Vie', largo: 'viernes' },
  { valor: 6, corto: 'Sáb', largo: 'sábado' },
  { valor: 0, corto: 'Dom', largo: 'domingo' },
];
const TIPOS_BLOQUEO = [
  { valor: 'semanal', nombre: 'Cada semana' },
  { valor: 'puntual', nombre: 'Un día' },
  { valor: 'vacaciones', nombre: 'Vacaciones' },
];
// Los bloqueos que arma «Mi horario disponible» llevan este motivo (así se pueden reemplazar después).
const MOTIVO_HORARIO = 'Fuera de mi horario';
// Lo que no es noche: el horario disponible se completa contra esto.
const DIA_DESDE = NOCHE.hasta; // 07:00
const DIA_HASTA = NOCHE.desde; // 22:00
const LARGO_TITULO = 120;
const LARGO_MOTIVO = 80;
const LARGO_NOTAS = 500;

export function iniciar(app) {
  const estado = {
    datos: { reuniones: [], bloqueos: [] },
    cargado: false,
    error: false,
    sinInternet: typeof navigator !== 'undefined' && navigator.onLine === false,
    verA: new Set(PERSONAS), // a quiénes se ve en el calendario de todos
    armado: false,
  };
  let fuente = null;
  let partes = null;
  let esperando = null;

  app.registrarPantalla({
    ruta: 'meetings',
    titulo: 'Meetings',
    orden: 38,
    mostrar({ zona }) {
      if (!estado.armado) {
        estado.armado = true;
        fuente = app.conectado ? fuenteSupabase(app) : fuentePrueba(app);
        partes = armar(zona);
        fuente.escuchar(() => recargar());
        app.escuchar('personas', () => dibujarTodo());
        app.escuchar('persona', () => dibujarTodo());
        window.addEventListener('online', () => {
          estado.sinInternet = false;
          dibujarAviso();
          recargar(0);
        });
        window.addEventListener('offline', () => {
          estado.sinInternet = true;
          dibujarAviso();
        });
      }
      recargar(0);
    },
  });

  const yo = () => app.persona?.slug ?? '';
  const nombreDe = (slug) => (slug === TODOS ? 'Todos' : app.buscarPersona(slug)?.nombre ?? slug);
  const personasParaCal = () => app.personas.map((p) => ({ slug: p.slug, nombre: p.nombre }));

  // ── Datos ────────────────────────────────────────────

  // Junta varios avisos seguidos (ej. tres bloqueos guardados de una) en una sola recarga.
  function recargar(demora = 250) {
    clearTimeout(esperando);
    esperando = setTimeout(traer, demora);
  }

  async function traer() {
    try {
      estado.datos = await fuente.traer();
      estado.error = false;
      estado.cargado = true;
    } catch (e) {
      console.error('[meetings]', e);
      estado.error = true;
    }
    dibujarTodo();
  }

  /** Los eventos (con la noche) de un rango, ya con el formato que entiende el calendario. */
  function eventosPara(rango) {
    return eventosDelRango(rango, estado.datos, { recortar: false }).map(aEventoDeCalendario);
  }

  function aEventoDeCalendario(ev) {
    const esReunion = ev.tipo === 'reunion';
    let tipo = 'bloqueo';
    if (ev.clase === 'vacaciones') tipo = 'vacaciones';
    if (ev.clase === 'noche') tipo = 'horario';
    return {
      id: ev.id,
      titulo: ev.titulo,
      inicio: ev.inicio,
      fin: ev.fin,
      tipo: esReunion ? 'reunion' : tipo,
      persona: esReunion ? ev.participantes : ev.persona,
      regla: ev, // el evento de horarios.js, para el detalle
    };
  }

  // ── Armado (una sola vez) ────────────────────────────

  function armar(zona) {
    const nuevaReunion = el('button', { type: 'button', class: 'boton' }, 'Nueva reunión');
    nuevaReunion.addEventListener('click', () => abrirReunion());

    const cabeza = el('header', { class: 'cabeza-pantalla' },
      el('div', {},
        el('p', { class: 'cabeza-pantalla__ante' }, 'Entre los tres'),
        el('h1', {}, 'Meetings'),
        el('p', { class: 'cabeza-pantalla__bajada' },
          'Las reuniones y los horarios ocupados de los tres. Lo que cargás abajo, en «Mi calendario», aparece arriba para todos.')),
      el('div', { class: 'cabeza-pantalla__acciones' },
        el('span', { class: 'mt-envivo' }, el('span', { class: 'mt-envivo__punto', 'aria-hidden': 'true' }), 'En vivo'),
        nuevaReunion),
    );

    const aviso = el('div', { class: 'mt-aviso', role: 'status', hidden: '' });

    // Calendario de todos
    const filtro = el('div', { class: 'mt-filtro', role: 'group', 'aria-label': 'A quién ver en el calendario de todos' });
    filtro.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ver]');
      if (!b) return;
      const slug = b.dataset.ver;
      if (slug === TODOS) {
        estado.verA = new Set(PERSONAS);
      } else if (estado.verA.size === PERSONAS.length) {
        // Con todos prendidos, tocar a uno = ver solo a ese.
        estado.verA = new Set([slug]);
      } else if (estado.verA.has(slug)) {
        estado.verA.delete(slug);
        if (!estado.verA.size) estado.verA = new Set(PERSONAS);
      } else {
        estado.verA.add(slug);
      }
      dibujarFiltro();
      dibujarConjunto();
    });
    const zonaConjunto = el('div', { class: 'mt-cal' });
    const conjunto = el('section', { class: 'seccion mt-seccion', 'aria-labelledby': 'mt-titulo-todos' },
      el('div', { class: 'seccion__cabeza mt-seccion__cabeza' },
        el('h2', { id: 'mt-titulo-todos', class: 'seccion__titulo' }, 'Calendario de todos'),
        filtro),
      el('p', { class: 'mt-pista' }, 'Rayado = ocupado. La noche (de 22 a 7) está bloqueada para todos. Tocá un horario libre para armar una reunión.'),
      zonaConjunto,
    );

    // Mi calendario
    const quienSoy = el('span', { class: 'mt-yo' });
    const botonBloquear = el('button', { type: 'button', class: 'boton boton--chico' }, 'Bloquear horario');
    botonBloquear.addEventListener('click', () => abrirBloqueo());
    const botonHorario = el('button', { type: 'button', class: 'boton boton--suave boton--chico' }, 'Mi horario disponible');
    botonHorario.addEventListener('click', () => abrirHorario());
    const botonReunion = el('button', { type: 'button', class: 'boton boton--suave boton--chico' }, 'Nueva reunión');
    botonReunion.addEventListener('click', () => abrirReunion());

    const zonaMia = el('div', { class: 'mt-cal' });
    const listaBloqueos = el('ul', { class: 'mt-lista', 'aria-labelledby': 'mt-titulo-bloqueos' });
    const listaReuniones = el('ul', { class: 'mt-lista', 'aria-labelledby': 'mt-titulo-reuniones' });
    const cuentaBloqueos = el('span', { class: 'seccion__cuenta' });
    const cuentaReuniones = el('span', { class: 'seccion__cuenta' });

    const mio = el('section', { class: 'seccion mt-seccion mt-mio', 'aria-labelledby': 'mt-titulo-mio' },
      el('div', { class: 'seccion__cabeza mt-seccion__cabeza' },
        el('h2', { id: 'mt-titulo-mio', class: 'seccion__titulo mt-mio__titulo' }, quienSoy, 'Mi calendario'),
        el('div', { class: 'fila' }, botonBloquear, botonHorario, botonReunion)),
      el('p', { class: 'mt-pista' }, 'Acá ves lo tuyo (y lo que es para todos). Tocá un horario — o arrastrá con el mouse — para bloquearlo o armar una reunión.'),
      zonaMia,
      el('div', { class: 'mt-listas' },
        el('div', { class: 'tarjeta mt-caja' },
          el('div', { class: 'tarjeta__cabeza' },
            el('h3', { id: 'mt-titulo-bloqueos', class: 'tarjeta__titulo' }, 'Mis horarios ocupados'), cuentaBloqueos),
          listaBloqueos),
        el('div', { class: 'tarjeta mt-caja' },
          el('div', { class: 'tarjeta__cabeza' },
            el('h3', { id: 'mt-titulo-reuniones', class: 'tarjeta__titulo' }, 'Mis próximas reuniones'), cuentaReuniones),
          listaReuniones)),
    );

    const dialogos = {
      bloqueo: armarDialogoBloqueo(),
      reunion: armarDialogoReunion(),
      horario: armarDialogoHorario(),
      elegir: armarDialogoElegir(),
      detalle: armarDialogoDetalle(),
    };

    zona.classList.add('meetings');
    zona.replaceChildren(cabeza, aviso, conjunto, mio, ...Object.values(dialogos).map((d) => d.dialogo));

    // Los dos calendarios. Cada uno se mueve por su cuenta (semana/mes) y pide sus eventos al cambiar.
    const calTodos = crearCalendario(zonaConjunto, {
      etiqueta: 'Calendario de todos',
      personas: personasParaCal(),
      alCambiar: () => dibujarConjunto(),
      alElegirFranja: ({ inicio, fin }) => abrirReunion({ inicio, fin }),
      alElegirDia: (fecha) => irAlDia(calTodos, fecha),
      alElegirEvento: (ev) => abrirDetalle(ev),
    });
    const calMio = crearCalendario(zonaMia, {
      etiqueta: 'Mi calendario',
      leyenda: false,
      personas: personasParaCal(),
      alCambiar: () => dibujarMio(),
      alElegirFranja: (franja) => abrirElegir(franja),
      alElegirDia: (fecha) => irAlDia(calMio, fecha),
      alElegirEvento: (ev) => abrirDetalle(ev),
    });

    return {
      aviso, filtro, quienSoy, listaBloqueos, listaReuniones, cuentaBloqueos, cuentaReuniones,
      botones: [nuevaReunion, botonBloquear, botonHorario, botonReunion],
      calTodos, calMio, dialogos,
    };
  }

  // En el mes, tocar un día lleva a esa semana.
  function irAlDia(cal, fecha) {
    if (cal.vista() === 'mes') cal.cambiarVista('semana');
    cal.irA(fecha);
  }

  // ── Dibujar ──────────────────────────────────────────

  function dibujarTodo() {
    if (!partes) return;
    dibujarAviso();
    dibujarFiltro();
    partes.calTodos.ponerPersonas(personasParaCal());
    partes.calMio.ponerPersonas(personasParaCal());
    dibujarConjunto();
    dibujarMio();
    dibujarListas();
  }

  function dibujarAviso() {
    if (!partes) return;
    const { aviso } = partes;
    let texto = '';
    let tipo = 'info';
    if (estado.sinInternet) {
      texto = 'Estás sin internet. Lo que ves puede estar viejo y no se puede guardar nada hasta que vuelva la conexión.';
      tipo = 'error';
    } else if (estado.error) {
      texto = estado.cargado
        ? 'Se cortó la conexión con la base: lo que ves puede estar viejo. Probá recargar la página.'
        : 'No pude traer los calendarios. ¿Ya se corrió supabase/meetings.sql en Supabase? Probá recargar la página.';
      tipo = 'error';
    } else if (!app.conectado) {
      texto = 'Modo prueba: lo que cargues queda solo en esta compu (y se ve en otras pestañas).';
    }
    aviso.hidden = !texto;
    aviso.textContent = texto;
    aviso.dataset.tipo = tipo;
    aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    // Sin internet no se puede guardar: los botones de cargar se apagan.
    for (const b of partes.botones) b.disabled = estado.sinInternet;
  }

  function dibujarFiltro() {
    const todos = estado.verA.size === PERSONAS.length;
    const botones = [
      el('button', { type: 'button', class: 'mt-filtro__boton', 'data-ver': TODOS, 'aria-pressed': String(todos) }, 'Los tres'),
      ...app.personas
        .filter((p) => PERSONAS.includes(p.slug))
        .map((p) => el('button', {
          type: 'button', class: 'mt-filtro__boton', 'data-ver': p.slug, 'data-de': p.slug,
          'aria-pressed': String(!todos && estado.verA.has(p.slug)),
          title: `Ver a ${p.nombre}`,
        }, el('span', { class: 'punto', 'aria-hidden': 'true' }), p.nombre)),
    ];
    partes.filtro.replaceChildren(...botones);
  }

  function dibujarConjunto() {
    if (!partes) return;
    const lista = eventosPara(partes.calTodos.rango()).filter((ev) => {
      const quienes = Array.isArray(ev.persona) ? ev.persona : [ev.persona];
      return quienes.includes(TODOS) || quienes.some((p) => estado.verA.has(p));
    });
    partes.calTodos.ponerEventos(lista);
  }

  function dibujarMio() {
    if (!partes) return;
    const rango = partes.calMio.rango();
    const mios = eventosDePersona(eventosDelRango(rango, estado.datos, { recortar: false }), yo());
    partes.calMio.ponerEventos(mios.map(aEventoDeCalendario));
  }

  function dibujarListas() {
    if (!partes) return;
    const persona = app.persona;
    partes.quienSoy.replaceChildren(
      el('span', { class: 'avatar avatar--chico', 'data-de': persona?.slug, 'aria-hidden': 'true' }, inicial(persona?.nombre)));

    // Mis bloqueos (los que cargué yo), ordenados: semanales por día, después por fecha.
    const orden = { semanal: 0, puntual: 1, vacaciones: 2 };
    const posDia = (d) => DIAS_SEMANA.findIndex((x) => x.valor === Number(d) % 7);
    const bloqueos = estado.datos.bloqueos
      .filter((b) => b.persona === yo())
      .sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9)
        || posDia(a.dia_semana) - posDia(b.dia_semana)
        || String(a.fecha_desde ?? '').localeCompare(String(b.fecha_desde ?? ''))
        || String(a.hora_desde ?? '').localeCompare(String(b.hora_desde ?? '')));
    partes.cuentaBloqueos.textContent = bloqueos.length ? String(bloqueos.length) : '';

    const nocheItem = el('li', { class: 'mt-item mt-item--fijo' },
      el('div', { class: 'mt-item__texto' },
        el('p', { class: 'mt-item__titulo' }, `Todas las noches de ${hora5(NOCHE.desde)} a ${hora5(NOCHE.hasta)}`),
        el('p', { class: 'mt-item__detalle' }, 'Para todos, ya viene puesto.')));

    partes.listaBloqueos.replaceChildren(
      ...bloqueos.map(itemBloqueo),
      nocheItem,
    );
    if (!bloqueos.length) {
      partes.listaBloqueos.prepend(el('li', { class: 'mt-vacio' },
        estado.cargado || !app.conectado
          ? 'Todavía no cargaste horarios ocupados. Con «Bloquear horario» o «Mi horario disponible» los sumás.'
          : 'Cargando…'));
    }

    // Mis próximas reuniones (organizo o me invitaron)
    const ahora = new Date();
    const reuniones = estado.datos.reuniones
      .filter((r) => (r.organiza === yo() || (r.invitados ?? []).includes(yo())) && new Date(r.fin) >= ahora)
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))
      .slice(0, 12);
    partes.cuentaReuniones.textContent = reuniones.length ? String(reuniones.length) : '';
    partes.listaReuniones.replaceChildren(
      ...(reuniones.length
        ? reuniones.map(itemReunion)
        : [el('li', { class: 'mt-vacio' }, 'No tenés reuniones por delante. Tocá un horario libre arriba para armar una.')]),
    );
  }

  function itemBloqueo(fila) {
    const tipo = TIPOS_BLOQUEO.find((t) => t.valor === fila.tipo)?.nombre ?? '';
    const texto = el('div', { class: 'mt-item__texto' },
      el('p', { class: 'mt-item__titulo' }, describirBloqueo(fila).replace(' (para todos)', '')),
      el('p', { class: 'mt-item__detalle' },
        [tipo, fila.motivo?.trim()].filter(Boolean).join(' · ')),
    );
    if (fila.para_todos) texto.append(el('span', { class: 'etiqueta etiqueta--gris mt-item__marca' }, 'Para todos'));
    const editar = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico', 'aria-label': `Cambiar: ${describirBloqueo(fila)}` }, 'Cambiar');
    editar.addEventListener('click', () => abrirBloqueo({ fila }));
    const borrar = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico mt-borrar', 'aria-label': `Borrar: ${describirBloqueo(fila)}` }, 'Borrar');
    borrar.addEventListener('click', () => borrarBloqueo(fila, borrar));
    return el('li', { class: `mt-item mt-item--${fila.tipo}`, 'data-de': fila.persona },
      texto, el('div', { class: 'mt-item__acciones' }, editar, borrar));
  }

  function itemReunion(fila) {
    const inicio = new Date(fila.inicio);
    const fin = new Date(fila.fin);
    const organizo = fila.organiza === yo();
    const otros = [fila.organiza, ...(fila.invitados ?? [])].filter((s) => s && s !== yo());
    const detalle = organizo
      ? (otros.length ? `Con ${listaDeNombres(otros.map(nombreDe))}` : 'Sin invitados del equipo')
      : `Te invitó ${nombreDe(fila.organiza)}`;

    const item = el('li', { class: 'mt-item mt-item--reunion', 'data-de': fila.organiza },
      el('time', { class: 'mt-fecha', datetime: inicio.toISOString() },
        el('span', { class: 'mt-fecha__dia' }, inicio.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')),
        el('span', { class: 'mt-fecha__numero' }, String(inicio.getDate())),
        el('span', { class: 'mt-fecha__mes' }, inicio.toLocaleDateString('es-AR', { month: 'short' }).replace('.', ''))),
      el('div', { class: 'mt-item__texto' },
        el('p', { class: 'mt-item__titulo' }, fila.titulo || 'Reunión'),
        el('p', { class: 'mt-item__detalle' }, `${horaDe(inicio)} a ${horaDe(fin)} · ${detalle}`)),
    );
    const acciones = el('div', { class: 'mt-item__acciones' });
    if (organizo) {
      const editar = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico', 'aria-label': `Cambiar la reunión «${fila.titulo}»` }, 'Cambiar');
      editar.addEventListener('click', () => abrirReunion({ fila }));
      const borrar = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico mt-borrar', 'aria-label': `Borrar la reunión «${fila.titulo}»` }, 'Borrar');
      borrar.addEventListener('click', () => borrarReunion(fila, borrar));
      acciones.append(editar, borrar);
    } else {
      const ver = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico', 'aria-label': `Ver la reunión «${fila.titulo}»` }, 'Ver');
      ver.addEventListener('click', () => abrirDetalle(aEventoDeCalendario(reunionComoEvento(fila))));
      acciones.append(ver);
    }
    item.append(acciones);
    return item;
  }

  // ── Guardar y borrar (con lo de la pantalla al día al toque) ──

  function sePuedeGuardar() {
    if (estado.sinInternet) {
      app.avisar('Estás sin internet: no se puede guardar ahora.', 'error');
      return false;
    }
    return true;
  }

  async function borrarBloqueo(fila, boton) {
    if (!sePuedeGuardar()) return;
    if (!confirm(`¿Borrar «${describirBloqueo(fila)}»? Deja de verse para los tres.`)) return;
    if (boton) boton.disabled = true;
    try {
      await fuente.borrarBloqueo(fila.id);
      estado.datos.bloqueos = estado.datos.bloqueos.filter((b) => b.id !== fila.id);
      dibujarTodo();
      app.avisar('Listo, se liberó ese horario.', 'ok');
      recargar();
      return true;
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo borrar. Fijate la conexión y probá de nuevo.', 'error');
      if (boton) boton.disabled = false;
      return false;
    }
  }

  async function borrarReunion(fila, boton) {
    if (!sePuedeGuardar()) return;
    if (!confirm(`¿Borrar la reunión «${fila.titulo}»? Se borra para los tres.`)) return;
    if (boton) boton.disabled = true;
    try {
      await fuente.borrarReunion(fila.id);
      estado.datos.reuniones = estado.datos.reuniones.filter((r) => r.id !== fila.id);
      dibujarTodo();
      app.avisar('Reunión borrada.', 'ok');
      recargar();
      return true;
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo borrar. Fijate la conexión y probá de nuevo.', 'error');
      if (boton) boton.disabled = false;
      return false;
    }
  }

  // ── Ventanita: ¿qué cargás en este horario? (Mi calendario) ──

  function armarDialogoElegir() {
    const titulo = el('h2', { id: 'mt-elegir-titulo', class: 'mt-dialogo__titulo' }, '¿Qué cargás?');
    const cuando = el('p', { class: 'dialogo__nota mt-elegir__cuando' });
    const bloquear = el('button', { type: 'button', class: 'boton' }, 'Bloquear este horario');
    const reunion = el('button', { type: 'button', class: 'boton boton--suave' }, 'Armar una reunión');
    const cancelar = el('button', { type: 'button', class: 'boton boton--fantasma' }, 'Cancelar');
    const dialogo = el('dialog', { class: 'dialogo', 'aria-labelledby': 'mt-elegir-titulo' },
      el('div', { class: 'dialogo__cuerpo' }, titulo, cuando,
        el('div', { class: 'dialogo__botones mt-elegir__botones' }, bloquear, reunion, cancelar)));
    let franja = null;
    bloquear.addEventListener('click', () => {
      dialogo.close();
      abrirBloqueo({ franja });
    });
    reunion.addEventListener('click', () => {
      dialogo.close();
      abrirReunion(franja);
    });
    cancelar.addEventListener('click', () => dialogo.close());
    return {
      dialogo,
      abrir(f) {
        franja = f;
        cuando.textContent = `${capitalizar(diaLargo(f.inicio))}, de ${horaDe(f.inicio)} a ${horaDe(f.fin)}.`;
        dialogo.showModal();
        bloquear.focus();
      },
    };
  }

  function abrirElegir(franja) {
    if (!sePuedeGuardar()) return;
    partes.dialogos.elegir.abrir(franja);
  }

  // ── Ventanita: bloqueo (crear / cambiar) ──

  function armarDialogoBloqueo() {
    const id = 'mt-bloqueo';
    const titulo = el('h2', { id: `${id}-titulo`, class: 'mt-dialogo__titulo' }, 'Bloquear horario');

    const tipos = el('fieldset', { class: 'mt-segmentos' },
      el('legend', { class: 'mt-legend' }, 'Qué es'),
      ...TIPOS_BLOQUEO.map((t) => el('label', { class: 'mt-segmentos__opcion' },
        el('input', { type: 'radio', name: 'tipo', value: t.valor }), el('span', {}, t.nombre))));

    const dias = elegirDias(`${id}-dias`, 'Qué días');
    const fecha = campo({ id: `${id}-fecha`, nombre: 'fecha_desde', etiqueta: 'Día', tipo: 'date' });
    const fechaHasta = campo({ id: `${id}-fecha-hasta`, nombre: 'fecha_hasta', etiqueta: 'Hasta (inclusive)', tipo: 'date' });
    const fechas = el('div', { class: 'mt-dos' }, fecha.caja, fechaHasta.caja);

    const todoElDia = el('label', { class: 'mt-casilla' },
      el('input', { type: 'checkbox', name: 'todo_el_dia' }), el('span', {}, 'Todo el día'));
    const desde = campo({ id: `${id}-desde`, nombre: 'hora_desde', etiqueta: 'Desde', tipo: 'time', paso: 900 });
    const hasta = campo({ id: `${id}-hasta`, nombre: 'hora_hasta', etiqueta: 'Hasta', tipo: 'time', paso: 900 });
    const horas = el('div', { class: 'mt-horas' },
      el('div', { class: 'mt-dos' }, desde.caja, hasta.caja),
      el('p', { class: 'campo__ayuda mt-ayuda' }, 'Si termina antes de lo que empieza, pasa la medianoche (ej.: 23:00 a 01:00).'));

    const motivo = campo({ id: `${id}-motivo`, nombre: 'motivo', etiqueta: 'Motivo (opcional, lo ven los tres)', max: LARGO_MOTIVO, ejemplo: 'Ej.: Facultad, médico, partido' });
    const paraTodos = el('label', { class: 'mt-casilla mt-casilla--destacada' },
      el('input', { type: 'checkbox', name: 'para_todos' }),
      el('span', {}, el('strong', {}, 'Para todos'), ' — bloquea este horario a los tres (ej.: un feriado o algo del equipo).'));

    const error = el('p', { class: 'campo__error mt-error', role: 'alert', hidden: '' });
    const guardar = el('button', { type: 'submit', class: 'boton' }, 'Guardar');
    const cancelar = el('button', { type: 'button', class: 'boton boton--suave' }, 'Cancelar');
    const borrar = el('button', { type: 'button', class: 'boton boton--peligro mt-dialogo__borrar' }, 'Borrar');

    const form = el('form', { class: 'dialogo__cuerpo mt-form', novalidate: '' },
      titulo, tipos, dias.caja, fechas, todoElDia, horas, motivo.caja, paraTodos, error,
      el('div', { class: 'dialogo__botones' }, guardar, cancelar, borrar));
    const dialogo = el('dialog', { class: 'dialogo mt-dialogo', 'aria-labelledby': `${id}-titulo` }, form);

    let editando = null;

    // Muestra solo lo que va con cada tipo.
    function acomodar() {
      const tipo = form.elements.tipo.value;
      const entero = tipo === 'vacaciones' || (tipo === 'puntual' && form.elements.todo_el_dia.checked);
      dias.caja.hidden = tipo !== 'semanal';
      fechas.hidden = tipo === 'semanal';
      fechaHasta.caja.hidden = tipo !== 'vacaciones';
      fecha.etiqueta.textContent = tipo === 'vacaciones' ? 'Desde' : 'Día';
      todoElDia.hidden = tipo !== 'puntual';
      horas.hidden = entero;
      limpiarError();
    }
    function limpiarError() {
      error.hidden = true;
      error.textContent = '';
    }
    function mostrar(texto) {
      error.textContent = texto;
      error.hidden = false;
    }

    form.addEventListener('change', acomodar);
    cancelar.addEventListener('click', () => dialogo.close());
    borrar.addEventListener('click', async () => {
      if (editando && (await borrarBloqueo(editando))) dialogo.close();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sePuedeGuardar()) return;
      const f = form.elements;
      const tipo = f.tipo.value;
      const entero = tipo === 'vacaciones' || (tipo === 'puntual' && f.todo_el_dia.checked);
      const base = {
        persona: yo(),
        tipo,
        dia_semana: null,
        hora_desde: entero ? null : f.hora_desde.value || null,
        hora_hasta: entero ? null : f.hora_hasta.value || null,
        fecha_desde: tipo === 'semanal' ? null : f.fecha_desde.value || null,
        fecha_hasta: tipo === 'vacaciones' ? f.fecha_hasta.value || null : null,
        motivo: f.motivo.value.trim().slice(0, LARGO_MOTIVO) || null,
        para_todos: f.para_todos.checked,
      };
      if (tipo === 'puntual' && base.fecha_desde) base.fecha_hasta = base.fecha_desde;

      // Cada semana: una fila por día elegido.
      let filas = [base];
      if (tipo === 'semanal') {
        const elegidos = dias.valores();
        if (!elegidos.length) return mostrar('Elegí al menos un día.');
        filas = elegidos.map((d) => ({ ...base, dia_semana: d }));
      }
      for (const fila of filas) {
        const problema = validarBloqueo(fila);
        if (problema) return mostrar(problema);
      }

      guardar.disabled = true;
      try {
        if (editando) {
          const [primera, ...resto] = filas;
          const cambiada = await fuente.cambiarBloqueo(editando.id, primera);
          const nuevas = resto.length ? await fuente.crearBloqueos(resto) : [];
          estado.datos.bloqueos = [
            ...estado.datos.bloqueos.map((b) => (b.id === editando.id ? cambiada : b)),
            ...nuevas,
          ];
        } else {
          estado.datos.bloqueos = [...estado.datos.bloqueos, ...(await fuente.crearBloqueos(filas))];
        }
        dibujarTodo();
        dialogo.close();
        app.avisar(base.para_todos ? 'Listo: quedó bloqueado para los tres.' : 'Listo: ya lo ven los otros dos.', 'ok');
        recargar();
      } catch (err) {
        console.error(err);
        mostrar('No se pudo guardar. Fijate la conexión y probá de nuevo.');
      } finally {
        guardar.disabled = false;
      }
    });

    return {
      dialogo,
      abrir({ fila = null, franja = null } = {}) {
        editando = fila;
        form.reset();
        titulo.textContent = fila ? 'Cambiar horario ocupado' : 'Bloquear horario';
        borrar.hidden = !fila;
        dias.caja.querySelector('legend').textContent = fila ? 'Qué días (si sumás otro, se agrega aparte)' : 'Qué días';
        if (fila) {
          form.elements.tipo.value = fila.tipo;
          dias.poner(fila.tipo === 'semanal' ? [Number(fila.dia_semana) % 7] : []);
          form.elements.fecha_desde.value = fila.fecha_desde ?? '';
          form.elements.fecha_hasta.value = fila.fecha_hasta ?? '';
          form.elements.todo_el_dia.checked = fila.tipo === 'puntual' && !fila.hora_desde;
          form.elements.hora_desde.value = hora5(fila.hora_desde);
          form.elements.hora_hasta.value = hora5(fila.hora_hasta);
          form.elements.motivo.value = fila.motivo ?? '';
          form.elements.para_todos.checked = Boolean(fila.para_todos);
        } else if (franja) {
          // Desde el calendario: ese día y ese horario.
          form.elements.tipo.value = 'puntual';
          form.elements.fecha_desde.value = fechaTexto(franja.inicio);
          form.elements.hora_desde.value = horaDe(franja.inicio);
          form.elements.hora_hasta.value = horaDe(franja.fin);
          dias.poner([franja.inicio.getDay()]);
        } else {
          form.elements.tipo.value = 'semanal';
          form.elements.fecha_desde.value = fechaTexto(new Date());
          form.elements.hora_desde.value = '10:00';
          form.elements.hora_hasta.value = '12:00';
          dias.poner([]);
        }
        acomodar();
        dialogo.showModal();
        form.querySelector('input[name="tipo"]:checked')?.focus();
      },
    };
  }

  function abrirBloqueo(opciones) {
    if (!sePuedeGuardar()) return;
    partes.dialogos.bloqueo.abrir(opciones);
  }

  // ── Ventanita: mi horario disponible (arma los bloqueos del resto del día) ──

  function armarDialogoHorario() {
    const id = 'mt-horario';
    const dias = elegirDias(`${id}-dias`, 'Qué días');
    const desde = campo({ id: `${id}-desde`, nombre: 'desde', etiqueta: 'Disponible desde', tipo: 'time', paso: 900 });
    const hasta = campo({ id: `${id}-hasta`, nombre: 'hasta', etiqueta: 'Hasta', tipo: 'time', paso: 900 });
    const explicacion = el('p', { class: 'dialogo__nota mt-horario__explica' });
    const error = el('p', { class: 'campo__error mt-error', role: 'alert', hidden: '' });
    const guardar = el('button', { type: 'submit', class: 'boton' }, 'Guardar mi horario');
    const cancelar = el('button', { type: 'button', class: 'boton boton--suave' }, 'Cancelar');

    const form = el('form', { class: 'dialogo__cuerpo mt-form', novalidate: '' },
      el('h2', { id: `${id}-titulo`, class: 'mt-dialogo__titulo' }, 'Mi horario disponible'),
      el('p', { class: 'dialogo__nota' },
        `Decí cuándo estás disponible y bloqueo el resto del día (entre las ${hora5(DIA_DESDE)} y las ${hora5(DIA_HASTA)}; la noche ya está bloqueada para todos).`),
      dias.caja,
      el('div', { class: 'mt-dos' }, desde.caja, hasta.caja),
      explicacion, error,
      el('div', { class: 'dialogo__botones' }, guardar, cancelar));
    const dialogo = el('dialog', { class: 'dialogo mt-dialogo', 'aria-labelledby': `${id}-titulo` }, form);

    // Los pedazos a bloquear para un horario disponible (fuera de la noche).
    function pedazos() {
      const a = form.elements.desde.value;
      const b = form.elements.hasta.value;
      if (!a || !b || b <= a) return null;
      const lista = [];
      if (a > DIA_DESDE) lista.push([DIA_DESDE, a < DIA_HASTA ? a : DIA_HASTA]);
      if (b < DIA_HASTA) lista.push([b > DIA_DESDE ? b : DIA_DESDE, DIA_HASTA]);
      return lista.filter(([x, y]) => y > x);
    }
    function contar() {
      error.hidden = true;
      const p = pedazos();
      if (!p) {
        explicacion.textContent = '';
        return;
      }
      explicacion.textContent = p.length
        ? `Se va a bloquear: ${p.map(([x, y]) => `de ${x} a ${y}`).join(' y ')}. Si ya tenías un horario cargado esos días, se reemplaza.`
        : 'Con ese horario no hace falta bloquear nada del día (solo la noche, que ya está).';
    }
    form.addEventListener('input', contar);
    form.addEventListener('change', contar);
    cancelar.addEventListener('click', () => dialogo.close());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sePuedeGuardar()) return;
      const elegidos = dias.valores();
      const mostrar = (t) => {
        error.textContent = t;
        error.hidden = false;
      };
      if (!elegidos.length) return mostrar('Elegí al menos un día.');
      const p = pedazos();
      if (!p) return mostrar('Poné desde qué hora y hasta qué hora estás disponible (la de fin, después de la de inicio).');

      const viejos = estado.datos.bloqueos.filter((b) =>
        b.persona === yo() && b.tipo === 'semanal' && b.motivo === MOTIVO_HORARIO && elegidos.includes(Number(b.dia_semana) % 7));
      const nuevos = elegidos.flatMap((d) => p.map(([x, y]) => ({
        persona: yo(), tipo: 'semanal', dia_semana: d, hora_desde: x, hora_hasta: y,
        fecha_desde: null, fecha_hasta: null, motivo: MOTIVO_HORARIO, para_todos: false,
      })));

      guardar.disabled = true;
      try {
        for (const v of viejos) await fuente.borrarBloqueo(v.id);
        const creados = nuevos.length ? await fuente.crearBloqueos(nuevos) : [];
        const borrados = new Set(viejos.map((v) => v.id));
        estado.datos.bloqueos = [...estado.datos.bloqueos.filter((b) => !borrados.has(b.id)), ...creados];
        dibujarTodo();
        dialogo.close();
        app.avisar('Listo: tu horario quedó cargado y ya lo ven los otros dos.', 'ok');
        recargar();
      } catch (err) {
        console.error(err);
        mostrar('No se pudo guardar. Fijate la conexión y probá de nuevo.');
        recargar(0);
      } finally {
        guardar.disabled = false;
      }
    });

    return {
      dialogo,
      abrir() {
        form.reset();
        dias.poner([1, 2, 3, 4, 5]);
        form.elements.desde.value = '09:00';
        form.elements.hasta.value = '18:00';
        contar();
        dialogo.showModal();
        form.elements.desde.focus();
      },
    };
  }

  function abrirHorario() {
    if (!sePuedeGuardar()) return;
    partes.dialogos.horario.abrir();
  }

  // ── Ventanita: reunión (crear / cambiar) ──

  function armarDialogoReunion() {
    const id = 'mt-reunion';
    const titulo = el('h2', { id: `${id}-titulo`, class: 'mt-dialogo__titulo' }, 'Nueva reunión');
    const nombre = campo({ id: `${id}-nombre`, nombre: 'titulo', etiqueta: 'De qué es', max: LARGO_TITULO, ejemplo: 'Ej.: Reunión con Juan (cliente)', requerido: true });
    const dia = campo({ id: `${id}-dia`, nombre: 'dia', etiqueta: 'Día', tipo: 'date', requerido: true });
    const desde = campo({ id: `${id}-desde`, nombre: 'desde', etiqueta: 'Desde', tipo: 'time', paso: 900, requerido: true });
    const hasta = campo({ id: `${id}-hasta`, nombre: 'hasta', etiqueta: 'Hasta', tipo: 'time', paso: 900, requerido: true });
    const invitados = el('fieldset', { class: 'mt-invitados' }, el('legend', { class: 'mt-legend' }, 'Del equipo, ¿quién más va?'));
    const notas = campo({ id: `${id}-notas`, nombre: 'notas', etiqueta: 'Notas (opcional)', max: LARGO_NOTAS, ejemplo: 'Link de Meet, dirección, de qué se habla…', area: true });
    const choques = el('div', { class: 'mt-choques', 'aria-live': 'polite' });
    const error = el('p', { class: 'campo__error mt-error', role: 'alert', hidden: '' });
    const guardar = el('button', { type: 'submit', class: 'boton' }, 'Guardar reunión');
    const cancelar = el('button', { type: 'button', class: 'boton boton--suave' }, 'Cancelar');
    const borrar = el('button', { type: 'button', class: 'boton boton--peligro mt-dialogo__borrar' }, 'Borrar');

    const form = el('form', { class: 'dialogo__cuerpo mt-form', novalidate: '' },
      titulo, nombre.caja,
      el('div', { class: 'mt-tres' }, dia.caja, desde.caja, hasta.caja),
      invitados, choques, notas.caja, error,
      el('div', { class: 'dialogo__botones' }, guardar, cancelar, borrar));
    const dialogo = el('dialog', { class: 'dialogo mt-dialogo', 'aria-labelledby': `${id}-titulo` }, form);

    let editando = null;

    function leer() {
      const f = form.elements;
      const inicio = f.dia.value && f.desde.value ? new Date(`${f.dia.value}T${f.desde.value}`) : null;
      const fin = f.dia.value && f.hasta.value ? new Date(`${f.dia.value}T${f.hasta.value}`) : null;
      const quienes = [...invitados.querySelectorAll('input:checked')].map((i) => i.value);
      return { inicio, fin, quienes };
    }

    // Avisa en vivo si a alguno ya le ocupa ese horario (no impide guardar: a veces se mueve otra cosa).
    function revisarChoques() {
      error.hidden = true;
      const { inicio, fin, quienes } = leer();
      if (!inicio || !fin || isNaN(inicio) || isNaN(fin) || fin <= inicio) {
        choques.replaceChildren();
        return;
      }
      const rango = { desde: sumarDias(inicioDelDia(inicio), -1), hasta: sumarDias(inicioDelDia(inicio), 2) };
      const eventos = eventosDelRango(rango, estado.datos, { recortar: false });
      const gente = [yo(), ...quienes];
      const lista = conflictos(eventos, gente, inicio, fin, { ignorarId: editando ? `reunion-${editando.id}` : undefined });
      if (!lista.length) {
        choques.replaceChildren(el('p', { class: 'mt-choques__ok' }, gente.length > 1 ? 'Están todos libres en ese horario.' : 'Estás libre en ese horario.'));
        return;
      }
      choques.replaceChildren(
        el('p', { class: 'mt-choques__titulo' }, 'Ojo, se pisa con:'),
        el('ul', {}, ...lista.slice(0, 5).map((ev) => {
          const afectados = ev.persona === TODOS ? 'Todos' : listaDeNombres(gente.filter((p) => (ev.participantes ?? [ev.persona]).includes(p)).map(nombreDe));
          return el('li', {}, `${afectados}: ${ev.titulo} (${horaDe(ev.inicio)} a ${horaDe(ev.fin)})`);
        })),
        el('p', { class: 'mt-choques__nota' }, 'Igual la podés guardar.'));
    }

    form.addEventListener('input', revisarChoques);
    form.addEventListener('change', revisarChoques);
    cancelar.addEventListener('click', () => dialogo.close());
    borrar.addEventListener('click', async () => {
      if (editando && (await borrarReunion(editando))) dialogo.close();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sePuedeGuardar()) return;
      const mostrar = (t, campoMal) => {
        error.textContent = t;
        error.hidden = false;
        campoMal?.focus();
      };
      const f = form.elements;
      const texto = f.titulo.value.trim();
      const { inicio, fin, quienes } = leer();
      if (!texto) return mostrar('Poné de qué es la reunión.', f.titulo);
      if (!inicio || isNaN(inicio)) return mostrar('Elegí el día y la hora de inicio.', f.dia);
      if (!fin || isNaN(fin) || fin <= inicio) return mostrar('La reunión tiene que terminar después de empezar.', f.hasta);

      const fila = {
        titulo: texto.slice(0, LARGO_TITULO),
        inicio: inicio.toISOString(),
        fin: fin.toISOString(),
        organiza: editando?.organiza ?? yo(),
        invitados: quienes.filter((q) => PERSONAS.includes(q) && q !== yo()),
        notas: f.notas.value.trim().slice(0, LARGO_NOTAS) || null,
      };
      guardar.disabled = true;
      try {
        if (editando) {
          const cambiada = await fuente.cambiarReunion(editando.id, fila);
          estado.datos.reuniones = estado.datos.reuniones.map((r) => (r.id === editando.id ? cambiada : r));
        } else {
          estado.datos.reuniones = [...estado.datos.reuniones, await fuente.crearReunion(fila)];
        }
        dibujarTodo();
        dialogo.close();
        // Que se vea dónde quedó.
        partes.calTodos.irA(inicio);
        partes.calMio.irA(inicio);
        app.avisar(fila.invitados.length ? `Reunión guardada. Ya les aparece a ${listaDeNombres(fila.invitados.map(nombreDe))}.` : 'Reunión guardada.', 'ok');
        recargar();
      } catch (err) {
        console.error(err);
        mostrar('No se pudo guardar. Fijate la conexión y probá de nuevo.');
      } finally {
        guardar.disabled = false;
      }
    });

    return {
      dialogo,
      abrir({ fila = null, inicio = null, fin = null } = {}) {
        editando = fila;
        form.reset();
        titulo.textContent = fila ? 'Cambiar reunión' : 'Nueva reunión';
        borrar.hidden = !fila;
        // Los invitados posibles: los otros dos.
        invitados.replaceChildren(invitados.querySelector('legend'),
          ...app.personas.filter((p) => p.slug !== yo() && PERSONAS.includes(p.slug)).map((p) =>
            el('label', { class: 'mt-invitado', 'data-de': p.slug },
              el('input', { type: 'checkbox', name: 'invitados', value: p.slug }),
              el('span', { class: 'avatar avatar--chico', 'aria-hidden': 'true' }, inicial(p.nombre)),
              el('span', {}, p.nombre))));

        const f = form.elements;
        if (fila) {
          const a = new Date(fila.inicio);
          const b = new Date(fila.fin);
          f.titulo.value = fila.titulo ?? '';
          f.dia.value = fechaTexto(a);
          f.desde.value = horaDe(a);
          f.hasta.value = horaDe(b);
          f.notas.value = fila.notas ?? '';
          for (const i of invitados.querySelectorAll('input')) i.checked = (fila.invitados ?? []).includes(i.value);
        } else {
          // Sin horario elegido: la próxima media hora redonda, de media hora.
          const a = inicio ?? proximaMediaHora();
          let b = fin ?? new Date(a.getTime() + 30 * 60000);
          if (b - a < 30 * 60000) b = new Date(a.getTime() + 30 * 60000);
          f.dia.value = fechaTexto(a);
          f.desde.value = horaDe(a);
          // Si pasa la medianoche, se corta a las 23:45 (una reunión es de un solo día).
          f.hasta.value = fechaTexto(b) === fechaTexto(a) ? horaDe(b) : '23:45';
        }
        revisarChoques();
        dialogo.showModal();
        f.titulo.focus();
      },
    };
  }

  function abrirReunion(opciones) {
    if (!sePuedeGuardar()) return;
    partes.dialogos.reunion.abrir(opciones);
  }

  // ── Ventanita: detalle de algo del calendario ──

  function armarDialogoDetalle() {
    const titulo = el('h2', { id: 'mt-detalle-titulo', class: 'mt-dialogo__titulo' });
    const cuerpo = el('div', { class: 'mt-detalle' });
    const botones = el('div', { class: 'dialogo__botones' });
    const dialogo = el('dialog', { class: 'dialogo mt-dialogo', 'aria-labelledby': 'mt-detalle-titulo' },
      el('div', { class: 'dialogo__cuerpo' }, titulo, cuerpo, botones));
    return { dialogo, titulo, cuerpo, botones };
  }

  function abrirDetalle(evCal) {
    const { dialogo, titulo, cuerpo, botones } = partes.dialogos.detalle;
    const ev = evCal.regla;
    const cerrar = el('button', { type: 'button', class: 'boton boton--suave' }, 'Cerrar');
    cerrar.addEventListener('click', () => dialogo.close());
    const lineas = [];
    const cuando = mismoDia(ev.inicio, new Date(ev.fin.getTime() - 1))
      ? `${capitalizar(diaLargo(ev.inicio))}, de ${horaDe(ev.inicio)} a ${horaDe(ev.fin)}`
      : `Del ${diaLargo(ev.inicio)} ${horaDe(ev.inicio)} al ${diaLargo(ev.fin)} ${horaDe(ev.fin)}`;

    if (ev.tipo === 'reunion') {
      const fila = estado.datos.reuniones.find((r) => r.id === ev.filaId);
      titulo.textContent = ev.titulo;
      lineas.push(el('p', { class: 'mt-detalle__cuando' }, cuando));
      lineas.push(el('div', { class: 'fila' },
        ...ev.participantes.map((s) => el('span', { class: 'etiqueta', 'data-de': s },
          el('span', { class: 'punto', 'aria-hidden': 'true' }), nombreDe(s)))));
      lineas.push(el('p', { class: 'mt-detalle__dato' }, `La armó ${nombreDe(ev.persona)}.`));
      if (ev.notas) lineas.push(el('p', { class: 'mt-detalle__notas' }, ev.notas));
      const extra = [];
      if (fila && fila.organiza === yo()) {
        const cambiar = el('button', { type: 'button', class: 'boton' }, 'Cambiar');
        cambiar.addEventListener('click', () => {
          dialogo.close();
          abrirReunion({ fila });
        });
        const borrar = el('button', { type: 'button', class: 'boton boton--peligro mt-dialogo__borrar' }, 'Borrar');
        borrar.addEventListener('click', async () => {
          if (await borrarReunion(fila)) dialogo.close();
        });
        extra.push(cambiar, cerrar, borrar);
      } else {
        extra.push(cerrar);
      }
      botones.replaceChildren(...extra);
    } else if (ev.clase === 'noche') {
      titulo.textContent = 'Noche';
      lineas.push(el('p', { class: 'mt-detalle__cuando' }, cuando));
      lineas.push(el('p', { class: 'mt-detalle__dato' },
        `De ${hora5(NOCHE.desde)} a ${hora5(NOCHE.hasta)} no está disponible nadie. Viene puesto para los tres.`));
      botones.replaceChildren(cerrar);
    } else {
      const fila = estado.datos.bloqueos.find((b) => b.id === ev.filaId);
      titulo.textContent = ev.titulo;
      lineas.push(el('p', { class: 'mt-detalle__cuando' }, cuando));
      if (fila) lineas.push(el('p', { class: 'mt-detalle__dato' }, describirBloqueo(fila)));
      lineas.push(el('div', { class: 'fila' },
        ev.paraTodos
          ? el('span', { class: 'etiqueta etiqueta--gris' }, 'Para todos')
          : el('span', { class: 'etiqueta', 'data-de': ev.persona }, el('span', { class: 'punto', 'aria-hidden': 'true' }), `Ocupado: ${nombreDe(ev.persona)}`),
        ev.paraTodos && ev.de ? el('span', { class: 'mt-detalle__dato' }, `Lo puso ${nombreDe(ev.de)}`) : ''));
      if (fila && fila.persona === yo()) {
        const cambiar = el('button', { type: 'button', class: 'boton' }, 'Cambiar');
        cambiar.addEventListener('click', () => {
          dialogo.close();
          abrirBloqueo({ fila });
        });
        const borrar = el('button', { type: 'button', class: 'boton boton--peligro mt-dialogo__borrar' }, 'Borrar');
        borrar.addEventListener('click', async () => {
          if (await borrarBloqueo(fila)) dialogo.close();
        });
        botones.replaceChildren(cambiar, cerrar, borrar);
      } else {
        botones.replaceChildren(cerrar);
      }
    }
    cuerpo.replaceChildren(...lineas);
    dialogo.showModal();
    cerrar.focus();
  }

  // Una fila de reunión → el mismo evento que arma horarios.js (para abrir su detalle desde la lista).
  function reunionComoEvento(fila) {
    return eventosDelRango({ desde: new Date(fila.inicio), hasta: new Date(fila.fin) }, { reuniones: [fila] }, { noche: false, recortar: false })[0];
  }
}

// ── Fuentes de datos ─────────────────────────────────────

// Supabase de verdad: tablas meetings_reuniones y meetings_bloqueos (supabase/meetings.sql), en vivo.
function fuenteSupabase(app) {
  const db = app.supabase;
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  return {
    async traer() {
      // Reuniones: desde medio año atrás (para poder mirar para atrás sin traer todo).
      const desde = new Date(Date.now() - 183 * 864e5).toISOString();
      const [reuniones, bloqueos] = await Promise.all([
        db.from('meetings_reuniones').select('*').gte('fin', desde).order('inicio').limit(2000),
        db.from('meetings_bloqueos').select('*').limit(2000),
      ]);
      return { reuniones: ok(reuniones) ?? [], bloqueos: ok(bloqueos) ?? [] };
    },
    crearBloqueos: async (filas) => ok(await db.from('meetings_bloqueos').insert(filas).select()),
    cambiarBloqueo: async (id, fila) => ok(await db.from('meetings_bloqueos').update(fila).eq('id', id).select().single()),
    borrarBloqueo: async (id) => ok(await db.from('meetings_bloqueos').delete().eq('id', id)),
    crearReunion: async (fila) => ok(await db.from('meetings_reuniones').insert(fila).select().single()),
    cambiarReunion: async (id, fila) => ok(await db.from('meetings_reuniones').update(fila).eq('id', id).select().single()),
    borrarReunion: async (id) => ok(await db.from('meetings_reuniones').delete().eq('id', id)),

    escuchar(avisar) {
      db.channel('meetings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings_reuniones' }, () => avisar())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings_bloqueos' }, () => avisar())
        .subscribe();
    },
  };
}

// Modo prueba: todo en el localStorage de esta compu, con unos ejemplos para ver cómo queda.
function fuentePrueba(app) {
  const CLAVE = 'ath-prueba-meetings';
  const yo = () => app.persona.slug;

  const leer = () => {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE));
      if (Array.isArray(datos?.reuniones) && Array.isArray(datos?.bloqueos)) return datos;
    } catch {
      /* si está roto, se arma de nuevo */
    }
    return ejemplo();
  };
  const cambiar = (fn) => {
    const datos = leer();
    const r = fn(datos);
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    return r;
  };
  const copia = (x) => JSON.parse(JSON.stringify(x));

  return {
    traer: async () => {
      const d = leer();
      return { reuniones: d.reuniones, bloqueos: d.bloqueos };
    },
    crearBloqueos: async (filas) =>
      cambiar((d) => {
        const nuevas = filas.map((f) => ({ ...f, id: ++d.sig, persona: f.persona || yo() }));
        d.bloqueos.push(...nuevas);
        return copia(nuevas);
      }),
    cambiarBloqueo: async (id, fila) =>
      cambiar((d) => {
        const b = d.bloqueos.find((x) => x.id === id && x.persona === yo());
        if (!b) throw new Error('No es tuyo o ya no está.');
        Object.assign(b, fila);
        return copia(b);
      }),
    borrarBloqueo: async (id) =>
      cambiar((d) => {
        d.bloqueos = d.bloqueos.filter((x) => !(x.id === id && x.persona === yo()));
      }),
    crearReunion: async (fila) =>
      cambiar((d) => {
        const nueva = { ...fila, id: ++d.sig, organiza: yo() };
        d.reuniones.push(nueva);
        return copia(nueva);
      }),
    cambiarReunion: async (id, fila) =>
      cambiar((d) => {
        const r = d.reuniones.find((x) => x.id === id && x.organiza === yo());
        if (!r) throw new Error('No es tuya o ya no está.');
        Object.assign(r, fila);
        return copia(r);
      }),
    borrarReunion: async (id) =>
      cambiar((d) => {
        d.reuniones = d.reuniones.filter((x) => !(x.id === id && x.organiza === yo()));
      }),

    escuchar(avisar) {
      // Otra pestaña cambió algo: se recarga (así se ve el «en vivo» sin Supabase).
      window.addEventListener('storage', (e) => {
        if (e.key === CLAVE) avisar();
      });
    },
  };

  function ejemplo() {
    const hoy = inicioDelDia(new Date());
    const lunes = sumarDias(hoy, -((hoy.getDay() + 6) % 7));
    const en = (dias, hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      const d = sumarDias(lunes, dias);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const datos = {
      sig: 100,
      reuniones: [
        { id: 1, titulo: 'Con Juan (cliente)', inicio: en(1, '10:30'), fin: en(1, '11:00'), organiza: 'aostri', invitados: [], notas: 'Le mostramos la web nueva.' },
        { id: 2, titulo: 'Planificación del mes', inicio: en(3, '15:00'), fin: en(3, '16:00'), organiza: 'tomas', invitados: ['aostri', 'hassan'], notas: '' },
        { id: 3, titulo: 'Fotos del local', inicio: en(4, '12:00'), fin: en(4, '13:30'), organiza: 'hassan', invitados: ['tomas'], notas: '' },
      ],
      bloqueos: [
        { id: 10, persona: 'hassan', tipo: 'semanal', dia_semana: 2, hora_desde: '08:00', hora_hasta: '12:00', fecha_desde: null, fecha_hasta: null, motivo: 'Facultad', para_todos: false },
        { id: 11, persona: 'hassan', tipo: 'semanal', dia_semana: 4, hora_desde: '08:00', hora_hasta: '12:00', fecha_desde: null, fecha_hasta: null, motivo: 'Facultad', para_todos: false },
        { id: 12, persona: 'tomas', tipo: 'semanal', dia_semana: 1, hora_desde: '07:00', hora_hasta: '18:00', fecha_desde: null, fecha_hasta: null, motivo: MOTIVO_HORARIO, para_todos: false },
        { id: 13, persona: 'aostri', tipo: 'puntual', dia_semana: null, hora_desde: '17:00', hora_hasta: '19:00', fecha_desde: fechaTexto(sumarDias(lunes, 2)), fecha_hasta: fechaTexto(sumarDias(lunes, 2)), motivo: 'Médico', para_todos: false },
        { id: 14, persona: 'tomas', tipo: 'puntual', dia_semana: null, hora_desde: null, hora_hasta: null, fecha_desde: fechaTexto(sumarDias(lunes, 5)), fecha_hasta: fechaTexto(sumarDias(lunes, 5)), motivo: 'Feriado del equipo', para_todos: true },
        { id: 15, persona: 'aostri', tipo: 'vacaciones', dia_semana: null, hora_desde: null, hora_hasta: null, fecha_desde: fechaTexto(sumarDias(lunes, 14)), fecha_hasta: fechaTexto(sumarDias(lunes, 18)), motivo: '', para_todos: false },
      ],
    };
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    return datos;
  }
}

// ── Ayudantes ────────────────────────────────────────────

// Crea un elemento. Los hijos de texto van como texto (nunca como HTML).
function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor == null || valor === false) continue;
    if (nombre === 'class') nodo.className = valor;
    else nodo.setAttribute(nombre, valor === true ? '' : valor);
  }
  for (const hijo of hijos) {
    if (hijo == null || hijo === '') continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

// Un campo con su etiqueta (.campo de base.css). Devuelve la caja, el input y la etiqueta.
function campo({ id, nombre, etiqueta, tipo = 'text', max, ejemplo, requerido, paso, area }) {
  const input = el(area ? 'textarea' : 'input', {
    id, name: nombre,
    type: area ? null : tipo,
    maxlength: max ? String(max) : null,
    placeholder: ejemplo ?? null,
    required: requerido ? '' : null,
    step: paso ? String(paso) : null,
    rows: area ? '3' : null,
    autocomplete: 'off',
  });
  const rotulo = el('label', { for: id }, etiqueta);
  return { caja: el('div', { class: 'campo' }, rotulo, input), input, etiqueta: rotulo };
}

// Las casillas de los días (Lun … Dom). valores() → [getDay()], poner([getDay()]).
function elegirDias(nombre, titulo) {
  const caja = el('fieldset', { class: 'mt-dias' }, el('legend', { class: 'mt-legend' }, titulo),
    ...DIAS_SEMANA.map((d) => el('label', { class: 'mt-dias__dia', title: d.largo },
      el('input', { type: 'checkbox', name: nombre, value: String(d.valor), 'aria-label': d.largo }),
      el('span', { 'aria-hidden': 'true' }, d.corto))));
  return {
    caja,
    valores: () => [...caja.querySelectorAll('input:checked')].map((i) => Number(i.value)),
    poner(lista) {
      for (const i of caja.querySelectorAll('input')) i.checked = lista.includes(Number(i.value));
    },
  };
}

function horaDe(fecha) {
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}

// '10:00:00' → '10:00' (como lo devuelve la base) ; null → ''
function hora5(valor) {
  return typeof valor === 'string' ? valor.slice(0, 5) : '';
}

function diaLargo(fecha) {
  return fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function mismoDia(a, b) {
  return fechaTexto(a) === fechaTexto(b);
}

function proximaMediaHora() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  // Si cae de noche, mañana a las 10.
  if (d.getHours() >= 22 || d.getHours() < 7) {
    const manana = leerFecha(fechaTexto(sumarDias(d, d.getHours() >= 22 ? 1 : 0)));
    manana.setHours(10, 0, 0, 0);
    return manana;
  }
  return d;
}

function inicial(nombre) {
  return (String(nombre ?? '?').trim().charAt(0) || '?').toUpperCase();
}

function listaDeNombres(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`;
}
