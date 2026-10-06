// Mi espacio: el perfil de cada uno armado con bloques (lista, notas, tablero, links, ideas, dibujo),
// un saludo sorpresa al entrar y las sorpresas (stickers o dibujos) que te dejan los otros.
// #/miespacio = el tuyo · #/miespacio/hassan = el de Hassan (se mira, no se toca, y le podés dejar una sorpresa).
// Datos: tablas «bloques» y «sorpresas» de Supabase (supabase/miespacio.sql) o, en modo prueba, esta compu.
import '../estilos/miespacio.css';
import { stickers, stickerAlAzar, elegirSaludo, nombres } from '../../recursos/index.js';
import { listarDibujos, urlsDeDibujos, alCambiarDibujos } from './paint.js';

const TIPOS = {
  lista: { nombre: 'Lista', icono: '☑️', titulo: 'Lista', vacio: () => ({ items: [] }) },
  notas: { nombre: 'Notas', icono: '📝', titulo: 'Notas', vacio: () => ({ texto: '' }) },
  tablero: {
    nombre: 'Tablero',
    icono: '🗂️',
    titulo: 'Tablero',
    vacio: () => ({
      columnas: ['Por hacer', 'Haciendo', 'Hecho'].map((titulo) => ({ id: nuevoId(), titulo, tarjetas: [] })),
    }),
  },
  links: { nombre: 'Links', icono: '🔗', titulo: 'Links', vacio: () => ({ links: [] }) },
  ideas: { nombre: 'Muro de ideas', icono: '💡', titulo: 'Ideas', vacio: () => ({ ideas: [] }) },
  dibujo: { nombre: 'Dibujo', icono: '🎨', titulo: 'Dibujo', vacio: () => ({ dibujoId: null }) },
};
const COLORES_IDEA = 4;
const MAX_MENSAJE = 140;
const CLAVE_BLOQUES = 'ath-prueba-bloques';
const CLAVE_SORPRESAS = 'ath-prueba-sorpresas';

function nuevoId() {
  return crypto.randomUUID();
}

// ── Ayudantes ─────────────────────────────────────────────────────────

function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave === 'valor') nodo.value = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  nodo.append(...hijos.filter((h) => h !== null && h !== undefined && h !== false));
  return nodo;
}

const texto = (v, max = 2000) => String(v ?? '').slice(0, max);
const lista = (v) => (Array.isArray(v) ? v : []);

// Solo direcciones web de verdad (nada de «javascript:» escondido en un link).
function linkSeguro(valor) {
  let limpio = String(valor ?? '').trim();
  if (!limpio) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(limpio)) limpio = `https://${limpio}`;
  try {
    const url = new URL(limpio);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// Lo que viene de la base (o del agente) se ordena antes de mostrarlo: si falta algo, va vacío.
function normalizar(tipo, c = {}) {
  c = c && typeof c === 'object' ? c : {};
  if (tipo === 'lista') return { items: lista(c.items).map((i) => ({ id: texto(i.id) || nuevoId(), texto: texto(i.texto, 300), hecho: Boolean(i.hecho) })) };
  if (tipo === 'notas') return { texto: texto(c.texto, 20000) };
  if (tipo === 'tablero') {
    const columnas = lista(c.columnas).map((col) => ({
      id: texto(col.id) || nuevoId(),
      titulo: texto(col.titulo, 40),
      tarjetas: lista(col.tarjetas).map((t) => ({ id: texto(t.id) || nuevoId(), texto: texto(t.texto, 300) })),
    }));
    return columnas.length ? { columnas } : TIPOS.tablero.vacio();
  }
  if (tipo === 'links') {
    return { links: lista(c.links).map((l) => ({ id: texto(l.id) || nuevoId(), titulo: texto(l.titulo, 100), url: linkSeguro(l.url) })).filter((l) => l.url) };
  }
  if (tipo === 'ideas') {
    return { ideas: lista(c.ideas).map((i) => ({ id: texto(i.id) || nuevoId(), texto: texto(i.texto, 500), color: Math.abs(Number(i.color) || 0) % COLORES_IDEA })) };
  }
  if (tipo === 'dibujo') return { dibujoId: c.dibujoId ? texto(c.dibujoId, 60) : null };
  return {};
}

function leerLocal(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? '[]');
  } catch {
    return [];
  }
}

function escribirLocal(clave, filas) {
  try {
    localStorage.setItem(clave, JSON.stringify(filas));
  } catch {
    throw new Error('No entra más en esta compu (modo prueba).');
  }
  window.dispatchEvent(new CustomEvent('ath-miespacio', { detail: clave }));
}

// ── Datos: bloques y sorpresas (Supabase o, en modo prueba, esta compu) ─

function crearDatos(app) {
  const db = app.supabase;
  const COLUMNAS = 'id, dueno, tipo, titulo, contenido, privado, orden';

  return {
    async bloques(dueno) {
      if (!app.conectado) {
        return leerLocal(CLAVE_BLOQUES)
          .filter((b) => b.dueno === dueno && (dueno === app.persona.slug || !b.privado))
          .sort((a, b) => a.orden - b.orden);
      }
      const { data, error } = await db.from('bloques').select(COLUMNAS).eq('dueno', dueno).order('orden');
      if (error) throw new Error('No pude traer los bloques.');
      return data;
    },

    async crearBloque(fila) {
      const nueva = { ...fila, dueno: app.persona.slug };
      if (!app.conectado) {
        const conId = { ...nueva, id: nuevoId() };
        escribirLocal(CLAVE_BLOQUES, [...leerLocal(CLAVE_BLOQUES), conId]);
        return conId;
      }
      const { data, error } = await db.from('bloques').insert(nueva).select(COLUMNAS).single();
      if (error) throw new Error('No pude crear el bloque.');
      return data;
    },

    async cambiarBloque(id, cambios) {
      if (!app.conectado) {
        escribirLocal(CLAVE_BLOQUES, leerLocal(CLAVE_BLOQUES).map((b) => (b.id === id ? { ...b, ...cambios } : b)));
        return;
      }
      const { error } = await db.from('bloques').update(cambios).eq('id', id);
      if (error) throw new Error('No se pudo guardar.');
    },

    async borrarBloque(id) {
      if (!app.conectado) {
        escribirLocal(CLAVE_BLOQUES, leerLocal(CLAVE_BLOQUES).filter((b) => b.id !== id));
        return;
      }
      const { error } = await db.from('bloques').delete().eq('id', id);
      if (error) throw new Error('No se pudo borrar.');
    },

    /** Las sorpresas que me dejaron y todavía no vi. */
    async misSorpresas() {
      const yo = app.persona.slug;
      if (!app.conectado) return leerLocal(CLAVE_SORPRESAS).filter((s) => s.para === yo && !s.vista);
      const { data, error } = await db
        .from('sorpresas')
        .select('id, de, para, tipo, sticker, dibujo_id, mensaje, creado')
        .eq('para', yo)
        .eq('vista', false)
        .order('creado');
      if (error) throw new Error('No pude traer tus sorpresas.');
      return data;
    },

    async dejarSorpresa({ para, tipo, sticker = null, dibujoId = null, mensaje = '' }) {
      const fila = { de: app.persona.slug, para, tipo, sticker, dibujo_id: dibujoId, mensaje: mensaje || null };
      if (!app.conectado) {
        escribirLocal(CLAVE_SORPRESAS, [...leerLocal(CLAVE_SORPRESAS), { ...fila, id: nuevoId(), vista: false, creado: new Date().toISOString() }]);
        return;
      }
      const { error } = await db.from('sorpresas').insert(fila);
      if (error) throw new Error('No se pudo dejar la sorpresa.');
    },

    async marcarVista(id) {
      if (!app.conectado) {
        escribirLocal(CLAVE_SORPRESAS, leerLocal(CLAVE_SORPRESAS).map((s) => (s.id === id ? { ...s, vista: true } : s)));
        return;
      }
      const { error } = await db.from('sorpresas').update({ vista: true }).eq('id', id);
      if (error) throw new Error('No se pudo guardar.');
    },

    /** fn(tabla, fila o null) cuando cambia algo de los bloques o las sorpresas. */
    alCambiar(fn) {
      if (!app.conectado) {
        window.addEventListener('ath-miespacio', (e) => fn(e.detail === CLAVE_SORPRESAS ? 'sorpresas' : 'bloques', null));
        window.addEventListener('storage', (e) => {
          if (e.key === CLAVE_BLOQUES) fn('bloques', null);
          if (e.key === CLAVE_SORPRESAS) fn('sorpresas', null);
        });
        return;
      }
      db.channel('miespacio')
        // Al borrar, Supabase no manda la fila: va null y se recarga igual.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bloques' }, (c) => fn('bloques', c.eventType === 'DELETE' ? null : c.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sorpresas' }, () => fn('sorpresas', null))
        .subscribe();
    },
  };
}

// ── La pantalla ───────────────────────────────────────────────────────

export async function iniciar(app) {
  const datos = crearDatos(app);
  const estado = {
    dueno: null, // de quién es el espacio que se está mirando
    bloques: [],
    dibujos: [],
    urls: {},
    sorpresas: [],
    abiertas: new Set(), // sorpresas que ya desenvolviste (para que no se vuelvan a envolver al redibujar)
    pendiente: false, // llegó un cambio mientras escribías: se aplica cuando salís del bloque
    saludo: null,
    sticker: null,
  };
  const temporizadores = new Map();
  let guardando = 0;
  let zona = null;
  let partes = null;

  app.registrarPantalla({
    ruta: 'miespacio',
    titulo: 'Mi espacio',
    icono: '✨',
    orden: 30,
    mostrar({ zona: z, params }) {
      zona = z;
      if (!partes) partes = armarFijo(zona);
      const pedido = app.buscarPersona(params[0] ?? '')?.slug ?? app.persona.slug;
      estado.saludo = null; // un saludo nuevo cada vez que entrás
      estado.dueno = pedido;
      cargar();
    },
  });

  // Sorpresas: aviso al entrar y cada vez que te llega una nueva.
  let cuantasSorpresas = 0;
  async function contarSorpresas() {
    try {
      const mias = await datos.misSorpresas();
      if (mias.length > cuantasSorpresas) {
        const nueva = mias.at(-1);
        app.avisar(
          mias.length - cuantasSorpresas > 1
            ? `🎁 Te dejaron ${mias.length - cuantasSorpresas} sorpresas en Mi espacio.`
            : `🎁 ${nombreDe(nueva.de)} te dejó una sorpresa en Mi espacio.`,
        );
      }
      cuantasSorpresas = mias.length;
    } catch (e) {
      console.error(e);
    }
  }
  setTimeout(contarSorpresas, 1200);

  datos.alCambiar((tabla, fila) => {
    if (tabla === 'sorpresas') contarSorpresas();
    if (!zona || zona.hidden) return;
    if (tabla === 'bloques' && fila && fila.dueno !== estado.dueno) return;
    recargarCuandoSePueda();
  });
  alCambiarDibujos(app, () => zona && !zona.hidden && recargarCuandoSePueda());

  // Un dibujo hecho en el Paint «para» alguien se deja como sorpresa.
  app.escuchar('dibujo-guardado', async ({ dibujo, para }) => {
    try {
      await datos.dejarSorpresa({ para, tipo: 'dibujo', dibujoId: dibujo.id });
      app.avisar(`Listo: ${app.buscarPersona(para)?.nombre ?? para} va a ver tu dibujo cuando entre a su espacio.`, 'ok');
    } catch (e) {
      app.avisar(e.message, 'error');
    }
  });

  app.escuchar('personas', () => zona && !zona.hidden && partes && pintarQuien());

  // Si estás escribiendo en un bloque, no te lo cambio abajo de los dedos: espero a que salgas.
  function recargarCuandoSePueda() {
    const escribiendo = zona.contains(document.activeElement) && document.activeElement.closest('.bloque, .me-sorpresa');
    if (escribiendo || guardando > 0) {
      estado.pendiente = true;
      return;
    }
    cargar();
  }

  async function cargar() {
    estado.pendiente = false;
    const dueno = estado.dueno;
    try {
      const [bloques, dibujos, sorpresas] = await Promise.all([
        datos.bloques(dueno),
        listarDibujos(app).catch(() => []),
        dueno === app.persona.slug ? datos.misSorpresas().catch(() => []) : [],
      ]);
      if (dueno !== estado.dueno) return; // mientras tanto se fue a otro espacio
      estado.bloques = bloques.map((b) => ({ ...b, contenido: normalizar(b.tipo, b.contenido) }));
      estado.dibujos = dibujos;
      estado.sorpresas = sorpresas;
      const usados = new Set([
        ...estado.bloques.filter((b) => b.tipo === 'dibujo').map((b) => b.contenido.dibujoId),
        ...sorpresas.filter((s) => s.tipo === 'dibujo').map((s) => s.dibujo_id),
      ]);
      estado.urls = await urlsDeDibujos(app, dibujos.filter((d) => usados.has(d.id))).catch(() => ({}));
      if (dueno !== estado.dueno) return;
      pintar();
    } catch (e) {
      console.error(e);
      partes.bloques.replaceChildren(el('p', { clase: 'me-vacio', texto: `${e.message} Probá recargar.` }));
    }
  }

  // ── Lo que no cambia entre espacios ──

  function armarFijo(z) {
    z.classList.add('me-pantalla');
    const quien = el('nav', { clase: 'me-quien', 'aria-label': 'Espacios del equipo' });
    const cabeza = el('header', { clase: 'me-cabeza' });
    const sorpresas = el('section', { clase: 'me-sorpresas', 'aria-label': 'Sorpresas para vos' });
    const barra = el('div', { clase: 'me-barra' });
    const bloques = el('div', { clase: 'me-bloques' });
    const dialogoSorpresa = armarDialogoSorpresa();
    const dialogoConfirmar = armarDialogoConfirmar();
    const contenedor = el('div', { clase: 'me' }, quien, cabeza, sorpresas, barra, bloques);
    z.replaceChildren(contenedor, dialogoSorpresa.dialogo, dialogoConfirmar.dialogo);

    // Cuando salís de un bloque, se aplican los cambios que llegaron mientras escribías.
    contenedor.addEventListener('focusout', () => {
      setTimeout(() => {
        if (estado.pendiente && !contenedor.contains(document.activeElement)) cargar();
      }, 0);
    });

    return { contenedor, quien, cabeza, sorpresas, barra, bloques, dialogoSorpresa, dialogoConfirmar };
  }

  function soyYo() {
    return estado.dueno === app.persona.slug;
  }

  function pintar() {
    partes.contenedor.dataset.dueno = estado.dueno;
    partes.contenedor.classList.toggle('me--ajeno', !soyYo());
    pintarQuien();
    pintarCabeza();
    pintarSorpresas();
    pintarBarra();
    pintarBloques();
  }

  function pintarQuien() {
    partes.quien.replaceChildren(
      el(
        'ul',
        {},
        ...app.personas.map((p) =>
          el(
            'li',
            {},
            el(
              'a',
              {
                clase: 'me-quien__link',
                href: p.slug === app.persona.slug ? '#/miespacio' : `#/miespacio/${p.slug}`,
                'data-persona': p.slug,
                'aria-current': p.slug === estado.dueno ? 'page' : null,
              },
              el('span', { clase: 'me-quien__punto', 'aria-hidden': 'true', texto: p.nombre[0]?.toUpperCase() }),
              el('span', { texto: p.slug === app.persona.slug ? `${p.nombre} (vos)` : p.nombre }),
            ),
          ),
        ),
      ),
    );
  }

  function nombreDe(slug) {
    return app.buscarPersona(slug)?.nombre ?? nombres[slug] ?? slug;
  }

  function pintarCabeza() {
    if (soyYo()) {
      if (!estado.saludo) nuevoSaludo();
      const s = estado.sticker;
      partes.cabeza.replaceChildren(
        el(
          'div',
          { clase: 'me-cabeza__texto' },
          el('p', { clase: 'me-cabeza__antetitulo', texto: 'Tu espacio' }),
          el('h1', { clase: 'me-cabeza__saludo', texto: estado.saludo }),
          el('p', { clase: 'me-cabeza__frase', texto: s.frase }),
        ),
        el(
          'button',
          {
            clase: 'me-cabeza__sticker',
            type: 'button',
            title: 'Otro saludo',
            'aria-label': 'Otro saludo',
            onclick: () => {
              nuevoSaludo();
              pintarCabeza();
            },
          },
          el('img', { src: s.url, alt: s.alt, width: 120, height: 120 }),
        ),
      );
      return;
    }
    const otro = app.buscarPersona(estado.dueno);
    partes.cabeza.replaceChildren(
      el(
        'div',
        { clase: 'me-cabeza__texto' },
        el('p', { clase: 'me-cabeza__antetitulo', texto: otro?.rol ?? '' }),
        el('h1', { clase: 'me-cabeza__saludo', texto: `El espacio de ${nombreDe(estado.dueno)}` }),
        el('p', { clase: 'me-cabeza__frase', texto: 'Lo podés mirar, no tocar. Pero le podés dejar una sorpresa.' }),
      ),
      el(
        'div',
        { clase: 'me-cabeza__acciones' },
        el('button', { clase: 'boton', type: 'button', texto: '🎁 Dejarle una sorpresa', onclick: () => partes.dialogoSorpresa.abrir(estado.dueno) }),
        el('a', { clase: 'boton boton--suave', href: `#/paint/para/${estado.dueno}`, texto: '🎨 Dibujarle algo' }),
      ),
    );
  }

  function nuevoSaludo() {
    const slug = app.persona.slug;
    const anterior = estado.saludo;
    // Que no salga dos veces seguidas el mismo.
    for (let i = 0; i < 5 && estado.saludo === anterior; i++) {
      estado.saludo = elegirSaludo({ persona: slug }).replaceAll(nombres[slug] ?? '\u0000', app.persona.nombre);
    }
    const stickerAnterior = estado.sticker;
    do estado.sticker = stickerAlAzar();
    while (estado.sticker === stickerAnterior);
  }

  // ── Sorpresas que me dejaron ──

  function pintarSorpresas() {
    const visibles = soyYo() ? estado.sorpresas : [];
    partes.sorpresas.hidden = visibles.length === 0;
    partes.sorpresas.replaceChildren(...visibles.map(tarjetaSorpresa));
  }

  function tarjetaSorpresa(s) {
    const de = nombreDe(s.de);
    const abierta = estado.abiertas.has(s.id);
    const cuerpo = el('div', { clase: 'me-sorpresa__cuerpo', hidden: !abierta });
    const tapa = el(
      'button',
      {
        clase: 'me-sorpresa__tapa',
        type: 'button',
        hidden: abierta,
        onclick: () => {
          estado.abiertas.add(s.id);
          tapa.hidden = true;
          cuerpo.hidden = false;
          cuerpo.querySelector('button')?.focus();
        },
      },
      el('span', { clase: 'me-sorpresa__regalo', 'aria-hidden': 'true', texto: '🎁' }),
      el('span', {}, el('strong', { texto: `${de} te dejó una sorpresa` }), el('span', { clase: 'me-sorpresa__abrila', texto: 'Tocá para abrirla' })),
    );

    let imagen;
    if (s.tipo === 'sticker') {
      const st = stickers.find((x) => x.id === s.sticker) ?? stickers[0];
      imagen = el('img', { clase: 'me-sorpresa__img me-sorpresa__img--sticker', src: st.url, alt: st.alt, width: 160, height: 160 });
    } else {
      const dibujo = estado.dibujos.find((d) => d.id === s.dibujo_id);
      imagen = estado.urls[s.dibujo_id]
        ? el('img', { clase: 'me-sorpresa__img', src: estado.urls[s.dibujo_id], alt: `Dibujo de ${de}: ${dibujo?.titulo ?? ''}`, width: 480, height: 320 })
        : el('p', { clase: 'me-vacio', texto: 'Era un dibujo, pero ya no está.' });
    }

    cuerpo.append(
      imagen,
      el(
        'div',
        { clase: 'me-sorpresa__pie' },
        el('p', { clase: 'me-sorpresa__mensaje', texto: s.mensaje ? `«${s.mensaje}» — ${de}` : `De ${de}, con cariño.` }),
        el('button', {
          clase: 'boton',
          type: 'button',
          texto: '¡Gracias, che!',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await datos.marcarVista(s.id);
              estado.sorpresas = estado.sorpresas.filter((x) => x.id !== s.id);
              pintarSorpresas();
            } catch (err) {
              app.avisar(err.message, 'error');
              e.currentTarget.disabled = false;
            }
          },
        }),
      ),
    );
    return el('article', { clase: 'me-sorpresa', 'data-persona': s.de }, tapa, cuerpo);
  }

  // ── Barra para sumar bloques ──

  function pintarBarra() {
    if (!soyYo()) {
      partes.barra.replaceChildren();
      partes.barra.hidden = true;
      return;
    }
    partes.barra.hidden = false;
    partes.barra.replaceChildren(
      el(
        'div',
        { clase: 'me-barra__sumar', role: 'group', 'aria-labelledby': 'me-sumar-titulo' },
        el('span', { id: 'me-sumar-titulo', clase: 'me-barra__titulo', texto: 'Sumar un bloque:' }),
        ...Object.entries(TIPOS).map(([tipo, t]) =>
          el(
            'button',
            { clase: 'me-chip', type: 'button', onclick: () => sumarBloque(tipo) },
            el('span', { 'aria-hidden': 'true', texto: t.icono }),
            el('span', { texto: t.nombre }),
          ),
        ),
      ),
      el(
        'div',
        { clase: 'me-barra__derecha' },
        el('p', { clase: 'me-barra__estado', id: 'me-estado', role: 'status', texto: '' }),
        el('a', { clase: 'boton boton--suave', href: '#/paint' }, el('span', { 'aria-hidden': 'true', texto: '🖌️' }), 'Abrir el Paint'),
      ),
    );
  }

  function avisarGuardado() {
    const nodo = zona.querySelector('#me-estado');
    if (nodo) nodo.textContent = guardando > 0 ? 'Guardando…' : 'Todo guardado ✓';
  }

  async function sumarBloque(tipo) {
    const t = TIPOS[tipo];
    const orden = (estado.bloques.at(-1)?.orden ?? 0) + 1;
    try {
      const bloque = await datos.crearBloque({ tipo, titulo: t.titulo, contenido: t.vacio(), privado: false, orden });
      bloque.contenido = normalizar(bloque.tipo, bloque.contenido);
      estado.bloques.push(bloque);
      pintarBloques();
      const nuevo = partes.bloques.querySelector(`[data-id="${bloque.id}"] .bloque__titulo`);
      nuevo?.focus();
      nuevo?.select();
    } catch (e) {
      app.avisar(e.message, 'error');
    }
  }

  // Guarda un rato después de la última tecla, para no mandar una vez por letra.
  function guardarLuego(bloque, campos = ['contenido']) {
    const clave = bloque.id;
    const previo = temporizadores.get(clave);
    if (previo) clearTimeout(previo.t);
    else guardando++;
    const juntos = new Set([...(previo?.campos ?? []), ...campos]);
    avisarGuardado();
    const t = setTimeout(async () => {
      temporizadores.delete(clave);
      const cambios = Object.fromEntries([...juntos].map((c) => [c, bloque[c]]));
      try {
        await datos.cambiarBloque(bloque.id, cambios);
      } catch (e) {
        app.avisar(e.message, 'error');
      } finally {
        guardando--;
        avisarGuardado();
        if (guardando === 0 && estado.pendiente) recargarCuandoSePueda();
      }
    }, 600);
    temporizadores.set(clave, { t, campos: juntos });
  }

  // ── Los bloques ──

  function pintarBloques() {
    if (!estado.bloques.length) {
      partes.bloques.replaceChildren(
        el(
          'div',
          { clase: 'me-vacio me-vacio--grande' },
          el('p', { texto: soyYo() ? 'Tu espacio está vacío.' : `${nombreDe(estado.dueno)} todavía no armó nada (o lo tiene en privado).` }),
          soyYo() && el('p', { texto: 'Sumá un bloque de arriba: una lista, notas, un tablero, tus links, un muro de ideas o un dibujo.' }),
        ),
      );
      return;
    }
    partes.bloques.replaceChildren(...estado.bloques.map(tarjetaBloque));
  }

  function repintarBloque(bloque, enfocar) {
    const viejo = partes.bloques.querySelector(`[data-id="${bloque.id}"]`);
    if (!viejo) return;
    const nuevo = tarjetaBloque(bloque);
    viejo.replaceWith(nuevo);
    if (enfocar) nuevo.querySelector(enfocar)?.focus();
  }

  function tarjetaBloque(bloque) {
    const t = TIPOS[bloque.tipo] ?? { icono: '•', nombre: bloque.tipo };
    const editable = soyYo();
    const i = estado.bloques.indexOf(bloque);
    const idTitulo = `bloque-titulo-${bloque.id}`;

    const titulo = editable
      ? el('input', {
          clase: 'bloque__titulo',
          id: idTitulo,
          type: 'text',
          maxlength: 80,
          valor: bloque.titulo,
          'aria-label': `Título del bloque (${t.nombre})`,
          oninput: (e) => {
            bloque.titulo = e.target.value;
            guardarLuego(bloque, ['titulo']);
          },
        })
      : el('h2', { clase: 'bloque__titulo', id: idTitulo, texto: bloque.titulo || t.nombre });

    const acciones = editable
      ? el(
          'div',
          { clase: 'bloque__acciones' },
          el('button', {
            clase: 'bloque__boton',
            type: 'button',
            'aria-pressed': String(bloque.privado),
            title: bloque.privado ? 'Solo lo ves vos. Tocá para que lo vean los otros.' : 'Lo ven los tres. Tocá para que sea solo tuyo.',
            'aria-label': 'Solo para mí',
            texto: bloque.privado ? '🔒' : '👀',
            onclick: () => {
              bloque.privado = !bloque.privado;
              guardarLuego(bloque, ['privado']);
              repintarBloque(bloque, '.bloque__acciones button');
            },
          }),
          el('button', { clase: 'bloque__boton', type: 'button', 'aria-label': 'Subir el bloque', title: 'Subir', texto: '↑', disabled: i === 0, onclick: () => mover(bloque, -1) }),
          el('button', { clase: 'bloque__boton', type: 'button', 'aria-label': 'Bajar el bloque', title: 'Bajar', texto: '↓', disabled: i === estado.bloques.length - 1, onclick: () => mover(bloque, 1) }),
          el('button', { clase: 'bloque__boton bloque__boton--peligro', type: 'button', 'aria-label': 'Borrar el bloque', title: 'Borrar', texto: '🗑', onclick: () => borrar(bloque) }),
        )
      : bloque.privado && el('span', { clase: 'bloque__privado', texto: '🔒' });

    const cuerpo = el('div', { clase: 'bloque__cuerpo' });
    const pintores = { lista: cuerpoLista, notas: cuerpoNotas, tablero: cuerpoTablero, links: cuerpoLinks, ideas: cuerpoIdeas, dibujo: cuerpoDibujo };
    pintores[bloque.tipo]?.(cuerpo, bloque, editable);

    return el(
      'article',
      { clase: `bloque bloque--${bloque.tipo}`, 'data-id': bloque.id, 'aria-labelledby': idTitulo },
      el('header', { clase: 'bloque__cabeza' }, el('span', { clase: 'bloque__icono', 'aria-hidden': 'true', texto: t.icono }), titulo, acciones),
      cuerpo,
    );
  }

  async function mover(bloque, paso) {
    const i = estado.bloques.indexOf(bloque);
    const otro = estado.bloques[i + paso];
    if (!otro) return;
    [bloque.orden, otro.orden] = [otro.orden, bloque.orden];
    if (bloque.orden === otro.orden) bloque.orden += paso * 0.5; // por si quedaron iguales
    estado.bloques.sort((a, b) => a.orden - b.orden);
    guardarLuego(bloque, ['orden']);
    guardarLuego(otro, ['orden']);
    pintarBloques();
    partes.bloques.querySelector(`[data-id="${bloque.id}"] [aria-label="${paso < 0 ? 'Subir' : 'Bajar'} el bloque"]:not(:disabled)`)?.focus() ??
      partes.bloques.querySelector(`[data-id="${bloque.id}"] .bloque__titulo`)?.focus();
  }

  async function borrar(bloque) {
    const t = TIPOS[bloque.tipo];
    const si = await confirmar(`¿Borrás «${bloque.titulo || t.nombre}»?`, 'Se borra con todo lo que tiene adentro y no se puede deshacer.', 'Borrar el bloque');
    if (!si) return;
    try {
      const previo = temporizadores.get(bloque.id);
      if (previo) {
        clearTimeout(previo.t);
        temporizadores.delete(bloque.id);
        guardando--;
      }
      await datos.borrarBloque(bloque.id);
      estado.bloques = estado.bloques.filter((b) => b !== bloque);
      pintarBloques();
      avisarGuardado();
      app.avisar('Bloque borrado.', 'ok');
    } catch (e) {
      app.avisar(e.message, 'error');
    }
  }

  // Un renglón «agregar»: campo + botón, con Enter también.
  function filaAgregar({ etiqueta, lugar, alAgregar, clase = '', max = 300 }) {
    const campo = el('input', { type: 'text', maxlength: max, placeholder: lugar, 'aria-label': etiqueta, clase: 'me-agregar__campo' });
    const agregar = () => {
      const v = campo.value.trim();
      if (!v) return campo.focus();
      alAgregar(v);
    };
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        agregar();
      }
    });
    return el('div', { clase: `me-agregar ${clase}` }, campo, el('button', { clase: 'me-agregar__boton', type: 'button', 'aria-label': etiqueta, texto: '+', onclick: agregar }));
  }

  function botonSacar(etiqueta, alSacar) {
    return el('button', { clase: 'me-sacar', type: 'button', 'aria-label': etiqueta, title: 'Sacar', texto: '×', onclick: alSacar });
  }

  // Lista con tildes
  function cuerpoLista(cuerpo, bloque, editable) {
    const c = bloque.contenido;
    const items = c.items.map((item) => {
      const idCampo = `item-${item.id}`;
      if (!editable) {
        return el('li', { clase: `me-item${item.hecho ? ' me-item--hecho' : ''}` }, el('span', { clase: 'me-item__tilde', 'aria-hidden': 'true', texto: item.hecho ? '✓' : '' }), el('span', { texto: item.texto }), item.hecho && el('span', { clase: 'visualmente-oculto', texto: '(hecho)' }));
      }
      return el(
        'li',
        { clase: `me-item${item.hecho ? ' me-item--hecho' : ''}` },
        el('input', {
          type: 'checkbox',
          clase: 'me-item__check',
          checked: item.hecho,
          'aria-label': `Hecho: ${item.texto}`,
          onchange: (e) => {
            item.hecho = e.target.checked;
            e.target.closest('li').classList.toggle('me-item--hecho', item.hecho);
            guardarLuego(bloque);
          },
        }),
        el('input', {
          type: 'text',
          id: idCampo,
          clase: 'me-item__texto',
          maxlength: 300,
          valor: item.texto,
          'aria-label': 'Texto del ítem',
          oninput: (e) => {
            item.texto = e.target.value;
            guardarLuego(bloque);
          },
        }),
        botonSacar(`Sacar «${item.texto}»`, () => {
          c.items = c.items.filter((x) => x !== item);
          guardarLuego(bloque);
          repintarBloque(bloque, '.me-agregar__campo');
        }),
      );
    });
    cuerpo.append(items.length ? el('ul', { clase: 'me-lista' }, ...items) : el('p', { clase: 'me-vacio', texto: 'Nada por acá todavía.' }));
    if (editable) {
      cuerpo.append(
        filaAgregar({
          etiqueta: 'Agregar a la lista',
          lugar: 'Agregar algo…',
          alAgregar: (v) => {
            c.items.push({ id: nuevoId(), texto: v, hecho: false });
            guardarLuego(bloque);
            repintarBloque(bloque, '.me-agregar__campo');
          },
        }),
      );
    }
  }

  // Notas: un texto libre
  function cuerpoNotas(cuerpo, bloque, editable) {
    if (!editable) {
      cuerpo.append(bloque.contenido.texto ? el('p', { clase: 'me-notas me-notas--leer', texto: bloque.contenido.texto }) : el('p', { clase: 'me-vacio', texto: 'Sin notas.' }));
      return;
    }
    const area = el('textarea', {
      clase: 'me-notas',
      rows: 5,
      maxlength: 20000,
      placeholder: 'Escribí lo que quieras…',
      'aria-label': `Notas de «${bloque.titulo}»`,
      oninput: (e) => {
        bloque.contenido.texto = e.target.value;
        crecer(e.target);
        guardarLuego(bloque);
      },
    });
    area.value = bloque.contenido.texto;
    cuerpo.append(area);
    requestAnimationFrame(() => crecer(area));
  }

  function crecer(area) {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight + 2, 640)}px`;
  }

  // Tablero: columnas con tarjetas que se pasan de una a otra
  function cuerpoTablero(cuerpo, bloque, editable) {
    const cols = bloque.contenido.columnas;
    const columnas = cols.map((col, ci) => {
      const tarjetas = col.tarjetas.map((tarjeta) => {
        if (!editable) return el('li', { clase: 'me-tarjeta', texto: tarjeta.texto });
        const pasar = (paso) => {
          const destino = cols[ci + paso];
          if (!destino) return;
          col.tarjetas = col.tarjetas.filter((x) => x !== tarjeta);
          destino.tarjetas.push(tarjeta);
          guardarLuego(bloque);
          repintarBloque(bloque);
          const nuevo = partes.bloques.querySelector(`[data-tarjeta="${tarjeta.id}"] [data-paso="${paso}"]:not(:disabled)`) ?? partes.bloques.querySelector(`[data-tarjeta="${tarjeta.id}"] textarea`);
          nuevo?.focus();
        };
        const area = el('textarea', {
          clase: 'me-tarjeta__texto',
          rows: 2,
          maxlength: 300,
          'aria-label': `Tarjeta en «${col.titulo}»`,
          oninput: (e) => {
            tarjeta.texto = e.target.value;
            guardarLuego(bloque);
          },
        });
        area.value = tarjeta.texto;
        return el(
          'li',
          { clase: 'me-tarjeta', 'data-tarjeta': tarjeta.id },
          area,
          el(
            'div',
            { clase: 'me-tarjeta__botones' },
            el('button', { type: 'button', clase: 'me-mini', 'data-paso': '-1', 'aria-label': `Pasar a «${cols[ci - 1]?.titulo ?? ''}»`, title: 'Pasar a la izquierda', texto: '←', disabled: ci === 0, onclick: () => pasar(-1) }),
            el('button', { type: 'button', clase: 'me-mini', 'data-paso': '1', 'aria-label': `Pasar a «${cols[ci + 1]?.titulo ?? ''}»`, title: 'Pasar a la derecha', texto: '→', disabled: ci === cols.length - 1, onclick: () => pasar(1) }),
            botonSacar('Sacar la tarjeta', () => {
              col.tarjetas = col.tarjetas.filter((x) => x !== tarjeta);
              guardarLuego(bloque);
              repintarBloque(bloque);
            }),
          ),
        );
      });

      const cabeza = editable
        ? el('input', {
            clase: 'me-columna__titulo',
            type: 'text',
            maxlength: 40,
            valor: col.titulo,
            'aria-label': 'Nombre de la columna',
            oninput: (e) => {
              col.titulo = e.target.value;
              guardarLuego(bloque);
            },
          })
        : el('h3', { clase: 'me-columna__titulo', texto: col.titulo });

      return el(
        'section',
        { clase: 'me-columna', 'aria-label': col.titulo || 'Columna' },
        el('div', { clase: 'me-columna__cabeza' }, cabeza, el('span', { clase: 'me-columna__cuenta', texto: String(col.tarjetas.length) })),
        el('ul', { clase: 'me-columna__tarjetas' }, ...tarjetas),
        editable &&
          filaAgregar({
            etiqueta: `Agregar tarjeta en «${col.titulo}»`,
            lugar: 'Nueva tarjeta…',
            alAgregar: (v) => {
              col.tarjetas.push({ id: nuevoId(), texto: v });
              guardarLuego(bloque);
              repintarBloque(bloque);
              partes.bloques.querySelectorAll(`[data-id="${bloque.id}"] .me-columna`)[ci]?.querySelector('.me-agregar__campo')?.focus();
            },
          }),
      );
    });
    cuerpo.append(el('div', { clase: 'me-tablero' }, ...columnas));
  }

  // Links
  function cuerpoLinks(cuerpo, bloque, editable) {
    const c = bloque.contenido;
    const items = c.links.map((l) =>
      el(
        'li',
        { clase: 'me-link' },
        el('span', { clase: 'me-link__icono', 'aria-hidden': 'true', texto: new URL(l.url).hostname.replace(/^www\./, '')[0]?.toUpperCase() ?? '↗' }),
        el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', texto: l.titulo || new URL(l.url).hostname.replace(/^www\./, '') }),
        editable &&
          botonSacar(`Sacar el link «${l.titulo || l.url}»`, () => {
            c.links = c.links.filter((x) => x !== l);
            guardarLuego(bloque);
            repintarBloque(bloque, '.me-link-form input');
          }),
      ),
    );
    cuerpo.append(items.length ? el('ul', { clase: 'me-links' }, ...items) : el('p', { clase: 'me-vacio', texto: 'Todavía no hay links.' }));
    if (!editable) return;

    const idError = `link-error-${bloque.id}`;
    const campoUrl = el('input', { type: 'url', inputmode: 'url', placeholder: 'ejemplo.com', 'aria-label': 'Dirección del link', autocomplete: 'url', maxlength: 2000 });
    const campoNombre = el('input', { type: 'text', placeholder: 'Nombre (opcional)', 'aria-label': 'Nombre del link', maxlength: 100 });
    const error = el('p', { clase: 'campo__error', id: idError, hidden: true });
    const form = el(
      'form',
      { clase: 'me-link-form', novalidate: true },
      campoUrl,
      campoNombre,
      el('button', { clase: 'me-agregar__boton', type: 'submit', 'aria-label': 'Agregar el link', texto: '+' }),
      error,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = linkSeguro(campoUrl.value);
      if (!url) {
        error.textContent = 'Esa dirección no parece un link. Probá con algo como ejemplo.com';
        error.hidden = false;
        campoUrl.setAttribute('aria-invalid', 'true');
        campoUrl.setAttribute('aria-describedby', idError);
        campoUrl.focus();
        return;
      }
      c.links.push({ id: nuevoId(), url, titulo: campoNombre.value.trim().slice(0, 100) });
      guardarLuego(bloque);
      repintarBloque(bloque, '.me-link-form input');
    });
    cuerpo.append(form);
  }

  // Muro de ideas: papelitos de colores
  function cuerpoIdeas(cuerpo, bloque, editable) {
    const c = bloque.contenido;
    const papelitos = c.ideas.map((idea) => {
      if (!editable) return el('li', { clase: `me-idea me-idea--${idea.color}`, texto: idea.texto });
      const area = el('textarea', {
        clase: 'me-idea__texto',
        rows: 4,
        maxlength: 500,
        'aria-label': 'Idea',
        oninput: (e) => {
          idea.texto = e.target.value;
          guardarLuego(bloque);
        },
      });
      area.value = idea.texto;
      return el(
        'li',
        { clase: `me-idea me-idea--${idea.color}` },
        area,
        el(
          'div',
          { clase: 'me-idea__botones' },
          el('button', {
            clase: 'me-mini',
            type: 'button',
            'aria-label': 'Cambiar el color del papelito',
            title: 'Otro color',
            texto: '🎨',
            onclick: (e) => {
              idea.color = (idea.color + 1) % COLORES_IDEA;
              e.currentTarget.closest('li').className = `me-idea me-idea--${idea.color}`;
              guardarLuego(bloque);
            },
          }),
          botonSacar('Sacar la idea', () => {
            c.ideas = c.ideas.filter((x) => x !== idea);
            guardarLuego(bloque);
            repintarBloque(bloque);
          }),
        ),
      );
    });
    cuerpo.append(papelitos.length ? el('ul', { clase: 'me-ideas' }, ...papelitos) : el('p', { clase: 'me-vacio', texto: 'El muro está vacío. ¡Tirá la primera!' }));
    if (editable) {
      cuerpo.append(
        el('button', {
          clase: 'boton boton--suave me-idea-nueva',
          type: 'button',
          texto: '+ Nueva idea',
          onclick: () => {
            c.ideas.push({ id: nuevoId(), texto: '', color: c.ideas.length % COLORES_IDEA });
            guardarLuego(bloque);
            repintarBloque(bloque);
            const todas = partes.bloques.querySelectorAll(`[data-id="${bloque.id}"] .me-idea__texto`);
            todas[todas.length - 1]?.focus();
          },
        }),
      );
    }
  }

  // Dibujo: uno de la galería del equipo
  function cuerpoDibujo(cuerpo, bloque, editable) {
    const id = bloque.contenido.dibujoId;
    const dibujo = estado.dibujos.find((d) => d.id === id);
    if (dibujo && estado.urls[id]) {
      cuerpo.append(
        el(
          'figure',
          { clase: 'me-dibujo' },
          el('img', { src: estado.urls[id], alt: `Dibujo «${dibujo.titulo}» de ${nombreDe(dibujo.dueno)}`, width: 960, height: 640, loading: 'lazy' }),
          el('figcaption', { texto: `«${dibujo.titulo}», de ${nombreDe(dibujo.dueno)}` }),
        ),
      );
    } else {
      cuerpo.append(el('p', { clase: 'me-vacio', texto: id ? 'Ese dibujo ya no está.' : 'Todavía no elegiste un dibujo.' }));
    }
    if (!editable) return;

    const idSelect = `dibujo-elegir-${bloque.id}`;
    const elegir = el(
      'select',
      {
        id: idSelect,
        onchange: async (e) => {
          bloque.contenido.dibujoId = e.target.value || null;
          guardarLuego(bloque);
          const elegido = estado.dibujos.find((d) => d.id === bloque.contenido.dibujoId);
          if (elegido && !estado.urls[elegido.id]) Object.assign(estado.urls, await urlsDeDibujos(app, [elegido]));
          repintarBloque(bloque, 'select');
        },
      },
      el('option', { value: '', texto: estado.dibujos.length ? '— Elegí uno —' : 'No hay dibujos guardados' }),
      ...estado.dibujos.map((d) => el('option', { value: d.id, selected: d.id === id, texto: `${d.titulo} (de ${nombreDe(d.dueno)})` })),
    );
    cuerpo.append(
      el(
        'div',
        { clase: 'me-dibujo__elegir' },
        el('label', { for: idSelect, texto: 'Mostrar' }),
        elegir,
        el('a', { clase: 'boton boton--suave', href: dibujo ? `#/paint/abrir/${dibujo.id}` : '#/paint', texto: dibujo ? 'Abrir en el Paint' : 'Dibujar uno' }),
      ),
    );
  }

  // ── Dejarle una sorpresa a otro ──

  function armarDialogoSorpresa() {
    const titulo = el('h2', { id: 'me-sorpresa-titulo' });
    const opciones = el(
      'div',
      { clase: 'me-elegir-sticker', role: 'radiogroup', 'aria-label': 'Elegí un sticker' },
      ...stickers.map((s, i) =>
        el(
          'label',
          { clase: 'me-elegir-sticker__opcion', title: s.frase },
          el('input', { type: 'radio', name: 'me-sticker', value: s.id, checked: i === 0, clase: 'visualmente-oculto' }),
          el('img', { src: s.url, alt: s.alt, width: 64, height: 64, loading: 'lazy' }),
        ),
      ),
    );
    const misDibujos = el('select', { id: 'me-sorpresa-dibujo' });
    const filaDibujo = el('div', { clase: 'campo' }, el('label', { for: 'me-sorpresa-dibujo', texto: 'O mandale uno de tus dibujos' }), misDibujos);
    const mensaje = el('input', { id: 'me-sorpresa-mensaje', type: 'text', maxlength: MAX_MENSAJE, placeholder: '¡Qué hacés, crack!', autocomplete: 'off' });
    const botonDejar = el('button', { clase: 'boton', type: 'submit', texto: 'Dejar la sorpresa' });
    const linkDibujar = el('a', { clase: 'boton boton--suave', texto: '🎨 Dibujarle algo nuevo' });
    let para = null;

    const form = el(
      'form',
      { clase: 'dialogo__cuerpo', method: 'dialog', novalidate: true },
      titulo,
      el('p', { clase: 'campo__ayuda me-sorpresa-ayuda', texto: 'Le aparece envuelta la próxima vez que entre a su espacio.' }),
      el('fieldset', { clase: 'me-fieldset' }, el('legend', { texto: 'Un sticker' }), opciones),
      filaDibujo,
      el('div', { clase: 'campo' }, el('label', { for: 'me-sorpresa-mensaje', texto: 'Un mensajito (opcional)' }), mensaje),
      el('div', { clase: 'dialogo__botones' }, botonDejar, linkDibujar, el('button', { clase: 'boton boton--suave', type: 'button', texto: 'Cancelar', onclick: () => dialogo.close() })),
    );
    const dialogo = el('dialog', { clase: 'dialogo me-dialogo-sorpresa', 'aria-labelledby': 'me-sorpresa-titulo' }, form);
    linkDibujar.addEventListener('click', () => dialogo.close());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dibujoId = misDibujos.value || null;
      const sticker = form.querySelector('input[name="me-sticker"]:checked')?.value ?? stickers[0].id;
      botonDejar.disabled = true;
      try {
        await datos.dejarSorpresa({ para, tipo: dibujoId ? 'dibujo' : 'sticker', sticker: dibujoId ? null : sticker, dibujoId, mensaje: mensaje.value.trim().slice(0, MAX_MENSAJE) });
        dialogo.close();
        app.avisar(`Listo: ${nombreDe(para)} la va a ver cuando entre a su espacio. 🤫`, 'ok');
      } catch (err) {
        app.avisar(err.message, 'error');
      } finally {
        botonDejar.disabled = false;
      }
    });

    return {
      dialogo,
      abrir(slug) {
        para = slug;
        titulo.textContent = `Una sorpresa para ${nombreDe(slug)}`;
        linkDibujar.href = `#/paint/para/${slug}`;
        const mios = estado.dibujos.filter((d) => d.dueno === app.persona.slug);
        misDibujos.replaceChildren(el('option', { value: '', texto: mios.length ? 'No, mejor el sticker' : 'Todavía no guardaste dibujos' }), ...mios.map((d) => el('option', { value: d.id, texto: d.titulo })));
        filaDibujo.hidden = mios.length === 0;
        mensaje.value = '';
        dialogo.showModal();
      },
    };
  }

  function armarDialogoConfirmar() {
    const pregunta = el('h2', { id: 'me-confirmar-titulo' });
    const detalle = el('p', { clase: 'campo__ayuda' });
    const botonSi = el('button', { clase: 'boton boton--peligro', type: 'submit', value: 'si' });
    const dialogo = el(
      'dialog',
      { clase: 'dialogo', 'aria-labelledby': 'me-confirmar-titulo' },
      el('form', { clase: 'dialogo__cuerpo', method: 'dialog' }, pregunta, detalle, el('div', { clase: 'dialogo__botones me-confirmar__botones' }, botonSi, el('button', { clase: 'boton boton--suave', value: 'no', texto: 'Cancelar', autofocus: true }))),
    );
    return { dialogo, pregunta, detalle, botonSi };
  }

  function confirmar(texto, detalle, si) {
    const d = partes.dialogoConfirmar;
    d.pregunta.textContent = texto;
    d.detalle.textContent = detalle;
    d.botonSi.textContent = si;
    d.dialogo.returnValue = 'no';
    d.dialogo.showModal();
    return new Promise((listo) => d.dialogo.addEventListener('close', () => listo(d.dialogo.returnValue === 'si'), { once: true }));
  }
}
