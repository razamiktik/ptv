// ================================================================
//  WISP System - API Core  (Node.js 20 + Express)
//  Entry point: carga rutas, plugins y tareas programadas
// ================================================================

import express          from 'express';
import cors             from 'cors';
import helmet           from 'helmet';
import morgan           from 'morgan';
import { createPool }   from 'mariadb';
import path             from 'path';
import fs               from 'fs';
import { fileURLToPath } from 'url';

import authRouter       from './routes/auth.js';
import clientsRouter    from './routes/clients.js';
import plansRouter      from './routes/plans.js';
import invoicesRouter   from './routes/invoices.js';
import networkRouter    from './routes/network.js';
import pluginRouter     from './routes/plugins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Base de Datos (pool con reconexión automática) ──────────────
export const db = createPool({
  host:               process.env.DB_HOST,
  port:               Number(process.env.DB_PORT) || 3306,
  database:           process.env.DB_NAME,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  connectionLimit:    10,
  acquireTimeout:     30000,
  connectTimeout:     10000,
  idleTimeout:        60000,
});

// Verificar conexión al arrancar
(async () => {
  let retries = 10;
  while (retries--) {
    try {
      const conn = await db.getConnection();
      console.log('[DB] Conexión exitosa a MariaDB');
      conn.release();
      break;
    } catch (err) {
      if (!retries) { console.error('[DB] No se pudo conectar:', err.message); process.exit(1); }
      console.warn(`[DB] Reintentando conexión... (${retries} intentos restantes)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
})();

// ── Middlewares ─────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// ── Health Check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── Rutas API ─────────────────────────────────────────────────────
app.use('/api/auth',     authRouter);
app.use('/api/clients',  clientsRouter);
app.use('/api/plans',    plansRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/network',  networkRouter);
app.use('/api/plugins',  pluginRouter);

// ── Sistema de Plugins (carga dinámica) ──────────────────────────
const pluginsDir = path.join(__dirname, '..', 'plugins');

async function loadPlugins() {
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    console.log('[Plugins] Carpeta /plugins creada.');
    return;
  }

  const pluginFiles = fs.readdirSync(pluginsDir)
    .filter(f => f.endsWith('.js') || f.endsWith('.mjs'));

  for (const file of pluginFiles) {
    try {
      const pluginPath = `file://${path.join(pluginsDir, file)}`;
      const plugin = await import(pluginPath);

      if (typeof plugin.register === 'function') {
        plugin.register(app, db);
        console.log(`[Plugins] ✓ Cargado: ${file}`);
      } else {
        console.warn(`[Plugins] ${file} no exporta función 'register', omitiendo.`);
      }
    } catch (err) {
      console.error(`[Plugins] Error cargando ${file}:`, err.message);
    }
  }
}

loadPlugins();

// Watcher para hot-reload de plugins en desarrollo
if (process.env.NODE_ENV === 'development') {
  fs.watch(pluginsDir, { persistent: false }, (event, filename) => {
    if (filename?.endsWith('.js')) {
      console.log(`[Plugins] Cambio detectado en ${filename}, recargando...`);
      loadPlugins();
    }
  });
}

// ── Manejo de errores ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

// ── Arrancar servidor ─────────────────────────────────────────────
const PORT = process.env.API_PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] WISP API Core corriendo en puerto ${PORT}`);
});

export default app;
