// Diagrama de Gantt propio (sin librerías) para la pestaña Planificación.
// Se dibuja con createElement + textContent (nunca innerHTML) y pinta cada barra con el color de su responsable.
//
// Uso:
//   import { crearGantt } from '../planificacion/gantt.js';
//   const gantt = crearGantt(zona, {
//     tareas: [{ id, titulo, proyecto, responsable, inicio, fin, avance, estado, depende_de, hito }],
//     personas: app.personas,                      // [{ slug, nombre, id }] para nombres, colores y la leyenda
//     zoom: 'semana',                              // 'semana' (un casillero por día) | 'mes' (más comprimido)
//     alCambiar: (id, { inicio, fin }) => …,       // se movió o estiró una barra (fechas 'AAAA-MM-DD'); si devuelve
//                                                  //   una promesa que falla, la barra vuelve a donde estaba
//     alAbrir: (id) => …,                          // se tocó una barra o el nombre de una tarea
//   });
//   gantt.actualizar(lista); gantt.cambiarZoom('mes'); gantt.irAHoy(); gantt.ponerPersonas(lista); gantt.destruir();
//
// Tareas:
//   inicio / fin: 'AAAA-MM-DD' (o Date); el fin está incluido (del 3 al 5 = 3 días). Sin fechas, la fila sale sin barra.
//   responsable: 'aostri' | 'tomas' | 'hassan' (o el id de la persona). Otro valor o vacío = gris.
//   avance: 0 a 100 (se pinta por dentro de la barra). hito: true = un rombito en su fecha (solo se mueve, no se estira).
//   depende_de: id de otra tarea; se dibuja una flecha desde el fin de esa hasta el inicio de esta (roja si se pisan).
//   Las tareas se agrupan por «proyecto» en el orden en que llegan.
//
// Con el mouse: arrastrar la barra la mueve; los bordes la estiran. Con el dedo: mantener apretada la barra
// un ratito y arrastrar (si no, la pantalla se desliza como siempre); los bordes se agarran directo.
// Con el teclado: ← → mueven un día; Mayús + ← → estiran el final; Enter abre.
import '../estilos/gantt.css';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LETRAS_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const PERSONAS_CONOCIDAS = ['aostri', 'tomas', 'hassan'];
const DIA_MS = 24 * 60 * 60 * 1000;
const PX_POR_DIA = { semana: 40, mes: 12 };
const ALTO_FILA = 48;
const ALTO_GRUPO = 34;
const ESPERA_DEDO_MS = 280; // lo que hay que mantener apretado en el celu para agarrar una barra
const TOLERANCIA_PX = 8; // si el dedo se mueve más que esto antes de agarrar, era para deslizar la pantalla
const ESPERA_TECLADO_MS = 700; // con las flechas, se avisa el cambio cuando dejás de apretar

let contadorGantts = 0;

// ── Fechas (siempre a la medianoche local, sin husos horarios de por medio) ──

function aDia(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : soloDia(valor);
  const coincide = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
  if (!coincide) return null;
  const fecha = new Date(Number(coincide[1]), Number(coincide[2]) - 1, Number(coincide[3]));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
function soloDia(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}
function sumarDias(fecha, dias) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
}
function diasEntre(desde, hasta) {
  return Math.round((hasta - desde) / DIA_MS);
}
function lunesDe(fecha) {
  const dia = soloDia(fecha);
  return sumarDias(dia, -((dia.getDay() + 6) % 7));
}
function aTexto(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}
function fechaCorta(fecha) {
  return `${fecha.getDate()} ${MESES[fecha.getMonth()].slice(0, 3)}`;
}
function fechaLarga(fecha) {
  return fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Ayudantes ─────────────────────────────────────────────────────────

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}
function boton(clase, texto, etiqueta) {
  const nodo = el('button', clase, texto);
  nodo.type = 'button';
  if (etiqueta) nodo.setAttribute('aria-label', etiqueta);
  return nodo;
}
const SVG = 'http://www.w3.org/2000/svg';
function svg(etiqueta, atributos = {}) {
  const nodo = document.createElementNS(SVG, etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor));
  return nodo;
}

// ── El Gantt ──────────────────────────────────────────────────────────

/**
 * Arma el Gantt adentro de «contenedor» y devuelve sus controles.
 * Opciones (todas opcionales): tareas, personas, zoom, editable (true), controles (true: Hoy + Semana/Mes),
 * leyenda (true), etiqueta (nombre para lectores de pantalla), textoVacio, alCambiar, alAbrir.
 */
export function crearGantt(contenedor, opciones = {}) {
  contadorGantts += 1;
  const config = {
    editable: true,
    controles: true,
    leyenda: true,
    etiqueta: 'Diagrama de Gantt',
    textoVacio: 'Todavía no hay tareas para mostrar.',
    ...opciones,
  };
  const idMarca = `gantt-flecha-${contadorGantts}`;
  const idAyuda = `gantt-ayuda-${contadorGantts}`;

  const estado = {
    zoom: config.zoom === 'mes' ? 'mes' : 'semana',
    personas: config.personas ?? [],
    tareas: [],
    desde: lunesDe(new Date()),
    dias: 0,
    arrastre: null,
    tragarClic: false,
    pendiente: null, // tareas que llegaron mientras alguien arrastraba: se dibujan al soltar
    teclado: new Map(), // id → temporizador del aviso de cambio con flechas
    primeraVez: true,
  };

  const raiz = el('div', 'gantt');
  raiz.setAttribute('role', 'region');
  raiz.setAttribute('aria-label', config.etiqueta);

  // Barra: Hoy · rango que se ve · Semana / Mes
  const titulo = el('p', 'gantt__titulo');
  const botonesZoom = {};
  if (config.controles) {
    const barra = el('div', 'gantt__barra');
    const hoy = boton('boton boton--suave boton--chico', 'Hoy');
    hoy.addEventListener('click', () => api.irAHoy());
    const zooms = el('div', 'gantt__zooms');
    zooms.setAttribute('role', 'group');
    zooms.setAttribute('aria-label', 'Ver por');
    for (const [clave, texto] of [['semana', 'Semana'], ['mes', 'Mes']]) {
      const b = boton('gantt__zoom', texto);
      b.addEventListener('click', () => api.cambiarZoom(clave));
      botonesZoom[clave] = b;
      zooms.append(b);
    }
    barra.append(hoy, titulo, zooms);
    raiz.append(barra);
  }

  const marco = el('div', 'gantt__marco');
  const ayuda = el(
    'p',
    'visualmente-oculto',
    'Flechas izquierda y derecha: mover un día. Mayúscula más flechas: cambiar el final. Enter: abrir la tarea.',
  );
  ayuda.id = idAyuda;
  const pie = el('div', 'gantt__leyenda');
  raiz.append(marco, ayuda);
  if (config.leyenda) raiz.append(pie);
  contenedor.append(raiz);

  // Si cambia el día (la compu quedó prendida de noche), la línea de hoy se corre sola.
  let diaDibujado = aTexto(new Date());
  const reloj = setInterval(() => {
    if (aTexto(new Date()) !== diaDibujado && !estado.arrastre) dibujar();
  }, 5 * 60 * 1000);

  // En el celu, mientras se arrastra una barra la pantalla no se tiene que deslizar.
  const frenarDeslizar = (e) => {
    if (estado.arrastre?.activo) e.preventDefault();
  };
  marco.addEventListener('touchmove', frenarDeslizar, { passive: false });

  // ── Datos ──

  function slugDe(responsable) {
    if (PERSONAS_CONOCIDAS.includes(responsable)) return responsable;
    const persona = estado.personas.find((p) => p.id === responsable || p.slug === responsable);
    return PERSONAS_CONOCIDAS.includes(persona?.slug) ? persona.slug : null;
  }
  function nombreDe(responsable) {
    const slug = slugDe(responsable);
    if (!slug) return '';
    return estado.personas.find((p) => p.slug === slug)?.nombre ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  /** Deja las tareas prolijas: fechas de verdad, fin no antes del inicio, avance entre 0 y 100. */
  function normalizar(lista) {
    return (lista ?? []).map((t) => {
      const hito = Boolean(t.hito);
      let inicio = aDia(t.inicio);
      let fin = aDia(t.fin);
      if (inicio && !fin) fin = inicio;
      if (!inicio && fin) inicio = fin;
      if (inicio && fin && fin < inicio) [inicio, fin] = [fin, inicio];
      if (hito && inicio) fin = inicio;
      const avance = Math.min(100, Math.max(0, Math.round(Number(t.avance) || 0)));
      return {
        original: t,
        id: t.id,
        titulo: String(t.titulo ?? '').trim() || 'Sin título',
        proyecto: String(t.proyecto ?? '').trim(),
        responsable: t.responsable ?? null,
        inicio,
        fin,
        avance,
        hito,
        dependeDe: t.depende_de ?? null,
      };
    });
  }

  /** Filas en pantalla: un título por proyecto y abajo sus tareas, en el orden en que llegaron. */
  function armarFilas() {
    const grupos = new Map();
    for (const t of estado.tareas) {
      const lista = grupos.get(t.proyecto) ?? [];
      lista.push(t);
      grupos.set(t.proyecto, lista);
    }
    const hayGrupos = grupos.size > 1 || (grupos.size === 1 && !grupos.has(''));
    const filas = [];
    let y = 0;
    for (const [proyecto, lista] of grupos) {
      if (hayGrupos) {
        filas.push({ tipo: 'grupo', proyecto: proyecto || 'Sin proyecto', cuenta: lista.length, y, alto: ALTO_GRUPO });
        y += ALTO_GRUPO;
      }
      for (const tarea of lista) {
        filas.push({ tipo: 'tarea', tarea, y, alto: ALTO_FILA });
        y += ALTO_FILA;
      }
    }
    return { filas, alto: y };
  }

  /** Desde qué lunes y cuántos días se muestran: todas las tareas, hoy y un margen para arrastrar. */
  function calcularRango() {
    const hoy = soloDia(new Date());
    const conFecha = estado.tareas.filter((t) => t.inicio);
    const margenAntes = estado.zoom === 'semana' ? 14 : 28;
    const margenDespues = estado.zoom === 'semana' ? 42 : 120;
    let primero = sumarDias(hoy, -margenAntes);
    let ultimo = sumarDias(hoy, margenDespues);
    for (const t of conFecha) {
      if (t.inicio < sumarDias(primero, 7)) primero = sumarDias(t.inicio, -7);
      if (t.fin > sumarDias(ultimo, -14)) ultimo = sumarDias(t.fin, 14);
    }
    const desde = lunesDe(primero);
    const px = PX_POR_DIA[estado.zoom];
    const minimoDias = Math.ceil((marco.clientWidth || 0) / px) + 7;
    const dias = Math.max(diasEntre(desde, ultimo) + 1, minimoDias);
    // Se redondea a semanas enteras, así el fondo rayado cierra prolijo.
    return { desde, dias: Math.ceil(dias / 7) * 7 };
  }

  // ── Posiciones ──

  const px = () => PX_POR_DIA[estado.zoom];
  const xDe = (fecha) => diasEntre(estado.desde, fecha) * px();
  function cajaDe(tarea, inicio = tarea.inicio, fin = tarea.fin) {
    if (tarea.hito) {
      const centro = xDe(inicio) + px() / 2;
      return { izq: centro - 9, der: centro + 9 };
    }
    return { izq: xDe(inicio), der: xDe(fin) + px() };
  }

  // ── Dibujo ──

  function describir(t, inicio = t.inicio, fin = t.fin) {
    const partes = [t.hito ? `Hito: ${t.titulo}` : t.titulo];
    const quien = nombreDe(t.responsable);
    if (quien) partes.push(quien);
    if (!inicio) partes.push('sin fechas');
    else if (t.hito || inicio.getTime() === fin.getTime()) partes.push(fechaLarga(inicio));
    else partes.push(`del ${fechaLarga(inicio)} al ${fechaLarga(fin)}`);
    if (!t.hito) partes.push(`${t.avance}% hecho`);
    if (atrasada(t)) partes.push('atrasada');
    return partes.join(' · ');
  }
  function atrasada(t) {
    return Boolean(t.fin) && t.avance < 100 && t.fin < soloDia(new Date());
  }
  function textoFechas(t) {
    if (!t.inicio) return 'Sin fechas';
    if (t.hito || t.inicio.getTime() === t.fin.getTime()) return fechaCorta(t.inicio);
    return `${fechaCorta(t.inicio)} → ${fechaCorta(t.fin)}`;
  }

  function pintarCabeza(cabeza) {
    const hoy = soloDia(new Date());
    const meses = el('div', 'gantt-cabeza__meses');
    const dias = el('div', 'gantt-cabeza__dias');
    // Meses: un cartel donde arranca cada uno (y el primero, aunque arranque antes)
    let cursor = new Date(estado.desde);
    const final = sumarDias(estado.desde, estado.dias);
    while (cursor < final) {
      const siguiente = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const hasta = siguiente < final ? siguiente : final;
      const mes = el('span', 'gantt-cabeza__mes');
      // El texto va adentro para que quede pegado a la izquierda mientras se ve el mes.
      mes.append(el('span', 'gantt-cabeza__mes-texto', `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`));
      mes.style.left = `${xDe(cursor)}px`;
      mes.style.width = `${xDe(hasta) - xDe(cursor)}px`;
      meses.append(mes);
      cursor = siguiente;
    }
    if (estado.zoom === 'semana') {
      for (let i = 0; i < estado.dias; i += 1) {
        const fecha = sumarDias(estado.desde, i);
        const dia = el('span', 'gantt-cabeza__dia');
        if (fecha.getTime() === hoy.getTime()) dia.classList.add('es-hoy');
        if (fecha.getDay() === 0 || fecha.getDay() === 6) dia.classList.add('es-finde');
        dia.style.left = `${i * px()}px`;
        dia.append(el('span', 'gantt-cabeza__letra', LETRAS_DIA[fecha.getDay()]), el('span', 'gantt-cabeza__numero', String(fecha.getDate())));
        dias.append(dia);
      }
    } else {
      for (let i = 0; i < estado.dias; i += 7) {
        const fecha = sumarDias(estado.desde, i);
        const semana = el('span', 'gantt-cabeza__semana');
        semana.append(el('span', 'gantt-cabeza__numero', String(fecha.getDate())));
        if (hoy >= fecha && hoy < sumarDias(fecha, 7)) semana.classList.add('es-hoy');
        semana.title = `Semana del ${fechaLarga(fecha)}`;
        semana.style.left = `${i * px()}px`;
        dias.append(semana);
      }
    }
    meses.setAttribute('aria-hidden', 'true');
    dias.setAttribute('aria-hidden', 'true');
    cabeza.replaceChildren(meses, dias);
  }

  function pintarNombre(fila) {
    if (fila.tipo === 'grupo') {
      const nodo = el('div', 'gantt-nombre gantt-nombre--grupo');
      nodo.append(el('span', 'gantt-nombre__proyecto', fila.proyecto), el('span', 'gantt-nombre__cuenta', String(fila.cuenta)));
      return nodo;
    }
    const t = fila.tarea;
    const tocable = typeof config.alAbrir === 'function';
    const nodo = tocable ? boton('gantt-nombre') : el('div', 'gantt-nombre');
    const slug = slugDe(t.responsable);
    if (slug) nodo.dataset.de = slug;
    const punto = el('span', t.hito ? 'gantt-nombre__rombo' : 'punto');
    punto.setAttribute('aria-hidden', 'true');
    const textos = el('span', 'gantt-nombre__textos');
    textos.append(el('span', 'gantt-nombre__titulo', t.titulo), el('span', 'gantt-nombre__fechas', textoFechas(t)));
    nodo.append(punto, textos);
    nodo.title = describir(t);
    if (tocable) {
      nodo.setAttribute('aria-label', `Abrir ${describir(t)}`);
      nodo.addEventListener('click', () => config.alAbrir(t.id));
    }
    return nodo;
  }

  /** La barra de una tarea (o el rombito de un hito), con sus bordes para estirar. */
  function pintarBarra(fila) {
    const t = fila.tarea;
    const nodo = boton(t.hito ? 'gantt-barra gantt-barra--hito' : 'gantt-barra');
    nodo.dataset.id = String(t.id);
    const slug = slugDe(t.responsable);
    if (slug) nodo.dataset.de = slug;
    if (t.avance >= 100) nodo.classList.add('es-hecha');
    if (atrasada(t)) nodo.classList.add('es-atrasada');
    if (config.editable) nodo.classList.add('es-movible');
    nodo.setAttribute('aria-label', describir(t));
    if (config.editable) nodo.setAttribute('aria-describedby', idAyuda);
    nodo.title = describir(t);

    if (!t.hito) {
      const relleno = el('span', 'gantt-barra__avance');
      relleno.style.width = `${t.avance}%`;
      relleno.setAttribute('aria-hidden', 'true');
      nodo.append(relleno);
      if (config.editable) {
        for (const lado of ['inicio', 'fin']) {
          const tirador = el('span', `gantt-barra__tirador gantt-barra__tirador--${lado}`);
          tirador.dataset.lado = lado;
          tirador.setAttribute('aria-hidden', 'true');
          nodo.append(tirador);
        }
      }
    }
    const rotulo = el('span', 'gantt-barra__rotulo', t.hito ? t.titulo : `${t.avance}%`);
    rotulo.setAttribute('aria-hidden', 'true');
    nodo.append(rotulo);

    ubicarBarra(nodo, t, t.inicio, t.fin, fila.y);
    return nodo;
  }

  function ubicarBarra(nodo, t, inicio, fin, y) {
    const caja = cajaDe(t, inicio, fin);
    nodo.style.left = `${caja.izq}px`;
    nodo.style.width = `${caja.der - caja.izq}px`;
    if (y !== undefined) nodo.style.top = `${y + (ALTO_FILA - (t.hito ? 18 : 22)) / 2}px`;
  }

  /** Flechas de dependencia: del final de la tarea previa al inicio de la que depende de ella. */
  function pintarFlechas(capa, filas) {
    const porId = new Map();
    for (const f of filas) if (f.tipo === 'tarea' && f.tarea.inicio) porId.set(String(f.tarea.id), f);
    const defs = svg('defs');
    for (const [sufijo, clase] of [['', 'gantt-flecha__punta'], ['-mal', 'gantt-flecha__punta gantt-flecha__punta--mal']]) {
      const marca = svg('marker', { id: idMarca + sufijo, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' });
      marca.append(svg('path', { d: 'M0,0 L8,4 L0,8 z', class: clase }));
      defs.append(marca);
    }
    const trazos = [defs];
    for (const f of porId.values()) {
      const t = f.tarea;
      if (t.dependeDe === null || t.dependeDe === undefined) continue;
      const previa = porId.get(String(t.dependeDe));
      if (!previa || previa === f) continue;
      const desde = cajaDe(previa.tarea);
      const hasta = cajaDe(t);
      const x1 = desde.der;
      const y1 = previa.y + ALTO_FILA / 2;
      const x2 = hasta.izq;
      const y2 = f.y + ALTO_FILA / 2;
      const mal = t.inicio <= previa.tarea.fin && !(t.hito && t.inicio.getTime() === previa.tarea.fin.getTime());
      let d;
      if (x2 - x1 >= 16) {
        // Hay lugar: sale a la derecha, baja (o sube) y entra derecho.
        const codo = x1 + 8;
        d = `M${x1},${y1} H${codo} V${y2} H${x2 - 1}`;
      } else {
        // Se pisan: sale, da la vuelta por el medio entre las dos filas y entra desde la izquierda.
        const medio = y1 + (y2 > y1 ? ALTO_FILA / 2 : -ALTO_FILA / 2);
        d = `M${x1},${y1} H${x1 + 8} V${medio} H${x2 - 10} V${y2} H${x2 - 1}`;
      }
      trazos.push(svg('path', { d, class: mal ? 'gantt-flecha gantt-flecha--mal' : 'gantt-flecha', 'marker-end': `url(#${idMarca}${mal ? '-mal' : ''})` }));
    }
    capa.replaceChildren(...trazos);
  }

  function pintarLeyenda() {
    if (!config.leyenda) return;
    const items = estado.personas
      .filter((p) => PERSONAS_CONOCIDAS.includes(p.slug))
      .map((p) => {
        const item = el('span', 'gantt-leyenda__item');
        item.dataset.de = p.slug;
        item.append(el('span', 'gantt-leyenda__muestra'), document.createTextNode(p.nombre));
        return item;
      });
    const hito = el('span', 'gantt-leyenda__item');
    hito.append(el('span', 'gantt-leyenda__muestra gantt-leyenda__muestra--hito'), document.createTextNode('Hito'));
    const hoy = el('span', 'gantt-leyenda__item');
    hoy.append(el('span', 'gantt-leyenda__muestra gantt-leyenda__muestra--hoy'), document.createTextNode('Hoy'));
    const nodos = [...items, hito, hoy];
    if (config.editable) {
      nodos.push(el('span', 'gantt-leyenda__pista gantt-leyenda__pista--mouse', 'Arrastrá una barra para moverla y sus bordes para estirarla.'));
      nodos.push(el('span', 'gantt-leyenda__pista gantt-leyenda__pista--dedo', 'Mantené apretada una barra y arrastrala para moverla.'));
    }
    pie.replaceChildren(...nodos);
  }

  function pintarTitulo() {
    if (!config.controles) return;
    const ultimo = sumarDias(estado.desde, estado.dias - 1);
    titulo.textContent = `${fechaCorta(estado.desde)} ${estado.desde.getFullYear() !== ultimo.getFullYear() ? estado.desde.getFullYear() : ''} al ${fechaCorta(ultimo)} ${ultimo.getFullYear()}`.replace(/\s+/g, ' ');
    for (const [clave, b] of Object.entries(botonesZoom)) b.setAttribute('aria-pressed', String(clave === estado.zoom));
  }

  let filasActuales = [];
  let capaFlechas = null;
  let cuerpoActual = null;

  function dibujar({ centrarEn } = {}) {
    // Se acuerda qué fecha estaba a la izquierda, para no saltar al redibujar.
    const anchoNombres = marco.querySelector('.gantt__nombres')?.offsetWidth ?? 0;
    const fechaIzquierda = estado.primeraVez ? null : sumarDias(estado.desde, Math.floor(marco.scrollLeft / px()));
    const scrollArriba = marco.scrollTop;

    Object.assign(estado, calcularRango());
    diaDibujado = aTexto(new Date());
    raiz.dataset.zoom = estado.zoom;
    pintarTitulo();
    pintarLeyenda();

    if (!estado.tareas.length) {
      marco.classList.add('es-vacio');
      marco.replaceChildren(el('p', 'gantt__vacio', config.textoVacio));
      filasActuales = [];
      cuerpoActual = null;
      return;
    }
    marco.classList.remove('es-vacio');

    const { filas, alto } = armarFilas();
    filasActuales = filas;
    const ancho = estado.dias * px();

    const lienzo = el('div', 'gantt__lienzo');
    lienzo.style.setProperty('--gantt-dia', `${px()}px`);
    lienzo.style.setProperty('--gantt-ancho-tiempo', `${ancho}px`);
    lienzo.style.setProperty('--gantt-alto-fila', `${ALTO_FILA}px`);
    lienzo.style.setProperty('--gantt-alto-grupo', `${ALTO_GRUPO}px`);

    const esquina = el('div', 'gantt__esquina', 'Tareas');
    const cabeza = el('div', 'gantt__cabeza');
    pintarCabeza(cabeza);

    const nombres = el('div', 'gantt__nombres');
    const cuerpo = el('div', 'gantt__cuerpo');
    cuerpo.style.height = `${alto}px`;

    // Fondo: las filas de proyecto y el comienzo de cada mes
    const fondo = el('div', 'gantt__fondo');
    fondo.setAttribute('aria-hidden', 'true');
    for (const f of filas) {
      if (f.tipo !== 'grupo') continue;
      const franja = el('div', 'gantt__franja-grupo');
      franja.style.top = `${f.y}px`;
      fondo.append(franja);
    }
    let cursor = new Date(estado.desde.getFullYear(), estado.desde.getMonth() + 1, 1);
    while (diasEntre(estado.desde, cursor) < estado.dias) {
      const linea = el('div', 'gantt__linea-mes');
      linea.style.left = `${xDe(cursor)}px`;
      fondo.append(linea);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    capaFlechas = svg('svg', { class: 'gantt__flechas', width: ancho, height: alto, 'aria-hidden': 'true', focusable: 'false' });
    const barras = el('div', 'gantt__barras');

    for (const f of filas) {
      nombres.append(pintarNombre(f));
      if (f.tipo === 'tarea' && f.tarea.inicio) barras.append(pintarBarra(f));
    }

    // Línea de hoy
    const hoy = soloDia(new Date());
    const diaHoy = diasEntre(estado.desde, hoy);
    const lineaHoy = el('div', 'gantt__hoy');
    lineaHoy.setAttribute('aria-hidden', 'true');
    lineaHoy.style.left = `${diaHoy * px() + px() / 2}px`;
    lineaHoy.hidden = diaHoy < 0 || diaHoy >= estado.dias;

    cuerpo.append(fondo, capaFlechas, lineaHoy, barras);
    cuerpoActual = cuerpo;
    pintarFlechas(capaFlechas, filas);
    prepararArrastre(barras);

    lienzo.append(esquina, cabeza, nombres, cuerpo);
    marco.replaceChildren(lienzo);
    marco.scrollTop = scrollArriba;

    // Dónde queda el scroll: hoy un poco a la izquierda la primera vez; si no, la misma fecha que antes.
    const anchoVisible = marco.clientWidth - (nombres.offsetWidth || anchoNombres);
    if (centrarEn) {
      marco.scrollLeft = Math.max(0, xDe(centrarEn) - anchoVisible / 2);
    } else if (fechaIzquierda) {
      marco.scrollLeft = Math.max(0, xDe(fechaIzquierda));
    } else {
      marco.scrollLeft = Math.max(0, diaHoy * px() - Math.min(anchoVisible * 0.25, 7 * px()));
    }
    estado.primeraVez = false;
  }

  // ── Mover y estirar ──

  function filaDe(id) {
    return filasActuales.find((f) => f.tipo === 'tarea' && String(f.tarea.id) === String(id));
  }

  /** Nuevas fechas según cuántos días se corrió y qué parte se agarró (sin dar vuelta la barra). */
  function fechasMovidas(t, modo, dias) {
    if (modo === 'inicio') {
      const inicio = sumarDias(t.inicio, dias);
      return { inicio: inicio > t.fin ? t.fin : inicio, fin: t.fin };
    }
    if (modo === 'fin') {
      const fin = sumarDias(t.fin, dias);
      return { inicio: t.inicio, fin: fin < t.inicio ? t.inicio : fin };
    }
    return { inicio: sumarDias(t.inicio, dias), fin: sumarDias(t.fin, dias) };
  }

  /** Guarda las fechas nuevas en la tarea, redibuja las flechas y le avisa a la pantalla. */
  function confirmar(t, inicio, fin, previas) {
    if (inicio.getTime() === previas.inicio.getTime() && fin.getTime() === previas.fin.getTime()) return;
    t.inicio = inicio;
    t.fin = fin;
    if (typeof config.alCambiar !== 'function') return;
    let resultado;
    try {
      resultado = config.alCambiar(t.id, { inicio: aTexto(inicio), fin: aTexto(fin) });
    } catch {
      resultado = Promise.reject();
    }
    // Si no se pudo guardar, la barra vuelve a donde estaba.
    if (resultado && typeof resultado.then === 'function') {
      resultado.then(null, () => {
        t.inicio = previas.inicio;
        t.fin = previas.fin;
        if (!estado.arrastre) dibujar();
      });
    }
  }

  function prepararArrastre(barras) {
    barras.addEventListener('click', (e) => {
      const nodo = e.target.closest('.gantt-barra');
      if (!nodo) return;
      if (estado.tragarClic) return;
      if (typeof config.alAbrir === 'function') config.alAbrir(filaDe(nodo.dataset.id)?.tarea.id ?? nodo.dataset.id);
    });

    // Que el «mantener apretado» del celu no abra el menú de copiar.
    barras.addEventListener('contextmenu', (e) => {
      if (config.editable && e.target.closest('.gantt-barra')) e.preventDefault();
    });

    if (!config.editable) return;

    barras.addEventListener('keydown', (e) => {
      const nodo = e.target.closest('.gantt-barra');
      if (!nodo || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const fila = filaDe(nodo.dataset.id);
      if (!fila) return;
      e.preventDefault();
      const t = fila.tarea;
      const paso = e.key === 'ArrowLeft' ? -1 : 1;
      const modo = e.shiftKey && !t.hito ? 'fin' : 'mover';
      const clave = String(t.id);
      const espera = estado.teclado.get(clave) ?? { previas: { inicio: t.inicio, fin: t.fin } };
      clearTimeout(espera.temporizador);
      const nuevas = fechasMovidas(t, modo, paso);
      t.inicio = nuevas.inicio;
      t.fin = nuevas.fin;
      ubicarBarra(nodo, t, t.inicio, t.fin);
      nodo.setAttribute('aria-label', describir(t));
      nodo.title = describir(t);
      pintarFlechas(capaFlechas, filasActuales);
      espera.temporizador = setTimeout(() => {
        estado.teclado.delete(clave);
        const { inicio, fin } = t;
        t.inicio = espera.previas.inicio;
        t.fin = espera.previas.fin;
        confirmar(t, inicio, fin, espera.previas);
        actualizarNombre(t);
      }, ESPERA_TECLADO_MS);
      estado.teclado.set(clave, espera);
    });

    barras.addEventListener('pointerdown', (e) => {
      const nodo = e.target.closest('.gantt-barra');
      if (!nodo || estado.arrastre) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const fila = filaDe(nodo.dataset.id);
      if (!fila) return;
      const lado = e.target.closest('.gantt-barra__tirador')?.dataset.lado;
      const t = fila.tarea;
      const a = {
        nodo,
        t,
        modo: lado ?? 'mover',
        idPuntero: e.pointerId,
        tipo: e.pointerType,
        x0: e.clientX,
        y0: e.clientY,
        scroll0: marco.scrollLeft,
        previas: { inicio: t.inicio, fin: t.fin },
        nuevas: { inicio: t.inicio, fin: t.fin },
        activo: false,
        temporizador: null,
      };
      estado.arrastre = a;
      if (e.pointerType === 'mouse' || lado) {
        // Con el mouse arranca al moverse; los bordes, también con el dedo, se agarran de una.
        if (lado) activar(a);
      } else {
        a.temporizador = setTimeout(() => activar(a), ESPERA_DEDO_MS);
      }
    });

    barras.addEventListener('pointermove', (e) => {
      const a = estado.arrastre;
      if (!a || e.pointerId !== a.idPuntero) return;
      const dx = e.clientX - a.x0;
      const dy = e.clientY - a.y0;
      if (!a.activo) {
        if (a.tipo === 'mouse') {
          if (Math.abs(dx) > 3) activar(a);
          else return;
        } else {
          // El dedo se movió antes de tiempo: era para deslizar la pantalla.
          if (Math.hypot(dx, dy) > TOLERANCIA_PX) cancelar(false);
          return;
        }
      }
      a.ultimoX = e.clientX;
      moverA(a, e.clientX);
      autoDeslizar(a, e.clientX);
    });

    barras.addEventListener('pointerup', (e) => {
      const a = estado.arrastre;
      if (!a || e.pointerId !== a.idPuntero) return;
      soltar(a);
    });
    barras.addEventListener('pointercancel', (e) => {
      const a = estado.arrastre;
      if (!a || e.pointerId !== a.idPuntero) return;
      cancelar(true);
    });
    barras.addEventListener('lostpointercapture', (e) => {
      const a = estado.arrastre;
      if (a?.activo && e.pointerId === a.idPuntero) soltar(a);
    });
  }

  function activar(a) {
    if (estado.arrastre !== a || a.activo) return;
    a.activo = true;
    try {
      a.nodo.setPointerCapture(a.idPuntero);
    } catch {
      // El dedo ya se levantó: no hay nada que agarrar.
      cancelar(false);
      return;
    }
    a.nodo.classList.add('es-arrastrada');
    raiz.classList.add('es-arrastrando');
    if (a.tipo !== 'mouse') navigator.vibrate?.(12);
    mostrarGlobo(a);
  }

  function moverA(a, clientX) {
    const dias = Math.round((clientX - a.x0 + (marco.scrollLeft - a.scroll0)) / px());
    const nuevas = fechasMovidas({ ...a.t, inicio: a.previas.inicio, fin: a.previas.fin }, a.modo, dias);
    if (nuevas.inicio.getTime() === a.nuevas.inicio.getTime() && nuevas.fin.getTime() === a.nuevas.fin.getTime()) return;
    a.nuevas = nuevas;
    ubicarBarra(a.nodo, a.t, nuevas.inicio, nuevas.fin);
    // Las flechas siguen a la barra mientras se arrastra.
    a.t.inicio = nuevas.inicio;
    a.t.fin = nuevas.fin;
    pintarFlechas(capaFlechas, filasActuales);
    a.t.inicio = a.previas.inicio;
    a.t.fin = a.previas.fin;
    mostrarGlobo(a);
  }

  /** Si arrastrás cerca del borde, la línea de tiempo se corre sola. */
  function autoDeslizar(a, clientX) {
    cancelAnimationFrame(a.cuadro);
    const caja = marco.getBoundingClientRect();
    const izquierda = caja.left + (marco.querySelector('.gantt__nombres')?.offsetWidth ?? 0);
    const borde = 40;
    let velocidad = 0;
    if (clientX > caja.right - borde) velocidad = Math.min(8, (clientX - (caja.right - borde)) / 4);
    else if (clientX < izquierda + borde) velocidad = -Math.min(8, (izquierda + borde - clientX) / 4);
    if (!velocidad) return;
    const paso = () => {
      if (estado.arrastre !== a || !a.activo) return;
      marco.scrollLeft += velocidad;
      moverA(a, a.ultimoX ?? clientX);
      a.cuadro = requestAnimationFrame(paso);
    };
    a.cuadro = requestAnimationFrame(paso);
  }

  let globo = null;
  function mostrarGlobo(a) {
    if (!cuerpoActual) return;
    if (!globo) globo = el('div', 'gantt__globo');
    const { inicio, fin } = a.nuevas;
    globo.textContent = a.t.hito || inicio.getTime() === fin.getTime() ? fechaCorta(inicio) : `${fechaCorta(inicio)} → ${fechaCorta(fin)} · ${diasEntre(inicio, fin) + 1} días`;
    const caja = cajaDe(a.t, inicio, fin);
    globo.style.left = `${(caja.izq + caja.der) / 2}px`;
    globo.style.top = `${parseFloat(a.nodo.style.top)}px`;
    if (globo.parentNode !== cuerpoActual) cuerpoActual.append(globo);
  }

  function terminar(a) {
    clearTimeout(a.temporizador);
    cancelAnimationFrame(a.cuadro);
    a.nodo.classList.remove('es-arrastrada');
    raiz.classList.remove('es-arrastrando');
    globo?.remove();
    estado.arrastre = null;
  }

  function soltar(a) {
    const estabaActivo = a.activo;
    terminar(a);
    if (!estabaActivo) return; // fue un toque: lo atiende el «click»
    // El «click» que viene atrás no tiene que abrir la tarea.
    estado.tragarClic = true;
    setTimeout(() => {
      estado.tragarClic = false;
    }, 0);
    confirmar(a.t, a.nuevas.inicio, a.nuevas.fin, a.previas);
    redibujarSiHaceFalta();
  }

  function cancelar(volver) {
    const a = estado.arrastre;
    if (!a) return;
    const estabaActivo = a.activo;
    terminar(a);
    if (estabaActivo && volver) {
      ubicarBarra(a.nodo, a.t, a.previas.inicio, a.previas.fin);
      pintarFlechas(capaFlechas, filasActuales);
    }
    redibujarSiHaceFalta(estabaActivo);
  }

  function redibujarSiHaceFalta(siempre = true) {
    if (estado.pendiente) {
      estado.tareas = estado.pendiente;
      estado.pendiente = null;
      dibujar();
    } else if (siempre) {
      dibujar();
    }
  }

  function actualizarNombre(t) {
    const fila = filaDe(t.id);
    if (!fila) return;
    const viejo = [...marco.querySelectorAll('.gantt-nombre')].find((n, i) => filasActuales[i] === fila);
    viejo?.replaceWith(pintarNombre(fila));
    pintarFlechas(capaFlechas, filasActuales);
  }

  // ── Controles ──

  const api = {
    /** Cambia la lista de tareas y redibuja sin mover lo que se está viendo. */
    actualizar(lista) {
      const nuevas = normalizar(lista);
      if (estado.arrastre?.activo) {
        estado.pendiente = nuevas;
        return;
      }
      if (estado.arrastre) cancelar(false);
      for (const espera of estado.teclado.values()) clearTimeout(espera.temporizador);
      estado.teclado.clear();
      estado.tareas = nuevas;
      dibujar();
    },
    /** Cambia los nombres y colores de la leyenda ([{ slug, nombre, id }]). */
    ponerPersonas(lista) {
      estado.personas = lista ?? [];
      if (!estado.arrastre) dibujar();
    },
    cambiarZoom(zoom) {
      if ((zoom !== 'semana' && zoom !== 'mes') || zoom === estado.zoom) return;
      const centro = sumarDias(estado.desde, Math.floor((marco.scrollLeft + marco.clientWidth / 2) / px()));
      estado.zoom = zoom;
      dibujar({ centrarEn: centro });
    },
    /** Corre la línea de tiempo para que se vea hoy. */
    irAHoy() {
      dibujar({ centrarEn: soloDia(new Date()) });
    },
    zoom: () => estado.zoom,
    destruir() {
      clearInterval(reloj);
      if (estado.arrastre) terminar(estado.arrastre);
      for (const espera of estado.teclado.values()) clearTimeout(espera.temporizador);
      marco.removeEventListener('touchmove', frenarDeslizar);
      raiz.remove();
    },
  };

  estado.tareas = normalizar(config.tareas);
  dibujar();
  return api;
}

export { aDia, aTexto, sumarDias, diasEntre };
