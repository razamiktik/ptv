// ================================================================
//  WISP System - Mikrotik Worker
//  Proceso independiente: ejecuta tareas programadas de red/facturación
//  Se comunica con la API Core internamente
// ================================================================

import cron from 'node-cron';

const API_URL        = process.env.API_URL        || 'http://api-core:3000';
const WORKER_KEY     = process.env.API_WORKER_KEY || '';
const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL) || 3600; // segundos

const headers = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${WORKER_KEY}`,
  'X-Worker-Agent': 'wisp-mikrotik-worker/1.0',
};

async function callAPI(path, method = 'POST', body = null) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${path} respondió ${response.status}: ${err}`);
  }
  return response.json();
}

// ── Tarea: Ciclo de facturación y suspensiones ────────────────────
async function runBillingCycle() {
  console.log(`[Worker] Iniciando ciclo de facturación: ${new Date().toISOString()}`);
  try {
    const result = await callAPI('/api/billing/run-cycle');
    console.log(`[Worker] Ciclo completado:`, JSON.stringify(result));
  } catch (err) {
    console.error('[Worker] Error en ciclo de facturación:', err.message);
  }
}

// ── Tarea: Generar facturas mensuales (día 1 de cada mes) ─────────
async function generateMonthlyInvoices() {
  console.log('[Worker] Generando facturas mensuales...');
  try {
    const result = await callAPI('/api/billing/generate-invoices');
    console.log(`[Worker] Facturas generadas: ${result.created}`);
  } catch (err) {
    console.error('[Worker] Error generando facturas:', err.message);
  }
}

// ── Tarea: Sincronizar estado de clientes con Mikrotik ────────────
async function syncMikrotikState() {
  console.log('[Worker] Sincronizando estado con Mikrotik...');
  try {
    await callAPI('/api/network/sync-state');
    console.log('[Worker] Sincronización completada.');
  } catch (err) {
    console.error('[Worker] Error en sincronización:', err.message);
  }
}

// ── Cargar plugins del worker ─────────────────────────────────────
async function loadPlugins() {
  const { default: fs }   = await import('fs');
  const { default: path } = await import('path');
  const pluginsDir = path.join(process.cwd(), 'plugins');

  if (!fs.existsSync(pluginsDir)) return;

  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const plugin = await import(`file://${path.join(pluginsDir, file)}`);
      if (typeof plugin.registerWorker === 'function') {
        plugin.registerWorker({ cron, callAPI });
        console.log(`[Worker:Plugin] Cargado: ${file}`);
      }
    } catch (err) {
      console.error(`[Worker:Plugin] Error en ${file}:`, err.message);
    }
  }
}

// ── Esperar a que la API esté disponible ──────────────────────────
async function waitForAPI(maxRetries = 30) {
  console.log('[Worker] Esperando que la API Core esté disponible...');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const r = await fetch(`${API_URL}/health`);
      if (r.ok) { console.log('[Worker] API Core disponible.'); return; }
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
  }
  console.error('[Worker] API Core no disponible después de reintentos. Saliendo.');
  process.exit(1);
}

// ── MAIN ──────────────────────────────────────────────────────────
(async () => {
  await waitForAPI();
  await loadPlugins();

  // Convertir segundos a expresión cron
  // Para intervalos simples usamos setInterval para mayor flexibilidad
  console.log(`[Worker] Ciclo de cortes cada ${CHECK_INTERVAL}s`);
  setInterval(runBillingCycle, CHECK_INTERVAL * 1000);

  // Facturas mensuales: día 1 a las 00:05
  cron.schedule('5 0 1 * *', generateMonthlyInvoices, {
    timezone: process.env.TZ || 'America/Mexico_City',
  });

  // Sincronización con Mikrotik cada 15 minutos
  cron.schedule('*/15 * * * *', syncMikrotikState);

  // Ejecutar ciclo inicial al arrancar
  setTimeout(runBillingCycle, 30000); // Esperar 30s después de init
  setTimeout(syncMikrotikState, 60000);

  console.log('[Worker] Mikrotik Worker iniciado y escuchando tareas.');
})();
