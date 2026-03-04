// ================================================================
//  WISP System - Plugin de Ejemplo: Notificaciones WhatsApp
//  Archivo: /plugins/whatsapp-notify.js
//
//  FORMATO REQUERIDO:
//  Todo plugin DEBE exportar una función 'register(app, db)'
//  que recibe la instancia de Express y el pool de DB.
// ================================================================

// Metadata del plugin (opcional pero recomendada)
export const meta = {
  name:        'whatsapp-notify',
  version:     '1.0.0',
  description: 'Envía notificaciones por WhatsApp al suspender/reactivar clientes',
  author:      'WISP Community',
};

/**
 * Función principal que se llama al cargar el plugin.
 * @param {import('express').Express} app  - Instancia de Express
 * @param {import('mariadb').Pool}    db   - Pool de base de datos
 */
export function register(app, db) {
  console.log(`[Plugin] ${meta.name} v${meta.version} cargado.`);

  // ── Configuración desde variables de entorno ──────────────────
  const config = {
    apiUrl:   process.env.WA_API_URL   || '',  // Ej: https://api.ultramsg.com/instance123
    apiToken: process.env.WA_API_TOKEN || '',
    enabled:  !!(process.env.WA_API_URL && process.env.WA_API_TOKEN),
  };

  if (!config.enabled) {
    console.warn(`[Plugin:${meta.name}] WA_API_URL o WA_API_TOKEN no configurados. Plugin desactivado.`);
    return;
  }

  // ── Función interna para enviar mensaje ───────────────────────
  async function sendWhatsApp(phone, message) {
    const cleanPhone = phone.replace(/\D/g, '');
    const response = await fetch(`${config.apiUrl}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: config.apiToken, to: cleanPhone, body: message }),
    });
    return response.json();
  }

  // ── Rutas adicionales que este plugin expone ──────────────────

  // GET /api/plugins/whatsapp-notify/status
  app.get('/api/plugins/whatsapp-notify/status', (_req, res) => {
    res.json({ plugin: meta.name, enabled: config.enabled });
  });

  // POST /api/plugins/whatsapp-notify/test
  app.post('/api/plugins/whatsapp-notify/test', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
      const result = await sendWhatsApp(phone, '✅ WISP System: Notificación de prueba exitosa.');
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Hook: escuchar eventos del sistema ────────────────────────
  // El core emitirá eventos en app.locals.events (EventEmitter)
  if (app.locals.events) {
    // Evento: cliente suspendido
    app.locals.events.on('client:suspended', async ({ client }) => {
      if (!client.phone) return;
      const msg = `⚠️ Estimado ${client.full_name}, su servicio de internet ha sido suspendido por falta de pago. Para reactivarlo, realice su pago y contáctenos.`;
      try {
        await sendWhatsApp(client.phone, msg);
        console.log(`[Plugin:${meta.name}] Notificación enviada a ${client.phone}`);
      } catch (err) {
        console.error(`[Plugin:${meta.name}] Error enviando WA:`, err.message);
      }
    });

    // Evento: cliente reactivado
    app.locals.events.on('client:reactivated', async ({ client }) => {
      if (!client.phone) return;
      const msg = `✅ Estimado ${client.full_name}, su servicio de internet ha sido reactivado exitosamente. ¡Bienvenido de vuelta!`;
      try {
        await sendWhatsApp(client.phone, msg);
      } catch (err) {
        console.error(`[Plugin:${meta.name}] Error enviando WA:`, err.message);
      }
    });

    // Evento: factura generada
    app.locals.events.on('invoice:created', async ({ client, invoice }) => {
      if (!client.phone) return;
      const msg = `📄 ${client.full_name}, su factura por $${invoice.amount} ha sido generada. Vence el ${invoice.due_date}. Favor de pagar a tiempo para evitar cortes.`;
      try {
        await sendWhatsApp(client.phone, msg);
      } catch (err) {
        console.error(`[Plugin:${meta.name}] Error enviando WA:`, err.message);
      }
    });
  }
}
