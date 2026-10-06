// Clientes y posibles clientes: el tablero común (#/clientes) y la ficha de cada uno (#/clientes/ID).
// Con Supabase todo se guarda en la base y se ve en vivo en las otras compus; en modo prueba vive en esta compu.
// Las tablas están en supabase/clientes.sql.
import '../estilos/clientes.css';

// ── Constantes ─────────────────────────────────────────────────────────

const ESTADOS = [
  { id: 'contactado', nombre: 'Contactado', ayuda: 'Les escribimos o nos escribieron' },
  { id: 'charlando', nombre: 'Charlando', ayuda: 'Hay conversación en marcha' },
  { id: 'presupuesto', nombre: 'Presupuesto', ayuda: 'Les pasamos un precio' },
  { id: 'ganado', nombre: 'Ganado', ayuda: 'Ya es cliente' },
  { id: 'perdido', nombre: 'Perdido', ayuda: 'No se dio (queda guardado)' },
];
const ES_POSIBLE = new Set(['contactado', 'charlando', 'presupuesto']);

const TABLAS = ['clientes', 'tareas', 'cliente_notas', 'cliente_links', 'cliente_plata', 'archivos'];

const MAX_BYTES = 50 * 1024 * 1024;
const TOPE_ESPACIO = 1024 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
]);

const CLAVE_PRUEBA = 'ath-prueba-clientes';

// ── Arranque del módulo ────────────────────────────────────────────────

export function iniciar(app) {
  const datos = app.conectado ? datosSupabase(app.supabase) : datosLocales();
  const pantalla = crearPantalla(app, datos);

  app.registrarPantalla({
    ruta: 'clientes',
    titulo: 'Clientes',
    icono: '🤝',
    orden: 20,
    mostrar: ({ zona, params }) => pantalla.mostrar(zona, params),
    ocultar: () => pantalla.ocultar(),
  });

  // Lo que cambia otro (o esta misma persona en otra ventana) se recarga solo.
  datos.escuchar(() => pantalla.recargarPronto());
  app.escuchar('personas', () => pantalla.repintarNombres());
}

// ── Datos: Supabase ────────────────────────────────────────────────────

function datosSupabase(sb) {
  async function ok(promesa) {
    const { data, error } = await promesa;
    if (error) throw error;
    return data;
  }
  return {
    conectado: true,
    traer(tabla, filtros = {}) {
      let q = sb.from(tabla).select('*');
      for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v);
      return ok(q);
    },
    traerUno(tabla, id) {
      return ok(sb.from(tabla).select('*').eq('id', id).maybeSingle());
    },
    crear(tabla, fila) {
      return ok(sb.from(tabla).insert(fila).select().single());
    },
    cambiar(tabla, id, cambios) {
      return ok(sb.from(tabla).update(cambios).eq('id', id).select().single());
    },
    borrar(tabla, id) {
      return ok(sb.from(tabla).delete().eq('id', id));
    },
    escuchar(fn) {
      let canal = sb.channel('clientes-en-vivo');
      for (const tabla of TABLAS) {
        canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => fn(tabla));
      }
      canal.subscribe();
    },

    // Archivos: la caja privada «archivos» de Storage + la fila en la tabla archivos.
    async subirArchivo({ clienteId, archivo }) {
      const ruta = `clientes/${clienteId}/${crypto.randomUUID()}-${nombreLimpio(archivo.name)}`;
      const { error } = await sb.storage.from('archivos').upload(ruta, archivo, { contentType: archivo.type, upsert: false });
      if (error) {
        console.error(error);
        throw new Error(
          /row-level security|policy/i.test(error.message)
            ? 'No hay más lugar para archivos (1 GB). Borrá alguno viejo.'
            : `No se pudo subir «${archivo.name}». Probá de nuevo.`,
        );
      }
      const { error: errorFila } = await sb.from('archivos').insert({
        cliente_id: clienteId,
        ruta,
        nombre: archivo.name.slice(0, 255),
        tamano: archivo.size,
        tipo: archivo.type,
      });
      if (errorFila) {
        console.error(errorFila);
        await sb.storage.from('archivos').remove([ruta]); // que no quede un archivo huérfano
        throw new Error(`No se pudo guardar «${archivo.name}». Probá de nuevo.`);
      }
    },
    async linkParaBajar({ ruta, nombre }) {
      const { data, error } = await sb.storage.from('archivos').createSignedUrl(ruta, 600, { download: nombre });
      if (error) throw new Error('No pude abrir el archivo.');
      return data.signedUrl;
    },
    async linksDeImagenes(rutas) {
      if (!rutas.length) return {};
      const { data } = await sb.storage.from('archivos').createSignedUrls(rutas, 3600);
      return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
    },
    async borrarArchivo({ id, ruta }) {
      const { error } = await sb.storage.from('archivos').remove([ruta]);
      if (error) throw new Error('No se pudo borrar el archivo.');
      await ok(sb.from('archivos').delete().eq('id', id));
    },
    async espacioUsado() {
      const { data, error } = await sb.rpc('espacio_usado');
      return error ? null : Number(data ?? 0);
    },
  };
}

// ── Datos: modo prueba (en esta compu, sin Supabase) ───────────────────

function datosLocales() {
  const leer = () => {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_PRUEBA)) ?? null;
    } catch {
      return null;
    }
  };
  let base = leer() ?? ejemplos();
  const avisos = new Set();
  const guardar = () => {
    localStorage.setItem(CLAVE_PRUEBA, JSON.stringify(base));
    for (const fn of avisos) fn();
  };
  guardar();

  const ahora = () => new Date().toISOString();
  return {
    conectado: false,
    async traer(tabla, filtros = {}) {
      return (base[tabla] ?? []).filter((f) => Object.entries(filtros).every(([k, v]) => f[k] === v));
    },
    async traerUno(tabla, id) {
      return (base[tabla] ?? []).find((f) => f.id === id) ?? null;
    },
    async crear(tabla, fila) {
      const nueva = { id: crypto.randomUUID(), creado: ahora(), actualizado: ahora(), ...fila };
      base[tabla] = [...(base[tabla] ?? []), nueva];
      guardar();
      return nueva;
    },
    async cambiar(tabla, id, cambios) {
      let cambiada = null;
      base[tabla] = (base[tabla] ?? []).map((f) => (f.id === id ? (cambiada = { ...f, ...cambios, actualizado: ahora() }) : f));
      guardar();
      return cambiada;
    },
    async borrar(tabla, id) {
      base[tabla] = (base[tabla] ?? []).filter((f) => f.id !== id);
      // Como en la base: al borrar un cliente se va todo lo suyo.
      if (tabla === 'clientes') {
        for (const t of TABLAS) if (t !== 'clientes') base[t] = (base[t] ?? []).filter((f) => f.cliente_id !== id);
      }
      guardar();
    },
    escuchar(fn) {
      avisos.add(fn);
      // Otra ventana de esta misma compu cambió algo.
      window.addEventListener('storage', (e) => {
        if (e.key !== CLAVE_PRUEBA) return;
        base = leer() ?? base;
        fn();
      });
    },
    async subirArchivo() {
      throw new Error('En modo prueba no se suben archivos: hace falta Supabase.');
    },
    async linkParaBajar() {
      throw new Error('En modo prueba no hay archivos.');
    },
    async linksDeImagenes() {
      return {};
    },
    async borrarArchivo() {},
    async espacioUsado() {
      return null;
    },
  };
}

// Para que el modo prueba no arranque vacío. Se notan que son de ejemplo.
function ejemplos() {
  const id = () => crypto.randomUUID();
  const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
  const [a, b, c, d] = [id(), id(), id(), id()];
  return {
    clientes: [
      { id: a, nombre: 'Panadería Don Luis (ejemplo)', contacto: 'Luis', telefono: '11 5555-1234', rubro: 'Gastronomía', descripcion: 'Quieren una página con el menú y pedidos por WhatsApp.', estado: 'presupuesto', responsable: 'hassan', orden: 1, creado_por: 'hassan', creado: hace(9), actualizado: hace(1) },
      { id: b, nombre: 'Estudio Pampa (ejemplo)', contacto: 'Carla', rubro: 'Arquitectura', descripcion: 'Portfolio con fotos de obras.', estado: 'charlando', responsable: 'aostri', orden: 2, creado_por: 'aostri', creado: hace(5), actualizado: hace(2) },
      { id: c, nombre: 'Gimnasio Fuerza (ejemplo)', contacto: 'Marcos', rubro: 'Deportes', estado: 'contactado', responsable: 'hassan', orden: 3, creado_por: 'hassan', creado: hace(2), actualizado: hace(2) },
      { id: d, nombre: 'Vivero La Huerta (ejemplo)', contacto: 'Ana', rubro: 'Plantas', descripcion: 'Tienda online chica.', estado: 'ganado', responsable: 'tomas', orden: 4, creado_por: 'tomas', creado: hace(30), actualizado: hace(3) },
    ],
    tareas: [
      { id: id(), cliente_id: a, titulo: 'Mandar el presupuesto por mail', responsable: 'hassan', vence: null, hecha: false, creado_por: 'hassan', creado: hace(1) },
      { id: id(), cliente_id: a, titulo: 'Armar la maqueta del menú', responsable: 'tomas', vence: null, hecha: false, creado_por: 'hassan', creado: hace(1) },
      { id: id(), cliente_id: d, titulo: 'Cargar las fotos de las plantas', responsable: 'aostri', vence: null, hecha: false, creado_por: 'tomas', creado: hace(3) },
    ],
    cliente_notas: [
      { id: id(), cliente_id: a, tipo: 'idea', texto: 'Un botón grande de «Pedir por WhatsApp» arriba de todo.', creado_por: 'aostri', creado: hace(2) },
      { id: id(), cliente_id: a, tipo: 'nota', texto: 'Abren de 7 a 13. Prefieren que los llamen a la tarde.', creado_por: 'hassan', creado: hace(4) },
    ],
    cliente_links: [],
    cliente_plata: [
      { id: id(), cliente_id: d, tipo: 'cobro', concepto: 'Seña de la tienda', monto: 150000, moneda: 'ARS', fecha: hace(20).slice(0, 10), pagado: true, creado_por: 'tomas', creado: hace(20) },
      { id: id(), cliente_id: d, tipo: 'cobro', concepto: 'Resto de la tienda', monto: 150000, moneda: 'ARS', fecha: hace(0).slice(0, 10), pagado: false, creado_por: 'tomas', creado: hace(20) },
      { id: id(), cliente_id: d, tipo: 'gasto', concepto: 'Dominio por un año', monto: 12, moneda: 'USD', fecha: hace(19).slice(0, 10), pagado: true, creado_por: 'tomas', creado: hace(19) },
    ],
    archivos: [],
  };
}

// ── La pantalla ────────────────────────────────────────────────────────

function crearPantalla(app, datos) {
  let zona = null;
  let vista = null; // 'tablero' | 'ficha'
  let clienteId = null;
  let visible = false;
  let temporizador = null;

  const tablero = crearTablero(app, datos);
  const ficha = crearFicha(app, datos);

  return {
    mostrar(z, params) {
      zona = z;
      visible = true;
      const id = params[0] ?? null;
      if (id) {
        if (vista !== 'ficha' || clienteId !== id) {
          zona.replaceChildren(ficha.armar(id));
          vista = 'ficha';
          clienteId = id;
        }
        ficha.cargar({ enfocar: true });
      } else {
        if (vista !== 'tablero') {
          zona.replaceChildren(tablero.armar());
          vista = 'tablero';
          clienteId = null;
        }
        tablero.cargar();
      }
    },
    ocultar() {
      visible = false;
    },
    recargarPronto() {
      if (!visible) return;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => (vista === 'ficha' ? ficha.cargar() : tablero.cargar()), 250);
    },
    repintarNombres() {
      if (!visible) return;
      if (vista === 'ficha') ficha.repintar();
      else tablero.repintar();
    },
  };
}

// ── El tablero ─────────────────────────────────────────────────────────

function crearTablero(app, datos) {
  let raiz = null;
  let clientes = [];
  let pendientes = [];
  const filtro = { texto: '', persona: '', perdidos: false };
  let arrastrando = null;

  function armar() {
    raiz = h('div', { class: 'cl cl-tablero' });

    const nuevo = h('button', { class: 'boton', type: 'button', onclick: () => abrirNuevo('contactado') }, h('span', { 'aria-hidden': 'true', texto: '+' }), 'Sumar posible cliente');
    const resumen = h('p', { class: 'cl-cabeza__resumen', 'data-resumen': true });

    const buscador = h('input', {
      type: 'search',
      id: 'cl-buscar',
      placeholder: 'Nombre, contacto o rubro',
      autocomplete: 'off',
      oninput: (e) => {
        filtro.texto = normalizar(e.target.value);
        pintar();
      },
    });
    const selectorPersona = h('select', {
      id: 'cl-persona',
      onchange: (e) => {
        filtro.persona = e.target.value;
        pintar();
      },
    });
    const verPerdidos = h('input', {
      type: 'checkbox',
      id: 'cl-perdidos',
      onchange: (e) => {
        filtro.perdidos = e.target.checked;
        pintar();
      },
    });

    raiz.append(
      h('header', { class: 'cl-cabeza' },
        h('div', {}, h('h1', { texto: 'Clientes' }), resumen),
        nuevo,
      ),
      h('div', { class: 'cl-filtros', role: 'search', 'aria-label': 'Filtrar clientes' },
        h('div', { class: 'cl-filtro cl-filtro--buscar' }, h('label', { for: 'cl-buscar', texto: 'Buscar' }), buscador),
        h('div', { class: 'cl-filtro' }, h('label', { for: 'cl-persona', texto: 'Lo sigue' }), selectorPersona),
        h('div', { class: 'cl-filtro cl-filtro--tilde' }, verPerdidos, h('label', { for: 'cl-perdidos', texto: 'Ver los perdidos' })),
      ),
      h('div', { class: 'cl-columnas', 'data-columnas': true }),
      h('p', { class: 'cl-pista cl-pista--mouse', texto: 'Arrastrá una tarjeta a otra columna para cambiarle el estado (o cambialo adentro de la ficha).' }),
      h('p', { class: 'cl-pista cl-pista--dedo', texto: 'Deslizá para ver las otras columnas. Para cambiar el estado, entrá a la ficha.' }),
      dialogoNuevo(),
    );
    pintarSelectorPersona(selectorPersona);
    return raiz;
  }

  function pintarSelectorPersona(select) {
    const actual = select.value;
    select.replaceChildren(
      h('option', { value: '', texto: 'Todos' }),
      ...app.personas.map((p) => h('option', { value: p.slug, texto: p.nombre })),
      h('option', { value: '-', texto: 'Nadie todavía' }),
    );
    select.value = actual;
  }

  async function cargar() {
    try {
      const [cs, ts] = await Promise.all([datos.traer('clientes'), datos.traer('tareas', { hecha: false })]);
      clientes = cs;
      pendientes = ts;
      pintar();
    } catch (e) {
      console.error(e);
      mostrarFallaCarga(raiz?.querySelector('[data-columnas]'), '¿Ya corriste supabase/clientes.sql en Supabase?');
    }
  }

  function pintar() {
    if (!raiz) return;
    const posibles = clientes.filter((c) => ES_POSIBLE.has(c.estado)).length;
    const ganados = clientes.filter((c) => c.estado === 'ganado').length;
    raiz.querySelector('[data-resumen]').textContent =
      `${posibles} ${posibles === 1 ? 'posible cliente' : 'posibles clientes'} · ${ganados} ${ganados === 1 ? 'cliente' : 'clientes'}`;

    const visibles = clientes.filter((c) => {
      if (filtro.persona === '-' && c.responsable) return false;
      if (filtro.persona && filtro.persona !== '-' && c.responsable !== filtro.persona) return false;
      if (filtro.texto && !normalizar(`${c.nombre} ${c.contacto ?? ''} ${c.rubro ?? ''}`).includes(filtro.texto)) return false;
      return true;
    });
    const tareasPorCliente = contar(pendientes, 'cliente_id');

    const columnas = ESTADOS.filter((e) => e.id !== 'perdido' || filtro.perdidos).map((estado) => {
      const suyos = visibles.filter((c) => c.estado === estado.id).sort((a, b) => a.orden - b.orden);
      const lista = h('ol', { class: 'cl-columna__lista', 'aria-labelledby': `cl-col-${estado.id}` },
        suyos.map((c) => tarjeta(c, tareasPorCliente.get(c.id) ?? 0)),
      );
      const columna = h('section', { class: 'cl-columna', 'data-estado': estado.id },
        h('header', { class: 'cl-columna__cabeza' },
          h('h2', { id: `cl-col-${estado.id}`, class: 'cl-columna__titulo' },
            h('span', { class: 'cl-punto', 'aria-hidden': 'true' }),
            estado.id === 'ganado' ? 'Ganados' : estado.nombre,
          ),
          h('span', { class: 'cl-columna__cuenta', 'aria-label': `${suyos.length} en ${estado.nombre}`, texto: String(suyos.length) }),
        ),
        suyos.length ? lista : h('p', { class: 'cl-columna__vacia', texto: filtro.texto || filtro.persona ? 'Nada con ese filtro.' : estado.ayuda }),
        ES_POSIBLE.has(estado.id)
          ? h('button', { class: 'cl-columna__sumar', type: 'button', onclick: () => abrirNuevo(estado.id), 'aria-label': `Sumar en ${estado.nombre}` }, h('span', { 'aria-hidden': 'true', texto: '+ ' }), 'Sumar')
          : null,
      );
      prepararSoltar(columna, estado.id);
      return columna;
    });

    const contenedor = raiz.querySelector('[data-columnas]');
    contenedor.classList.toggle('cl-columnas--con-perdidos', filtro.perdidos);
    contenedor.replaceChildren(...columnas);
  }

  function tarjeta(c, cuantasTareas) {
    const quien = c.responsable ? app.buscarPersona(c.responsable) : null;
    const enlace = h('a', { class: 'cl-tarjeta', href: `#/clientes/${encodeURIComponent(c.id)}`, draggable: 'true' },
      h('span', { class: 'cl-tarjeta__nombre', texto: c.nombre }),
      c.contacto || c.rubro ? h('span', { class: 'cl-tarjeta__detalle', texto: [c.contacto, c.rubro].filter(Boolean).join(' · ') }) : null,
      h('span', { class: 'cl-tarjeta__pie' },
        avatar(quien, 'Lo sigue'),
        cuantasTareas ? h('span', { class: 'cl-etiqueta', texto: `☐ ${cuantasTareas} ${cuantasTareas === 1 ? 'tarea' : 'tareas'}` }) : null,
        c.repo ? h('span', { class: 'cl-etiqueta', title: `Repo: ${c.repo}`, texto: '⌥ repo' }) : null,
      ),
    );
    enlace.addEventListener('dragstart', (e) => {
      arrastrando = c.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.id);
      requestAnimationFrame(() => enlace.classList.add('cl-tarjeta--arrastrando'));
    });
    enlace.addEventListener('dragend', () => {
      arrastrando = null;
      enlace.classList.remove('cl-tarjeta--arrastrando');
      raiz.querySelectorAll('.cl-columna--destino').forEach((x) => x.classList.remove('cl-columna--destino'));
    });
    return h('li', {}, enlace);
  }

  function prepararSoltar(columna, estado) {
    columna.addEventListener('dragover', (e) => {
      if (!arrastrando) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      columna.classList.add('cl-columna--destino');
    });
    columna.addEventListener('dragleave', (e) => {
      if (!columna.contains(e.relatedTarget)) columna.classList.remove('cl-columna--destino');
    });
    columna.addEventListener('drop', async (e) => {
      e.preventDefault();
      columna.classList.remove('cl-columna--destino');
      const id = arrastrando;
      const cliente = clientes.find((c) => c.id === id);
      if (!cliente || cliente.estado === estado) return;
      const antes = { estado: cliente.estado, orden: cliente.orden };
      // Se mueve ya en pantalla; si la base dice que no, vuelve a su lugar.
      Object.assign(cliente, { estado, orden: Date.now() / 1000 });
      pintar();
      try {
        await datos.cambiar('clientes', id, { estado, orden: cliente.orden });
        app.avisar(estado === 'ganado' ? `¡Bien! ${cliente.nombre} ya es cliente.` : `${cliente.nombre} → ${nombreEstado(estado)}.`, 'ok');
      } catch (err) {
        console.error(err);
        Object.assign(cliente, antes);
        pintar();
        app.avisar('No se pudo mover. Fijate la conexión y probá de nuevo.', 'error');
      }
    });
  }

  // La ventanita para sumar un posible cliente.
  function dialogoNuevo() {
    const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'cl-nuevo-titulo', 'data-nuevo': true });
    const form = h('form', { class: 'dialogo__cuerpo', novalidate: true },
      h('h2', { id: 'cl-nuevo-titulo', texto: 'Sumar posible cliente' }),
      campo({ id: 'cl-nuevo-nombre', nombre: 'nombre', etiqueta: 'Nombre (persona o negocio)', requerido: true, max: 120, autocomplete: 'organization' }),
      campo({ id: 'cl-nuevo-contacto', nombre: 'contacto', etiqueta: 'Con quién hablamos', max: 120, autocomplete: 'off' }),
      h('div', { class: 'cl-fila-campos' },
        campoSelect({ id: 'cl-nuevo-estado', nombre: 'estado', etiqueta: 'Estado', opciones: ESTADOS.map((e) => [e.id, e.nombre]) }),
        campoSelect({ id: 'cl-nuevo-responsable', nombre: 'responsable', etiqueta: 'Lo sigue', opciones: opcionesPersonas(app) }),
      ),
      h('div', { class: 'dialogo__botones' },
        h('button', { class: 'boton', type: 'submit', texto: 'Sumar' }),
        h('button', { class: 'boton boton--suave', type: 'button', onclick: () => dialogo.close(), texto: 'Cancelar' }),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      const valores = leerForm(form);
      if (!valores.nombre) return marcarError(form, 'nombre', 'Escribí el nombre.');
      const boton = form.querySelector('[type="submit"]');
      boton.disabled = true;
      try {
        const nuevo = await datos.crear('clientes', {
          nombre: valores.nombre,
          contacto: valores.contacto || null,
          estado: valores.estado,
          responsable: valores.responsable || null,
          orden: Date.now() / 1000,
          creado_por: app.persona.slug,
        });
        clientes.push(nuevo);
        pintar();
        dialogo.close();
        app.avisar(`Listo, ${nuevo.nombre} quedó en «${nombreEstado(nuevo.estado)}».`, 'ok');
      } catch (err) {
        console.error(err);
        app.avisar('No se pudo guardar. Fijate la conexión y probá de nuevo.', 'error');
      } finally {
        boton.disabled = false;
      }
    });
    dialogo.append(form);
    return dialogo;
  }

  function abrirNuevo(estado) {
    const dialogo = raiz.querySelector('[data-nuevo]');
    const form = dialogo.querySelector('form');
    form.reset();
    limpiarErrores(form);
    const responsable = form.elements.responsable;
    responsable.replaceChildren(...opcionesPersonas(app).map(([v, t]) => h('option', { value: v, texto: t })));
    responsable.value = app.persona.slug;
    form.elements.estado.value = estado;
    dialogo.showModal();
    form.elements.nombre.focus();
  }

  return {
    armar,
    cargar,
    repintar() {
      if (!raiz) return;
      pintarSelectorPersona(raiz.querySelector('#cl-persona'));
      pintar();
    },
  };
}

// ── La ficha de un cliente ─────────────────────────────────────────────

function crearFicha(app, datos) {
  let raiz = null;
  let id = null;
  let cliente = null;
  let filas = { tareas: [], notas: [], links: [], plata: [], archivos: [] };
  let confirmar = null;

  function armar(clienteId) {
    id = clienteId;
    cliente = null;
    raiz = h('article', { class: 'cl cl-ficha', 'aria-busy': 'true' });
    confirmar = crearConfirmar();

    const saltos = [
      ['tareas', 'Tareas'], ['ideas', 'Ideas'], ['notas', 'Notas'],
      ['archivos', 'Archivos'], ['datos', 'Datos'], ['plata', 'Plata'], ['links', 'Links'],
    ];

    raiz.append(
      h('a', { class: 'cl-volver', href: '#/clientes' }, h('span', { 'aria-hidden': 'true', texto: '← ' }), 'Todos los clientes'),
      h('header', { class: 'cl-ficha__cabeza' },
        h('div', { class: 'cl-ficha__titulos' },
          h('p', { class: 'cl-ficha__tipo', 'data-tipo': true }),
          h('h1', { tabindex: '-1', 'data-nombre': true, texto: 'Cargando…' }),
          h('p', { class: 'cl-ficha__sub', 'data-sub': true }),
        ),
        h('div', { class: 'cl-ficha__acciones' },
          h('div', { class: 'cl-filtro' },
            h('label', { for: 'cl-ficha-responsable', texto: 'Lo sigue' }),
            h('select', { id: 'cl-ficha-responsable', onchange: (e) => guardarCliente({ responsable: e.target.value || null }, 'Listo, cambió quién lo sigue.') }),
          ),
          h('a', { class: 'boton boton--suave', 'data-publicada': true, target: '_blank', rel: 'noopener noreferrer', hidden: true }, 'Ver cómo quedó', h('span', { 'aria-hidden': 'true', texto: ' ↗' })),
        ),
      ),
      h('fieldset', { class: 'cl-estados' },
        h('legend', { class: 'visualmente-oculto', texto: 'Estado' }),
        ESTADOS.map((e) =>
          h('label', { class: 'cl-estado', 'data-estado': e.id },
            h('input', { type: 'radio', name: 'cl-estado', value: e.id, onchange: () => cambiarEstado(e.id) }),
            h('span', { class: 'cl-punto', 'aria-hidden': 'true' }),
            e.nombre,
          ),
        ),
      ),
      // Acá engancha la parte de GitHub: app.escuchar('cliente-ficha', ({ zona, cliente }) => …)
      h('div', { class: 'cl-github', id: 'cliente-github' }),
      h('nav', { class: 'cl-saltos', 'aria-label': 'Partes de la ficha' },
        saltos.map(([parte, nombre]) =>
          h('button', { type: 'button', class: 'cl-salto', onclick: () => irA(parte) }, nombre, h('span', { class: 'cl-salto__cuenta', 'data-cuenta': parte })),
        ),
      ),
      h('div', { class: 'cl-ficha__grilla' },
        h('div', { class: 'cl-ficha__principal' }, bloqueTareas(), bloqueNotas('idea'), bloqueNotas('nota'), bloqueArchivos()),
        h('div', { class: 'cl-ficha__lado' }, bloqueDatos(), bloquePlata(), bloqueLinks(), bloqueBorrar()),
      ),
      confirmar.dialogo,
    );
    return raiz;
  }

  function irA(parte) {
    const bloque = raiz.querySelector(`#cl-${parte}`);
    bloque.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    bloque.querySelector('h2').focus({ preventScroll: true });
  }

  async function cargar({ enfocar = false } = {}) {
    const pedido = id;
    try {
      const [c, tareas, notas, links, plata, archivos] = await Promise.all([
        datos.traerUno('clientes', id),
        datos.traer('tareas', { cliente_id: id }),
        datos.traer('cliente_notas', { cliente_id: id }),
        datos.traer('cliente_links', { cliente_id: id }),
        datos.traer('cliente_plata', { cliente_id: id }),
        datos.traer('archivos', { cliente_id: id }),
      ]);
      if (pedido !== id) return; // se fue a otra ficha mientras cargaba
      if (!c) return pintarNoExiste();
      const esNuevo = !cliente;
      cliente = c;
      filas = { tareas, notas, links, plata, archivos };
      pintar();
      raiz.removeAttribute('aria-busy');
      if (esNuevo) {
        const zonaGithub = raiz.querySelector('#cliente-github');
        // El módulo de GitHub llena solo las cajas con data-github-cliente="ID".
        if (zonaGithub) zonaGithub.dataset.githubCliente = String(cliente.id);
        app.emitir('cliente-ficha', { zona: zonaGithub, cliente });
      }
      if (enfocar && esNuevo) raiz.querySelector('h1').focus({ preventScroll: true });
    } catch (e) {
      console.error(e);
      mostrarFallaCarga(raiz.querySelector('.cl-ficha__grilla'), '¿Ya corriste supabase/clientes.sql en Supabase?');
    }
  }

  function pintarNoExiste() {
    raiz.removeAttribute('aria-busy');
    raiz.replaceChildren(
      h('a', { class: 'cl-volver', href: '#/clientes' }, h('span', { 'aria-hidden': 'true', texto: '← ' }), 'Todos los clientes'),
      h('div', { class: 'cl-vacio' },
        h('h1', { tabindex: '-1', texto: 'Ese cliente no está' }),
        h('p', { texto: 'Puede que alguien lo haya borrado. Volvé al tablero para ver los que hay.' }),
      ),
    );
    raiz.querySelector('h1').focus({ preventScroll: true });
  }

  function pintar() {
    if (!raiz || !cliente) return;
    // Al redibujar las listas, el foco del teclado vuelve a donde estaba (si sigue existiendo).
    const enfocado = raiz.contains(document.activeElement) ? document.activeElement.id : '';
    pintarTodo();
    if (enfocado && document.activeElement?.id !== enfocado) document.getElementById(enfocado)?.focus({ preventScroll: true });
  }

  function pintarTodo() {
    document.title = `${cliente.nombre} · ATH`;
    raiz.dataset.estado = cliente.estado;
    raiz.querySelector('[data-nombre]').textContent = cliente.nombre;
    raiz.querySelector('[data-tipo]').textContent = cliente.estado === 'ganado' ? 'Cliente' : cliente.estado === 'perdido' ? 'Se perdió' : 'Posible cliente';
    raiz.querySelector('[data-sub]').textContent = [cliente.contacto, cliente.rubro].filter(Boolean).join(' · ');

    const responsable = raiz.querySelector('#cl-ficha-responsable');
    responsable.replaceChildren(...opcionesPersonas(app).map(([v, t]) => h('option', { value: v, texto: t })));
    responsable.value = cliente.responsable ?? '';

    for (const radio of raiz.querySelectorAll('input[name="cl-estado"]')) radio.checked = radio.value === cliente.estado;

    const publicada = raiz.querySelector('[data-publicada]');
    const urlOk = linkSeguro(cliente.url_publicada);
    publicada.hidden = !urlOk;
    if (urlOk) publicada.href = urlOk;

    pintarDatos();
    pintarTareas();
    pintarNotas('idea');
    pintarNotas('nota');
    pintarLinks();
    pintarPlata();
    pintarArchivos();

    const cuentas = {
      tareas: filas.tareas.filter((t) => !t.hecha).length,
      ideas: filas.notas.filter((n) => n.tipo === 'idea').length,
      notas: filas.notas.filter((n) => n.tipo === 'nota').length,
      archivos: filas.archivos.length,
      plata: filas.plata.length,
      links: filas.links.length,
    };
    for (const marca of raiz.querySelectorAll('[data-cuenta]')) {
      const n = cuentas[marca.dataset.cuenta];
      marca.textContent = n ? ` ${n}` : '';
    }
  }

  async function guardarCliente(cambios, mensaje) {
    try {
      cliente = await datos.cambiar('clientes', id, cambios);
      pintar();
      if (mensaje) app.avisar(mensaje, 'ok');
      return true;
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo guardar. Fijate la conexión y probá de nuevo.', 'error');
      pintar();
      return false;
    }
  }

  function cambiarEstado(estado) {
    if (!cliente || cliente.estado === estado) return;
    guardarCliente(
      { estado, orden: Date.now() / 1000 },
      estado === 'ganado' ? `¡Bien! ${cliente.nombre} ya es cliente.` : `Ahora está en «${nombreEstado(estado)}».`,
    );
  }

  // ── Datos ──

  function bloqueDatos() {
    const form = h('form', { class: 'cl-datos', novalidate: true, 'data-form-datos': true },
      campo({ id: 'cl-d-nombre', nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 120, autocomplete: 'off' }),
      campo({ id: 'cl-d-contacto', nombre: 'contacto', etiqueta: 'Con quién hablamos', max: 120, autocomplete: 'off' }),
      h('div', { class: 'cl-fila-campos' },
        campo({ id: 'cl-d-telefono', nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', max: 40, autocomplete: 'off', inputmode: 'tel' }),
        campo({ id: 'cl-d-rubro', nombre: 'rubro', etiqueta: 'Rubro', max: 80, autocomplete: 'off' }),
      ),
      campo({ id: 'cl-d-correo', nombre: 'correo', etiqueta: 'Correo', tipo: 'email', max: 200, autocomplete: 'off' }),
      campo({ id: 'cl-d-web', nombre: 'web', etiqueta: 'Web o red social', tipo: 'url', max: 500, autocomplete: 'off', placeholder: 'https://…' }),
      campo({ id: 'cl-d-descripcion', nombre: 'descripcion', etiqueta: 'Qué quiere / de qué se trata', area: true, max: 4000 }),
      h('details', { class: 'cl-datos__mas' },
        h('summary', { texto: 'GitHub y página publicada' }),
        campo({ id: 'cl-d-repo', nombre: 'repo', etiqueta: 'Repo de GitHub (solo el nombre)', max: 100, autocomplete: 'off', placeholder: 'panaderia-don-luis', ayuda: 'El repo de la organización: letras, números, puntos y guiones.' }),
        campo({ id: 'cl-d-publicada', nombre: 'url_publicada', etiqueta: 'Dirección publicada', tipo: 'url', max: 500, autocomplete: 'off', placeholder: 'https://…' }),
      ),
      h('div', { class: 'cl-contactar', 'data-contactar': true }),
      h('div', { class: 'cl-datos__botones' },
        h('button', { class: 'boton', type: 'submit', disabled: true, 'data-guardar': true, texto: 'Guardar datos' }),
        h('button', { class: 'boton boton--suave', type: 'button', hidden: true, 'data-deshacer': true, texto: 'Descartar cambios' }),
      ),
    );
    form.addEventListener('input', () => marcarCambiado(form, true));
    form.querySelector('[data-deshacer]').addEventListener('click', () => {
      marcarCambiado(form, false);
      pintarDatos();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      const v = leerForm(form);
      const web = v.web ? conProtocolo(v.web) : '';
      const publicada = v.url_publicada ? conProtocolo(v.url_publicada) : '';
      if (!v.nombre) return marcarError(form, 'nombre', 'Escribí el nombre.');
      if (v.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.correo)) return marcarError(form, 'correo', 'Ese correo no parece completo (falta la @ o el punto).');
      if (web && !linkSeguro(web)) return marcarError(form, 'web', 'Pegá una dirección que empiece con https://');
      if (v.repo && !/^[A-Za-z0-9._-]{1,100}$/.test(v.repo)) return marcarError(form, 'repo', 'Solo el nombre del repo: letras, números, puntos y guiones (sin espacios ni barras).');
      if (publicada && !publicada.startsWith('https://')) return marcarError(form, 'url_publicada', 'Tiene que empezar con https://');

      const boton = form.querySelector('[data-guardar]');
      boton.disabled = true;
      marcarCambiado(form, false);
      const salio = await guardarCliente({
        nombre: v.nombre,
        contacto: v.contacto || null,
        telefono: v.telefono || null,
        rubro: v.rubro || null,
        correo: v.correo || null,
        web: web || null,
        descripcion: v.descripcion || null,
        repo: v.repo || null,
        url_publicada: publicada || null,
      }, 'Listo, datos guardados.');
      if (!salio) marcarCambiado(form, true);
    });
    return bloque('datos', 'Datos', form);
  }

  function marcarCambiado(form, cambiado) {
    form.dataset.cambiado = cambiado ? 'si' : '';
    form.querySelector('[data-guardar]').disabled = !cambiado;
    form.querySelector('[data-deshacer]').hidden = !cambiado;
  }

  function pintarDatos() {
    const form = raiz.querySelector('[data-form-datos]');
    // Si alguien está escribiendo acá, no le pisamos lo que escribió con lo que llega de los otros.
    if (form.dataset.cambiado !== 'si') {
      for (const nombre of ['nombre', 'contacto', 'telefono', 'rubro', 'correo', 'web', 'descripcion', 'repo', 'url_publicada']) {
        form.elements[nombre].value = cliente[nombre] ?? '';
      }
      if (cliente.repo || cliente.url_publicada) form.querySelector('details').open = true;
    }

    // Accesos rápidos para escribirle o llamarlo.
    const accesos = [];
    const digitos = (cliente.telefono ?? '').replace(/\D/g, '');
    if (digitos.length >= 8) {
      const paraWhatsapp = digitos.startsWith('54') ? digitos : `549${digitos.replace(/^0/, '')}`;
      accesos.push(h('a', { class: 'cl-acceso', href: `https://wa.me/${paraWhatsapp}`, target: '_blank', rel: 'noopener noreferrer', texto: 'WhatsApp' }));
      accesos.push(h('a', { class: 'cl-acceso', href: `tel:${digitos}`, texto: 'Llamar' }));
    }
    if (cliente.correo) accesos.push(h('a', { class: 'cl-acceso', href: `mailto:${cliente.correo}`, texto: 'Mandar correo' }));
    const web = linkSeguro(cliente.web);
    if (web) accesos.push(h('a', { class: 'cl-acceso', href: web, target: '_blank', rel: 'noopener noreferrer', texto: 'Abrir su web' }));
    raiz.querySelector('[data-contactar]').replaceChildren(...accesos);
  }

  // ── Tareas ──

  function bloqueTareas() {
    const form = h('form', { class: 'cl-sumar cl-sumar--tarea', novalidate: true },
      h('div', { class: 'campo cl-sumar__principal' },
        h('label', { for: 'cl-t-titulo', texto: 'Nueva tarea' }),
        h('input', { id: 'cl-t-titulo', name: 'titulo', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Ej.: mandar el presupuesto' }),
        h('p', { class: 'campo__error', id: 'cl-t-titulo-error', hidden: true }),
      ),
      campoSelect({ id: 'cl-t-responsable', nombre: 'responsable', etiqueta: 'Quién', opciones: opcionesPersonas(app) }),
      campo({ id: 'cl-t-vence', nombre: 'vence', etiqueta: 'Para cuándo', tipo: 'date' }),
      h('button', { class: 'boton', type: 'submit', texto: 'Sumar tarea' }),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      const v = leerForm(form);
      if (!v.titulo) return marcarError(form, 'titulo', 'Escribí qué hay que hacer.');
      const ok = await crearFila('tareas', {
        cliente_id: id,
        titulo: v.titulo,
        responsable: v.responsable || null,
        vence: v.vence || null,
        hecha: false,
      }, 'tareas');
      if (ok) {
        form.elements.titulo.value = '';
        form.elements.vence.value = '';
        form.elements.titulo.focus();
      }
    });
    const lista = h('ul', { class: 'cl-tareas', 'data-lista-tareas': true });
    const hechas = h('details', { class: 'cl-hechas', 'data-hechas': true },
      h('summary', { 'data-hechas-titulo': true }),
      h('ul', { class: 'cl-tareas' }),
    );
    return bloque('tareas', 'Tareas', lista, hechas, form);
  }

  function pintarTareas() {
    const responsable = raiz.querySelector('#cl-t-responsable');
    if (document.activeElement !== responsable) {
      // La primera vez arranca en quien está usando la app; después respeta lo que se eligió.
      const actual = responsable.dataset.listo ? responsable.value : app.persona.slug;
      responsable.replaceChildren(...opcionesPersonas(app).map(([v, t]) => h('option', { value: v, texto: t })));
      responsable.value = actual;
      responsable.dataset.listo = 'si';
    }

    const pendientes = filas.tareas
      .filter((t) => !t.hecha)
      .sort((a, b) => (a.vence ?? '9999').localeCompare(b.vence ?? '9999') || a.creado.localeCompare(b.creado));
    const hechas = filas.tareas.filter((t) => t.hecha).sort((a, b) => (b.hecha_en ?? b.actualizado ?? '').localeCompare(a.hecha_en ?? a.actualizado ?? ''));

    const lista = raiz.querySelector('[data-lista-tareas]');
    lista.replaceChildren(...(pendientes.length ? pendientes.map(filaTarea) : [h('li', { class: 'cl-nada', texto: 'No hay nada pendiente. 🎉' })]));

    const zonaHechas = raiz.querySelector('[data-hechas]');
    zonaHechas.hidden = !hechas.length;
    zonaHechas.querySelector('[data-hechas-titulo]').textContent = `Hechas (${hechas.length})`;
    zonaHechas.querySelector('ul').replaceChildren(...hechas.map(filaTarea));
  }

  function filaTarea(t) {
    const idCaja = `cl-tarea-${t.id}`;
    const hoy = new Date().toISOString().slice(0, 10);
    const vencida = !t.hecha && t.vence && t.vence < hoy;
    const selector = h('select', { class: 'cl-chip-select', 'aria-label': `Quién hace «${t.titulo}»`, 'data-persona': t.responsable ?? '' },
      opcionesPersonas(app).map(([v, txt]) => h('option', { value: v, texto: txt })),
    );
    selector.value = t.responsable ?? '';
    selector.addEventListener('change', () => cambiarFila('tareas', t.id, { responsable: selector.value || null }, 'tareas'));

    return h('li', { class: `cl-tarea${t.hecha ? ' cl-tarea--hecha' : ''}` },
      h('input', {
        type: 'checkbox',
        id: idCaja,
        checked: t.hecha,
        onchange: (e) => cambiarFila('tareas', t.id, { hecha: e.target.checked }, 'tareas', e.target.checked ? '¡Tarea hecha!' : null),
      }),
      h('label', { for: idCaja, class: 'cl-tarea__titulo', texto: t.titulo }),
      h('span', { class: 'cl-tarea__meta' },
        t.vence ? h('span', { class: `cl-fecha${vencida ? ' cl-fecha--vencida' : ''}`, texto: (vencida ? 'Venció ' : '') + fechaCorta(t.vence) }) : null,
        selector,
        botonBorrar(`la tarea «${t.titulo}»`, () => borrarFila('tareas', t.id, 'tareas')),
      ),
    );
  }

  // ── Ideas y notas ──

  function bloqueNotas(tipo) {
    const esIdea = tipo === 'idea';
    const parte = esIdea ? 'ideas' : 'notas';
    const form = h('form', { class: 'cl-sumar cl-sumar--texto', novalidate: true },
      h('div', { class: 'campo cl-sumar__principal' },
        h('label', { for: `cl-${parte}-texto`, texto: esIdea ? 'Nueva idea' : 'Nueva nota' }),
        h('textarea', { id: `cl-${parte}-texto`, name: 'texto', rows: '2', maxlength: '4000', placeholder: esIdea ? '¿Y si le hacemos…?' : 'Lo que hablamos, lo que hay que acordarse…' }),
        h('p', { class: 'campo__error', id: `cl-${parte}-texto-error`, hidden: true }),
      ),
      h('button', { class: 'boton boton--suave', type: 'submit', texto: esIdea ? 'Sumar idea' : 'Sumar nota' }),
    );
    // Ctrl+Enter también guarda (cómodo para notas largas).
    form.elements.texto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      const texto = form.elements.texto.value.trim();
      if (!texto) return marcarError(form, 'texto', esIdea ? 'Escribí la idea.' : 'Escribí la nota.');
      const ok = await crearFila('cliente_notas', { cliente_id: id, tipo, texto }, 'notas');
      if (ok) form.elements.texto.value = '';
    });
    return bloque(parte, esIdea ? 'Ideas' : 'Notas', h('ul', { class: esIdea ? 'cl-ideas' : 'cl-notas', [`data-lista-${tipo}`]: true }), form);
  }

  function pintarNotas(tipo) {
    const esIdea = tipo === 'idea';
    const lista = raiz.querySelector(`[data-lista-${tipo}]`);
    // Si alguien está editando una, no la pisamos.
    if (lista.querySelector('textarea')) return;
    const suyas = filas.notas.filter((n) => n.tipo === tipo).sort((a, b) => b.creado.localeCompare(a.creado));
    if (!suyas.length) {
      lista.replaceChildren(h('li', { class: 'cl-nada', texto: esIdea ? 'Todavía no hay ideas. Tirá la primera.' : 'Todavía no hay notas.' }));
      return;
    }
    lista.replaceChildren(...suyas.map((n) => {
      const autor = app.buscarPersona(n.creado_por);
      const texto = h('p', { class: 'cl-nota__texto', texto: n.texto });
      const item = h('li', { class: esIdea ? 'cl-idea' : 'cl-nota', 'data-persona': n.creado_por ?? '' },
        texto,
        h('footer', { class: 'cl-nota__pie' },
          h('span', { class: 'cl-nota__autor', texto: `${autor?.nombre ?? 'Alguien'} · ${haceCuanto(n.creado)}` }),
          h('span', { class: 'cl-nota__botones' },
            h('button', { type: 'button', class: 'cl-boton-mini', 'aria-label': `Editar ${esIdea ? 'idea' : 'nota'}`, onclick: () => editarNota(item, n), texto: 'Editar' }),
            botonBorrar(esIdea ? 'esta idea' : 'esta nota', () => borrarFila('cliente_notas', n.id, 'notas')),
          ),
        ),
      );
      return item;
    }));
  }

  function editarNota(item, nota) {
    const caja = h('textarea', { class: 'cl-editar', rows: '4', maxlength: '4000', 'aria-label': 'Editar el texto' });
    caja.value = nota.texto;
    const terminar = () => {
      item.querySelector('.cl-editar-zona').remove();
      for (const hijo of item.children) hijo.hidden = false;
      pintarNotas(nota.tipo);
    };
    const guardar = async () => {
      const texto = caja.value.trim();
      if (!texto) return caja.focus();
      if (texto !== nota.texto) {
        caja.disabled = true;
        await cambiarFila('cliente_notas', nota.id, { texto }, 'notas', 'Listo, guardado.');
      }
      terminar();
    };
    caja.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') terminar();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) guardar();
    });
    for (const hijo of item.children) hijo.hidden = true;
    item.append(h('div', { class: 'cl-editar-zona' },
      caja,
      h('div', { class: 'cl-nota__botones' },
        h('button', { type: 'button', class: 'boton', onclick: guardar, texto: 'Guardar' }),
        h('button', { type: 'button', class: 'boton boton--suave', onclick: terminar, texto: 'Cancelar' }),
      ),
    ));
    caja.focus();
  }

  // ── Links ──

  function bloqueLinks() {
    const form = h('form', { class: 'cl-sumar cl-sumar--link', novalidate: true },
      campo({ id: 'cl-l-url', nombre: 'url', etiqueta: 'Dirección', tipo: 'url', max: 2000, autocomplete: 'off', placeholder: 'https://…' }),
      campo({ id: 'cl-l-titulo', nombre: 'titulo', etiqueta: 'Nombre (opcional)', max: 120, autocomplete: 'off', placeholder: 'Ej.: Drive con las fotos' }),
      h('button', { class: 'boton boton--suave', type: 'submit', texto: 'Sumar link' }),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      const v = leerForm(form);
      const url = linkSeguro(conProtocolo(v.url));
      if (!v.url) return marcarError(form, 'url', 'Pegá la dirección.');
      if (!url) return marcarError(form, 'url', 'Esa dirección no parece válida. Copiala entera desde el navegador.');
      const ok = await crearFila('cliente_links', { cliente_id: id, url, titulo: v.titulo || null }, 'links');
      if (ok) form.reset();
    });
    return bloque('links', 'Links', h('ul', { class: 'cl-links', 'data-lista-links': true }), form);
  }

  function pintarLinks() {
    const lista = raiz.querySelector('[data-lista-links]');
    if (!filas.links.length) {
      lista.replaceChildren(h('li', { class: 'cl-nada', texto: 'Drive, Figma, Instagram… lo que sirva tener a mano.' }));
      return;
    }
    lista.replaceChildren(...[...filas.links].sort((a, b) => a.creado.localeCompare(b.creado)).map((l) => {
      const url = linkSeguro(l.url);
      let sitio = '';
      try {
        sitio = new URL(l.url).hostname.replace(/^www\./, '');
      } catch {
        /* queda vacío */
      }
      return h('li', { class: 'cl-link' },
        url
          ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' },
              h('span', { class: 'cl-link__titulo', texto: l.titulo || sitio || l.url }),
              l.titulo ? h('span', { class: 'cl-link__sitio', texto: sitio }) : null,
            )
          : h('span', { texto: l.titulo || l.url }),
        botonBorrar(`el link «${l.titulo || sitio}»`, () => borrarFila('cliente_links', l.id, 'links')),
      );
    }));
  }

  // ── Plata ──

  function bloquePlata() {
    const hoy = new Date().toISOString().slice(0, 10);
    const form = h('form', { class: 'cl-sumar cl-sumar--plata', novalidate: true },
      h('fieldset', { class: 'cl-tipo-plata' },
        h('legend', { class: 'visualmente-oculto', texto: 'Tipo' }),
        h('label', {}, h('input', { type: 'radio', name: 'tipo', value: 'cobro', checked: true }), 'Cobro'),
        h('label', {}, h('input', { type: 'radio', name: 'tipo', value: 'gasto' }), 'Gasto'),
      ),
      campo({ id: 'cl-p-concepto', nombre: 'concepto', etiqueta: 'Concepto', max: 160, autocomplete: 'off', placeholder: 'Ej.: seña de la página' }),
      h('div', { class: 'cl-fila-campos cl-fila-campos--plata' },
        campo({ id: 'cl-p-monto', nombre: 'monto', etiqueta: 'Monto', inputmode: 'decimal', autocomplete: 'off', placeholder: '150.000' }),
        campoSelect({ id: 'cl-p-moneda', nombre: 'moneda', etiqueta: 'Moneda', opciones: [['ARS', 'Pesos'], ['USD', 'Dólares']] }),
      ),
      h('div', { class: 'cl-fila-campos' },
        campo({ id: 'cl-p-fecha', nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: hoy }),
        h('div', { class: 'cl-filtro cl-filtro--tilde cl-pagado' },
          h('input', { type: 'checkbox', id: 'cl-p-pagado', name: 'pagado' }),
          h('label', { for: 'cl-p-pagado', texto: 'Ya está pagado' }),
        ),
      ),
      h('button', { class: 'boton boton--suave', type: 'submit', texto: 'Anotar' }),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      const v = leerForm(form);
      const monto = leerMonto(v.monto);
      if (!v.concepto) return marcarError(form, 'concepto', 'Escribí de qué es.');
      if (!v.monto) return marcarError(form, 'monto', 'Poné el monto.');
      if (monto == null) return marcarError(form, 'monto', 'Solo números: por ejemplo 150000 o 150.000,50');
      const ok = await crearFila('cliente_plata', {
        cliente_id: id,
        tipo: v.tipo,
        concepto: v.concepto,
        monto,
        moneda: v.moneda,
        fecha: v.fecha || hoy,
        pagado: form.elements.pagado.checked,
      }, 'plata');
      if (ok) {
        form.elements.concepto.value = '';
        form.elements.monto.value = '';
        form.elements.pagado.checked = false;
        form.elements.concepto.focus();
      }
    });
    return bloque('plata', 'Plata', h('div', { class: 'cl-totales', 'data-totales': true }), h('ul', { class: 'cl-plata', 'data-lista-plata': true }), form);
  }

  function pintarPlata() {
    const totales = raiz.querySelector('[data-totales]');
    const lista = raiz.querySelector('[data-lista-plata]');
    if (!filas.plata.length) {
      totales.replaceChildren();
      lista.replaceChildren(h('li', { class: 'cl-nada', texto: 'Anotá lo que se cobra y lo que se gasta, en pesos o en dólares.' }));
      return;
    }

    // Un resumen por moneda: nunca se suman pesos con dólares.
    const monedas = [...new Set(filas.plata.map((p) => p.moneda))].sort();
    totales.replaceChildren(...monedas.map((moneda) => {
      const suyas = filas.plata.filter((p) => p.moneda === moneda);
      const suma = (f) => suyas.filter(f).reduce((s, p) => s + Number(p.monto), 0);
      const cobrado = suma((p) => p.tipo === 'cobro' && p.pagado);
      const falta = suma((p) => p.tipo === 'cobro' && !p.pagado);
      const gastos = suma((p) => p.tipo === 'gasto');
      return h('dl', { class: 'cl-total' },
        h('div', { class: 'cl-total__moneda', texto: moneda === 'USD' ? 'En dólares' : 'En pesos' }),
        h('div', {}, h('dt', { texto: 'Cobrado' }), h('dd', { class: 'cl-total--bien', texto: plata(cobrado, moneda) })),
        h('div', {}, h('dt', { texto: 'Falta cobrar' }), h('dd', { texto: plata(falta, moneda) })),
        h('div', {}, h('dt', { texto: 'Gastos' }), h('dd', { texto: plata(gastos, moneda) })),
      );
    }));

    const ordenadas = [...filas.plata].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado.localeCompare(a.creado));
    lista.replaceChildren(...ordenadas.map((p) => {
      const idCaja = `cl-pagado-${p.id}`;
      const esCobro = p.tipo === 'cobro';
      return h('li', { class: `cl-movimiento cl-movimiento--${p.tipo}` },
        h('span', { class: 'cl-movimiento__icono', 'aria-hidden': 'true', texto: esCobro ? '↓' : '↑' }),
        h('span', { class: 'cl-movimiento__texto' },
          h('span', { class: 'cl-movimiento__concepto', texto: p.concepto }),
          h('span', { class: 'cl-movimiento__fecha', texto: `${esCobro ? 'Cobro' : 'Gasto'} · ${fechaCorta(p.fecha)}` }),
        ),
        h('span', { class: 'cl-movimiento__monto', texto: (esCobro ? '' : '− ') + plata(p.monto, p.moneda) }),
        h('span', { class: 'cl-movimiento__pagado' },
          h('input', { type: 'checkbox', id: idCaja, checked: p.pagado, onchange: (e) => cambiarFila('cliente_plata', p.id, { pagado: e.target.checked }, 'plata') }),
          h('label', { for: idCaja, texto: esCobro ? 'Cobrado' : 'Pagado' }),
        ),
        botonBorrar(`«${p.concepto}»`, () => borrarFila('cliente_plata', p.id, 'plata')),
      );
    }));
  }

  // ── Archivos ──

  function bloqueArchivos() {
    const entrada = h('input', {
      id: 'cl-subir',
      type: 'file',
      multiple: true,
      class: 'visualmente-oculto',
      accept: 'image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.csv,.docx,.xlsx,.pptx,.zip',
    });
    entrada.addEventListener('change', () => subir([...entrada.files]).finally(() => (entrada.value = '')));
    const zonaSoltar = h('div', { class: 'cl-soltar', 'data-soltar': true },
      entrada,
      h('label', { for: 'cl-subir', class: 'boton boton--suave cl-soltar__boton' }, h('span', { 'aria-hidden': 'true', texto: '⇪ ' }), 'Sumar archivos'),
      h('p', { class: 'cl-soltar__ayuda', 'data-ayuda-archivos': true, texto: 'O soltalos acá. PDF, imágenes, Word, Excel, PowerPoint o ZIP, hasta 50 MB cada uno. Videos no.' }),
      h('p', { class: 'cl-soltar__estado', role: 'status', 'data-estado-subida': true }),
    );
    zonaSoltar.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      zonaSoltar.classList.add('cl-soltar--encima');
    });
    zonaSoltar.addEventListener('dragleave', () => zonaSoltar.classList.remove('cl-soltar--encima'));
    zonaSoltar.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      zonaSoltar.classList.remove('cl-soltar--encima');
      subir([...e.dataTransfer.files]);
    });
    return bloque('archivos', 'Archivos', h('ul', { class: 'cl-archivos', 'data-lista-archivos': true }), zonaSoltar);
  }

  async function subir(archivos) {
    if (!archivos.length) return;
    const estado = raiz.querySelector('[data-estado-subida]');
    if (!datos.conectado) {
      app.avisar('En modo prueba no se suben archivos: hace falta conectar Supabase.', 'info');
      return;
    }
    const problemas = [];
    const buenos = archivos.filter((a) => {
      const problema = problemaArchivo(a);
      if (problema) problemas.push(problema);
      return !problema;
    });
    let subidos = 0;
    for (const [i, archivo] of buenos.entries()) {
      estado.textContent = `Subiendo ${buenos.length > 1 ? `${i + 1} de ${buenos.length}: ` : ''}${archivo.name}…`;
      try {
        await datos.subirArchivo({ clienteId: id, archivo });
        subidos++;
      } catch (e) {
        problemas.push(e.message);
      }
    }
    estado.textContent = '';
    if (subidos > 0) app.avisar(subidos === 1 ? 'Listo, archivo subido.' : `Listo, ${subidos} archivos subidos.`, 'ok');
    for (const p of problemas) app.avisar(p, 'error');
    await cargar();
  }

  let pedidoMiniaturas = 0;
  async function pintarArchivos() {
    const lista = raiz.querySelector('[data-lista-archivos]');
    const ayuda = raiz.querySelector('[data-ayuda-archivos]');
    if (!datos.conectado) {
      ayuda.textContent = 'En modo prueba no se suben archivos: cuando esté conectado Supabase, acá van PDF, imágenes, Word, Excel o ZIP (hasta 50 MB cada uno).';
    }
    if (!filas.archivos.length) {
      lista.replaceChildren(h('li', { class: 'cl-nada', texto: 'Todavía no hay archivos.' }));
      return;
    }
    const ordenados = [...filas.archivos].sort((a, b) => b.creado.localeCompare(a.creado));
    lista.replaceChildren(...ordenados.map((a) => {
      const autor = app.buscarPersona(a.subido_por);
      const esImagen = a.tipo.startsWith('image/');
      return h('li', { class: 'cl-archivo', 'data-ruta': a.ruta },
        h('span', { class: 'cl-archivo__icono', 'aria-hidden': 'true', texto: iconoArchivo(a) }),
        h('span', { class: 'cl-archivo__texto' },
          h('span', { class: 'cl-archivo__nombre', texto: a.nombre }),
          h('span', { class: 'cl-archivo__meta', texto: `${peso(a.tamano)} · ${autor?.nombre ?? 'Alguien'} · ${haceCuanto(a.creado)}` }),
        ),
        h('button', { type: 'button', class: 'cl-boton-mini', 'aria-label': `Bajar ${a.nombre}`, onclick: () => bajar(a), texto: esImagen ? 'Abrir' : 'Bajar' }),
        botonBorrar(`el archivo «${a.nombre}»`, async () => {
          try {
            await datos.borrarArchivo(a);
            app.avisar('Archivo borrado.', 'ok');
            await cargar();
          } catch (e) {
            app.avisar(e.message, 'error');
          }
        }),
      );
    }));

    // Miniaturas de las imágenes (con links que vencen solos).
    const pedido = ++pedidoMiniaturas;
    const rutas = ordenados.filter((a) => a.tipo.startsWith('image/')).map((a) => a.ruta);
    const links = await datos.linksDeImagenes(rutas).catch(() => ({}));
    if (pedido !== pedidoMiniaturas) return;
    for (const item of lista.querySelectorAll('[data-ruta]')) {
      const link = links[item.dataset.ruta];
      if (!link) continue;
      const img = h('img', { class: 'cl-archivo__miniatura', src: link, alt: '', width: '40', height: '40', loading: 'lazy', decoding: 'async' });
      item.querySelector('.cl-archivo__icono').replaceWith(img);
    }

    const usado = await datos.espacioUsado();
    if (usado != null) ayuda.textContent = `O soltalos acá. Hasta 50 MB cada uno, sin videos. Usado: ${peso(usado)} de 1 GB.${usado > TOPE_ESPACIO * 0.85 ? ' ¡Queda poco lugar!' : ''}`;
  }

  async function bajar(archivo) {
    try {
      const url = await datos.linkParaBajar(archivo);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      app.avisar(e.message, 'error');
    }
  }

  // ── Borrar el cliente ──

  function bloqueBorrar() {
    return h('section', { class: 'cl-bloque cl-bloque--peligro', 'aria-labelledby': 'cl-borrar-titulo' },
      h('h2', { id: 'cl-borrar-titulo', texto: 'Borrar' }),
      h('p', { texto: 'Se borra la ficha con todo lo que tiene adentro (tareas, notas, plata y archivos). No se puede deshacer.' }),
      h('button', {
        type: 'button',
        class: 'boton boton--peligro',
        onclick: async () => {
          const si = await confirmar.preguntar(`¿Borrar a ${cliente?.nombre ?? 'este cliente'} con todo lo suyo?`, 'Sí, borrar todo');
          if (!si) return;
          try {
            // Primero los archivos de la caja (la base borra las filas sola, pero no los archivos).
            for (const a of filas.archivos) await datos.borrarArchivo(a).catch((e) => console.error(e));
            await datos.borrar('clientes', id);
            app.avisar(`${cliente.nombre} se borró.`, 'ok');
            app.navegar('clientes');
          } catch (e) {
            console.error(e);
            app.avisar('No se pudo borrar. Probá de nuevo.', 'error');
          }
        },
        texto: 'Borrar este cliente',
      }),
    );
  }

  // ── Crear, cambiar y borrar filas (comunes a las listas) ──

  const CLAVE_FILAS = { tareas: 'tareas', notas: 'notas', links: 'links', plata: 'plata' };

  async function crearFila(tabla, fila, clave) {
    try {
      const nueva = await datos.crear(tabla, { ...fila, creado_por: app.persona.slug });
      filas[CLAVE_FILAS[clave]].push(nueva);
      pintar();
      return true;
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo guardar. Fijate la conexión y probá de nuevo.', 'error');
      return false;
    }
  }

  async function cambiarFila(tabla, filaId, cambios, clave, mensaje) {
    try {
      const nueva = await datos.cambiar(tabla, filaId, cambios);
      filas[clave] = filas[clave].map((f) => (f.id === filaId ? nueva : f));
      pintar();
      if (mensaje) app.avisar(mensaje, 'ok');
      return true;
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo guardar. Fijate la conexión y probá de nuevo.', 'error');
      pintar();
      return false;
    }
  }

  async function borrarFila(tabla, filaId, clave) {
    try {
      await datos.borrar(tabla, filaId);
      filas[clave] = filas[clave].filter((f) => f.id !== filaId);
      pintar();
      app.avisar('Borrado.', 'ok');
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo borrar. Probá de nuevo.', 'error');
    }
  }

  // Botón de borrar con confirmación (para no borrar nada sin querer).
  function botonBorrar(que, alConfirmar) {
    return h('button', {
      type: 'button',
      class: 'cl-boton-mini cl-boton-mini--borrar',
      'aria-label': `Borrar ${que}`,
      title: 'Borrar',
      onclick: async () => {
        if (await confirmar.preguntar(`¿Borrar ${que}?`, 'Sí, borrar')) alConfirmar();
      },
    }, h('span', { 'aria-hidden': 'true', texto: '✕' }));
  }

  return {
    armar,
    cargar,
    repintar: pintar,
  };
}

// ── Piezas chicas ──────────────────────────────────────────────────────

/** Crea un elemento. Todo el texto entra como texto (nunca como HTML). */
function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor == null || valor === false) continue;
    if (clave === 'class') el.className = valor;
    else if (clave === 'texto') el.textContent = valor;
    else if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), valor);
    else if (valor === true) el.setAttribute(clave, '');
    else el.setAttribute(clave, valor);
  }
  el.append(...hijos.flat(Infinity).filter((x) => x != null && x !== false));
  return el;
}

function bloque(parte, titulo, ...contenido) {
  return h('section', { class: 'cl-bloque', id: `cl-${parte}`, 'aria-labelledby': `cl-${parte}-titulo` },
    h('h2', { id: `cl-${parte}-titulo`, tabindex: '-1', texto: titulo }),
    ...contenido,
  );
}

function campo({ id, nombre, etiqueta, tipo = 'text', requerido, max, autocomplete, placeholder, inputmode, area, valor, ayuda }) {
  const props = {
    id,
    name: nombre,
    maxlength: max ? String(max) : null,
    required: requerido,
    autocomplete,
    placeholder,
    inputmode,
    'aria-describedby': ayuda ? `${id}-ayuda` : null,
  };
  const control = area ? h('textarea', { ...props, rows: '4' }) : h('input', { ...props, type: tipo, value: valor });
  return h('div', { class: 'campo' },
    h('label', { for: id, texto: etiqueta }),
    control,
    ayuda ? h('p', { class: 'campo__ayuda', id: `${id}-ayuda`, texto: ayuda }) : null,
    h('p', { class: 'campo__error', id: `${id}-error`, hidden: true }),
  );
}

function campoSelect({ id, nombre, etiqueta, opciones }) {
  return h('div', { class: 'campo' },
    h('label', { for: id, texto: etiqueta }),
    h('select', { id, name: nombre }, opciones.map(([v, t]) => h('option', { value: v, texto: t }))),
  );
}

function opcionesPersonas(app) {
  return [...app.personas.map((p) => [p.slug, p.nombre]), ['', 'Nadie']];
}

function leerForm(form) {
  const valores = {};
  for (const [k, v] of new FormData(form)) valores[k] = typeof v === 'string' ? v.trim().replace(/[ \t]+/g, ' ') : v;
  // En los textos largos se respetan los renglones.
  for (const area of form.querySelectorAll('textarea[name]')) valores[area.name] = area.value.trim();
  return valores;
}

function marcarError(form, nombre, texto) {
  const control = form.elements[nombre];
  const error = form.querySelector(`#${control.id}-error`);
  control.setAttribute('aria-invalid', 'true');
  if (error) {
    error.textContent = texto;
    error.hidden = false;
    control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
  }
  control.focus();
}

function limpiarErrores(form) {
  for (const control of form.querySelectorAll('[aria-invalid]')) {
    control.removeAttribute('aria-invalid');
    const quedan = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && !x.endsWith('-error'));
    if (quedan.length) control.setAttribute('aria-describedby', quedan.join(' '));
    else control.removeAttribute('aria-describedby');
  }
  for (const error of form.querySelectorAll('.campo__error')) error.hidden = true;
}

function avatar(persona, prefijo) {
  if (!persona) return h('span', { class: 'cl-avatar cl-avatar--nadie', title: `${prefijo}: nadie todavía`, 'aria-label': `${prefijo}: nadie todavía`, texto: '?' });
  return h('span', {
    class: 'cl-avatar',
    'data-persona': persona.slug,
    title: `${prefijo}: ${persona.nombre}`,
    'aria-label': `${prefijo}: ${persona.nombre}`,
    texto: persona.nombre.slice(0, 1).toUpperCase(),
  });
}

// Una ventanita de «¿Seguro?» que devuelve true o false.
function crearConfirmar() {
  const texto = h('p', { class: 'cl-confirmar__texto', id: 'cl-confirmar-texto' });
  const si = h('button', { class: 'boton boton--peligro', type: 'submit', value: 'si' });
  const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'cl-confirmar-texto' },
    h('form', { method: 'dialog', class: 'dialogo__cuerpo' },
      texto,
      h('div', { class: 'dialogo__botones' }, si, h('button', { class: 'boton boton--suave', type: 'submit', value: 'no', texto: 'No, dejalo' })),
    ),
  );
  return {
    dialogo,
    preguntar(pregunta, textoSi) {
      texto.textContent = pregunta;
      si.textContent = textoSi;
      dialogo.returnValue = '';
      dialogo.showModal();
      dialogo.querySelector('[value="no"]').focus();
      return new Promise((listo) => dialogo.addEventListener('close', () => listo(dialogo.returnValue === 'si'), { once: true }));
    },
  };
}

function mostrarFallaCarga(donde, pista) {
  if (!donde) return;
  donde.replaceChildren(
    h('div', { class: 'cl-vacio cl-vacio--falla', role: 'alert' },
      h('p', { class: 'cl-vacio__titulo', texto: 'No pude traer los clientes.' }),
      h('p', { texto: `Fijate la conexión y recargá. ${pista}` }),
    ),
  );
}

function nombreEstado(id) {
  return ESTADOS.find((e) => e.id === id)?.nombre ?? id;
}

function contar(filas, campo) {
  const cuenta = new Map();
  for (const f of filas) if (f[campo]) cuenta.set(f[campo], (cuenta.get(f[campo]) ?? 0) + 1);
  return cuenta;
}

function normalizar(texto) {
  return (texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

// Solo links http/https (nada de «javascript:» ni cosas raras).
function linkSeguro(texto) {
  if (!texto) return null;
  try {
    const url = new URL(texto);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function conProtocolo(texto) {
  if (!texto) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`;
}

// «150.000», «150000», «150.000,50», «1500.5» → número; si no se entiende, null.
function leerMonto(texto) {
  let t = (texto ?? '').replace(/[\s$]|US|ARS|USD/gi, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n < 1e12 ? n : null;
}

function plata(monto, moneda) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    currencyDisplay: moneda === 'USD' ? 'code' : 'narrowSymbol',
    maximumFractionDigits: Number(monto) % 1 ? 2 : 0,
  }).format(Number(monto));
}

function fechaCorta(fecha) {
  if (!fecha) return '';
  const [a, m, d] = fecha.slice(0, 10).split('-').map(Number);
  const f = new Date(a, m - 1, d);
  const esteAnio = a === new Date().getFullYear();
  return f.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', ...(esteAnio ? {} : { year: 'numeric' }) });
}

function haceCuanto(fecha) {
  const segundos = (Date.now() - new Date(fecha).getTime()) / 1000;
  if (segundos < 60) return 'recién';
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `hace ${Math.floor(segundos / 3600)} h`;
  if (segundos < 86400 * 7) {
    const dias = Math.floor(segundos / 86400);
    return dias === 1 ? 'ayer' : `hace ${dias} días`;
  }
  return fechaCorta(fecha);
}

function peso(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
}

function iconoArchivo(a) {
  if (a.tipo.startsWith('image/')) return '🖼';
  if (a.tipo === 'application/pdf') return '📕';
  if (a.tipo.includes('spreadsheet') || a.tipo === 'text/csv') return '📊';
  if (a.tipo.includes('presentation')) return '📽';
  if (a.tipo.includes('zip')) return '🗜';
  return '📄';
}

// Nombre seguro para la ruta en la caja: sin tildes, sin barras ni caracteres raros.
function nombreLimpio(nombre) {
  return (
    nombre
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-80) || 'archivo'
  );
}

function problemaArchivo(archivo) {
  if (archivo.type.startsWith('video/')) return `«${archivo.name}» es un video: no entran (ocupan mucho). Subilo a Drive y pegá el link.`;
  if (archivo.size > MAX_BYTES) return `«${archivo.name}» pesa más de 50 MB.`;
  if (!archivo.size) return `«${archivo.name}» está vacío.`;
  if (!TIPOS_PERMITIDOS.has(archivo.type)) return `«${archivo.name}»: ese tipo de archivo no se puede subir. Probá con PDF, imagen, Word, Excel, PowerPoint o ZIP.`;
  return null;
}
