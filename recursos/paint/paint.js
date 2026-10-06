// Recursos del Paint retro: herramientas con su ícono (16×16) y la paleta clásica de 28 colores.
// Los íconos son pixel art: mostralos a 16, 32 o 48 px (múltiplos de 16) con
// `image-rendering: pixelated` para que no se vean borrosos.

const icono = (nombre) => new URL(`./iconos/${nombre}.svg`, import.meta.url).href;

// Herramientas para dibujar (la barra de la izquierda). `atajo` = tecla sugerida.
export const herramientas = [
  { id: 'seleccion', nombre: 'Seleccionar', atajo: 's', icono: icono('seleccion') },
  { id: 'goma', nombre: 'Goma', atajo: 'e', icono: icono('goma') },
  { id: 'balde', nombre: 'Rellenar con color', atajo: 'f', icono: icono('balde') },
  { id: 'cuentagotas', nombre: 'Tomar un color', atajo: 'i', icono: icono('cuentagotas') },
  { id: 'lupa', nombre: 'Lupa', atajo: 'z', icono: icono('lupa') },
  { id: 'lapiz', nombre: 'Lápiz', atajo: 'p', icono: icono('lapiz') },
  { id: 'pincel', nombre: 'Pincel', atajo: 'b', icono: icono('pincel') },
  { id: 'spray', nombre: 'Aerosol', atajo: 'a', icono: icono('spray') },
  { id: 'texto', nombre: 'Texto', atajo: 't', icono: icono('texto') },
  { id: 'linea', nombre: 'Línea', atajo: 'l', icono: icono('linea') },
  { id: 'rectangulo', nombre: 'Rectángulo', atajo: 'r', icono: icono('rectangulo') },
  { id: 'rectangulo-relleno', nombre: 'Rectángulo lleno', atajo: 'R', icono: icono('rectangulo-relleno') },
  { id: 'elipse', nombre: 'Círculo', atajo: 'o', icono: icono('elipse') },
  { id: 'sticker', nombre: 'Pegar un sticker', atajo: 'k', icono: icono('sticker') },
];

// Acciones (la barra de arriba)
export const acciones = [
  { id: 'nuevo', nombre: 'Dibujo nuevo', icono: icono('nuevo') },
  { id: 'abrir', nombre: 'Abrir un dibujo', icono: icono('abrir') },
  { id: 'guardar', nombre: 'Guardar', icono: icono('guardar') },
  { id: 'deshacer', nombre: 'Deshacer', icono: icono('deshacer') },
  { id: 'rehacer', nombre: 'Rehacer', icono: icono('rehacer') },
  { id: 'papelera', nombre: 'Borrar todo', icono: icono('papelera') },
];

// La paleta de 28 colores del Paint de Windows 95/98 (dos filas de 14).
export const paletaClasica = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080',
  '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff',
  '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
];

// Colores para la ventana estilo Windows viejo (bordes en relieve)
export const coloresVentana = {
  fondo: '#c0c0c0',
  luz: '#ffffff',
  sombra: '#808080',
  sombraOscura: '#000000',
  tituloDesde: '#000080',
  tituloHasta: '#1084d0',
  tituloTexto: '#ffffff',
};
