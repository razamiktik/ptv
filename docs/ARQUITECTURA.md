# WISP System — Documentación Técnica

> Sistema de gestión para proveedores de internet inalámbrico (WISP).  
> Autoalojado · Docker · Compatible Windows & Linux · Integración Mikrotik RouterOS

---

## Estructura del Proyecto

```
wisp-system/
│
├── docker-compose.yml          ← Orquestación de todos los servicios
├── .env.example                ← Plantilla de variables de entorno
├── install.sh                  ← Instalador Linux (Ubuntu/Debian/CentOS)
├── install.ps1                 ← Instalador Windows (PowerShell)
│
├── api-core/                   ← Backend Node.js 20 + Express
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── app.js              ← Entry point + carga de plugins
│   │   ├── routes/             ← Rutas de la API REST
│   │   ├── services/
│   │   │   ├── mikrotik.service.js   ← Capa abstracción RouterOS
│   │   │   └── billing.service.js    ← Facturación y cortes
│   │   ├── controllers/
│   │   ├── models/
│   │   └── middleware/
│   └── plugins/                ← Carpeta para plugins de usuario
│       └── whatsapp-notify.example.js
│
├── web-ui/                     ← Frontend React + Vite + Tailwind CSS
│   ├── Dockerfile
│   └── src/
│       ├── pages/              ← Dashboard, Clientes, Facturas, etc.
│       └── components/
│
├── mikrotik-worker/            ← Worker de tareas programadas
│   ├── Dockerfile
│   └── src/
│       └── worker.js           ← Cron jobs: facturación, cortes, sync
│
├── db/
│   └── init/
│       └── 01_schema.sql       ← Schema inicial (solo en primera ejecución)
│
├── nginx/
│   └── nginx.conf              ← Reverse proxy: /api → backend, / → frontend
│
└── scripts/
    ├── update.sh               ← Actualización Linux (con backup automático)
    └── update.ps1              ← Actualización Windows
```

---

## Arquitectura de Servicios

```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│  nginx:80  (Reverse Proxy + SSL)        │  RED: wisp-public
│  /api/* → api-core:3000                 │
│  /*     → web-ui:80                     │
└──────────────┬──────────────────────────┘
               │
     ┌─────────┴─────────┐
     ▼                   ▼
┌─────────────┐    ┌────────────┐
│  api-core   │    │  web-ui    │
│  Node.js    │    │  React SPA │
│  Express    │    │  (Nginx)   │
└──────┬──────┘    └────────────┘
       │
  ┌────┴────────────────────┐
  │     RED: wisp-internal  │  (aislada, sin salida a internet)
  ▼                         ▼
┌──────────────┐    ┌───────────────────┐
│  db          │    │  mikrotik-worker  │
│  MariaDB     │    │  Cron Jobs        │
│  10.11 LTS   │    │  + node-routeros  │
└──────────────┘    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    │   RED: wisp-mikrotik│
                    ▼
              ┌─────────────┐
              │  Mikrotik   │
              │  RouterOS   │
              │  (externo)  │
              └─────────────┘
```

---

## Persistencia de Datos — Volúmenes Docker

**Esta es la parte más crítica.** Los datos nunca deben perderse al actualizar.

### Volúmenes declarados en docker-compose.yml

| Volumen       | Contenido                          | Riesgo si se borra           |
|---------------|------------------------------------|------------------------------|
| `db-data`     | Todos los datos MariaDB (clientes, facturas, pagos) | **CRÍTICO — pérdida total** |
| `api-logs`    | Logs del sistema                   | Sin riesgo de datos          |
| `plugin-data` | Datos extras de plugins            | Bajo                         |

### Por qué los datos son seguros durante actualizaciones

```yaml
# docker-compose.yml
volumes:
  db-data:        # ← Este volumen existe independientemente de los contenedores
    driver: local

services:
  db:
    volumes:
      - db-data:/var/lib/mysql   # ← MariaDB guarda aquí todos sus datos
```

**Cuando ejecutas `docker compose up -d` o `./scripts/update.sh`:**
1. El volumen `db-data` **NO se borra**. Existe en el host de Docker.
2. El contenedor `db` se reinicia/actualiza pero monta el mismo volumen.
3. Los datos persisten aunque borres y recreees el contenedor.

**La única forma de perder datos es ejecutar explícitamente:**
```bash
docker compose down -v   # ← El flag -v borra los volúmenes. ¡NUNCA usar en producción!
```

### Ubicación física de los datos en el host

```bash
# Linux
/var/lib/docker/volumes/wisp-system_db-data/_data/

# Windows (Docker Desktop con WSL2)
\\wsl$\docker-desktop-data\version-pack-data\community\docker\volumes\wisp-system_db-data\
```

---

## Sistema de Plugins

Los plugins permiten extender el sistema sin modificar el código base.

### Cómo crear un plugin

1. Crea un archivo `.js` en `/api-core/plugins/`:

```javascript
// /api-core/plugins/mi-plugin.js

export const meta = {
  name: 'mi-plugin',
  version: '1.0.0',
};

// Función OBLIGATORIA: register(app, db)
export function register(app, db) {
  // Agregar rutas nuevas
  app.get('/api/plugins/mi-plugin/datos', async (req, res) => {
    const datos = await db.query('SELECT * FROM clients LIMIT 10');
    res.json(datos);
  });

  // Escuchar eventos del sistema
  if (app.locals.events) {
    app.locals.events.on('client:suspended', ({ client }) => {
      console.log(`Plugin: cliente suspendido: ${client.full_name}`);
    });
  }
}
```

2. El sistema detecta y carga el plugin automáticamente al reiniciar.

### Eventos disponibles

| Evento                | Payload                         |
|-----------------------|---------------------------------|
| `client:suspended`    | `{ client, invoice }`           |
| `client:reactivated`  | `{ client }`                    |
| `invoice:created`     | `{ client, invoice }`           |
| `payment:recorded`    | `{ client, invoice, payment }`  |

---

## Mikrotik Worker — Tareas Programadas

| Tarea                     | Frecuencia              | Descripción                                    |
|---------------------------|-------------------------|------------------------------------------------|
| Ciclo de facturación      | Configurable (default 1h) | Suspende clientes con facturas vencidas       |
| Generación de facturas    | Día 1 de cada mes       | Crea facturas mensuales automáticamente        |
| Sincronización Mikrotik   | Cada 15 minutos         | Verifica sesiones activas, actualiza estado    |

---

## Comandos Útiles

```bash
# Iniciar sistema
docker compose up -d

# Ver logs en tiempo real
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f api-core

# Actualizar (con backup automático)
./scripts/update.sh         # Linux
.\scripts\update.ps1        # Windows

# Backup manual de la BD
docker compose exec db mysqldump -uwispuser -p wispdb > backup.sql

# Restaurar backup
docker compose exec -T db mysql -uwispuser -p wispdb < backup.sql

# Reiniciar solo un servicio
docker compose restart api-core

# Ingresar al contenedor de la API
docker compose exec api-core sh

# Ver estado de todos los servicios
docker compose ps
```

---

## Seguridad — Recomendaciones

1. **Nunca expongas el puerto de la BD** (3306) al exterior. El servicio `db` está en red interna.
2. **El Worker de Mikrotik** está en una red aislada (`wisp-mikrotik`). Si el router está en ubicación remota, agrega WireGuard:
   ```yaml
   mikrotik-worker:
     cap_add:
       - NET_ADMIN
   ```
3. **Cambia las contraseñas** del `.env` después de la instalación.
4. **Habilita HTTPS** descomentando el bloque SSL en `nginx/nginx.conf`.
5. **Permisos del `.env`**: El instalador automáticamente aplica `chmod 600`.

---

## Variables de Entorno Clave

| Variable                  | Descripción                                    |
|---------------------------|------------------------------------------------|
| `MIKROTIK_HOST`           | IP del router Mikrotik                         |
| `BILLING_CHECK_INTERVAL`  | Segundos entre ciclos de corte (default: 3600) |
| `JWT_SECRET`              | Clave para tokens JWT (generada automáticamente)|
| `WORKER_SECRET_KEY`       | Clave interna Worker↔API (generada auto)       |
| `SMTP_HOST`               | Servidor de correo para notificaciones         |
