import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || '/api'
const api = axios.create({ baseURL: API })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('wisp_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// ── Auth Context ──────────────────────────────────────────────────
function useAuth() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wisp_user')) } catch { return null }
  })

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password })
    localStorage.setItem('wisp_token', data.token)
    localStorage.setItem('wisp_user', JSON.stringify(data.user))
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('wisp_token')
    localStorage.removeItem('wisp_user')
    setUser(null)
  }

  return { user, login, logout }
}

// ── Login Page ────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [form, setForm] = useState({ username: 'admin', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await onLogin(form.username, form.password)
    } catch {
      setError('Usuario o contraseña incorrectos')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-sm border border-slate-700">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">📡</div>
          <h1 className="text-2xl font-bold text-white">WISP System</h1>
          <p className="text-slate-400 text-sm mt-1">Panel de Administración</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Usuario</label>
            <input
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Contraseña</label>
            <input
              type="password"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
        <p className="text-slate-500 text-xs text-center mt-4">Contraseña por defecto: Admin1234</p>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────
function Sidebar({ user, onLogout }) {
  const loc = useLocation()
  const links = [
    { to: '/',          icon: '📊', label: 'Dashboard' },
    { to: '/clients',   icon: '👥', label: 'Clientes' },
    { to: '/plans',     icon: '📦', label: 'Planes' },
    { to: '/invoices',  icon: '🧾', label: 'Facturas' },
  ]
  return (
    <aside className="w-56 bg-slate-800 border-r border-slate-700 flex flex-col min-h-screen">
      <div className="p-5 border-b border-slate-700">
        <div className="text-xl font-bold text-white flex items-center gap-2">
          <span>📡</span> WISP
        </div>
        <p className="text-slate-400 text-xs mt-1">{user?.username}</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map(l => (
          <Link
            key={l.to} to={l.to}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
              loc.pathname === l.to
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <span>{l.icon}</span> {l.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-slate-700">
        <button
          onClick={onLogout}
          className="w-full text-left px-3 py-2 text-slate-400 hover:text-white text-sm rounded-lg hover:bg-slate-700 transition"
        >
          🚪 Cerrar sesión
        </button>
      </div>
    </aside>
  )
}

// ── Dashboard ────────────────────────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState(null)
  useEffect(() => { api.get('/stats').then(r => setStats(r.data)).catch(() => {}) }, [])

  const cards = stats ? [
    { label: 'Clientes Activos',  value: stats.clients,          icon: '👥', color: 'blue' },
    { label: 'Suspendidos',       value: stats.suspended,         icon: '🚫', color: 'red' },
    { label: 'Facturas Pendientes', value: stats.pending_invoices, icon: '🧾', color: 'yellow' },
    { label: 'Ingresos del Mes',  value: `$${stats.monthly_income?.toFixed(2)}`, icon: '💰', color: 'green' },
  ] : []

  const colors = { blue: 'border-blue-500', red: 'border-red-500', yellow: 'border-yellow-500', green: 'border-green-500' }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats ? cards.map(c => (
          <div key={c.label} className={`bg-slate-800 rounded-xl p-5 border-l-4 ${colors[c.color]}`}>
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className="text-2xl font-bold text-white">{c.value}</div>
            <div className="text-slate-400 text-sm">{c.label}</div>
          </div>
        )) : (
          <div className="col-span-4 text-slate-400 text-center py-10">Cargando estadísticas...</div>
        )}
      </div>
    </div>
  )
}

// ── Clients ──────────────────────────────────────────────────────
function Clients() {
  const [clients, setClients] = useState([])
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', username_mikrotik: '', password_mikrotik: '', plan_id: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/clients'), api.get('/plans')])
      .then(([c, p]) => { setClients(c.data); setPlans(p.data) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const save = async e => {
    e.preventDefault(); setSaving(true)
    try {
      await api.post('/clients', form)
      setShowForm(false)
      setForm({ full_name: '', email: '', phone: '', username_mikrotik: '', password_mikrotik: '', plan_id: '' })
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Clientes</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">
          + Nuevo Cliente
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 rounded-xl p-5 mb-6 border border-slate-700">
          <h2 className="text-white font-semibold mb-4">Nuevo Cliente</h2>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            {[
              ['full_name', 'Nombre completo'],
              ['email', 'Email'],
              ['phone', 'Teléfono'],
              ['username_mikrotik', 'Usuario Mikrotik'],
              ['password_mikrotik', 'Contraseña Mikrotik'],
            ].map(([k, label]) => (
              <div key={k}>
                <label className="block text-slate-400 text-xs mb-1">{label}</label>
                <input
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  value={form[k]} required
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <label className="block text-slate-400 text-xs mb-1">Plan</label>
              <select
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none"
                value={form.plan_id} required
                onChange={e => setForm(f => ({ ...f, plan_id: e.target.value }))}
              >
                <option value="">Seleccionar...</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} - ${p.price}</option>)}
              </select>
            </div>
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm transition disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-lg text-sm transition">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-left">
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Teléfono</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400">Cargando...</td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-500">No hay clientes registrados</td></tr>
            ) : clients.map(c => (
              <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
                <td className="px-4 py-3 text-white">{c.full_name}</td>
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">{c.username_mikrotik}</td>
                <td className="px-4 py-3 text-slate-300">{c.plan_name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    c.suspended ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'
                  }`}>
                    {c.suspended ? 'Suspendido' : 'Activo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">{c.phone || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Plans ────────────────────────────────────────────────────────
function Plans() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', price: '', speed_down_mbps: '', speed_up_mbps: '', mikrotik_profile: '' })
  const [saving, setSaving] = useState(false)

  const load = () => { setLoading(true); api.get('/plans').then(r => setPlans(r.data)).finally(() => setLoading(false)) }
  useEffect(load, [])

  const save = async e => {
    e.preventDefault(); setSaving(true)
    try { await api.post('/plans', form); setShowForm(false); load() }
    catch (err) { alert(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Planes</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">
          + Nuevo Plan
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 rounded-xl p-5 mb-6 border border-slate-700">
          <h2 className="text-white font-semibold mb-4">Nuevo Plan</h2>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            {[
              ['name', 'Nombre del plan'],
              ['price', 'Precio (USD)'],
              ['speed_down_mbps', 'Velocidad bajada (Mbps)'],
              ['speed_up_mbps', 'Velocidad subida (Mbps)'],
              ['mikrotik_profile', 'Perfil Mikrotik'],
            ].map(([k, label]) => (
              <div key={k}>
                <label className="block text-slate-400 text-xs mb-1">{label}</label>
                <input
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  value={form[k]} required
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                />
              </div>
            ))}
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm transition disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="bg-slate-700 text-white px-6 py-2 rounded-lg text-sm transition">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? <div className="text-slate-400">Cargando...</div> :
          plans.map(p => (
            <div key={p.id} className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <h3 className="text-white font-semibold text-lg">{p.name}</h3>
              <div className="text-3xl font-bold text-blue-400 my-2">${p.price}<span className="text-sm text-slate-400">/mes</span></div>
              <div className="text-slate-400 text-sm space-y-1">
                <div>⬇ {p.speed_down_mbps} Mbps bajada</div>
                <div>⬆ {p.speed_up_mbps} Mbps subida</div>
                <div className="font-mono text-xs mt-2 text-slate-500">Perfil: {p.mikrotik_profile}</div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Invoices ─────────────────────────────────────────────────────
function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const load = () => {
    setLoading(true)
    const q = filter ? `?status=${filter}` : ''
    api.get(`/invoices${q}`).then(r => setInvoices(r.data)).finally(() => setLoading(false))
  }
  useEffect(load, [filter])

  const pay = async (id, amount) => {
    if (!confirm(`¿Registrar pago de $${amount}?`)) return
    await api.post(`/invoices/${id}/pay`, { amount, method: 'cash' })
    load()
  }

  const statusColor = s => ({
    pending: 'bg-yellow-900/50 text-yellow-400',
    paid:    'bg-green-900/50 text-green-400',
    overdue: 'bg-red-900/50 text-red-400',
  }[s] || 'bg-slate-700 text-slate-400')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Facturas</h1>
        <select
          className="bg-slate-700 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
          value={filter} onChange={e => setFilter(e.target.value)}
        >
          <option value="">Todas</option>
          <option value="pending">Pendientes</option>
          <option value="paid">Pagadas</option>
          <option value="overdue">Vencidas</option>
        </select>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-left">
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Monto</th>
              <th className="px-4 py-3">Vencimiento</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400">Cargando...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-500">No hay facturas</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className="px-4 py-3 text-white">{inv.full_name}</td>
                <td className="px-4 py-3 text-green-400 font-semibold">${Number(inv.amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-400">{inv.due_date?.split('T')[0]}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(inv.status)}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {inv.status !== 'paid' && (
                    <button onClick={() => pay(inv.id, inv.amount)}
                      className="bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded text-xs transition">
                      Registrar Pago
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── App Root ──────────────────────────────────────────────────────
export default function App() {
  const { user, login, logout } = useAuth()

  if (!user) return <Login onLogin={login} />

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} onLogout={logout} />
      <main className="flex-1 p-8 overflow-auto">
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/clients"  element={<Clients />} />
          <Route path="/plans"    element={<Plans />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="*"         element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
