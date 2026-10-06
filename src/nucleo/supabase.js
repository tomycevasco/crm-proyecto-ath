// La única conexión a Supabase de toda la app. Los módulos la usan como app.supabase.
import { createClient } from '@supabase/supabase-js';
import { HAY_SUPABASE, SUPABASE_URL, SUPABASE_CLAVE } from './config.js';

// Si todavía no se cargó el .env, queda en null y la entrada avisa qué falta.
export const supabase = HAY_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_CLAVE, {
      // La sesión queda guardada en esta compu: el código se pone una sola vez.
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ath-sesion' },
    })
  : null;
