// ================================================================
//  WISP System - Servicio de Facturación y Cortes Automáticos
//  Este módulo es llamado por el mikrotik-worker cada N horas.
// ================================================================

import mikrotik from './mikrotik.service.js';

export class BillingService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Tarea principal: verifica facturas vencidas y suspende clientes.
   * Se ejecuta periódicamente desde el mikrotik-worker.
   */
  async runBillingCycle() {
    console.log('[Billing] Iniciando ciclo de facturación...', new Date().toISOString());
    const results = { suspended: [], errors: [], reactivated: [] };

    try {
      // 1. Obtener clientes con facturas vencidas (no suspendidos aún)
      const overdueClients = await this.db.query(`
        SELECT 
          c.id, c.username_mikrotik, c.email, c.full_name,
          i.id AS invoice_id, i.due_date, i.amount, i.status
        FROM clients c
        JOIN invoices i ON i.client_id = c.id
        WHERE i.status = 'pending'
          AND i.due_date < CURDATE()
          AND c.suspended = 0
          AND c.active = 1
        ORDER BY i.due_date ASC
      `);

      console.log(`[Billing] ${overdueClients.length} clientes con facturas vencidas.`);

      // 2. Suspender cada cliente moroso
      for (const client of overdueClients) {
        try {
          // Suspender en Mikrotik
          await mikrotik.suspendClient(client.username_mikrotik);

          // Actualizar estado en BD
          await this.db.query(
            `UPDATE clients SET suspended = 1, suspended_at = NOW() WHERE id = ?`,
            [client.id]
          );
          await this.db.query(
            `UPDATE invoices SET status = 'overdue' WHERE id = ?`,
            [client.invoice_id]
          );

          // Registrar en log de eventos
          await this._logEvent(client.id, 'suspension', 
            `Suspendido por factura vencida ${client.invoice_id} (${client.due_date})`);

          results.suspended.push({ id: client.id, username: client.username_mikrotik });
          console.log(`[Billing] ✓ Suspendido: ${client.username_mikrotik}`);
        } catch (err) {
          console.error(`[Billing] Error suspendiendo ${client.username_mikrotik}:`, err.message);
          results.errors.push({ username: client.username_mikrotik, error: err.message });
        }
      }

      // 3. Verificar clientes suspendidos que pagaron (facturas pagadas en el período)
      const paidClients = await this.db.query(`
        SELECT DISTINCT c.id, c.username_mikrotik, c.email, c.full_name
        FROM clients c
        WHERE c.suspended = 1
          AND NOT EXISTS (
            SELECT 1 FROM invoices i 
            WHERE i.client_id = c.id 
              AND i.status IN ('pending', 'overdue')
          )
      `);

      for (const client of paidClients) {
        try {
          await mikrotik.reactivateClient(client.username_mikrotik);
          await this.db.query(
            `UPDATE clients SET suspended = 0, suspended_at = NULL WHERE id = ?`,
            [client.id]
          );
          await this._logEvent(client.id, 'reactivation', 'Reactivado tras pago de facturas');
          results.reactivated.push({ id: client.id, username: client.username_mikrotik });
          console.log(`[Billing] ✓ Reactivado: ${client.username_mikrotik}`);
        } catch (err) {
          console.error(`[Billing] Error reactivando ${client.username_mikrotik}:`, err.message);
          results.errors.push({ username: client.username_mikrotik, error: err.message });
        }
      }

    } catch (dbErr) {
      console.error('[Billing] Error de base de datos en ciclo:', dbErr.message);
      results.errors.push({ type: 'db', error: dbErr.message });
    }

    console.log('[Billing] Ciclo completado:', JSON.stringify(results));
    return results;
  }

  /**
   * Genera facturas mensuales para todos los clientes activos.
   * Ejecutar el día 1 de cada mes.
   */
  async generateMonthlyInvoices() {
    const today = new Date();
    const dueDate = new Date(today.getFullYear(), today.getMonth() + 1, 5); // Vence el día 5
    
    const clients = await this.db.query(`
      SELECT c.id, c.full_name, p.price, p.name AS plan_name
      FROM clients c
      JOIN plans p ON p.id = c.plan_id
      WHERE c.active = 1
    `);

    let created = 0;
    for (const client of clients) {
      // Evitar duplicados: verificar si ya existe factura este mes
      const existing = await this.db.query(`
        SELECT id FROM invoices 
        WHERE client_id = ? AND MONTH(created_at) = ? AND YEAR(created_at) = ?
      `, [client.id, today.getMonth() + 1, today.getFullYear()]);

      if (!existing.length) {
        await this.db.query(`
          INSERT INTO invoices (client_id, amount, due_date, status, description)
          VALUES (?, ?, ?, 'pending', ?)
        `, [client.id, client.price, dueDate, `Servicio ${client.plan_name} - ${today.toLocaleString('es', { month: 'long' })} ${today.getFullYear()}`]);
        created++;
      }
    }

    console.log(`[Billing] ${created} facturas mensuales generadas.`);
    return { created };
  }

  /**
   * Registra un pago manual y reactiva el cliente si corresponde.
   */
  async recordPayment(invoiceId, amount, method = 'cash') {
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const invoice = await conn.query(
        'SELECT * FROM invoices WHERE id = ?', [invoiceId]
      );
      if (!invoice.length) throw new Error('Factura no encontrada');

      // Registrar pago
      await conn.query(`
        INSERT INTO payments (invoice_id, amount, method, paid_at)
        VALUES (?, ?, ?, NOW())
      `, [invoiceId, amount, method]);

      // Marcar factura como pagada
      await conn.query(
        `UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ?`,
        [invoiceId]
      );

      await conn.commit();

      // Verificar si el cliente puede ser reactivado (sin más deudas)
      const pendingInvoices = await this.db.query(`
        SELECT id FROM invoices 
        WHERE client_id = ? AND status IN ('pending', 'overdue')
      `, [invoice[0].client_id]);

      if (!pendingInvoices.length) {
        const client = await this.db.query(
          'SELECT * FROM clients WHERE id = ?', [invoice[0].client_id]
        );
        if (client[0]?.suspended) {
          await mikrotik.reactivateClient(client[0].username_mikrotik);
          await this.db.query(
            'UPDATE clients SET suspended = 0, suspended_at = NULL WHERE id = ?',
            [client[0].id]
          );
          await this._logEvent(client[0].id, 'reactivation', `Reactivado tras pago de factura ${invoiceId}`);
        }
      }

      return { success: true, invoiceId };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async _logEvent(clientId, eventType, description) {
    await this.db.query(
      'INSERT INTO client_events (client_id, event_type, description) VALUES (?, ?, ?)',
      [clientId, eventType, description]
    );
  }
}
