-- ================================================================
--  WISP System - Schema inicial de Base de Datos
--  Se ejecuta SOLO en la primera creación del contenedor DB
-- ================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── Planes de servicio ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  price           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  speed_down_mbps INT UNSIGNED NOT NULL DEFAULT 10,
  speed_up_mbps   INT UNSIGNED NOT NULL DEFAULT 5,
  mikrotik_profile VARCHAR(100) NOT NULL DEFAULT 'default',
  active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT NOW(),
  updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Clientes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name           VARCHAR(200) NOT NULL,
  email               VARCHAR(200),
  phone               VARCHAR(50),
  address             TEXT,
  username_mikrotik   VARCHAR(100) NOT NULL UNIQUE,
  password_mikrotik   VARCHAR(255) NOT NULL,          -- Encriptado en app
  plan_id             INT UNSIGNED NOT NULL,
  ip_address          VARCHAR(45),                     -- IPv4 o IPv6 estática (opcional)
  mac_address         VARCHAR(17),
  active              TINYINT(1) NOT NULL DEFAULT 1,
  suspended           TINYINT(1) NOT NULL DEFAULT 0,
  suspended_at        DATETIME,
  notes               TEXT,
  created_at          DATETIME DEFAULT NOW(),
  updated_at          DATETIME DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Facturas ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  description VARCHAR(500),
  due_date    DATE NOT NULL,
  paid_at     DATETIME,
  status      ENUM('pending','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
  created_at  DATETIME DEFAULT NOW(),
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_status_due (status, due_date),
  INDEX idx_client     (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Pagos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT UNSIGNED NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  method      ENUM('cash','transfer','card','other') NOT NULL DEFAULT 'cash',
  reference   VARCHAR(255),
  paid_at     DATETIME DEFAULT NOW(),
  notes       TEXT,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Log de eventos por cliente ────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_events (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED NOT NULL,
  event_type  ENUM('suspension','reactivation','plan_change','payment','note','other') NOT NULL,
  description TEXT,
  created_at  DATETIME DEFAULT NOW(),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_client_events (client_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Usuarios del sistema (admins/operadores) ──────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','operator','viewer') NOT NULL DEFAULT 'operator',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  last_login    DATETIME,
  created_at    DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Configuración del sistema ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  description   VARCHAR(500),
  updated_at    DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Plugins registrados ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plugins (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  version     VARCHAR(20),
  description TEXT,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  config      JSON,
  installed_at DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Datos iniciales ────────────────────────────────────────────────

-- Plan de ejemplo
INSERT IGNORE INTO plans (id, name, description, price, speed_down_mbps, speed_up_mbps, mikrotik_profile)
VALUES 
  (1, 'Básico 5/2',   'Plan básico 5 Mbps bajada / 2 Mbps subida', 19.99,  5,  2, 'plan-basic'),
  (2, 'Estándar 10/5','Plan estándar 10 Mbps / 5 Mbps',             34.99, 10,  5, 'plan-standard'),
  (3, 'Pro 25/10',    'Plan profesional 25 Mbps / 10 Mbps',         54.99, 25, 10, 'plan-pro'),
  (4, 'Ultra 50/20',  'Plan ultra 50 Mbps / 20 Mbps',               89.99, 50, 20, 'plan-ultra');

-- Configuración por defecto
INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
  ('company_name',        'Mi WISP',         'Nombre de la empresa'),
  ('currency',            'USD',             'Moneda del sistema'),
  ('billing_day',         '1',               'Día del mes para generar facturas'),
  ('grace_days',          '5',               'Días de gracia después del vencimiento'),
  ('suspension_enabled',  'true',            'Activar suspensión automática'),
  ('smtp_enabled',        'false',           'Activar notificaciones por email');

-- Usuario admin por defecto (contraseña: Admin@1234 - CAMBIAR en primer login)
-- Hash bcrypt de 'Admin@1234'
INSERT IGNORE INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@wisp.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewMDmqPnUCBoNxWS', 'admin');
