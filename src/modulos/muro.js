// Muro de ideas: pantalla propia (#/muro, pestaña «Ideas»), compartida en vivo entre los tres.
// Cada uno pega papelitos de colores; cualquiera los apoya («Me copa») y los mueve: suelta → en marcha → hecha.
// Datos: tabla ideas_muro (supabase/muro.sql). Sin Supabase, modo prueba en esta compu.
import '../estilos/muro.css';

const COLORES = [
  { valor: 'amarillo', nombre: 'Amarillo' },
  { valor: 'rosa', nombre: 'Rosa' },
  { valor: 'celeste', nombre: 'Celeste' },
  { valor: 'verde', nombre: 'Verde' },
  { valor: 'lila', nombre: 'Lila' },
];

const ESTADOS = [
  { valor: 'suelta', nombre: 'Sueltas', uno: 'Suelta' },
  { valor: 'en marcha', nombre: 'En marcha', uno: 'En marcha' },
  { valor: 'hecha', nombre: 'Hechas', uno: 'Hecha' },
];

// Qué botón ofrece cada estado para avanzar (y el aviso que sale).
const SIGUIENTE = {
  suelta: { a: 'en marcha', boton: '¡La hacemos!', aviso: '¡Arriba! La idea pasó a «En marcha».' },
  'en marcha': { a: 'hecha', boton: 'Marcar hecha', aviso: '¡Bien ahí! Idea hecha.' },
  hecha: { a: 'suelta', boton: 'Volver a abrir', aviso: 'La idea volvió a quedar suelta.' },
};

const LARGO_MAXIMO = 500;

export function iniciar(app) {
  const estado = {
    ideas: [],
    error: false,
    sinEstado: false, // true si todavía no se corrió supabase/muro.sql (no hay columna «estado»)
    ver: 'todas', // 'todas' | 'suelta' | 'en marcha' | 'hecha'
    de: 'todos', // 'todos' | slug
    orden: 'nuevas', // 'nuevas' | 'apoyadas'
    editando: null, // id de la idea que se está retocando
    vistas: null, // ids ya mostrados (para resaltar las que llegan en vivo)
    recienLlegadas: new Set(),
    armado: false,
  };
  let fuente = null;
  let partes = null;
  let esperando = null;

  app.registrarPantalla({
    ruta: 'muro',
    titulo: 'Ideas',
    orden: 15,
    mostrar({ zona }) {
      if (!estado.armado) {
        estado.armado = true;
        fuente = app.conectado ? fuenteSupabase(app) : fuentePrueba(app);
        partes = armar(zona);
        fuente.escuchar(() => recargar());
        app.escuchar('personas', () => dibujar());
        // Los «hace 5 minutos» se ponen al día solos.
        setInterval(() => {
          if (!zona.hidden && estado.editando == null) dibujarTablero();
        }, 60_000);
      }
      dibujarEquipo();
      recargar(0);
    },
  });

  // ── Datos ────────────────────────────────────────────

  // Junta varios avisos seguidos (ej. tres «me copa» en un segundo) en una sola recarga.
  function recargar(demora = 250) {
    clearTimeout(esperando);
    esperando = setTimeout(traer, demora);
  }

  async function traer() {
    try {
      const { ideas, sinEstado } = await fuente.ideas();
      estado.ideas = ideas.map((i) => ({
        ...i,
        estado: i.estado ?? 'suelta',
        apoyos: Array.isArray(i.apoyos) ? i.apoyos : [],
      }));
      estado.sinEstado = sinEstado;
      estado.error = false;
    } catch (e) {
      console.error('[muro]', e);
      estado.error = true;
    }
    // Las que llegaron de otro mientras miraba: se marcan para que se note.
    const yo = app.persona?.slug;
    if (estado.vistas) {
      for (const i of estado.ideas) {
        if (!estado.vistas.has(i.id) && i.autor !== yo) estado.recienLlegadas.add(i.id);
      }
    }
    estado.vistas = new Set(estado.ideas.map((i) => i.id));
    dibujar();
  }

  // ── Armado (una sola vez) ────────────────────────────

  function armar(zona) {
    const equipo = el('ul', { class: 'muro-equipo', 'aria-label': 'Los tres ven este muro' });
    const resumen = el('p', { class: 'muro-cabeza__resumen' });

    const cabeza = el('header', { class: 'cabeza-pantalla muro-cabeza' },
      el('div', {},
        el('p', { class: 'cabeza-pantalla__ante' }, 'Entre los tres'),
        el('h1', {}, 'Muro de ideas'),
        el('p', { class: 'cabeza-pantalla__bajada' }, 'Lo que se te ocurra, sin filtro. Si a otro le copa, que lo apoye; si la hacemos, se mueve.')),
      el('div', { class: 'muro-cabeza__lado' },
        el('span', { class: 'muro-envivo' }, el('span', { class: 'muro-envivo__punto', 'aria-hidden': 'true' }), 'En vivo'),
        equipo,
        resumen),
    );

    const nueva = armarFormNueva();

    // Herramientas: qué ver, de quién y en qué orden.
    const ver = el('div', { class: 'muro-segmentos', role: 'group', 'aria-label': 'Qué ideas ver' });
    ver.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ver]');
      if (!b) return;
      estado.ver = b.dataset.ver;
      dibujar();
    });

    const de = el('div', { class: 'muro-personas', role: 'group', 'aria-label': 'De quién' });
    de.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-de-filtro]');
      if (!b) return;
      estado.de = b.dataset.deFiltro;
      dibujar();
    });

    const orden = el('select', { id: 'muro-orden', class: 'muro-orden__select' },
      el('option', { value: 'nuevas' }, 'Más nuevas primero'),
      el('option', { value: 'apoyadas' }, 'Las que más copan'));
    orden.addEventListener('change', () => {
      estado.orden = orden.value;
      dibujarTablero();
    });

    const herramientas = el('div', { class: 'muro-herramientas' },
      ver,
      el('div', { class: 'muro-herramientas__derecha' },
        de,
        el('label', { class: 'muro-orden' }, el('span', { class: 'visualmente-oculto' }, 'Ordenar'), orden)),
    );

    const aviso = el('p', { class: 'muro-aviso', role: 'status', hidden: '' });
    const tablero = el('div', { class: 'muro-tablero', 'aria-live': 'off' });

    const notaPrueba = app.conectado
      ? null
      : el('p', { class: 'muro-prueba' }, 'Modo prueba: lo que pegues queda solo en esta compu (y se ve en otras pestañas).');

    zona.classList.add('muro');
    zona.replaceChildren(cabeza, nueva.form, herramientas, aviso, tablero, ...(notaPrueba ? [notaPrueba] : []));

    return { equipo, resumen, nueva, ver, de, orden, aviso, tablero };
  }

  function armarFormNueva() {
    const texto = el('textarea', {
      id: 'muro-nueva-texto', name: 'texto', rows: '3', maxlength: String(LARGO_MAXIMO), required: '',
      placeholder: '¿Y si…?', 'aria-describedby': 'muro-nueva-ayuda muro-nueva-error',
    });
    const cuenta = el('span', { class: 'muro-nueva__cuenta', 'aria-hidden': 'true' });
    const error = el('p', { id: 'muro-nueva-error', class: 'campo__error muro-nueva__error', hidden: '' });
    const colores = elegirColor('muro-nueva-color', 'amarillo');
    const boton = el('button', { class: 'boton', type: 'submit' }, 'Pegar en el muro');

    const form = el('form', { class: 'muro-nueva', 'data-color': 'amarillo', novalidate: '' },
      el('label', { for: 'muro-nueva-texto', class: 'muro-nueva__titulo' }, 'Tirá una idea'),
      texto,
      el('div', { class: 'muro-nueva__pie' },
        colores.caja,
        el('p', { id: 'muro-nueva-ayuda', class: 'muro-nueva__ayuda' }, cuenta, el('span', { class: 'muro-solo-compu' }, ' · Ctrl + Enter pega')),
        boton),
      error,
    );

    // El papelito de escribir toma el color que elegís.
    colores.caja.addEventListener('change', () => {
      form.dataset.color = colores.valor();
    });
    const contar = () => {
      cuenta.textContent = `${texto.value.length}/${LARGO_MAXIMO}`;
    };
    contar();
    texto.addEventListener('input', () => {
      contar();
      mostrarError(texto, error, '');
    });
    texto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const limpio = texto.value.trim();
      if (!limpio) return mostrarError(texto, error, 'Escribí la idea antes de pegarla.');
      if (limpio.length > LARGO_MAXIMO) return mostrarError(texto, error, `Que tenga ${LARGO_MAXIMO} letras como mucho.`);
      boton.disabled = true;
      try {
        await fuente.pegar({ texto: limpio, color: colores.valor() });
        texto.value = '';
        contar();
        // Si estaba mirando otra cosa, vuelve a ver todo para que aparezca la suya.
        if (estado.ver === 'hecha' || estado.ver === 'en marcha') estado.ver = 'todas';
        if (estado.de !== 'todos' && estado.de !== app.persona.slug) estado.de = 'todos';
        app.avisar('Idea pegada. Ya la ven los otros dos.', 'ok');
        recargar(0);
      } catch (err) {
        console.error(err);
        app.avisar('No se pudo pegar la idea. Fijate la conexión y probá de nuevo.', 'error');
      } finally {
        boton.disabled = false;
      }
    });

    return { form };
  }

  // Los circulitos de colores (radios). Devuelve la caja y cómo leer el elegido.
  function elegirColor(nombre, elegido) {
    const caja = el('fieldset', { class: 'muro-colores' }, el('legend', { class: 'visualmente-oculto' }, 'Color del papelito'));
    for (const c of COLORES) {
      const radio = el('input', { type: 'radio', name: nombre, value: c.valor, 'aria-label': c.nombre });
      radio.checked = c.valor === elegido;
      caja.append(el('label', { class: 'muro-colores__opcion', 'data-color': c.valor, title: c.nombre }, radio));
    }
    return { caja, valor: () => caja.querySelector('input:checked')?.value ?? 'amarillo' };
  }

  // ── Dibujar ──────────────────────────────────────────

  function dibujar() {
    if (!partes) return;
    dibujarEquipo();
    dibujarHerramientas();
    dibujarTablero();
  }

  function dibujarEquipo() {
    if (!partes) return;
    partes.equipo.replaceChildren(
      ...app.personas.map((p) =>
        el('li', { title: p.nombre },
          el('span', { class: 'avatar avatar--chico', 'data-de': p.slug, 'aria-hidden': 'true' }, inicial(p.nombre)),
          el('span', { class: 'visualmente-oculto' }, p.nombre))),
    );
    const abiertas = estado.ideas.filter((i) => i.estado !== 'hecha').length;
    const semana = Date.now() - 7 * 864e5;
    const nuevas = estado.ideas.filter((i) => new Date(i.creado).getTime() > semana).length;
    const trozos = [`${abiertas} ${abiertas === 1 ? 'idea abierta' : 'ideas abiertas'}`];
    if (nuevas) trozos.push(`${nuevas} ${nuevas === 1 ? 'nueva' : 'nuevas'} esta semana`);
    partes.resumen.textContent = trozos.join(' · ');
  }

  function dibujarHerramientas() {
    const porPersona = estado.ideas.filter((i) => estado.de === 'todos' || i.autor === estado.de);
    const cuantas = (v) => (v === 'todas' ? porPersona.length : porPersona.filter((i) => i.estado === v).length);

    // Sin la columna «estado» todavía, no tiene sentido separar por estado.
    const opciones = estado.sinEstado ? [] : ESTADOS;
    if (estado.sinEstado) estado.ver = 'todas';
    partes.ver.hidden = estado.sinEstado;
    partes.ver.replaceChildren(
      ...[{ valor: 'todas', nombre: 'Todas' }, ...opciones].map((o) =>
        el('button', { type: 'button', class: 'muro-segmentos__boton', 'data-ver': o.valor, 'aria-pressed': String(estado.ver === o.valor) },
          o.nombre, el('span', { class: 'muro-segmentos__cuenta' }, String(cuantas(o.valor))))),
    );

    partes.de.replaceChildren(
      el('button', { type: 'button', class: 'muro-personas__boton', 'data-de-filtro': 'todos', 'aria-pressed': String(estado.de === 'todos') }, 'De todos'),
      ...app.personas.map((p) =>
        el('button', {
          type: 'button', class: 'muro-personas__boton', 'data-de-filtro': p.slug, 'data-de': p.slug,
          'aria-pressed': String(estado.de === p.slug), 'aria-label': `Solo las de ${p.nombre}`, title: `Solo las de ${p.nombre}`,
        }, el('span', { class: 'avatar avatar--chico', 'aria-hidden': 'true' }, inicial(p.nombre)),
        el('span', { class: 'muro-personas__nombre' }, p.nombre))),
    );

    partes.aviso.hidden = !estado.sinEstado;
    partes.aviso.textContent = estado.sinEstado
      ? 'Para poder mover ideas a «En marcha» y «Hechas», falta correr supabase/muro.sql en Supabase.'
      : '';
  }

  function visibles() {
    const lista = estado.ideas.filter(
      (i) => (estado.ver === 'todas' || i.estado === estado.ver) && (estado.de === 'todos' || i.autor === estado.de),
    );
    const porFecha = (a, b) => String(b.creado).localeCompare(String(a.creado));
    if (estado.orden === 'apoyadas') return lista.sort((a, b) => b.apoyos.length - a.apoyos.length || porFecha(a, b));
    // En «Todas», las hechas van al final (ya cumplieron).
    return lista.sort((a, b) => (estado.ver === 'todas' ? (a.estado === 'hecha') - (b.estado === 'hecha') : 0) || porFecha(a, b));
  }

  function dibujarTablero() {
    if (!partes) return;
    // Mientras alguien retoca una idea, no se le redibuja encima (se hace al terminar).
    if (estado.editando != null && partes.tablero.querySelector('.muro-papelito--editando')) return;

    if (estado.error) {
      partes.tablero.replaceChildren(el('p', { class: 'muro-error', role: 'alert' },
        'No pude traer el muro de ideas. ¿Ya se corrió supabase/muro.sql en Supabase? Probá recargar.'));
      return;
    }

    const lista = visibles();
    if (!lista.length) {
      partes.tablero.replaceChildren(vacio());
      return;
    }
    conservarFoco(partes.tablero, () => partes.tablero.replaceChildren(...lista.map(papelito)));
    // Lo «recién llegado» se resalta una sola vez.
    estado.recienLlegadas.clear();
  }

  function vacio() {
    if (!estado.ideas.length) {
      return el('div', { class: 'vacio-comun muro-vacio' },
        el('span', { class: 'muro-vacio__dibujo', 'aria-hidden': 'true' }, '💡'),
        el('strong', {}, 'El muro está vacío.'),
        el('span', {}, 'La primera idea siempre es la más valiente.'));
    }
    const que = { suelta: 'ideas sueltas', 'en marcha': 'ideas en marcha', hecha: 'ideas hechas' }[estado.ver] ?? 'ideas';
    const quien = estado.de === 'todos' ? '' : ` de ${app.buscarPersona(estado.de)?.nombre ?? estado.de}`;
    return el('div', { class: 'vacio-comun muro-vacio' },
      el('strong', {}, `No hay ${que}${quien}.`),
      el('span', {}, 'Probá con otro filtro arriba.'));
  }

  function papelito(idea) {
    const yo = app.persona.slug;
    const autor = app.buscarPersona(idea.autor);
    const esMia = idea.autor === yo;
    const meCopa = idea.apoyos.includes(yo);
    const nombresApoyos = idea.apoyos.map((s) => app.buscarPersona(s)?.nombre ?? s);
    const editando = estado.editando === idea.id;
    const fecha = new Date(idea.creado);

    const clases = ['muro-papelito'];
    if (idea.estado === 'hecha') clases.push('muro-papelito--hecha');
    if (idea.estado === 'en marcha') clases.push('muro-papelito--marcha');
    if (estado.recienLlegadas.has(idea.id)) clases.push('muro-papelito--llego');
    if (editando) clases.push('muro-papelito--editando');

    const nodo = el('article', {
      class: clases.join(' '), 'data-color': idea.color, 'data-clave': `i:${idea.id}`,
      'aria-label': `Idea de ${autor?.nombre ?? idea.autor}`,
    });

    if (!estado.sinEstado && idea.estado !== 'suelta') {
      nodo.append(el('span', { class: 'muro-sello' },
        idea.estado === 'hecha' ? '✓ Hecha' : 'En marcha'));
    }

    if (editando) {
      nodo.append(formEditar(idea));
      return nodo;
    }

    nodo.append(el('p', { class: 'muro-papelito__texto' }, idea.texto));

    // Quién y cuándo
    const autoria = el('p', { class: 'muro-papelito__autoria', 'data-de': idea.autor },
      el('span', { class: 'avatar avatar--chico', 'aria-hidden': 'true' }, inicial(autor?.nombre ?? idea.autor)),
      el('span', { class: 'muro-papelito__autor' }, autor?.nombre ?? idea.autor),
      el('time', { class: 'muro-papelito__cuando', datetime: fecha.toISOString(), title: fecha.toLocaleString('es-AR') }, haceCuanto(fecha)));

    // Me copa: con las caritas de los que la apoyaron
    const caritas = el('span', { class: 'muro-caritas', 'aria-hidden': 'true' },
      ...idea.apoyos.slice(0, 3).map((s) => el('span', { class: 'avatar avatar--chico', 'data-de': s }, inicial(app.buscarPersona(s)?.nombre ?? s))));
    const apoyar = el('button', {
      type: 'button', class: 'muro-apoyo', 'aria-pressed': String(meCopa),
      title: nombresApoyos.length ? `Le copa a ${listaDeNombres(nombresApoyos)}` : 'Todavía no la apoyó nadie',
      'aria-label': `Me copa${nombresApoyos.length ? ` (le copa a ${listaDeNombres(nombresApoyos)})` : ''}`,
    }, el('span', { 'aria-hidden': 'true' }, '👍'), 'Me copa', idea.apoyos.length ? el('span', { class: 'muro-apoyo__cuenta' }, String(idea.apoyos.length)) : '');
    apoyar.addEventListener('click', () => accion(apoyar, () => fuente.apoyar(idea.id), 'No se pudo guardar el «me copa».'));

    const pie = el('div', { class: 'muro-papelito__pie' }, autoria, el('div', { class: 'muro-papelito__apoyos' }, caritas, apoyar));

    // Acciones: mover (cualquiera) · retocar y despegar (solo la mía)
    const acciones = el('div', { class: 'muro-papelito__acciones' });
    if (!estado.sinEstado) {
      const sig = SIGUIENTE[idea.estado] ?? SIGUIENTE.suelta;
      const mover = el('button', { type: 'button', class: 'muro-accion muro-accion--fuerte' }, sig.boton);
      mover.addEventListener('click', () =>
        accion(mover, () => fuente.mover(idea.id, sig.a), 'No se pudo mover la idea.', sig.aviso));
      acciones.append(mover);
      // Desde «En marcha» también se puede volver atrás.
      if (idea.estado === 'en marcha') {
        const atras = el('button', { type: 'button', class: 'muro-accion' }, 'Todavía no');
        atras.addEventListener('click', () => accion(atras, () => fuente.mover(idea.id, 'suelta'), 'No se pudo mover la idea.'));
        acciones.append(atras);
      }
    }
    if (esMia) {
      const retocar = el('button', { type: 'button', class: 'muro-accion', 'data-retocar': '' }, 'Retocar');
      retocar.addEventListener('click', () => {
        estado.editando = idea.id;
        dibujarTablero();
        partes.tablero.querySelector('.muro-papelito--editando textarea')?.focus();
      });
      const despegar = el('button', { type: 'button', class: 'muro-accion muro-accion--peligro' }, 'Despegar');
      despegar.addEventListener('click', () => {
        if (!confirm(`¿Despegar «${recortar(idea.texto, 60)}» del muro? Se borra para los tres.`)) return;
        accion(despegar, () => fuente.despegar(idea.id), 'No se pudo despegar. Probá de nuevo.', 'Idea despegada.');
      });
      acciones.append(retocar, despegar);
    }

    nodo.append(pie);
    if (acciones.childElementCount) nodo.append(acciones);
    return nodo;
  }

  function formEditar(idea) {
    const id = `muro-editar-${idea.id}`;
    const texto = el('textarea', { id, rows: '4', maxlength: String(LARGO_MAXIMO), 'aria-describedby': `${id}-error` });
    texto.value = idea.texto;
    const error = el('p', { id: `${id}-error`, class: 'campo__error', hidden: '' });
    const colores = elegirColor(`${id}-color`, idea.color);
    const guardar = el('button', { type: 'submit', class: 'boton boton--chico' }, 'Guardar');
    const cancelar = el('button', { type: 'button', class: 'boton boton--fantasma boton--chico' }, 'Cancelar');

    const form = el('form', { class: 'muro-editar', novalidate: '' },
      el('label', { for: id, class: 'visualmente-oculto' }, 'Retocar la idea'),
      texto, error,
      el('div', { class: 'muro-editar__pie' }, colores.caja, el('div', { class: 'fila' }, cancelar, guardar)));

    const terminar = () => {
      estado.editando = null;
      dibujarTablero();
      partes.tablero.querySelector(`[data-clave="i:${idea.id}"] [data-retocar]`)?.focus();
    };
    colores.caja.addEventListener('change', () => {
      form.closest('.muro-papelito').dataset.color = colores.valor();
    });
    cancelar.addEventListener('click', terminar);
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') terminar();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
    texto.addEventListener('input', () => mostrarError(texto, error, ''));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const limpio = texto.value.trim();
      if (!limpio) return mostrarError(texto, error, 'La idea no puede quedar vacía (si no va más, despegala).');
      if (limpio.length > LARGO_MAXIMO) return mostrarError(texto, error, `Que tenga ${LARGO_MAXIMO} letras como mucho.`);
      guardar.disabled = true;
      try {
        await fuente.retocar(idea.id, { texto: limpio, color: colores.valor() });
        idea.texto = limpio;
        idea.color = colores.valor();
        terminar();
        recargar(0);
      } catch (err) {
        console.error(err);
        app.avisar('No se pudo guardar. Probá de nuevo.', 'error');
        guardar.disabled = false;
      }
    });
    return form;
  }

  // Corre una acción de un botón: lo apaga mientras tanto y avisa si falla.
  async function accion(boton, hacer, siFalla, siSale) {
    boton.disabled = true;
    try {
      await hacer();
      if (siSale) app.avisar(siSale, 'ok');
      recargar(0);
    } catch (e) {
      console.error(e);
      app.avisar(siFalla, 'error');
      boton.disabled = false;
    }
  }
}

// ── Fuentes de datos ─────────────────────────────────────

// Supabase de verdad: tabla ideas_muro (supabase/muro.sql), en vivo.
function fuenteSupabase(app) {
  const db = app.supabase;
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const columnas = 'id, texto, color, autor, apoyos, estado, creado';

  return {
    async ideas() {
      const r = await db.from('ideas_muro').select(columnas).order('creado', { ascending: false }).limit(300);
      // Si muro.sql todavía no se corrió, falta la columna «estado»: se muestra igual, sin estados.
      if (r.error && (r.error.code === '42703' || /estado/.test(r.error.message ?? ''))) {
        const sin = ok(await db.from('ideas_muro').select(columnas.replace(', estado', ''))
          .order('creado', { ascending: false }).limit(300));
        return { ideas: sin, sinEstado: true };
      }
      return { ideas: ok(r), sinEstado: false };
    },
    pegar: async ({ texto, color }) => ok(await db.from('ideas_muro').insert({ texto, color })),
    retocar: async (id, { texto, color }) => ok(await db.from('ideas_muro').update({ texto, color }).eq('id', id)),
    despegar: async (id) => ok(await db.from('ideas_muro').delete().eq('id', id)),
    apoyar: async (id) => ok(await db.rpc('apoyar_idea', { idea: id })),
    mover: async (id, a) => ok(await db.rpc('mover_idea', { idea: id, a })),

    escuchar(avisar) {
      db.channel('muro')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ideas_muro' }, () => avisar())
        .subscribe();
    },
  };
}

// Modo prueba: todo en el localStorage de esta compu. Arranca con las ideas de prueba del Inicio (si hay).
function fuentePrueba(app) {
  const CLAVE = 'ath-prueba-muro';
  const yo = () => app.persona.slug;
  const ahora = () => new Date().toISOString();

  const leer = () => {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE));
      if (Array.isArray(datos?.ideas)) return datos;
    } catch {
      /* si está roto, se arma de nuevo */
    }
    return ejemplo();
  };
  const cambiar = (fn) => {
    const datos = leer();
    fn(datos);
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  };
  const buscar = (d, id) => d.ideas.find((x) => x.id === id);

  return {
    ideas: async () => ({ ideas: leer().ideas, sinEstado: false }),
    pegar: async ({ texto, color }) =>
      cambiar((d) => {
        d.ideas.unshift({ id: ++d.sig, texto, color, autor: yo(), apoyos: [], estado: 'suelta', creado: ahora() });
      }),
    retocar: async (id, { texto, color }) =>
      cambiar((d) => {
        const i = buscar(d, id);
        if (i && i.autor === yo()) Object.assign(i, { texto, color });
      }),
    despegar: async (id) =>
      cambiar((d) => {
        d.ideas = d.ideas.filter((x) => !(x.id === id && x.autor === yo()));
      }),
    apoyar: async (id) =>
      cambiar((d) => {
        const i = buscar(d, id);
        if (i) i.apoyos = i.apoyos.includes(yo()) ? i.apoyos.filter((s) => s !== yo()) : [...i.apoyos, yo()];
      }),
    mover: async (id, a) =>
      cambiar((d) => {
        const i = buscar(d, id);
        if (i) i.estado = a;
      }),

    escuchar(avisar) {
      // Otra pestaña cambió algo: se recarga (así se ve el «en vivo» sin Supabase).
      window.addEventListener('storage', (e) => {
        if (e.key === CLAVE) avisar();
      });
    },
  };

  function ejemplo() {
    const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();
    let ideas = null;
    try {
      ideas = JSON.parse(localStorage.getItem('ath-prueba-inicio'))?.ideas ?? null;
    } catch {
      ideas = null;
    }
    if (!Array.isArray(ideas) || !ideas.length) {
      ideas = [
        { id: 6, texto: 'Un newsletter mensual con lo que hicimos para cada cliente', color: 'amarillo', autor: 'aostri', apoyos: ['tomas'], creado: hace(30) },
        { id: 7, texto: 'Paquete «web + Instagram» para comercios del barrio', color: 'celeste', autor: 'hassan', apoyos: ['aostri', 'tomas'], estado: 'en marcha', creado: hace(400) },
        { id: 8, texto: 'Plantilla base para que cada sitio nuevo arranque en un día', color: 'verde', autor: 'tomas', apoyos: [], creado: hace(1500) },
        { id: 9, texto: 'Sacar fotos lindas de los locales de los clientes, una tarde por mes', color: 'rosa', autor: 'aostri', apoyos: ['hassan'], creado: hace(2900) },
        { id: 10, texto: 'Comprar el dominio de ATH', color: 'lila', autor: 'tomas', apoyos: ['aostri', 'hassan'], estado: 'hecha', creado: hace(6000) },
      ];
    }
    const datos = {
      sig: Math.max(100, ...ideas.map((i) => Number(i.id) || 0)),
      ideas: ideas.map((i) => ({ estado: 'suelta', apoyos: [], ...i })),
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

function mostrarError(campo, zonaError, texto) {
  zonaError.textContent = texto;
  zonaError.hidden = !texto;
  if (texto) {
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
  } else {
    campo.removeAttribute('aria-invalid');
  }
}

// Al redibujar, que el foco del teclado vuelva al mismo botón del mismo papelito (si sigue ahí).
function conservarFoco(contenedor, redibujar) {
  const activo = document.activeElement;
  const dentro = contenedor.contains(activo);
  const clave = dentro ? activo.closest('[data-clave]')?.dataset.clave : null;
  const botones = clave ? [...contenedor.querySelectorAll(`[data-clave="${CSS.escape(clave)}"] button`)] : [];
  const cual = botones.indexOf(activo);
  redibujar();
  if (!clave) return;
  const nuevo = contenedor.querySelector(`[data-clave="${CSS.escape(clave)}"]`);
  const destino = nuevo?.querySelectorAll('button')[Math.max(cual, 0)] ?? nuevo;
  destino?.focus?.({ preventScroll: true });
}

function inicial(nombre) {
  return (String(nombre ?? '?').trim().charAt(0) || '?').toUpperCase();
}

function recortar(texto, largo) {
  const t = String(texto ?? '');
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
}

function listaDeNombres(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`;
}

const relativo = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });
function haceCuanto(fecha) {
  const segundos = Math.round((fecha.getTime() - Date.now()) / 1000);
  const abs = Math.abs(segundos);
  if (abs < 45) return 'recién';
  if (abs < 3600) return relativo.format(Math.round(segundos / 60), 'minute');
  if (abs < 86400) return relativo.format(Math.round(segundos / 3600), 'hour');
  if (abs < 7 * 86400) return relativo.format(Math.round(segundos / 86400), 'day');
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(fecha);
}
