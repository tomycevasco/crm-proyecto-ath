// Arranque de ATH: estilos → entrada → los tres → marco → módulos → enrutador.
import './estilos/base.css';
import './estilos/pulido.css';
import { supabase } from './nucleo/supabase.js';
import { crearApp } from './nucleo/app.js';
import { esperarEntrada } from './nucleo/entrada.js';
import { prepararPersonas } from './nucleo/personas.js';
import { prepararMarco } from './nucleo/marco.js';
import { registrarServiceWorker, prepararInstalacion } from './nucleo/instalar.js';

// Cada archivo de src/modulos/ se suma solo: exporta iniciar(app) y ahí registra su pantalla.
// (Para sumar una pantalla nueva no hace falta tocar este archivo.)
const modulos = import.meta.glob('./modulos/*.js', { eager: true });

async function arrancar() {
  registrarServiceWorker();
  const quien = await esperarEntrada(supabase);
  const app = crearApp({ supabase, conectado: quien.conectado });
  prepararInstalacion(app);

  try {
    await prepararPersonas(app, quien);
  } catch (e) {
    console.error(e);
    mostrarFalla('No pude cargar los datos del equipo. ¿Ya corriste supabase/esquema.sql en Supabase?');
    return;
  }

  prepararMarco(app);
  document.getElementById('arranque').hidden = true;
  document.getElementById('app').hidden = false;

  // Si un módulo falla al arrancar, los demás siguen.
  const nombres = Object.keys(modulos).sort();
  const resultados = await Promise.allSettled(
    nombres.map(async (nombre) => {
      if (typeof modulos[nombre].iniciar !== 'function') throw new Error('no exporta iniciar(app)');
      await modulos[nombre].iniciar(app);
    }),
  );
  resultados.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Módulo ${nombres[i]}:`, r.reason);
      app.avisar(`No pude cargar ${nombres[i].replace('./modulos/', '')}.`, 'error');
    }
  });

  app.arrancarEnrutador();

  // Para probar a mano desde la consola mientras se programa (no queda en la versión publicada).
  if (import.meta.env.DEV) window.ath = app;
}

function mostrarFalla(texto) {
  const arranque = document.getElementById('arranque');
  arranque.querySelector('p').textContent = texto;
  arranque.classList.add('arranque--falla');
  arranque.hidden = false;
}

arrancar().catch((e) => {
  console.error(e);
  mostrarFalla('Algo falló al abrir ATH. Probá recargar la página.');
});
