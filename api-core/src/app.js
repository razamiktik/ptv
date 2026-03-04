import 'dotenv/config';
import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import morgan         from 'morgan';
import { createPool } from 'mariadb';
import path           from 'path';
import fs             from 'fs';
import { fileURLToPath } from 'url';
import { EventEmitter }  from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.locals.events = new EventEmitter();

// ── Base de Datos ────────────────────────────────────────────────
export const db = createPool({
  host:            process.env.DB_HOST     || 'db',
  port:            Number(process.env.DB_PORT) || 3306,
  database:        process.env.DB_NAME     || 'wispdb',
  user:            process.env.DB_USER     || 'wispuser',
  password:        process.env.DB_PASSWORD || '',
  connectionLimit: 10,
  connectTimeout:  10000,
  acquireTimeout:  30000,
});

async function connectDB() {
  for (let i = 0; i < 15; i++) {
    try {
      const conn = await db.getConnection();
      console.log('[DB] Conectado a MariaDB');
      conn.release();
      return;
    } catch (e) {
      console.warn(`[DB] Reintento ${i + 1}/15:`, e.message);
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  console.error('[DB] No se pudo conectar. Saliendo.');
  process.exit(1);
}
await connectDB();

// ── Middlewares ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ── Health Check ─────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', ts: new Date().toISOString() });
});

// ── Rutas inline (básicas para que arranque) ──────────────────────

// Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const rows = await db.query('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const { default: bcrypt } = await import('bcrypt');
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const { default: jwt } = await import('jsonwebtoken');
    const token = jwt.sign(
      { id: rows[0].id, username: rows[0].username, role: rows[0].role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '8h' }
    );

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [rows[0].id]);
    res.json({ token, user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Clientes
app.get('/api/clients', async (_req, res) => {
  try {
    const rows = await db.query(`
      SELECT c.*, p.name as plan_name, p.price, p.speed_down_mbps, p.speed_up_mbps
      FROM clients c LEFT JOIN plans p ON p.id = c.plan_id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { full_name, email, phone, address, username_mikrotik, password_mikrotik, plan_id } = req.body;
    const { default: bcrypt } = await import('bcrypt');
    const hash = await bcrypt.hash(password_mikrotik, 10);
    const result = await db.query(
      'INSERT INTO clients (full_name, email, phone, address, username_mikrotik, password_mikrotik, plan_id) VALUES (?,?,?,?,?,?,?)',
      [full_name, email, phone, address, username_mikrotik, hash, plan_id]
    );
    res.json({ id: Number(result.insertId), message: 'Cliente creado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const rows = await db.query('SELECT c.*, p.name as plan_name, p.price FROM clients c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const { full_name, email, phone, address, plan_id } = req.body;
    await db.query('UPDATE clients SET full_name=?, email=?, phone=?, address=?, plan_id=?, updated_at=NOW() WHERE id=?',
      [full_name, email, phone, address, plan_id, req.params.id]);
    res.json({ message: 'Actualizado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Planes
app.get('/api/plans', async (_req, res) => {
  try {
    const rows = await db.query('SELECT * FROM plans WHERE active = 1 ORDER BY price ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/plans', async (req, res) => {
  try {
    const { name, description, price, speed_down_mbps, speed_up_mbps, mikrotik_profile } = req.body;
    const result = await db.query(
      'INSERT INTO plans (name, description, price, speed_down_mbps, speed_up_mbps, mikrotik_profile) VALUES (?,?,?,?,?,?)',
      [name, description, price, speed_down_mbps, speed_up_mbps, mikrotik_profile || 'default']
    );
    res.json({ id: Number(result.insertId), message: 'Plan creado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Facturas
app.get('/api/invoices', async (req, res) => {
  try {
    const { client_id, status } = req.query;
    let q = 'SELECT i.*, c.full_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE 1=1';
    const params = [];
    if (client_id) { q += ' AND i.client_id = ?'; params.push(client_id); }
    if (status)    { q += ' AND i.status = ?';    params.push(status); }
    q += ' ORDER BY i.created_at DESC LIMIT 200';
    const rows = await db.query(q, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/invoices/:id/pay', async (req, res) => {
  try {
    const { amount, method } = req.body;
    await db.query('UPDATE invoices SET status="paid", paid_at=NOW() WHERE id=?', [req.params.id]);
    await db.query('INSERT INTO payments (invoice_id, amount, method, paid_at) VALUES (?,?,?,NOW())',
      [req.params.id, amount, method || 'cash']);
    res.json({ message: 'Pago registrado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dashboard stats
app.get('/api/stats', async (_req, res) => {
  try {
    const [[clients]]   = await db.query('SELECT COUNT(*) as total, SUM(suspended) as suspended FROM clients WHERE active=1');
    const [[invoices]]  = await db.query('SELECT COUNT(*) as total, SUM(amount) as total_amount FROM invoices WHERE status="pending"');
    const [[paid]]      = await db.query('SELECT SUM(amount) as total FROM invoices WHERE status="paid" AND MONTH(paid_at)=MONTH(NOW())');
    res.json({
      clients:         Number(clients.total),
      suspended:       Number(clients.suspended),
      pending_invoices: Number(invoices.total),
      pending_amount:  Number(invoices.total_amount) || 0,
      monthly_income:  Number(paid.total) || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Billing manual trigger
app.post('/api/billing/run-cycle', async (_req, res) => {
  res.json({ message: 'Ciclo iniciado', ts: new Date().toISOString() });
});

// ── Plugins ───────────────────────────────────────────────────────
const pluginsDir = path.join(__dirname, '..', 'plugins');
if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

const pluginFiles = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
for (const file of pluginFiles) {
  try {
    const mod = await import(`file://${path.join(pluginsDir, file)}`);
    if (typeof mod.register === 'function') {
      mod.register(app, db);
      console.log(`[Plugin] Cargado: ${file}`);
    }
  } catch (e) {
    console.error(`[Plugin] Error en ${file}:`, e.message);
  }
}

// ── Error handler ────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] WISP Core corriendo en :${PORT}`);
});
