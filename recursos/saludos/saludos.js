// Saludos sorpresa en rioplatense. {nombre} se reemplaza por el nombre de quien entra.
// Uso: elegirSaludo({ persona: 'tomas' })  →  «Buen día, Tomás. ¿Ya cebaste el primero?»
// Las personas se identifican como 'tomas', 'aostri' y 'hassan'.

export const nombres = { tomas: 'Tomás', aostri: 'Aostri', hassan: 'Hassan' };

export const saludos = {
  manana: [
    'Buen día, {nombre}. ¿Ya cebaste el primero?',
    '¡Arriba, {nombre}! El café no se toma solo.',
    'Buen día, {nombre}. Hoy la rompemos.',
    'Llegó {nombre}. Ahora sí arranca el día.',
    'Buenas, {nombre}. ¿Medialunas de grasa o de manteca?',
  ],
  tarde: [
    'Buenas tardes, {nombre}. ¿Unos mates para la tarde?',
    '¿Qué hacés, {nombre}? Vamos que ya pasó lo peor.',
    '{nombre}, la siesta es para los débiles. Bueno, un ratito.',
    'Buenas, {nombre}. La tarde pinta productiva.',
  ],
  noche: [
    'Buenas noches, {nombre}. ¿Horas extra? Sos de fierro.',
    '{nombre}, ¿todavía por acá? Andá a comer algo.',
    'Noche de laburo, {nombre}. Que no se te enfríe la pizza.',
  ],
  madrugada: [
    '{nombre}, son altas horas. ¿Todo bien en casa?',
    'Modo búho activado, {nombre}. Mañana te quiero ver.',
  ],
  lunes: [
    'Lunes, {nombre}. Se lo encara con mate y paciencia.',
    'Arrancó la semana, {nombre}. Vamos con todo.',
  ],
  viernes: [
    '¡Viernes, {nombre}! Ya se huele el asado.',
    'Viernes, {nombre}. Cerramos algo y nos vamos.',
  ],
  finde: [
    '¿Laburando el finde, {nombre}? Sos crack (o te falta un tornillo).',
    '{nombre}, es finde. Esto puede esperar al lunes, eh.',
  ],
  general: [
    '¡Qué hacés, {nombre}! Qué bueno verte de nuevo.',
    'Hola, {nombre}. Todo en orden por acá.',
    '{nombre} en la casa. Se nota el nivel.',
    'Aguante ATH, {nombre}.',
    'Pasá, {nombre}, estás en tu casa.',
    'Llegó quien faltaba: {nombre}.',
  ],
  // Guiños según lo que hace cada uno en el equipo
  porPersona: {
    tomas: [
      'Hola, {nombre}. ¿Cuántas pestañas de GitHub tenés abiertas?',
      '{nombre}, el código no se escribe solo. Bueno, ahora casi.',
      'Buenas, {nombre}. Hassan dejó cambios para que revises, ojo.',
      '¡{nombre}! Que hoy compile todo a la primera.',
    ],
    aostri: [
      'Hola, {nombre}. ¿Qué idea genial traés hoy?',
      '{nombre}, el Paint te extrañaba.',
      'Buenas, {nombre}. Hoy pinta una campaña de esas.',
      '¡{nombre}! La creatividad no se agenda, pero anotala igual.',
    ],
    hassan: [
      'Hola, {nombre}. ¿Cuántos clientes nuevos trajiste hoy?',
      '{nombre}, el tablero de clientes te espera.',
      'Buenas, {nombre}. Hoy se cierra uno, lo presiento.',
      '¡{nombre}! Tomás ya vio tus cambios. O eso dice.',
    ],
  },
};

function momentoDelDia(fecha) {
  const hora = fecha.getHours();
  if (hora < 6) return 'madrugada';
  if (hora < 12) return 'manana';
  if (hora < 20) return 'tarde';
  return 'noche';
}

function diaEspecial(fecha) {
  const dia = fecha.getDay(); // 0 = domingo
  if (dia === 0 || dia === 6) return 'finde';
  if (dia === 1) return 'lunes';
  if (dia === 5) return 'viernes';
  return null;
}

// Junta los saludos que corresponden a esta persona, este día y esta hora, y elige uno.
export function elegirSaludo({ persona, fecha = new Date(), azar = Math.random } = {}) {
  const nombre = nombres[persona] ?? 'che';
  const opciones = [
    ...saludos[momentoDelDia(fecha)],
    ...(saludos[diaEspecial(fecha)] ?? []),
    ...saludos.general,
    ...(saludos.porPersona[persona] ?? []),
  ];
  const elegido = opciones[Math.floor(azar() * opciones.length)];
  return elegido.replaceAll('{nombre}', nombre);
}
