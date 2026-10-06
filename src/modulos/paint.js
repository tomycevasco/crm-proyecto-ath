// Paint retro estilo Windows 95: se dibuja, se guarda en la galería del equipo y se puede mandar de sorpresa.
// Pantalla #/paint (sin ítem en el menú: se abre desde Mi espacio). #/paint/abrir/ID abre un dibujo,
// #/paint/para/SLUG dibuja una sorpresa para otro (al guardar, Mi espacio la manda).
//
// También exporta los dibujos para Mi espacio: listarDibujos, urlsDeDibujos, alCambiarDibujos.
// Los dibujos viven en Supabase (tabla «dibujos» + caja privada «dibujos» de Storage) o,
// en modo prueba, en esta compu (localStorage).
import '../estilos/paint.css';
import { herramientas, acciones, paletaClasica, stickers } from '../../recursos/index.js';

const ANCHO = 960;
const ALTO = 640;
const GROSORES = [2, 5, 10, 18];
const LETRAS = [16, 24, 36, 56];
const MAX_DESHACER = 20;
const MAX_BYTES = 5 * 1024 * 1024;
const CLAVE_PRUEBA = 'ath-prueba-dibujos';

// ── Los dibujos (datos) ───────────────────────────────────────────────

function leerPrueba() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PRUEBA) ?? '[]');
  } catch {
    return [];
  }
}

function escribirPrueba(lista) {
  try {
    localStorage.setItem(CLAVE_PRUEBA, JSON.stringify(lista));
  } catch {
    throw new Error('No entra más en esta compu (modo prueba). Borrá algún dibujo viejo.');
  }
  window.dispatchEvent(new Event('ath-dibujos'));
}

/** Los dibujos del equipo, del más nuevo al más viejo: [{ id, dueno, titulo, ruta, actualizado }] */
export async function listarDibujos(app) {
  if (!app.conectado) {
    return leerPrueba()
      .map(({ dato, ...resto }) => resto)
      .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
  }
  const { data, error } = await app.supabase
    .from('dibujos')
    .select('id, dueno, titulo, ruta, actualizado')
    .order('actualizado', { ascending: false })
    .limit(200);
  if (error) throw new Error('No pude traer los dibujos.');
  return data;
}

/** Direcciones para mostrar los dibujos en <img>: { id: url } (en Supabase duran una hora). */
export async function urlsDeDibujos(app, lista) {
  if (!lista.length) return {};
  if (!app.conectado) {
    const todos = leerPrueba();
    return Object.fromEntries(lista.map((d) => [d.id, todos.find((t) => t.id === d.id)?.dato ?? '']));
  }
  const { data, error } = await app.supabase.storage.from('dibujos').createSignedUrls(
    lista.map((d) => d.ruta),
    3600,
  );
  if (error) return {};
  const porRuta = Object.fromEntries((data ?? []).map((d) => [d.path, d.signedUrl]));
  // Con la fecha en la dirección, el navegador no muestra una versión vieja guardada.
  return Object.fromEntries(lista.map((d) => [d.id, porRuta[d.ruta] ? `${porRuta[d.ruta]}&v=${Date.parse(d.actualizado)}` : '']));
}

/** Avisa cuando alguien guarda o borra un dibujo. Devuelve cómo dejar de escuchar. */
export function alCambiarDibujos(app, fn) {
  if (!app.conectado) {
    const manejador = (e) => (e.type === 'ath-dibujos' || e.key === CLAVE_PRUEBA) && fn();
    window.addEventListener('ath-dibujos', manejador);
    window.addEventListener('storage', manejador);
    return () => {
      window.removeEventListener('ath-dibujos', manejador);
      window.removeEventListener('storage', manejador);
    };
  }
  const canal = app.supabase
    .channel(`dibujos-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dibujos' }, () => fn())
    .subscribe();
  return () => app.supabase.removeChannel(canal);
}

// La imagen de un dibujo como algo que se puede poner en el lienzo sin «ensuciarlo»
// (una dirección de otro sitio no deja guardar el lienzo después).
async function imagenDeDibujo(app, dibujo) {
  let fuente;
  let liberar = () => {};
  if (!app.conectado) {
    fuente = leerPrueba().find((d) => d.id === dibujo.id)?.dato;
    if (!fuente) throw new Error('Ese dibujo ya no está.');
  } else {
    const { data, error } = await app.supabase.storage.from('dibujos').download(dibujo.ruta);
    if (error) throw new Error('No pude abrir ese dibujo.');
    fuente = URL.createObjectURL(data);
    liberar = () => URL.revokeObjectURL(fuente);
  }
  try {
    return await cargarImagen(fuente);
  } finally {
    liberar();
  }
}

function cargarImagen(src) {
  return new Promise((listo, fallo) => {
    const img = new Image();
    img.onload = () => listo(img);
    img.onerror = () => fallo(new Error('No pude cargar la imagen.'));
    img.src = src;
  });
}

async function guardarEnLaBase(app, lienzo, { titulo, encima }) {
  const ahora = new Date().toISOString();
  if (!app.conectado) {
    const dato = lienzo.toDataURL('image/png');
    const lista = leerPrueba();
    if (encima) {
      const i = lista.findIndex((d) => d.id === encima.id);
      if (i >= 0) {
        lista[i] = { ...lista[i], titulo, dato, actualizado: ahora };
        escribirPrueba(lista);
        return { ...lista[i], dato: undefined };
      }
    }
    const nuevo = { id: crypto.randomUUID(), dueno: app.persona.slug, titulo, ruta: '', actualizado: ahora, dato };
    escribirPrueba([nuevo, ...lista]);
    return { ...nuevo, dato: undefined };
  }

  const blob = await new Promise((listo) => lienzo.toBlob(listo, 'image/png'));
  if (!blob) throw new Error('No pude armar la imagen.');
  if (blob.size > MAX_BYTES) throw new Error('El dibujo es muy pesado para guardar (más de 5 MB).');

  const ruta = encima?.ruta ?? `${app.persona.slug}/${crypto.randomUUID()}.png`;
  const { error: errorSubida } = await app.supabase.storage
    .from('dibujos')
    .upload(ruta, blob, { contentType: 'image/png', upsert: Boolean(encima) });
  if (errorSubida) {
    console.error(errorSubida);
    throw new Error(/policy|security/i.test(errorSubida.message)
      ? 'No hay más lugar para dibujos, o no tenés permiso.'
      : 'No se pudo subir el dibujo. Fijate la conexión.');
  }

  if (encima) {
    const { data, error } = await app.supabase
      .from('dibujos')
      .update({ titulo, actualizado: ahora })
      .eq('id', encima.id)
      .select('id, dueno, titulo, ruta, actualizado')
      .single();
    if (error) throw new Error('Se subió, pero no pude anotar el cambio.');
    return data;
  }
  const { data, error } = await app.supabase
    .from('dibujos')
    .insert({ dueno: app.persona.slug, titulo, ruta })
    .select('id, dueno, titulo, ruta, actualizado')
    .single();
  if (error) {
    await app.supabase.storage.from('dibujos').remove([ruta]); // que no quede una imagen suelta
    throw new Error('No se pudo guardar el dibujo.');
  }
  return data;
}

async function borrarDibujo(app, dibujo) {
  if (!app.conectado) {
    escribirPrueba(leerPrueba().filter((d) => d.id !== dibujo.id));
    return;
  }
  const { error } = await app.supabase.from('dibujos').delete().eq('id', dibujo.id);
  if (error) throw new Error('No se pudo borrar.');
  await app.supabase.storage.from('dibujos').remove([dibujo.ruta]);
}

// ── Ayudantes de pantalla ─────────────────────────────────────────────

function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  nodo.append(...hijos.filter((h) => h !== null && h !== undefined && h !== false));
  return nodo;
}

function hexARgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbAHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ── La pantalla ───────────────────────────────────────────────────────

export function iniciar(app) {
  const estado = {
    herramienta: 'lapiz',
    anterior: 'lapiz', // para volver después del cuentagotas
    primario: '#000000',
    secundario: '#ffffff',
    grosor: 1, // índice en GROSORES
    zoom: 1,
    sticker: stickers[0],
    actual: null, // el dibujo abierto { id, dueno, titulo, ruta }
    para: null, // slug de a quién se le dibuja una sorpresa
    sinGuardar: false,
    deshacer: [],
    rehacer: [],
    seleccion: null, // { x, y, w, h, imagen, dx, dy, levantada }
    armado: false,
  };

  let partes = null;

  app.registrarPantalla({
    ruta: 'paint',
    titulo: 'Paint',
    icono: '🎨',
    orden: 35,
    enMenu: false,
    mostrar({ zona, params }) {
      if (!estado.armado) {
        partes = armar(zona);
        estado.armado = true;
        lienzoEnBlanco(false);
      }
      ajustarTamano();
      leerParametros(params);
    },
  });

  // Si alguien pide abrir un dibujo o dibujarle a otro desde la dirección.
  async function leerParametros([accion, valor]) {
    if (accion === 'para' && valor && valor !== app.persona.slug && app.buscarPersona(valor)) {
      if (estado.para !== valor) {
        if (!(await confirmarSiHaceFalta('¿Empezás un dibujo nuevo para la sorpresa?'))) return;
        lienzoEnBlanco(false);
        estado.para = valor;
        estado.actual = null;
      }
    } else if (accion === 'abrir' && valor && estado.actual?.id !== valor) {
      try {
        const lista = await listarDibujos(app);
        const dibujo = lista.find((d) => d.id === valor);
        if (dibujo) await abrir(dibujo);
        else app.avisar('Ese dibujo ya no está.', 'error');
      } catch (e) {
        app.avisar(e.message, 'error');
      }
    }
    pintarTitulo();
  }

  function armar(zona) {
    zona.classList.add('paint-pantalla');

    // Barra de título
    const titulo = el('span', { clase: 'paint__titulo-texto', id: 'paint-titulo' });
    const volver = el('a', { clase: 'paint__volver', href: '#/miespacio', texto: 'Volver a Mi espacio' });
    const barraTitulo = el(
      'div',
      { clase: 'paint__barra-titulo' },
      el('img', { src: herramientas.find((h) => h.id === 'pincel').icono, alt: '', width: 16, height: 16 }),
      el('h1', { clase: 'paint__h1' }, titulo),
      volver,
    );

    // Acciones (nuevo, abrir, guardar, deshacer, rehacer, borrar todo)
    const botonesAccion = {};
    const barraAcciones = el(
      'div',
      { clase: 'paint__acciones', role: 'toolbar', 'aria-label': 'Acciones del dibujo' },
      ...acciones.map((a) => {
        const b = el(
          'button',
          { clase: 'paint__accion', type: 'button', title: a.nombre, onclick: () => hacerAccion(a.id) },
          el('img', { src: a.icono, alt: '', width: 16, height: 16 }),
          el('span', { texto: a.nombre }),
        );
        botonesAccion[a.id] = b;
        return b;
      }),
    );

    // Herramientas
    const botonesHerramienta = {};
    const listaHerramientas = el(
      'div',
      { clase: 'paint__herramientas', role: 'toolbar', 'aria-label': 'Herramientas' },
      ...herramientas.map((h) => {
        const b = el(
          'button',
          {
            clase: 'paint__herramienta',
            type: 'button',
            title: `${h.nombre} (${h.atajo === 'R' ? 'Mayús+R' : h.atajo.toUpperCase()})`,
            'aria-label': h.nombre,
            'aria-pressed': 'false',
            onclick: () => elegirHerramienta(h.id),
          },
          el('img', { src: h.icono, alt: '', width: 16, height: 16 }),
        );
        botonesHerramienta[h.id] = b;
        return b;
      }),
    );

    // Grosor
    const botonesGrosor = GROSORES.map((g, i) =>
      el(
        'button',
        {
          clase: 'paint__grosor',
          type: 'button',
          'aria-label': `Grosor ${i + 1} de ${GROSORES.length}`,
          'aria-pressed': 'false',
          onclick: () => elegirGrosor(i),
        },
        el('span', { style: `height:${Math.max(1, Math.round(g / 2))}px` }),
      ),
    );
    const opciones = el('div', { clase: 'paint__opciones', role: 'group', 'aria-label': 'Grosor' }, ...botonesGrosor);

    // Lienzo: «lienzo» guarda el dibujo; «capa» muestra lo provisorio (formas, selección) y recibe el puntero.
    const lienzo = el('canvas', { clase: 'paint__lienzo', width: ANCHO, height: ALTO });
    const capa = el('canvas', {
      clase: 'paint__capa',
      width: ANCHO,
      height: ALTO,
      role: 'img',
      'aria-label': 'Lienzo para dibujar. Se dibuja con el mouse, el dedo o el lápiz.',
    });
    const campoTexto = el('input', {
      clase: 'paint__campo-texto',
      type: 'text',
      maxlength: 120,
      'aria-label': 'Texto para poner en el dibujo (Enter para ponerlo)',
      hidden: true,
    });
    const marco = el('div', { clase: 'paint__marco' }, lienzo, capa, campoTexto);
    const area = el('div', { clase: 'paint__area' }, marco);

    // Colores
    const muestraPrimario = el('span', { clase: 'paint__color-primario' });
    const muestraSecundario = el('span', { clase: 'paint__color-secundario' });
    const actuales = el(
      'button',
      {
        clase: 'paint__actuales',
        type: 'button',
        title: 'Cambiar el color de adelante con el de atrás',
        'aria-label': 'Cambiar el color principal con el de atrás',
        onclick: () => {
          [estado.primario, estado.secundario] = [estado.secundario, estado.primario];
          pintarColores();
        },
      },
      muestraSecundario,
      muestraPrimario,
    );
    const elegirOtro = el('input', {
      clase: 'paint__otro-color',
      type: 'color',
      value: '#000000',
      title: 'Otro color',
      'aria-label': 'Elegir otro color',
      oninput: (e) => {
        estado.primario = e.target.value;
        pintarColores();
      },
    });
    const paleta = el(
      'div',
      { clase: 'paint__paleta', role: 'group', 'aria-label': 'Colores (clic: principal · clic derecho: de atrás)' },
      ...paletaClasica.map((c) =>
        el('button', {
          clase: 'paint__muestra',
          type: 'button',
          style: `background:${c}`,
          title: c,
          'aria-label': `Color ${c}`,
          onclick: () => {
            estado.primario = c;
            pintarColores();
          },
          oncontextmenu: (e) => {
            e.preventDefault();
            estado.secundario = c;
            pintarColores();
          },
        }),
      ),
    );
    const colores = el('div', { clase: 'paint__colores' }, actuales, paleta, elegirOtro);

    // Stickers (aparece con la herramienta de sticker)
    const botonesSticker = {};
    const tiraStickers = el(
      'div',
      { clase: 'paint__stickers', role: 'group', 'aria-label': 'Elegí el sticker para pegar', hidden: true },
      ...stickers.map((s) => {
        const b = el(
          'button',
          {
            clase: 'paint__sticker',
            type: 'button',
            'aria-pressed': 'false',
            title: s.frase,
            onclick: () => {
              estado.sticker = s;
              pintarStickers();
            },
          },
          el('img', { src: s.url, alt: s.alt, width: 40, height: 40, loading: 'lazy' }),
        );
        botonesSticker[s.id] = b;
        return b;
      }),
    );

    const estadoBarra = el('p', { clase: 'paint__estado', 'aria-live': 'polite' });
    const posicion = el('span', { clase: 'paint__posicion' });
    const barraEstado = el('div', { clase: 'paint__barra-estado' }, estadoBarra, posicion);

    const ventana = el(
      'div',
      { clase: 'paint' },
      barraTitulo,
      barraAcciones,
      el('div', { clase: 'paint__cuerpo' }, el('div', { clase: 'paint__caja' }, listaHerramientas, opciones), area),
      tiraStickers,
      colores,
      barraEstado,
    );

    const dialogoGuardar = armarDialogoGuardar();
    const dialogoAbrir = armarDialogoAbrir();
    const dialogoConfirmar = armarDialogoConfirmar();

    zona.replaceChildren(ventana, dialogoGuardar.dialogo, dialogoAbrir.dialogo, dialogoConfirmar.dialogo);

    prepararPuntero(capa);
    prepararTeclado(zona);
    prepararCampoTexto(campoTexto);
    new ResizeObserver(() => ajustarTamano()).observe(area);

    const p = {
      zona, titulo, lienzo, capa, ctx: lienzo.getContext('2d', { willReadFrequently: true }),
      ctxCapa: capa.getContext('2d'), marco, area, campoTexto, botonesAccion, botonesHerramienta,
      botonesGrosor, botonesSticker, tiraStickers, muestraPrimario, muestraSecundario, elegirOtro,
      estadoBarra, posicion, dialogoGuardar, dialogoAbrir, dialogoConfirmar,
    };
    partes = p;
    elegirHerramienta('lapiz');
    elegirGrosor(1);
    pintarColores();
    pintarStickers();
    return p;
  }

  // ── Estado en pantalla ──

  function pintarTitulo() {
    if (!partes) return;
    const nombre = estado.actual?.titulo ?? 'sin título';
    const para = estado.para ? ` · sorpresa para ${app.buscarPersona(estado.para)?.nombre ?? estado.para}` : '';
    partes.titulo.textContent = `${estado.sinGuardar ? '* ' : ''}${nombre}${para} - Paint`;
    partes.botonesAccion.deshacer.disabled = estado.deshacer.length === 0;
    partes.botonesAccion.rehacer.disabled = estado.rehacer.length === 0;
  }

  function pintarColores() {
    partes.muestraPrimario.style.background = estado.primario;
    partes.muestraSecundario.style.background = estado.secundario;
    partes.elegirOtro.value = estado.primario;
  }

  function pintarStickers() {
    for (const [id, b] of Object.entries(partes.botonesSticker)) b.setAttribute('aria-pressed', String(id === estado.sticker.id));
  }

  function avisarEstado(texto) {
    partes.estadoBarra.textContent = texto;
  }

  function elegirHerramienta(id) {
    if (estado.herramienta !== 'cuentagotas') estado.anterior = estado.herramienta;
    if (id !== 'seleccion') soltarSeleccion();
    terminarTexto(true);
    estado.herramienta = id;
    for (const [hid, b] of Object.entries(partes.botonesHerramienta)) b.setAttribute('aria-pressed', String(hid === id));
    partes.tiraStickers.hidden = id !== 'sticker';
    partes.capa.dataset.herramienta = id;
    const h = herramientas.find((x) => x.id === id);
    const ayudas = {
      lupa: 'Lupa: clic para acercar, clic derecho (o Mayús+clic) para alejar.',
      seleccion: 'Seleccionar: marcá un rectángulo y arrastralo para moverlo. Supr para borrarlo.',
      cuentagotas: 'Tomar un color: tocá el dibujo.',
      texto: 'Texto: tocá dónde va, escribí y apretá Enter.',
      sticker: 'Elegí un sticker abajo y tocá dónde pegarlo.',
    };
    avisarEstado(ayudas[id] ?? h.nombre);
  }

  function elegirGrosor(i) {
    estado.grosor = i;
    partes.botonesGrosor.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
  }

  // El lienzo ocupa el ancho que haya (hasta su tamaño real) y la lupa lo agranda.
  function ajustarTamano() {
    if (!partes) return;
    // Que entre entero a lo ancho y a lo alto (el alto máximo del área sale del CSS).
    const disponible = Math.max(200, partes.area.clientWidth - 16);
    const altoMaximo = parseFloat(getComputedStyle(partes.area).maxHeight) || window.innerHeight;
    const porAlto = Math.max(200, ((altoMaximo - 16) * ANCHO) / ALTO);
    const base = Math.min(ANCHO, disponible, porAlto);
    const ancho = Math.round(base * estado.zoom);
    partes.marco.style.width = `${ancho}px`;
    partes.marco.style.height = `${Math.round((ancho * ALTO) / ANCHO)}px`;
  }

  // ── Deshacer ──

  function guardarParaDeshacer() {
    estado.deshacer.push(partes.ctx.getImageData(0, 0, ANCHO, ALTO));
    if (estado.deshacer.length > MAX_DESHACER) estado.deshacer.shift();
    estado.rehacer = [];
    estado.sinGuardar = true;
    pintarTitulo();
  }

  function deshacer() {
    soltarSeleccion();
    if (!estado.deshacer.length) return;
    estado.rehacer.push(partes.ctx.getImageData(0, 0, ANCHO, ALTO));
    partes.ctx.putImageData(estado.deshacer.pop(), 0, 0);
    estado.sinGuardar = true;
    pintarTitulo();
  }

  function rehacer() {
    soltarSeleccion();
    if (!estado.rehacer.length) return;
    estado.deshacer.push(partes.ctx.getImageData(0, 0, ANCHO, ALTO));
    partes.ctx.putImageData(estado.rehacer.pop(), 0, 0);
    estado.sinGuardar = true;
    pintarTitulo();
  }

  function lienzoEnBlanco(guardarAntes = true) {
    soltarSeleccion();
    if (guardarAntes) guardarParaDeshacer();
    else {
      estado.deshacer = [];
      estado.rehacer = [];
      estado.sinGuardar = false;
    }
    partes.ctx.fillStyle = '#ffffff';
    partes.ctx.fillRect(0, 0, ANCHO, ALTO);
    pintarTitulo();
  }

  // ── Acciones ──

  async function hacerAccion(id) {
    terminarTexto(true);
    if (id === 'deshacer') return deshacer();
    if (id === 'rehacer') return rehacer();
    if (id === 'papelera') {
      if (await confirmar('¿Borrás todo el dibujo?', 'Se puede deshacer con «Deshacer».', 'Borrar todo')) lienzoEnBlanco(true);
      return;
    }
    if (id === 'nuevo') {
      if (!(await confirmarSiHaceFalta('¿Empezás un dibujo nuevo?'))) return;
      estado.actual = null;
      estado.para = null;
      lienzoEnBlanco(false);
      if (location.hash !== '#/paint') history.replaceState(null, '', '#/paint');
      avisarEstado('Dibujo nuevo.');
      return;
    }
    if (id === 'guardar') return abrirGuardar();
    if (id === 'abrir') return partes.dialogoAbrir.abrir();
  }

  async function confirmarSiHaceFalta(pregunta) {
    if (!estado.sinGuardar) return true;
    return confirmar(pregunta, 'Lo que dibujaste y no guardaste se pierde.', 'Sí, empezar de nuevo');
  }

  async function abrir(dibujo) {
    if (!(await confirmarSiHaceFalta('¿Abrís otro dibujo?'))) return;
    const img = await imagenDeDibujo(app, dibujo);
    soltarSeleccion();
    partes.ctx.fillStyle = '#ffffff';
    partes.ctx.fillRect(0, 0, ANCHO, ALTO);
    partes.ctx.drawImage(img, 0, 0, ANCHO, ALTO);
    estado.deshacer = [];
    estado.rehacer = [];
    estado.sinGuardar = false;
    estado.para = null;
    // Si es de otro, se puede retocar pero se guarda como uno nuevo tuyo.
    estado.actual = dibujo.dueno === app.persona.slug ? dibujo : { ...dibujo, id: null, ruta: null, titulo: `${dibujo.titulo} (retocado)` };
    pintarTitulo();
    avisarEstado(`Abriste «${dibujo.titulo}».`);
  }

  async function guardar({ titulo, comoNuevo }) {
    soltarSeleccion();
    terminarTexto(true);
    const encima = !comoNuevo && estado.actual?.id ? estado.actual : null;
    const dibujo = await guardarEnLaBase(app, partes.lienzo, { titulo, encima });
    estado.actual = dibujo;
    estado.sinGuardar = false;
    const para = estado.para;
    estado.para = null;
    pintarTitulo();
    if (para) {
      // Mi espacio escucha esto y deja la sorpresa en el espacio del otro.
      app.emitir('dibujo-guardado', { dibujo, para });
    } else {
      app.avisar(`Guardado: «${dibujo.titulo}».`, 'ok');
    }
    history.replaceState(null, '', `#/paint/abrir/${dibujo.id}`);
  }

  // ── Ventanitas ──

  function armarDialogoGuardar() {
    const campo = el('input', { id: 'paint-nombre', type: 'text', maxlength: 60, required: true, autocomplete: 'off' });
    const error = el('p', { clase: 'campo__error', id: 'paint-nombre-error', hidden: true });
    const nota = el('p', { clase: 'campo__ayuda' });
    const botonNuevo = el('button', { clase: 'boton boton--suave', type: 'button', texto: 'Guardar como uno nuevo' });
    const botonGuardar = el('button', { clase: 'boton', type: 'submit', texto: 'Guardar' });
    const form = el(
      'form',
      { clase: 'dialogo__cuerpo', method: 'dialog', novalidate: true },
      el('h2', { id: 'paint-guardar-titulo', texto: 'Guardar el dibujo' }),
      el('div', { clase: 'campo' }, el('label', { for: 'paint-nombre', texto: 'Nombre del dibujo' }), campo, error, nota),
      el(
        'div',
        { clase: 'dialogo__botones' },
        botonGuardar,
        botonNuevo,
        el('button', { clase: 'boton boton--suave', type: 'button', texto: 'Cancelar', onclick: () => dialogo.close() }),
      ),
    );
    const dialogo = el('dialog', { clase: 'dialogo', 'aria-labelledby': 'paint-guardar-titulo' }, form);

    async function enviar(comoNuevo) {
      const titulo = campo.value.trim().replace(/\s+/g, ' ');
      if (!titulo) {
        error.textContent = 'Ponele un nombre.';
        error.hidden = false;
        campo.setAttribute('aria-invalid', 'true');
        campo.setAttribute('aria-describedby', 'paint-nombre-error');
        campo.focus();
        return;
      }
      botonGuardar.disabled = botonNuevo.disabled = true;
      botonGuardar.textContent = 'Guardando…';
      try {
        await guardar({ titulo: titulo.slice(0, 60), comoNuevo });
        dialogo.close();
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
      } finally {
        botonGuardar.disabled = botonNuevo.disabled = false;
        botonGuardar.textContent = 'Guardar';
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      enviar(false);
    });
    botonNuevo.addEventListener('click', () => enviar(true));

    return {
      dialogo,
      abrir() {
        const propio = Boolean(estado.actual?.id);
        campo.value = estado.actual?.titulo ?? '';
        error.hidden = true;
        campo.removeAttribute('aria-invalid');
        botonNuevo.hidden = !propio;
        const para = estado.para && app.buscarPersona(estado.para);
        nota.textContent = para
          ? `Al guardar, le aparece de sorpresa a ${para.nombre} en su espacio.`
          : propio
            ? '«Guardar» pisa la versión anterior.'
            : 'Queda en la galería del equipo: lo ven los tres.';
        dialogo.showModal();
        campo.select();
      },
    };
  }

  function abrirGuardar() {
    partes.dialogoGuardar.abrir();
  }

  function armarDialogoAbrir() {
    const lista = el('ul', { clase: 'paint-galeria' });
    const vacio = el('p', { clase: 'paint-galeria__vacio', texto: 'Todavía no hay dibujos guardados.', hidden: true });
    const dialogo = el(
      'dialog',
      { clase: 'dialogo paint-dialogo-abrir', 'aria-labelledby': 'paint-abrir-titulo' },
      el(
        'div',
        { clase: 'dialogo__cuerpo' },
        el(
          'div',
          { clase: 'paint-dialogo-abrir__cabeza' },
          el('h2', { id: 'paint-abrir-titulo', texto: 'Los dibujos del equipo' }),
          el('button', { clase: 'boton boton--suave', type: 'button', texto: 'Cerrar', onclick: () => dialogo.close() }),
        ),
        vacio,
        lista,
      ),
    );

    async function llenar() {
      lista.replaceChildren(el('li', { clase: 'paint-galeria__vacio', texto: 'Cargando…' }));
      try {
        const dibujos = await listarDibujos(app);
        const urls = await urlsDeDibujos(app, dibujos);
        vacio.hidden = dibujos.length > 0;
        lista.replaceChildren(
          ...dibujos.map((d) => {
            const persona = app.buscarPersona(d.dueno);
            const mio = d.dueno === app.persona.slug;
            return el(
              'li',
              { clase: 'paint-galeria__item', 'data-dueno': d.dueno },
              el(
                'button',
                {
                  clase: 'paint-galeria__abrir',
                  type: 'button',
                  onclick: async () => {
                    dialogo.close();
                    try {
                      await abrir(d);
                      history.replaceState(null, '', `#/paint/abrir/${d.id}`);
                    } catch (e) {
                      app.avisar(e.message, 'error');
                    }
                  },
                },
                el('img', { src: urls[d.id] || '', alt: '', width: 192, height: 128, loading: 'lazy' }),
                el('span', { clase: 'paint-galeria__nombre', texto: d.titulo }),
                el('span', { clase: 'paint-galeria__de', texto: `de ${persona?.nombre ?? d.dueno}` }),
              ),
              mio &&
                el('button', {
                  clase: 'paint-galeria__borrar',
                  type: 'button',
                  'aria-label': `Borrar «${d.titulo}»`,
                  title: 'Borrar',
                  texto: '×',
                  onclick: async () => {
                    if (!(await confirmar(`¿Borrás «${d.titulo}»?`, 'Se borra para los tres y no se puede deshacer.', 'Borrar'))) return;
                    try {
                      await borrarDibujo(app, d);
                      if (estado.actual?.id === d.id) estado.actual = null;
                      pintarTitulo();
                      app.avisar('Dibujo borrado.', 'ok');
                      llenar();
                    } catch (e) {
                      app.avisar(e.message, 'error');
                    }
                  },
                }),
            );
          }),
        );
      } catch (e) {
        lista.replaceChildren(el('li', { clase: 'paint-galeria__vacio', texto: e.message }));
      }
    }

    return {
      dialogo,
      abrir() {
        dialogo.showModal();
        llenar();
      },
    };
  }

  // Una pregunta de sí o no, con nuestros botones (no la ventanita fea del navegador).
  function armarDialogoConfirmar() {
    const pregunta = el('h2', { id: 'paint-confirmar-titulo' });
    const detalle = el('p', { clase: 'campo__ayuda' });
    const botonSi = el('button', { clase: 'boton boton--peligro', type: 'submit', value: 'si' });
    const dialogo = el(
      'dialog',
      { clase: 'dialogo', 'aria-labelledby': 'paint-confirmar-titulo' },
      el(
        'form',
        { clase: 'dialogo__cuerpo', method: 'dialog' },
        pregunta,
        detalle,
        el('div', { clase: 'dialogo__botones paint-confirmar__botones' }, botonSi, el('button', { clase: 'boton boton--suave', value: 'no', texto: 'Cancelar', autofocus: true })),
      ),
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

  // ── Dibujar ──

  function punto(e) {
    const r = partes.capa.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(ANCHO - 1, Math.round(((e.clientX - r.left) * ANCHO) / r.width))),
      y: Math.max(0, Math.min(ALTO - 1, Math.round(((e.clientY - r.top) * ALTO) / r.height))),
    };
  }

  function prepararPuntero(capa) {
    let trazo = null; // lo que se está haciendo con el puntero apretado
    let spray = null;

    capa.addEventListener('contextmenu', (e) => e.preventDefault());

    capa.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      terminarTexto(true);
      const p = punto(e);
      const color = e.button === 2 ? estado.secundario : estado.primario;
      const fondo = e.button === 2 ? estado.primario : estado.secundario;
      const h = estado.herramienta;
      const ctx = partes.ctx;

      if (h === 'lupa') {
        const alejar = e.button === 2 || e.shiftKey;
        estado.zoom = alejar ? Math.max(1, estado.zoom / 2) : Math.min(4, estado.zoom * 2);
        ajustarTamano();
        avisarEstado(`Lupa: ${estado.zoom * 100} %`);
        return;
      }
      if (h === 'cuentagotas') {
        const [r, g, b] = ctx.getImageData(p.x, p.y, 1, 1).data;
        if (e.button === 2) estado.secundario = rgbAHex(r, g, b);
        else estado.primario = rgbAHex(r, g, b);
        pintarColores();
        elegirHerramienta(estado.anterior);
        return;
      }
      if (h === 'balde') {
        guardarParaDeshacer();
        rellenar(p.x, p.y, color);
        return;
      }
      if (h === 'texto') {
        empezarTexto(p, color);
        return;
      }
      if (h === 'sticker') {
        pegarSticker(p);
        return;
      }
      if (h === 'seleccion') {
        const s = estado.seleccion;
        if (s && p.x >= s.x + s.dx && p.x < s.x + s.dx + s.w && p.y >= s.y + s.dy && p.y < s.y + s.dy + s.h) {
          trazo = { tipo: 'mover', desde: p, dx: s.dx, dy: s.dy };
        } else {
          soltarSeleccion();
          trazo = { tipo: 'marcar', desde: p };
        }
        capa.setPointerCapture(e.pointerId);
        return;
      }

      guardarParaDeshacer();
      capa.setPointerCapture(e.pointerId);
      trazo = { tipo: h, desde: p, ultimo: p, color, fondo };

      if (h === 'lapiz' || h === 'pincel' || h === 'goma') {
        linea(ctx, p, p, h === 'goma' ? fondo : color, grosorDe(h));
      } else if (h === 'spray') {
        trazo.ahora = p;
        rociar(p, color);
        spray = setInterval(() => rociar(trazo.ahora, color), 30);
      }
    });

    capa.addEventListener('pointermove', (e) => {
      const p = punto(e);
      partes.posicion.textContent = `${p.x}, ${p.y} px`;
      if (!trazo) return;
      const ctx = partes.ctx;
      const capaCtx = partes.ctxCapa;
      const h = trazo.tipo;

      if (h === 'lapiz' || h === 'pincel' || h === 'goma') {
        // Con mouse rápido llegan varios puntos juntos: los usamos todos para que la línea sea suave.
        const puntos = e.getCoalescedEvents?.().map(punto) ?? [p];
        for (const q of puntos.length ? puntos : [p]) {
          linea(ctx, trazo.ultimo, q, h === 'goma' ? trazo.fondo : trazo.color, grosorDe(h));
          trazo.ultimo = q;
        }
      } else if (h === 'spray') {
        trazo.ahora = p;
      } else if (h === 'linea' || h === 'rectangulo' || h === 'rectangulo-relleno' || h === 'elipse') {
        capaCtx.clearRect(0, 0, ANCHO, ALTO);
        forma(capaCtx, h, trazo.desde, ajustarConMayus(trazo.desde, p, e.shiftKey, h), trazo.color, trazo.fondo);
      } else if (h === 'marcar') {
        dibujarMarco(trazo.desde, p);
      } else if (h === 'mover') {
        const s = estado.seleccion;
        if (!s.levantada) levantarSeleccion();
        s.dx = trazo.dx + (p.x - trazo.desde.x);
        s.dy = trazo.dy + (p.y - trazo.desde.y);
        pintarSeleccion();
      }
    });

    const terminar = (e) => {
      if (!trazo) return;
      clearInterval(spray);
      spray = null;
      const p = punto(e);
      const h = trazo.tipo;
      if (h === 'linea' || h === 'rectangulo' || h === 'rectangulo-relleno' || h === 'elipse') {
        partes.ctxCapa.clearRect(0, 0, ANCHO, ALTO);
        forma(partes.ctx, h, trazo.desde, ajustarConMayus(trazo.desde, p, e.shiftKey, h), trazo.color, trazo.fondo);
      } else if (h === 'marcar') {
        const x = Math.min(trazo.desde.x, p.x);
        const y = Math.min(trazo.desde.y, p.y);
        const w = Math.abs(p.x - trazo.desde.x);
        const hh = Math.abs(p.y - trazo.desde.y);
        partes.ctxCapa.clearRect(0, 0, ANCHO, ALTO);
        if (w > 2 && hh > 2) {
          estado.seleccion = { x, y, w, h: hh, dx: 0, dy: 0, levantada: false, imagen: null };
          pintarSeleccion();
        }
      }
      trazo = null;
    };
    capa.addEventListener('pointerup', terminar);
    capa.addEventListener('pointercancel', terminar);
    capa.addEventListener('pointerleave', () => (partes.posicion.textContent = ''));
  }

  function grosorDe(h) {
    if (h === 'lapiz') return 2;
    if (h === 'goma') return GROSORES[estado.grosor] * 2 + 4;
    return GROSORES[estado.grosor];
  }

  function linea(ctx, a, b, color, grosor) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = grosor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + (a.x === b.x && a.y === b.y ? 0.01 : 0), b.y);
    ctx.stroke();
  }

  function rociar(p, color) {
    const ctx = partes.ctx;
    const radio = GROSORES[estado.grosor] * 2 + 6;
    ctx.fillStyle = color;
    for (let i = 0; i < 18; i++) {
      const angulo = Math.random() * Math.PI * 2;
      const distancia = Math.sqrt(Math.random()) * radio;
      ctx.fillRect(Math.round(p.x + Math.cos(angulo) * distancia), Math.round(p.y + Math.sin(angulo) * distancia), 1.5, 1.5);
    }
  }

  // Con Mayús: línea recta a 45°, cuadrado o círculo perfecto.
  function ajustarConMayus(a, b, mayus, h) {
    if (!mayus) return b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (h === 'linea') {
      const angulo = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const largo = Math.hypot(dx, dy);
      return { x: Math.round(a.x + Math.cos(angulo) * largo), y: Math.round(a.y + Math.sin(angulo) * largo) };
    }
    const lado = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * lado, y: a.y + Math.sign(dy || 1) * lado };
  }

  function forma(ctx, h, a, b, color, fondo) {
    const grosor = GROSORES[estado.grosor];
    ctx.lineWidth = grosor;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const hh = Math.abs(b.y - a.y);
    ctx.beginPath();
    if (h === 'linea') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (h === 'rectangulo') {
      ctx.strokeRect(x, y, w, hh);
    } else if (h === 'rectangulo-relleno') {
      // Como el Paint viejo: relleno con el color de atrás y borde con el principal.
      ctx.fillStyle = fondo;
      ctx.fillRect(x, y, w, hh);
      ctx.strokeRect(x, y, w, hh);
    } else if (h === 'elipse') {
      ctx.ellipse(x + w / 2, y + hh / 2, Math.max(1, w / 2), Math.max(1, hh / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Balde: rellena la zona del mismo color (con un poco de tolerancia por los bordes suavizados).
  function rellenar(x0, y0, hex) {
    const ctx = partes.ctx;
    const imagen = ctx.getImageData(0, 0, ANCHO, ALTO);
    const d = imagen.data;
    const i0 = (y0 * ANCHO + x0) * 4;
    const objetivo = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const [r, g, b] = hexARgb(hex);
    if (objetivo[0] === r && objetivo[1] === g && objetivo[2] === b && objetivo[3] === 255) return;
    const TOLERANCIA = 48;
    const parecido = (i) =>
      Math.abs(d[i] - objetivo[0]) + Math.abs(d[i + 1] - objetivo[1]) + Math.abs(d[i + 2] - objetivo[2]) + Math.abs(d[i + 3] - objetivo[3]) <= TOLERANCIA;
    const visto = new Uint8Array(ANCHO * ALTO);
    const pila = [x0, y0];
    while (pila.length) {
      const y = pila.pop();
      let x = pila.pop();
      // Ir a la izquierda hasta el borde y pintar la fila hacia la derecha.
      while (x > 0 && !visto[y * ANCHO + x - 1] && parecido((y * ANCHO + x - 1) * 4)) x--;
      let arriba = false;
      let abajo = false;
      for (; x < ANCHO; x++) {
        const n = y * ANCHO + x;
        if (visto[n] || !parecido(n * 4)) break;
        visto[n] = 1;
        const i = n * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
        if (y > 0) {
          const ok = !visto[n - ANCHO] && parecido((n - ANCHO) * 4);
          if (ok && !arriba) pila.push(x, y - 1);
          arriba = ok;
        }
        if (y < ALTO - 1) {
          const ok = !visto[n + ANCHO] && parecido((n + ANCHO) * 4);
          if (ok && !abajo) pila.push(x, y + 1);
          abajo = ok;
        }
      }
    }
    ctx.putImageData(imagen, 0, 0);
  }

  async function pegarSticker(p) {
    const s = estado.sticker;
    try {
      const img = await cargarImagen(s.url);
      const lado = 80 + estado.grosor * 50;
      guardarParaDeshacer();
      partes.ctx.drawImage(img, p.x - lado / 2, p.y - lado / 2, lado, lado);
      avisarEstado(`Pegaste «${s.alt}». ${s.frase}`);
    } catch {
      app.avisar('No pude cargar el sticker.', 'error');
    }
  }

  // ── Selección ──

  function dibujarMarco(a, b) {
    const c = partes.ctxCapa;
    c.clearRect(0, 0, ANCHO, ALTO);
    c.save();
    c.setLineDash([5, 4]);
    c.lineWidth = 1;
    c.strokeStyle = '#000';
    c.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    c.restore();
  }

  function levantarSeleccion() {
    const s = estado.seleccion;
    guardarParaDeshacer();
    s.imagen = partes.ctx.getImageData(s.x, s.y, s.w, s.h);
    partes.ctx.fillStyle = estado.secundario;
    partes.ctx.fillRect(s.x, s.y, s.w, s.h);
    s.levantada = true;
  }

  function pintarSeleccion() {
    const s = estado.seleccion;
    const c = partes.ctxCapa;
    c.clearRect(0, 0, ANCHO, ALTO);
    if (!s) return;
    if (s.levantada) c.putImageData(s.imagen, s.x + s.dx, s.y + s.dy);
    dibujarMarco({ x: s.x + s.dx, y: s.y + s.dy }, { x: s.x + s.dx + s.w, y: s.y + s.dy + s.h });
  }

  // Deja la selección donde está, pegada al dibujo.
  function soltarSeleccion() {
    const s = estado.seleccion;
    if (!s || !partes) return;
    if (s.levantada) {
      // putImageData pisa con transparencia: lo pasamos por un lienzo aparte para que se pegue bien.
      const aparte = document.createElement('canvas');
      aparte.width = s.w;
      aparte.height = s.h;
      aparte.getContext('2d').putImageData(s.imagen, 0, 0);
      partes.ctx.drawImage(aparte, s.x + s.dx, s.y + s.dy);
    }
    estado.seleccion = null;
    partes.ctxCapa.clearRect(0, 0, ANCHO, ALTO);
  }

  function borrarSeleccion() {
    const s = estado.seleccion;
    if (!s) return;
    if (!s.levantada) levantarSeleccion();
    estado.seleccion = null;
    partes.ctxCapa.clearRect(0, 0, ANCHO, ALTO);
  }

  // ── Texto ──

  let textoEnCurso = null;

  function empezarTexto(p, color) {
    const campo = partes.campoTexto;
    const escala = partes.capa.getBoundingClientRect().width / ANCHO;
    const tamano = LETRAS[estado.grosor];
    textoEnCurso = { p, color, tamano };
    campo.value = '';
    campo.hidden = false;
    campo.style.left = `${p.x * escala}px`;
    campo.style.top = `${p.y * escala}px`;
    campo.style.fontSize = `${Math.max(12, tamano * escala)}px`;
    campo.style.color = color;
    campo.focus();
  }

  function terminarTexto(poner) {
    if (!textoEnCurso || !partes) return;
    const { p, color, tamano } = textoEnCurso;
    const texto = partes.campoTexto.value.trim();
    textoEnCurso = null;
    partes.campoTexto.hidden = true;
    if (!poner || !texto) return;
    guardarParaDeshacer();
    const ctx = partes.ctx;
    ctx.fillStyle = color;
    ctx.font = `${tamano}px "Comic Sans MS", "Comic Neue", "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(texto, p.x, p.y);
  }

  function prepararCampoTexto(campo) {
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        terminarTexto(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        terminarTexto(false);
      }
      e.stopPropagation();
    });
    campo.addEventListener('blur', () => terminarTexto(true));
  }

  // ── Teclado ──

  function prepararTeclado(zona) {
    document.addEventListener('keydown', (e) => {
      if (zona.hidden || document.querySelector('dialog[open]')) return;
      const escribiendo = e.target.closest?.('input, textarea, select, [contenteditable]');
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !escribiendo) {
        e.preventDefault();
        if (e.shiftKey) rehacer();
        else deshacer();
      } else if (ctrl && e.key.toLowerCase() === 'y' && !escribiendo) {
        e.preventDefault();
        rehacer();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        abrirGuardar();
      } else if (!ctrl && !e.altKey && !escribiendo) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && estado.seleccion) {
          e.preventDefault();
          borrarSeleccion();
          return;
        }
        if (e.key === 'Escape' && estado.seleccion) {
          soltarSeleccion();
          return;
        }
        const h = herramientas.find((x) => x.atajo === e.key);
        if (h) {
          e.preventDefault();
          elegirHerramienta(h.id);
        }
      }
    });
  }
}
