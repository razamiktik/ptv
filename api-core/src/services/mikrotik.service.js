// ================================================================
//  WISP System - Capa de Abstracción Mikrotik
//  Usa la API RouterOS (puerto 8728/8729-TLS)
//  Biblioteca: node-routeros (compatible con RouterOS v6 y v7)
// ================================================================

import RouterOSAPI from 'node-routeros';

class MikrotikService {
  constructor() {
    this.config = {
      host:     process.env.MIKROTIK_HOST,
      user:     process.env.MIKROTIK_USER,
      password: process.env.MIKROTIK_PASS,
      port:     Number(process.env.MIKROTIK_PORT) || 8728,
      timeout:  10,
    };
    this._connection = null;
  }

  // ── Conexión con reconexión automática ─────────────────────────
  async connect() {
    if (this._connection?.connected) return this._connection;

    const conn = new RouterOSAPI(this.config);
    await conn.connect();
    this._connection = conn;
    console.log('[Mikrotik] Conectado a', this.config.host);
    return conn;
  }

  async disconnect() {
    if (this._connection) {
      await this._connection.close();
      this._connection = null;
    }
  }

  // ── Helpers internos ──────────────────────────────────────────
  async _exec(path, params = {}) {
    const conn = await this.connect();
    const channel = conn.openChannel();
    return new Promise((resolve, reject) => {
      channel.write(path, params)
        .then(data => { channel.close(); resolve(data); })
        .catch(err  => { channel.close(); reject(err);  });
    });
  }

  // ================================================================
  //  GESTIÓN DE CLIENTES (PPPoE / Hotspot / Simple Queue)
  // ================================================================

  /**
   * Crea un usuario PPPoE en Mikrotik para un cliente nuevo.
   * @param {Object} client - { username, password, profile }
   */
  async createPPPoEUser({ username, password, profile = 'default' }) {
    return this._exec('/ppp/secret/add', {
      name:     username,
      password: password,
      profile:  profile,
      service:  'pppoe',
      comment:  `WISP-AUTO:${username}`,
    });
  }

  /**
   * Suspende un cliente (añade a lista de suspendidos y desconecta sesión activa).
   * Equivale al "corte" por falta de pago.
   * @param {string} username - Nombre del usuario PPPoE
   */
  async suspendClient(username) {
    try {
      // 1. Desactivar el secreto PPPoE
      const secrets = await this._exec('/ppp/secret/getall', { '?name': username });
      if (secrets.length > 0) {
        await this._exec('/ppp/secret/set', { '.id': secrets[0]['.id'], disabled: 'yes' });
      }

      // 2. Terminar sesión activa si existe
      const activeSessions = await this._exec('/ppp/active/getall', { '?name': username });
      for (const session of activeSessions) {
        await this._exec('/ppp/active/remove', { '.id': session['.id'] });
      }

      // 3. Agregar a Address-List de suspendidos (para bloqueo en firewall)
      await this._exec('/ip/firewall/address-list/add', {
        list:    'WISP-SUSPENDED',
        address: username,  // Reemplazar por IP real si se usa IP fija
        comment: `Suspended:${username}:${new Date().toISOString()}`,
        timeout: '0s', // Sin expiración automática
      });

      console.log(`[Mikrotik] Cliente suspendido: ${username}`);
      return { success: true, username, action: 'suspended' };
    } catch (err) {
      console.error(`[Mikrotik] Error suspendiendo ${username}:`, err.message);
      throw err;
    }
  }

  /**
   * Reactiva un cliente después de que pague.
   * @param {string} username
   */
  async reactivateClient(username) {
    try {
      // 1. Re-habilitar secreto PPPoE
      const secrets = await this._exec('/ppp/secret/getall', { '?name': username });
      if (secrets.length > 0) {
        await this._exec('/ppp/secret/set', { '.id': secrets[0]['.id'], disabled: 'no' });
      }

      // 2. Remover de Address-List de suspendidos
      const entries = await this._exec('/ip/firewall/address-list/getall', {
        '?list':    'WISP-SUSPENDED',
        '?address': username,
      });
      for (const entry of entries) {
        await this._exec('/ip/firewall/address-list/remove', { '.id': entry['.id'] });
      }

      console.log(`[Mikrotik] Cliente reactivado: ${username}`);
      return { success: true, username, action: 'reactivated' };
    } catch (err) {
      console.error(`[Mikrotik] Error reactivando ${username}:`, err.message);
      throw err;
    }
  }

  /**
   * Cambia el perfil de velocidad (QoS) de un cliente.
   * @param {string} username
   * @param {string} profile - Nombre del perfil PPPoE en Mikrotik
   */
  async changeClientProfile(username, profile) {
    const secrets = await this._exec('/ppp/secret/getall', { '?name': username });
    if (!secrets.length) throw new Error(`Usuario ${username} no encontrado en Mikrotik`);
    return this._exec('/ppp/secret/set', { '.id': secrets[0]['.id'], profile });
  }

  // ================================================================
  //  MONITOREO
  // ================================================================

  /** Obtiene todas las sesiones PPPoE activas */
  async getActiveSessions() {
    return this._exec('/ppp/active/getall');
  }

  /** Estadísticas de tráfico de una interfaz */
  async getInterfaceStats(interfaceName = 'ether1') {
    const stats = await this._exec('/interface/getall', { '?name': interfaceName });
    return stats[0] || null;
  }

  /** Obtiene consumo actual de un cliente específico */
  async getClientTraffic(username) {
    const sessions = await this._exec('/ppp/active/getall', { '?name': username });
    if (!sessions.length) return null;
    return {
      username,
      uptime:    sessions[0].uptime,
      bytesIn:   sessions[0]['bytes-in'],
      bytesOut:  sessions[0]['bytes-out'],
      address:   sessions[0].address,
    };
  }

  // ================================================================
  //  PERFILES DE VELOCIDAD
  // ================================================================

  /** Lista todos los perfiles PPPoE disponibles */
  async listProfiles() {
    return this._exec('/ppp/profile/getall');
  }

  /**
   * Crea un nuevo perfil de velocidad.
   * @param {Object} profile - { name, rateLimit } ej: "5M/5M"
   */
  async createProfile({ name, rateLimit, localAddress = '' }) {
    return this._exec('/ppp/profile/add', {
      name,
      'rate-limit': rateLimit,
      'local-address': localAddress,
    });
  }
}

// Singleton: una sola instancia compartida en toda la API
export default new MikrotikService();
