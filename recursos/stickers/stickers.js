// Stickers sorpresa: dibujos propios en SVG (200×200, menos de 3 KB cada uno).
// `alt` = lo que lee un lector de pantalla · `frase` = texto cortito para acompañarlo.

const url = (id) => new URL(`./${id}.svg`, import.meta.url).href;

export const stickers = [
  { id: 'mate', alt: 'Un mate con carita', frase: '¿Unos mates mientras laburamos?' },
  { id: 'golazo', alt: 'Pelota de fútbol con el texto ¡Golazo!', frase: '¡Golazo! Eso salió redondito.' },
  { id: 'alfajor', alt: 'Un alfajor con carita', frase: 'Te ganaste un alfajor.' },
  { id: 'empanada', alt: 'Una empanada con carita', frase: '¿Pedimos unas empanadas?' },
  { id: 'medialuna', alt: 'Una medialuna con carita', frase: 'Medialunas para el equipo.' },
  { id: 'dulce-de-leche', alt: 'Un frasco de dulce de leche', frase: 'Más dulce que el dulce de leche.' },
  { id: 'che', alt: 'Globo de diálogo azul que dice ¡Che!', frase: '¡Che! Mirá esto.' },
  { id: 'aguante-ath', alt: 'Bandera naranja, azul y verde que dice Aguante ATH', frase: 'Aguante ATH, vieja.' },
  { id: 'dale-que-va', alt: 'Un cohete despegando con el texto ¡Dale que va!', frase: '¡Dale que va!' },
  { id: 'sol', alt: 'Un sol con anteojos de sol', frase: 'Qué día para cerrar un cliente.' },
  { id: 'crack', alt: 'Una copa dorada con el texto ¡Crack!', frase: 'Sos un crack, posta.' },
  { id: 'bien-ahi', alt: 'Estrella verde que dice ¡Bien ahí!', frase: '¡Bien ahí!' },
].map((s) => ({ ...s, url: url(s.id) }));

export function stickerAlAzar(azar = Math.random) {
  return stickers[Math.floor(azar() * stickers.length)];
}
