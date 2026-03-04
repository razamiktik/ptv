import 'dotenv/config';
import cron from 'node-cron';

const API_URL    = process.env.API_URL    || 'http://wisp-api:3000';
const WORKER_KEY = process.env.WORKER_SECRET_KEY || '';
const INTERVAL   = Number(process.env.BILLING_CHECK_INTERVAL) || 3600;

async function callAPI(path) {
  try {
    const r = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WORKER_KEY}` },
    });
    return r.json();
  } catch (e) {
    console.error(`[Worker] Error llamando ${path}:`, e.message);
  }
}

async function waitForAPI() {
  console.log('[Worker] Esperando API...');
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`${API_URL}/health`);
      if (r.ok) { console.log('[Worker] API disponible.'); return; }
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
  }
  console.error('[Worker] API no responde. El worker continuará intentando en background.');
}

await waitForAPI();

// Ciclo de facturación cada N segundos
setInterval(() => callAPI('/api/billing/run-cycle'), INTERVAL * 1000);

// Facturas mensuales: día 1 a las 00:05
cron.schedule('5 0 1 * *', () => {
  console.log('[Worker] Generando facturas mensuales...');
  callAPI('/api/billing/generate-invoices');
});

// Ciclo inicial al arrancar (con delay de 60s)
setTimeout(() => callAPI('/api/billing/run-cycle'), 60000);

console.log(`[Worker] Mikrotik Worker activo. Ciclo cada ${INTERVAL}s`);
