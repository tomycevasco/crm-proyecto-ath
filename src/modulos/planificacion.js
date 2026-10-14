// Planificación: pestaña propia (#/planificacion), compartida en vivo entre los tres.
// Arriba, un resumen (carga de cada uno, próximos hitos y cómo va cada proyecto).
// Abajo, las tareas en tres vistas: Gantt (se arrastra para cambiar fechas), Lista y Tablero por estado,
// con filtros por proyecto y persona. Las tareas e hitos se crean y cambian en una ventanita.
// Datos: tabla planificacion_tareas (supabase/planificacion.sql). Sin Supabase, modo prueba en esta compu.
// El dibujo del Gantt vive en src/planificacion/gantt.js; las cuentas (estado, empujar dependientes,
// carga, hitos), en src/planificacion/reglas.js.
import '../estilos/planificacion.css';
import { crearGantt } from '../planificacion/gantt.js';
import {
  ESTADOS,
  estadoDe,
  nombreEstado,
  avanceDe,
  validarTarea,
  moverTarea,
  dependientesDe,
  arrancaAntesDeTiempo,
  cargaPorPersona,
  proximosHitos,
  avancePorProyecto,
  proyectosDe,
  ordenarTareas,
  formatearFecha,
  formatearRango,
  formatearFaltan,
  duracion,
  hoyISO,
  sumarDias,
  diasEntre,
} from '../planificacion/reglas.js';

const PERSONAS = ['aostri', 'tomas', 'hassan'];
const TODOS = 'todos';
const NADIE = 'nadie'; // filtro: las tareas sin responsable
const TODOS_LOS_PROYECTOS = '*';
const VISTAS = [
  { valor: 'gantt', nombre: 'Gantt' },
  { valor: 'lista', nombre: 'Lista' },
  { valor: 'tablero', nombre: 'Tablero' },
];
const COLUMNAS = ['pendiente', 'en_curso', 'atrasada', 'hecha'];
const CLAVE_VISTA = 'ath-planificacion-vista';
const LARGO_TITULO = 120;
const LARGO_PROYECTO = 60;
const LARGO_NOTAS = 1000;

export function iniciar(app) {
  const estado = {
    tareas: [],
    cargado: false,
    error: false,
    sinInternet: typeof navigator !== 'undefined' && navigator.onLine === false,
    proyecto: TODOS_LOS_PROYECTOS,
    persona: TODOS,
    ocultarHechas: false,
    vista: leerVista(),
    armado: false,
  };
  let fuente = null;
  let partes = null;
  let esperando = null;

  app.registrarPantalla({
    ruta: 'planificacion',
    titulo: 'Planificación',
    orden: 36,
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
  const nombreDe = (slug) => app.buscarPersona(slug)?.nombre ?? (slug ? capitalizar(slug) : 'Sin asignar');
  const personasDelEquipo = () => app.personas.filter((p) => PERSONAS.includes(p.slug));
  const buscar = (id) => estado.tareas.find((t) => String(t.id) === String(id)) ?? null;

  // ── Datos ────────────────────────────────────────────

  // Junta varios avisos seguidos (ej. una tarea que empujó a otras tres) en una sola recarga.
  function recargar(demora = 250) {
    clearTimeout(esperando);
    esperando = setTimeout(traer, demora);
  }

  async function traer() {
    try {
      estado.tareas = await fuente.traer();
      estado.error = false;
      estado.cargado = true;
    } catch (e) {
      console.error('[planificacion]', e);
      estado.error = true;
    }
    dibujarTodo();
  }

  /** Las tareas del proyecto elegido (para los resúmenes). */
  function delProyecto() {
    if (estado.proyecto === TODOS_LOS_PROYECTOS) return estado.tareas;
    return estado.tareas.filter((t) => (t.proyecto || '') === estado.proyecto);
  }

  /** Las tareas que se ven en el Gantt, la lista y el tablero (proyecto + persona + ocultar hechas). */
  function filtradas() {
    return ordenarTareas(delProyecto().filter((t) => {
      if (estado.persona === NADIE && t.responsable) return false;
      if (estado.persona !== TODOS && estado.persona !== NADIE && t.responsable !== estado.persona) return false;
      if (estado.ocultarHechas && estadoDe(t) === 'hecha') return false;
      return true;
    }));
  }

  // ── Armado (una sola vez) ────────────────────────────

  function armar(zona) {
    const nuevaTarea = el('button', { type: 'button', class: 'boton' }, 'Nueva tarea');
    nuevaTarea.addEventListener('click', () => abrirTarea(null, { hito: false }));
    const nuevoHito = el('button', { type: 'button', class: 'boton boton--suave' }, 'Nuevo hito');
    nuevoHito.addEventListener('click', () => abrirTarea(null, { hito: true }));

    const cabeza = el('header', { class: 'cabeza-pantalla' },
      el('div', {},
        el('p', { class: 'cabeza-pantalla__ante' }, 'Entre los tres'),
        el('h1', {}, 'Planificación'),
        el('p', { class: 'cabeza-pantalla__bajada' },
          'Las tareas y los hitos de cada proyecto, en el tiempo. Cualquiera de los tres puede moverlas: los cambios se ven al toque en las otras compus.')),
      el('div', { class: 'cabeza-pantalla__acciones' },
        el('span', { class: 'pl-envivo' }, el('span', { class: 'pl-envivo__punto', 'aria-hidden': 'true' }), 'En vivo'),
        nuevoHito, nuevaTarea),
    );

    const aviso = el('div', { class: 'pl-aviso', role: 'status', hidden: '' });

    // Resumen: carga · hitos · proyectos
    const listaCarga = el('ul', { class: 'pl-carga', 'aria-labelledby': 'pl-titulo-carga' });
    const notaCarga = el('p', { class: 'pl-resumen__nota' });
    const listaHitos = el('ul', { class: 'pl-hitos', 'aria-labelledby': 'pl-titulo-hitos' });
    const listaProyectos = el('ul', { class: 'pl-proyectos', 'aria-labelledby': 'pl-titulo-proyectos' });
    const resumen = el('section', { class: 'pl-resumen', 'aria-label': 'Resumen' },
      el('div', { class: 'tarjeta pl-caja' },
        el('div', { class: 'tarjeta__cabeza' }, el('h2', { id: 'pl-titulo-carga', class: 'tarjeta__titulo' }, 'Carga de cada uno')),
        listaCarga, notaCarga),
      el('div', { class: 'tarjeta pl-caja' },
        el('div', { class: 'tarjeta__cabeza' }, el('h2', { id: 'pl-titulo-hitos', class: 'tarjeta__titulo' }, 'Próximos hitos')),
        listaHitos),
      el('div', { class: 'tarjeta pl-caja' },
        el('div', { class: 'tarjeta__cabeza' }, el('h2', { id: 'pl-titulo-proyectos', class: 'tarjeta__titulo' }, 'Cómo va cada proyecto')),
        listaProyectos),
    );

    // Barra de filtros y vistas
    const elegirProyecto = el('select', { id: 'pl-filtro-proyecto', class: 'pl-select' });
    elegirProyecto.addEventListener('change', () => {
      estado.proyecto = elegirProyecto.value;
      dibujarTodo();
    });
    const filtroPersona = el('div', { class: 'pl-pildoras', role: 'group', 'aria-label': 'Ver las tareas de' });
    filtroPersona.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ver]');
      if (!b) return;
      ponerPersona(b.dataset.ver === estado.persona ? TODOS : b.dataset.ver);
    });
    const ocultarHechas = el('input', { type: 'checkbox', id: 'pl-ocultar-hechas' });
    ocultarHechas.addEventListener('change', () => {
      estado.ocultarHechas = ocultarHechas.checked;
      dibujarVista();
    });
    const vistas = el('div', { class: 'pl-vistas', role: 'group', 'aria-label': 'Cómo ver las tareas' },
      ...VISTAS.map((v) => el('button', { type: 'button', class: 'pl-vistas__boton', 'data-vista': v.valor }, v.nombre)));
    vistas.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-vista]');
      if (!b) return;
      estado.vista = b.dataset.vista;
      guardarVista(estado.vista);
      dibujarVista();
    });
    const cuenta = el('span', { class: 'seccion__cuenta' });

    const barra = el('div', { class: 'pl-barra' },
      el('div', { class: 'pl-barra__filtros' },
        el('div', { class: 'pl-filtro' },
          el('label', { for: 'pl-filtro-proyecto', class: 'pl-filtro__rotulo' }, 'Proyecto'), elegirProyecto),
        filtroPersona,
        el('label', { class: 'pl-casilla', for: 'pl-ocultar-hechas' }, ocultarHechas, el('span', {}, 'Ocultar las hechas'))),
      vistas);

    const zonaGantt = el('div', { class: 'pl-vista pl-vista--gantt' });
    const zonaLista = el('div', { class: 'pl-vista pl-vista--lista', hidden: '' });
    const zonaTablero = el('div', { class: 'pl-vista pl-vista--tablero', hidden: '' });

    const tareas = el('section', { class: 'seccion pl-tareas', 'aria-labelledby': 'pl-titulo-tareas' },
      el('div', { class: 'seccion__cabeza' },
        el('h2', { id: 'pl-titulo-tareas', class: 'seccion__titulo' }, 'Tareas'), cuenta),
      barra, zonaGantt, zonaLista, zonaTablero);

    const dialogo = armarDialogoTarea();

    zona.classList.add('planificacion');
    zona.replaceChildren(cabeza, aviso, resumen, tareas, dialogo.dialogo);

    const gantt = crearGantt(zonaGantt, {
      tareas: [],
      personas: personasDelEquipo(),
      etiqueta: 'Diagrama de Gantt de la planificación',
      textoVacio: 'Todavía no hay tareas acá. Con «Nueva tarea» sumás la primera.',
      alCambiar: (id, fechas) => moverDesdeGantt(id, fechas),
      alAbrir: (id) => abrirTarea(buscar(id)),
    });

    return {
      aviso, listaCarga, notaCarga, listaHitos, listaProyectos,
      elegirProyecto, filtroPersona, vistas, cuenta, ocultarHechas,
      zonaGantt, zonaLista, zonaTablero, gantt, dialogo,
      botones: [nuevaTarea, nuevoHito],
    };
  }

  function ponerPersona(valor) {
    estado.persona = valor;
    dibujarFiltros();
    dibujarCarga();
    dibujarVista();
  }

  function ponerProyecto(valor) {
    estado.proyecto = valor;
    dibujarTodo();
    partes.elegirProyecto.focus();
  }

  // ── Dibujar ──────────────────────────────────────────

  function dibujarTodo() {
    if (!partes) return;
    // Si el proyecto elegido desapareció (lo borraron en otra compu), se vuelve a «Todos».
    if (estado.proyecto !== TODOS_LOS_PROYECTOS && !proyectosDe(estado.tareas).includes(estado.proyecto)) {
      estado.proyecto = TODOS_LOS_PROYECTOS;
    }
    dibujarAviso();
    dibujarFiltros();
    dibujarCarga();
    dibujarHitos();
    dibujarProyectos();
    partes.gantt.ponerPersonas(personasDelEquipo());
    dibujarVista();
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
        : 'No pude traer la planificación. ¿Ya está subida a Supabase la parte de Planificación? Probá recargar la página.';
      tipo = 'error';
    } else if (!app.conectado) {
      texto = 'Modo prueba: lo que cargues queda solo en esta compu (y se ve en otras pestañas).';
    }
    aviso.hidden = !texto;
    aviso.textContent = texto;
    aviso.dataset.tipo = tipo;
    aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    for (const b of partes.botones) b.disabled = estado.sinInternet;
  }

  function dibujarFiltros() {
    const { elegirProyecto, filtroPersona, vistas, ocultarHechas } = partes;
    const proyectos = proyectosDe(estado.tareas);
    elegirProyecto.replaceChildren(
      el('option', { value: TODOS_LOS_PROYECTOS }, 'Todos los proyectos'),
      ...proyectos.map((p) => el('option', { value: p }, p || 'Sin proyecto')));
    elegirProyecto.value = estado.proyecto;

    const opciones = [
      { valor: TODOS, texto: 'Los tres' },
      ...personasDelEquipo().map((p) => ({ valor: p.slug, texto: p.nombre, de: p.slug })),
    ];
    if (estado.tareas.some((t) => !t.responsable)) opciones.push({ valor: NADIE, texto: 'Sin asignar' });
    if (!opciones.some((o) => o.valor === estado.persona)) estado.persona = TODOS;
    filtroPersona.replaceChildren(...opciones.map((o) => el('button', {
      type: 'button', class: 'pl-pildora', 'data-ver': o.valor, 'data-de': o.de ?? null,
      'aria-pressed': String(estado.persona === o.valor),
    }, o.de ? el('span', { class: 'punto', 'aria-hidden': 'true' }) : null, o.texto)));

    for (const b of vistas.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.vista === estado.vista));
    ocultarHechas.checked = estado.ocultarHechas;
  }

  function dibujarCarga() {
    const { listaCarga, notaCarga } = partes;
    const tareas = delProyecto();
    const carga = cargaPorPersona(tareas, { personas: PERSONAS });
    const maximo = Math.max(1, ...PERSONAS.map((s) => carga[s]?.dias ?? 0));
    listaCarga.replaceChildren(...personasDelEquipo().map((p) => {
      const c = carga[p.slug];
      const elegido = estado.persona === p.slug;
      const detalle = c.tareas
        ? `${c.tareas} ${c.tareas === 1 ? 'tarea abierta' : 'tareas abiertas'} · ${c.dias} ${c.dias === 1 ? 'día' : 'días'} de trabajo`
        : 'Sin tareas abiertas';
      const boton = el('button', {
        type: 'button', class: 'pl-carga__boton', 'aria-pressed': String(elegido),
        title: elegido ? 'Volver a ver a los tres' : `Ver solo las tareas de ${p.nombre}`,
      },
      el('span', { class: 'avatar avatar--chico', 'aria-hidden': 'true' }, inicial(p.nombre)),
      el('span', { class: 'pl-carga__textos' },
        el('span', { class: 'pl-carga__nombre' }, p.nombre),
        el('span', { class: 'pl-carga__detalle' }, detalle),
        el('span', { class: 'pl-carga__barra', 'aria-hidden': 'true' },
          el('span', { class: 'pl-carga__relleno', style: `width: ${Math.round((c.dias / maximo) * 100)}%` }))),
      c.atrasadas ? el('span', { class: 'pl-marca pl-marca--atrasada' }, `${c.atrasadas} ${c.atrasadas === 1 ? 'atrasada' : 'atrasadas'}`) : null);
      boton.addEventListener('click', () => ponerPersona(elegido ? TODOS : p.slug));
      return el('li', { 'data-de': p.slug }, boton);
    }));
    const sinAsignar = carga['']?.tareas ?? 0;
    notaCarga.textContent = sinAsignar
      ? `Hay ${sinAsignar} ${sinAsignar === 1 ? 'tarea abierta sin asignar' : 'tareas abiertas sin asignar'}.`
      : 'Cuenta las tareas sin terminar (los hitos no). Tocá a alguien para ver solo lo suyo.';
  }

  function dibujarHitos() {
    const { listaHitos } = partes;
    const hitos = proximosHitos(delProyecto(), { limite: 5 });
    if (!hitos.length) {
      listaHitos.replaceChildren(el('li', { class: 'pl-vacio' },
        estado.cargado || !app.conectado ? 'No hay hitos por delante. Con «Nuevo hito» marcás una fecha importante (una entrega, un lanzamiento).' : 'Cargando…'));
      return;
    }
    listaHitos.replaceChildren(...hitos.map(({ tarea, atrasado }) => {
      const boton = el('button', { type: 'button', class: 'pl-hito', 'data-de': tarea.responsable || null },
        el('span', { class: 'pl-rombo', 'aria-hidden': 'true' }),
        el('span', { class: 'pl-hito__textos' },
          el('span', { class: 'pl-hito__titulo' }, tarea.titulo),
          el('span', { class: 'pl-hito__detalle' }, [tarea.proyecto, tarea.responsable ? nombreDe(tarea.responsable) : ''].filter(Boolean).join(' · ') || 'Sin proyecto')),
        el('span', { class: atrasado ? 'pl-hito__cuando es-atrasado' : 'pl-hito__cuando' },
          el('span', {}, formatearFecha(tarea.fin, { dia: true })),
          el('span', { class: 'pl-hito__faltan' }, atrasado ? `Atrasado (${formatearFaltan(tarea.fin)})` : capitalizar(formatearFaltan(tarea.fin)))));
      boton.addEventListener('click', () => abrirTarea(tarea));
      return el('li', {}, boton);
    }));
  }

  function dibujarProyectos() {
    const { listaProyectos } = partes;
    const resumenes = avancePorProyecto(estado.tareas);
    if (!resumenes.length) {
      listaProyectos.replaceChildren(el('li', { class: 'pl-vacio' },
        estado.cargado || !app.conectado ? 'Cuando cargues tareas con su proyecto, acá ves cuánto le falta a cada uno.' : 'Cargando…'));
      return;
    }
    listaProyectos.replaceChildren(...resumenes.map((r) => {
      const valor = r.proyecto;
      const elegido = estado.proyecto === valor;
      const detalle = [`${r.hechas} de ${r.total} hechas`];
      if (r.fin) detalle.push(`termina el ${formatearFecha(r.fin)}`);
      const boton = el('button', {
        type: 'button', class: 'pl-proyecto', 'aria-pressed': String(elegido),
        title: elegido ? 'Volver a ver todos los proyectos' : `Ver solo «${valor || 'Sin proyecto'}»`,
      },
      el('span', { class: 'pl-proyecto__fila' },
        el('span', { class: 'pl-proyecto__nombre' }, valor || 'Sin proyecto'),
        el('span', { class: 'pl-proyecto__porcentaje' }, `${r.avance}%`)),
      el('span', { class: 'pl-progreso', role: 'presentation' },
        el('span', { class: 'pl-progreso__relleno', style: `width: ${r.avance}%` })),
      el('span', { class: 'pl-proyecto__detalle' }, detalle.join(' · '),
        r.atrasadas ? el('span', { class: 'pl-marca pl-marca--atrasada' }, `${r.atrasadas} ${r.atrasadas === 1 ? 'atrasada' : 'atrasadas'}`) : null));
      boton.addEventListener('click', () => ponerProyecto(elegido ? TODOS_LOS_PROYECTOS : valor));
      return el('li', {}, boton);
    }));
  }

  function dibujarVista() {
    if (!partes) return;
    const { zonaGantt, zonaLista, zonaTablero, vistas, cuenta } = partes;
    for (const b of vistas.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.vista === estado.vista));
    const lista = filtradas();
    cuenta.textContent = lista.length ? `${lista.length} ${lista.length === 1 ? 'tarea' : 'tareas'}` : '';
    zonaGantt.hidden = estado.vista !== 'gantt';
    zonaLista.hidden = estado.vista !== 'lista';
    zonaTablero.hidden = estado.vista !== 'tablero';
    // El Gantt se redibuja solo si se ve (escondido no sabe cuánto mide).
    if (estado.vista === 'gantt') partes.gantt.actualizar(lista);
    else if (estado.vista === 'lista') dibujarLista(lista);
    else dibujarTablero(lista);
  }

  function textoVacio() {
    if (!estado.cargado && app.conectado) return 'Cargando…';
    if (!estado.tareas.length) return 'Todavía no hay tareas. Con «Nueva tarea» sumás la primera.';
    return 'Con estos filtros no aparece ninguna tarea.';
  }

  function dibujarLista(lista) {
    const { zonaLista } = partes;
    if (!lista.length) {
      zonaLista.replaceChildren(el('p', { class: 'pl-vacio pl-vacio--grande' }, textoVacio()));
      return;
    }
    // Ordenada por cuándo termina (lo más urgente arriba), las hechas al final.
    const ordenada = [...lista].sort((a, b) =>
      (estadoDe(a) === 'hecha') - (estadoDe(b) === 'hecha')
      || (diasEntre(b.fin, a.fin) ?? 0)
      || String(a.titulo).localeCompare(String(b.titulo), 'es'));
    zonaLista.replaceChildren(el('ul', { class: 'pl-lista', 'aria-label': 'Tareas' }, ...ordenada.map(filaDeLista)));
  }

  function filaDeLista(t) {
    const est = estadoDe(t);
    const abrir = el('button', { type: 'button', class: 'pl-fila__abrir' },
      el('span', { class: t.hito ? 'pl-rombo' : 'punto', 'aria-hidden': 'true' }),
      el('span', { class: 'pl-fila__textos' },
        el('span', { class: 'pl-fila__titulo' }, t.hito ? `Hito: ${t.titulo}` : t.titulo),
        el('span', { class: 'pl-fila__detalle' }, [t.proyecto || 'Sin proyecto', textoDependencia(t)].filter(Boolean).join(' · '))));
    abrir.addEventListener('click', () => abrirTarea(t));
    return el('li', { class: `pl-fila es-${est}`, 'data-de': t.responsable || null },
      abrir,
      el('span', { class: 'pl-fila__quien' }, etiquetaPersona(t.responsable)),
      el('span', { class: 'pl-fila__fechas' }, t.hito ? formatearFecha(t.fin, { dia: true }) : formatearRango(t.inicio, t.fin)),
      el('span', { class: 'pl-fila__avance' }, t.hito ? null : barraAvance(t)),
      el('span', { class: 'pl-fila__estado' }, etiquetaEstado(est)));
  }

  function dibujarTablero(lista) {
    const { zonaTablero } = partes;
    const porEstado = Object.fromEntries(COLUMNAS.map((c) => [c, []]));
    for (const t of lista) porEstado[estadoDe(t)].push(t);
    // En cada columna, lo que termina antes va arriba.
    for (const c of COLUMNAS) porEstado[c].sort((a, b) => (diasEntre(b.fin, a.fin) ?? 0));
    const columnas = COLUMNAS
      .filter((c) => !(c === 'hecha' && estado.ocultarHechas))
      .map((c) => el('section', { class: `pl-columna pl-columna--${c}`, 'aria-labelledby': `pl-columna-${c}` },
        el('h3', { id: `pl-columna-${c}`, class: 'pl-columna__titulo' },
          el('span', {}, ESTADOS[c]), el('span', { class: 'pl-columna__cuenta' }, String(porEstado[c].length))),
        porEstado[c].length
          ? el('ul', { class: 'pl-columna__lista' }, ...porEstado[c].map(tarjetaDeTablero))
          : el('p', { class: 'pl-vacio' }, c === 'atrasada' ? 'Nada atrasado.' : 'Nada por acá.')));
    zonaTablero.replaceChildren(
      lista.length ? el('div', { class: 'pl-tablero' }, ...columnas) : el('p', { class: 'pl-vacio pl-vacio--grande' }, textoVacio()));
  }

  function tarjetaDeTablero(t) {
    const est = estadoDe(t);
    const abrir = el('button', { type: 'button', class: 'pl-tarjeta__abrir' },
      el('span', { class: 'pl-tarjeta__proyecto' }, t.proyecto || 'Sin proyecto'),
      el('span', { class: 'pl-tarjeta__titulo' },
        t.hito ? el('span', { class: 'pl-rombo', 'aria-hidden': 'true' }) : null, t.hito ? `Hito: ${t.titulo}` : t.titulo),
      el('span', { class: 'pl-tarjeta__fechas' }, t.hito ? formatearFecha(t.fin, { dia: true }) : `${formatearRango(t.inicio, t.fin)} · ${duracion(t)} ${duracion(t) === 1 ? 'día' : 'días'}`));
    abrir.addEventListener('click', () => abrirTarea(t));
    const pie = el('div', { class: 'pl-tarjeta__pie' }, etiquetaPersona(t.responsable));
    if (!t.hito) pie.append(barraAvance(t));
    if (est !== 'hecha') {
      const hecha = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico pl-tarjeta__hecha', 'aria-label': `Marcar hecha: ${t.titulo}` }, t.hito ? 'Cumplido' : 'Marcar hecha');
      hecha.addEventListener('click', () => marcarHecha(t, hecha));
      pie.append(hecha);
    }
    return el('li', { class: `pl-tarjeta es-${est}`, 'data-de': t.responsable || null }, abrir, pie);
  }

  function etiquetaPersona(slug) {
    if (!slug) return el('span', { class: 'etiqueta etiqueta--gris' }, 'Sin asignar');
    return el('span', { class: 'etiqueta', 'data-de': slug }, el('span', { class: 'punto', 'aria-hidden': 'true' }), nombreDe(slug));
  }

  function etiquetaEstado(est) {
    return el('span', { class: `pl-estado pl-estado--${est}` }, nombreEstado(est));
  }

  function barraAvance(t) {
    const avance = avanceDe(t);
    return el('span', { class: 'pl-avance' },
      el('span', { class: 'pl-progreso', 'aria-hidden': 'true' }, el('span', { class: 'pl-progreso__relleno', style: `width: ${avance}%` })),
      el('span', { class: 'pl-avance__numero' }, `${avance}%`));
  }

  function textoDependencia(t) {
    if (!t.depende_de) return '';
    const previa = buscar(t.depende_de);
    return previa ? `después de «${previa.titulo}»` : '';
  }

  // ── Guardar (con lo de la pantalla al día al toque) ──

  function sePuedeGuardar() {
    if (estado.sinInternet) {
      app.avisar('Estás sin internet: no se puede guardar ahora.', 'error');
      return false;
    }
    return true;
  }

  /** Se movió o estiró una barra del Gantt: se guarda, y se empujan las que dependen de ella. */
  async function moverDesdeGantt(id, { inicio, fin }) {
    const tarea = buscar(id);
    if (!tarea) throw new Error('La tarea ya no está.');
    if (!sePuedeGuardar()) throw new Error('Sin internet.');
    const antes = estado.tareas;
    const { tareas: nuevas, cambiadas } = moverTarea(estado.tareas, tarea.id, { inicio, fin });
    estado.tareas = nuevas;
    dibujarResumenYVista();
    try {
      await guardarFechas(cambiadas);
      const empujadas = cambiadas.length - 1;
      if (empujadas > 0) {
        app.avisar(`Listo. También se ${empujadas === 1 ? 'corrió 1 tarea que depende' : `corrieron ${empujadas} tareas que dependen`} de esta.`, 'ok');
      }
      recargar();
    } catch (e) {
      console.error(e);
      estado.tareas = antes;
      dibujarResumenYVista();
      app.avisar('No se pudo guardar el cambio de fechas. Fijate la conexión y probá de nuevo.', 'error');
      recargar();
      throw e;
    }
  }

  function dibujarResumenYVista() {
    dibujarCarga();
    dibujarHitos();
    dibujarProyectos();
    dibujarVista();
  }

  async function guardarFechas(cambiadas) {
    await Promise.all(cambiadas.map((t) => fuente.cambiar(t.id, { inicio: t.inicio, fin: t.fin })));
  }

  async function marcarHecha(t, boton) {
    if (!sePuedeGuardar()) return;
    boton.disabled = true;
    try {
      const cambiada = await fuente.cambiar(t.id, { avance: 100, estado: 'hecha' });
      estado.tareas = estado.tareas.map((x) => (x.id === t.id ? { ...x, ...cambiada } : x));
      dibujarTodo();
      app.avisar(t.hito ? `Hito cumplido: «${t.titulo}».` : `Hecha: «${t.titulo}».`, 'ok');
      recargar();
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo guardar. Fijate la conexión y probá de nuevo.', 'error');
      boton.disabled = false;
    }
  }

  async function borrarTarea(t) {
    if (!sePuedeGuardar()) return false;
    const siguen = estado.tareas.filter((x) => x.depende_de === t.id);
    const extra = siguen.length ? ` ${siguen.length === 1 ? 'Hay 1 tarea que dependía de esta: queda' : `Hay ${siguen.length} tareas que dependían de esta: quedan`} suelta${siguen.length === 1 ? '' : 's'}.` : '';
    if (!confirm(`¿Borrar «${t.titulo}»? Se borra para los tres.${extra}`)) return false;
    try {
      // Primero se sueltan las que dependían de esta, así la base no se queja.
      for (const s of siguen) await fuente.cambiar(s.id, { depende_de: null });
      await fuente.borrar(t.id);
      estado.tareas = estado.tareas
        .filter((x) => x.id !== t.id)
        .map((x) => (x.depende_de === t.id ? { ...x, depende_de: null } : x));
      dibujarTodo();
      app.avisar(t.hito ? 'Hito borrado.' : 'Tarea borrada.', 'ok');
      recargar();
      return true;
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo borrar. Fijate la conexión y probá de nuevo.', 'error');
      recargar(0);
      return false;
    }
  }

  // ── Ventanita: tarea o hito (crear / cambiar) ──

  function armarDialogoTarea() {
    const id = 'pl-tarea';
    const titulo = el('h2', { id: `${id}-titulo`, class: 'pl-dialogo__titulo' }, 'Nueva tarea');

    const tipos = el('fieldset', { class: 'pl-segmentos' },
      el('legend', { class: 'pl-legend' }, 'Qué es'),
      el('div', { class: 'pl-segmentos__opciones' },
        ...[['tarea', 'Tarea (con inicio y fin)'], ['hito', 'Hito (una fecha clave)']].map(([valor, nombre]) =>
          el('label', { class: 'pl-segmentos__opcion' },
            el('input', { type: 'radio', name: 'tipo', value: valor }), el('span', {}, nombre)))));

    const nombre = campo({ id: `${id}-nombre`, nombre: 'titulo', etiqueta: 'Qué hay que hacer', max: LARGO_TITULO, ejemplo: 'Ej.: Diseñar la página de inicio', requerido: true });
    const listaProyectos = el('datalist', { id: `${id}-proyectos` });
    const proyecto = campo({ id: `${id}-proyecto`, nombre: 'proyecto', etiqueta: 'Proyecto', max: LARGO_PROYECTO, ejemplo: 'Ej.: Web de Juan', lista: listaProyectos.id });

    const opcionesResponsable = el('div', { class: 'pl-responsables__opciones' });
    const responsables = el('fieldset', { class: 'pl-responsables' }, el('legend', { class: 'pl-legend' }, 'Quién se encarga'), opcionesResponsable);

    const inicio = campo({ id: `${id}-inicio`, nombre: 'inicio', etiqueta: 'Empieza', tipo: 'date', requerido: true });
    const fin = campo({ id: `${id}-fin`, nombre: 'fin', etiqueta: 'Termina (inclusive)', tipo: 'date', requerido: true });
    const duracionTexto = el('p', { class: 'campo__ayuda pl-duracion', 'aria-live': 'polite' });
    const fechas = el('div', { class: 'pl-fechas' }, el('div', { class: 'pl-dos' }, inicio.caja, fin.caja), duracionTexto);

    const avance = el('input', { type: 'range', id: `${id}-avance`, name: 'avance', min: '0', max: '100', step: '5', class: 'pl-rango' });
    const avanceNumero = el('output', { for: `${id}-avance`, class: 'pl-rango__numero' });
    const errorAvance = el('p', { class: 'campo__error', hidden: '' });
    const cajaAvance = el('div', { class: 'pl-avance-campo' },
      el('div', { class: 'pl-avance-campo__cabeza' }, el('label', { for: `${id}-avance` }, 'Cuánto está hecho'), avanceNumero),
      avance, errorAvance);
    const cumplido = el('label', { class: 'pl-casilla' },
      el('input', { type: 'checkbox', name: 'cumplido' }), el('span', {}, 'Ya se cumplió'));

    const dependeDe = el('select', { id: `${id}-depende`, name: 'depende_de' });
    const errorDepende = el('p', { class: 'campo__error', hidden: '' });
    const cajaDepende = el('div', { class: 'campo' },
      el('label', { for: `${id}-depende` }, 'Depende de (opcional)'), dependeDe,
      el('p', { class: 'campo__ayuda' }, 'Si arranca cuando termina otra. Al correr esa, esta se corre sola.'), errorDepende);
    const avisoDepende = el('div', { class: 'pl-ojo', 'aria-live': 'polite' });

    const notas = campo({ id: `${id}-notas`, nombre: 'notas', etiqueta: 'Notas (opcional)', max: LARGO_NOTAS, ejemplo: 'Links, qué falta, a quién preguntarle…', area: true });

    const error = el('p', { class: 'campo__error pl-error', role: 'alert', hidden: '' });
    const guardar = el('button', { type: 'submit', class: 'boton' }, 'Guardar');
    const cancelar = el('button', { type: 'button', class: 'boton boton--suave' }, 'Cancelar');
    const borrar = el('button', { type: 'button', class: 'boton boton--peligro pl-dialogo__borrar' }, 'Borrar');
    const quien = el('p', { class: 'pl-dialogo__quien' });

    const form = el('form', { class: 'dialogo__cuerpo pl-form', novalidate: '' },
      titulo, tipos, nombre.caja, proyecto.caja, listaProyectos, responsables, fechas,
      cajaAvance, cumplido, cajaDepende, avisoDepende, notas.caja, error, quien,
      el('div', { class: 'dialogo__botones' }, guardar, cancelar, borrar));
    const dialogo = el('dialog', { class: 'dialogo pl-dialogo', 'aria-labelledby': `${id}-titulo` }, form);

    // Errores de cada campo (los de validarTarea).
    const errores = {
      titulo: nombre, inicio, fin,
      avance: { input: avance, error: errorAvance },
      depende_de: { input: dependeDe, error: errorDepende },
    };

    let editando = null;
    const esHito = () => form.elements.tipo.value === 'hito';

    function limpiarErrores() {
      error.hidden = true;
      error.textContent = '';
      for (const c of Object.values(errores)) {
        c.error.hidden = true;
        c.error.textContent = '';
        c.input.removeAttribute('aria-invalid');
      }
    }

    // Muestra solo lo que va con cada tipo, y la duración.
    function acomodar() {
      const hito = esHito();
      titulo.textContent = editando ? (hito ? 'Cambiar hito' : 'Cambiar tarea') : (hito ? 'Nuevo hito' : 'Nueva tarea');
      nombre.etiqueta.textContent = hito ? 'Qué pasa ese día' : 'Qué hay que hacer';
      inicio.etiqueta.textContent = hito ? 'Fecha' : 'Empieza';
      fin.caja.hidden = hito;
      cajaAvance.hidden = hito;
      cumplido.hidden = !hito;
      avanceNumero.textContent = `${avance.value}%`;
      const f = form.elements;
      if (!hito && f.inicio.value && f.fin.value) {
        const d = diasEntre(f.inicio.value, f.fin.value);
        duracionTexto.textContent = d === null || d < 0 ? '' : `Son ${d + 1} ${d === 0 ? 'día' : 'días'}.`;
      } else {
        duracionTexto.textContent = '';
      }
      revisarDependencia();
    }

    // Si arranca antes de que termine aquella de la que depende, avisa y ofrece correrla.
    function revisarDependencia() {
      const previa = buscar(dependeDe.value);
      const f = form.elements;
      if (!previa || !f.inicio.value) {
        avisoDepende.replaceChildren();
        return;
      }
      const prueba = { id: editando?.id ?? '__nueva', inicio: f.inicio.value, depende_de: previa.id };
      if (!arrancaAntesDeTiempo(prueba, estado.tareas)) {
        avisoDepende.replaceChildren();
        return;
      }
      const correr = el('button', { type: 'button', class: 'boton boton--suave boton--chico' }, `Que empiece el ${formatearFecha(sumarDias(previa.fin, 1))}`);
      correr.addEventListener('click', () => {
        const largo = esHito() ? 0 : Math.max(0, diasEntre(f.inicio.value, f.fin.value) ?? 0);
        f.inicio.value = sumarDias(previa.fin, 1);
        f.fin.value = sumarDias(f.inicio.value, largo);
        acomodar();
        f.inicio.focus();
      });
      avisoDepende.replaceChildren(
        el('p', {}, `Ojo: «${previa.titulo}» termina el ${formatearFecha(previa.fin)} y esta arranca antes.`),
        correr);
    }

    // Las opciones de «Depende de»: las demás tareas, menos las que dependen de esta (harían un círculo).
    function llenarDependencias(actual) {
      const prohibidas = new Set(actual ? [actual.id, ...dependientesDe(estado.tareas, actual.id).map((t) => t.id)] : []);
      const grupos = new Map();
      for (const t of ordenarTareas(estado.tareas)) {
        if (prohibidas.has(t.id)) continue;
        const clave = t.proyecto || 'Sin proyecto';
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(el('option', { value: String(t.id) },
          `${t.hito ? 'Hito: ' : ''}${t.titulo} (termina el ${formatearFecha(t.fin)})`));
      }
      dependeDe.replaceChildren(el('option', { value: '' }, 'No depende de nada'),
        ...[...grupos].map(([clave, opciones]) => el('optgroup', { label: clave }, ...opciones)));
    }

    function llenarResponsables(marcado) {
      opcionesResponsable.replaceChildren(
        el('label', { class: 'pl-responsable' },
          el('input', { type: 'radio', name: 'responsable', value: '' }),
          el('span', { class: 'avatar avatar--chico pl-responsable__nadie', 'aria-hidden': 'true' }, '–'),
          el('span', {}, 'Nadie todavía')),
        ...personasDelEquipo().map((p) => el('label', { class: 'pl-responsable', 'data-de': p.slug },
          el('input', { type: 'radio', name: 'responsable', value: p.slug }),
          el('span', { class: 'avatar avatar--chico', 'aria-hidden': 'true' }, inicial(p.nombre)),
          el('span', {}, p.nombre))));
      form.elements.responsable.value = marcado ?? '';
    }

    form.addEventListener('input', acomodar);
    form.addEventListener('change', acomodar);
    cancelar.addEventListener('click', () => dialogo.close());
    borrar.addEventListener('click', async () => {
      if (editando && (await borrarTarea(editando))) dialogo.close();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sePuedeGuardar()) return;
      limpiarErrores();
      const f = form.elements;
      const hito = esHito();
      const elegida = buscar(f.depende_de.value);
      const avanceValor = hito ? (f.cumplido.checked ? 100 : 0) : Number(f.avance.value);
      const fila = {
        titulo: f.titulo.value.trim().slice(0, LARGO_TITULO),
        proyecto: f.proyecto.value.trim().slice(0, LARGO_PROYECTO),
        responsable: PERSONAS.includes(f.responsable.value) ? f.responsable.value : null,
        inicio: f.inicio.value || null,
        fin: (hito ? f.inicio.value : f.fin.value) || null,
        avance: avanceValor,
        hito,
        depende_de: elegida ? elegida.id : null,
        notas: f.notas.value.trim().slice(0, LARGO_NOTAS) || null,
      };
      // El estado que se guarda: hecha, en curso o pendiente («atrasada» sale sola de las fechas).
      const calculado = estadoDe({ ...fila, estado: null });
      fila.estado = calculado === 'hecha' ? 'hecha' : calculado === 'pendiente' ? 'pendiente' : 'en_curso';

      const { ok, errores: problemas } = validarTarea({ ...fila, id: editando?.id }, estado.tareas);
      if (!ok) {
        let primero = null;
        for (const [clave, texto] of Object.entries(problemas)) {
          const c = errores[clave];
          if (!c) continue;
          c.error.textContent = texto;
          c.error.hidden = false;
          c.input.setAttribute('aria-invalid', 'true');
          primero ??= c.input;
        }
        error.textContent = 'Revisá lo marcado en rojo.';
        error.hidden = false;
        primero?.focus();
        return;
      }

      guardar.disabled = true;
      try {
        if (editando) {
          const guardada = await fuente.cambiar(editando.id, { ...fila, actualizado_en: new Date().toISOString() });
          // Si cambiaron las fechas, se empujan las que dependen de esta.
          const base = estado.tareas.map((t) => (t.id === editando.id ? { ...t, ...fila } : t));
          const { tareas: nuevas, cambiadas } = moverTarea(base, editando.id, { inicio: fila.inicio, fin: fila.fin });
          const empujadas = cambiadas.filter((t) => t.id !== editando.id);
          await guardarFechas(empujadas);
          estado.tareas = nuevas.map((t) => (t.id === editando.id ? { ...t, ...guardada } : t));
          dibujarTodo();
          dialogo.close();
          app.avisar(empujadas.length
            ? `Guardado. También se ${empujadas.length === 1 ? 'corrió 1 tarea que depende' : `corrieron ${empujadas.length} tareas que dependen`} de esta.`
            : 'Guardado. Ya lo ven los otros dos.', 'ok');
        } else {
          const mismas = estado.tareas.filter((t) => (t.proyecto || '') === fila.proyecto);
          const orden = mismas.reduce((max, t) => Math.max(max, Number(t.orden) || 0), 0) + 1;
          const creada = await fuente.crear({ ...fila, orden, creado_por: yo() || null });
          estado.tareas = [...estado.tareas, creada];
          dibujarTodo();
          dialogo.close();
          app.avisar(hito ? 'Hito guardado. Ya lo ven los otros dos.' : 'Tarea guardada. Ya la ven los otros dos.', 'ok');
        }
        recargar();
      } catch (err) {
        console.error(err);
        error.textContent = 'No se pudo guardar. Fijate la conexión y probá de nuevo.';
        error.hidden = false;
        recargar(0);
      } finally {
        guardar.disabled = false;
      }
    });

    return {
      dialogo,
      abrir(fila, { hito = false } = {}) {
        editando = fila;
        form.reset();
        limpiarErrores();
        borrar.hidden = !fila;
        listaProyectos.replaceChildren(...proyectosDe(estado.tareas).filter(Boolean).map((p) => el('option', { value: p })));
        llenarDependencias(fila);
        const f = form.elements;
        if (fila) {
          f.tipo.value = fila.hito ? 'hito' : 'tarea';
          f.titulo.value = fila.titulo ?? '';
          f.proyecto.value = fila.proyecto ?? '';
          llenarResponsables(fila.responsable);
          f.inicio.value = fila.inicio ?? '';
          f.fin.value = fila.fin ?? '';
          f.avance.value = String(avanceDe(fila));
          f.cumplido.checked = estadoDe(fila) === 'hecha';
          f.depende_de.value = fila.depende_de != null ? String(fila.depende_de) : '';
          f.notas.value = fila.notas ?? '';
          const autor = fila.creado_por ? `La cargó ${nombreDe(fila.creado_por)}` : '';
          const cuando = fila.actualizado_en ? `cambiada por última vez el ${new Date(fila.actualizado_en).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}` : '';
          quien.textContent = [autor, cuando].filter(Boolean).join(' · ');
        } else {
          // Nueva: en el proyecto y la persona que se están mirando, empezando hoy.
          const hoy = hoyISO();
          f.tipo.value = hito ? 'hito' : 'tarea';
          f.proyecto.value = estado.proyecto !== TODOS_LOS_PROYECTOS ? estado.proyecto : '';
          llenarResponsables(PERSONAS.includes(estado.persona) ? estado.persona : yo());
          f.inicio.value = hito ? sumarDias(hoy, 7) : hoy;
          f.fin.value = sumarDias(hoy, 4);
          f.avance.value = '0';
          f.depende_de.value = '';
          quien.textContent = '';
        }
        quien.hidden = !quien.textContent;
        acomodar();
        dialogo.showModal();
        f.titulo.focus();
      },
    };
  }

  function abrirTarea(fila, opciones) {
    if (!partes) return;
    if (!fila && !sePuedeGuardar()) return;
    partes.dialogo.abrir(fila, opciones);
  }
}

// ── Fuentes de datos ─────────────────────────────────────

// Supabase de verdad: tabla planificacion_tareas (supabase/planificacion.sql), en vivo.
function fuenteSupabase(app) {
  const db = app.supabase;
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const tabla = () => db.from('planificacion_tareas');
  return {
    traer: async () => ok(await tabla().select('*').order('orden').order('inicio').limit(3000)) ?? [],
    crear: async (fila) => ok(await tabla().insert(fila).select().single()),
    cambiar: async (id, cambios) => ok(await tabla().update(cambios).eq('id', id).select().single()),
    borrar: async (id) => ok(await tabla().delete().eq('id', id)),

    escuchar(avisar) {
      db.channel('planificacion')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'planificacion_tareas' }, () => avisar())
        .subscribe();
    },
  };
}

// Modo prueba: todo en el localStorage de esta compu, con unos ejemplos para ver cómo queda.
function fuentePrueba(app) {
  const CLAVE = 'ath-prueba-planificacion';

  const leer = () => {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE));
      if (Array.isArray(datos?.tareas)) return datos;
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
  const ahora = () => new Date().toISOString();

  return {
    traer: async () => copia(leer().tareas),
    crear: async (fila) =>
      cambiar((d) => {
        const nueva = { ...fila, id: ++d.sig, creado_por: fila.creado_por ?? app.persona?.slug ?? null, creado_en: ahora(), actualizado_en: ahora() };
        d.tareas.push(nueva);
        return copia(nueva);
      }),
    cambiar: async (id, cambios) =>
      cambiar((d) => {
        const t = d.tareas.find((x) => x.id === id);
        if (!t) throw new Error('Ya no está.');
        Object.assign(t, cambios, { actualizado_en: ahora() });
        return copia(t);
      }),
    borrar: async (id) =>
      cambiar((d) => {
        d.tareas = d.tareas.filter((x) => x.id !== id);
      }),

    escuchar(avisar) {
      // Otra pestaña cambió algo: se recarga (así se ve el «en vivo» sin Supabase).
      window.addEventListener('storage', (e) => {
        if (e.key === CLAVE) avisar();
      });
    },
  };

  function ejemplo() {
    const hoy = hoyISO();
    const d = (dias) => sumarDias(hoy, dias);
    const t = (id, titulo, proyecto, responsable, inicio, fin, avance, extra = {}) => ({
      id, titulo, proyecto, responsable, inicio, fin, avance,
      estado: avance >= 100 ? 'hecha' : 'pendiente', depende_de: null, hito: false, notas: null,
      orden: id, creado_por: 'tomas', creado_en: ahora(), actualizado_en: ahora(), ...extra,
    });
    const datos = {
      sig: 100,
      tareas: [
        t(1, 'Reunión de arranque con Juan', 'Web de Juan', 'aostri', d(-10), d(-9), 100),
        t(2, 'Bocetos de la página', 'Web de Juan', 'hassan', d(-8), d(-2), 100, { depende_de: 1 }),
        t(3, 'Armar la página de inicio', 'Web de Juan', 'tomas', d(-1), d(6), 40, { depende_de: 2 }),
        t(4, 'Cargar fotos y textos', 'Web de Juan', 'aostri', d(-4), d(-1), 60),
        t(5, 'Entrega a Juan', 'Web de Juan', 'tomas', d(9), d(9), 0, { hito: true, depende_de: 3 }),
        t(6, 'Pestaña de Planificación', 'CRM ATH', 'tomas', d(-3), d(4), 70),
        t(7, 'Probar en el celu', 'CRM ATH', 'hassan', d(5), d(7), 0, { depende_de: 6 }),
        t(8, 'Publicar la versión nueva', 'CRM ATH', null, d(14), d(14), 0, { hito: true }),
        t(9, 'Presupuesto para el local de ropa', 'Local de ropa', 'aostri', d(2), d(5), 0),
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
    else if (nombre === 'style') nodo.style.cssText = valor;
    else nodo.setAttribute(nombre, valor === true ? '' : valor);
  }
  for (const hijo of hijos) {
    if (hijo == null || hijo === '') continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

// Un campo con su etiqueta y su error (.campo de base.css).
function campo({ id, nombre, etiqueta, tipo = 'text', max, ejemplo, requerido, area, lista }) {
  const input = el(area ? 'textarea' : 'input', {
    id, name: nombre,
    type: area ? null : tipo,
    maxlength: max ? String(max) : null,
    placeholder: ejemplo ?? null,
    required: requerido ? '' : null,
    rows: area ? '3' : null,
    list: lista ?? null,
    autocomplete: 'off',
  });
  const rotulo = el('label', { for: id }, etiqueta);
  const error = el('p', { class: 'campo__error', hidden: '' });
  return { caja: el('div', { class: 'campo' }, rotulo, input, error), input, etiqueta: rotulo, error };
}

function leerVista() {
  try {
    const v = localStorage.getItem(CLAVE_VISTA);
    return VISTAS.some((x) => x.valor === v) ? v : 'gantt';
  } catch {
    return 'gantt';
  }
}

function guardarVista(valor) {
  try {
    localStorage.setItem(CLAVE_VISTA, valor);
  } catch {
    /* sin lugar: no pasa nada, la próxima arranca en Gantt */
  }
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function inicial(nombre) {
  return (String(nombre ?? '?').trim().charAt(0) || '?').toUpperCase();
}
