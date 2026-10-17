# MyPersonalFinance

Presupuesto personal y familiar: ingresos con desglose **bruto / neto** (impuestos, seguridad social y otros descuentos), bonos, freelance e ingresos comunes del hogar (inversiones, ahorros); gastos **fijos y corrientes**, **comunes o personales** con reparto entre miembros y cambio de dueño; presupuesto mensual, metas de ahorro, deudas y reportes multi-moneda (DOP, USD, EUR).

## Stack

| Parte | Tecnología |
| --- | --- |
| Web | React 19, Vite, React Router, TanStack Query, Tailwind CSS 4, Recharts |
| API | Fastify 5, TypeScript, Zod, Drizzle ORM |
| Base de datos | PostgreSQL 16 |
| Deploy | Docker Compose (`db`, `api`, `web` con nginx) |

Monorepo con pnpm:

```
apps/api         API Fastify (src/modules/<módulo>/routes.ts) + migraciones en apps/api/drizzle
apps/web         SPA React (src/pages/…)
packages/shared  Esquemas zod, constantes y helpers de dinero compartidos
```

## Conceptos

- **Hogar**: cada usuario pertenece a un solo hogar a la vez. Al registrarse se crea uno; desde Configuración → Hogar se invita a otras personas (enlace). Un usuario puede **salir** del hogar o aceptar una invitación a otro: se lleva sus datos personales (cuentas, fuentes de ingreso, gastos personales, metas y deudas propias) y lo común se queda.
- **Roles**: dueño (configura el hogar y miembros), miembro (registra datos), solo lectura.
- **Privacidad**: en modo "Solo totales", lo personal de cada miembro no se ve en detalle pero cuenta en los resúmenes del hogar.
- **Ingresos**: cada fuente (empleo formal, freelance, inversión…) es personal o del hogar. Cada pago guarda bruto, descuentos (ISR, AFP, SFS…) y el neto calculado. Las fuentes pueden tener una plantilla de descuentos que se precarga en cada pago.
- **Gastos**: `fijo` (generado cada mes desde una plantilla, queda pendiente hasta marcarlo pagado) o `corriente`; `del hogar` (con reparto %) o `personal`. El dueño puede cambiarse (persona ↔ persona ↔ hogar) y queda historial.
- **Moneda**: cada movimiento tiene su moneda; cada perfil tiene una moneda por defecto. Los reportes convierten con las tasas cargadas en Configuración → Tasas de cambio (tasa más reciente en o antes de la fecha del movimiento; inversa y triangulación automáticas). Si falta una tasa se avisa en vez de adivinar.

## Desarrollo local

Requisitos: Node 22+, pnpm 12, Docker.

```sh
cp .env.example .env          # ajusta SESSION_SECRET
pnpm install
pnpm db:up                    # Postgres de desarrollo en :5432
pnpm --filter @mypersonalfinance/api db:migrate
pnpm dev                      # API :3000 + web :5173 (proxy /api)
```

Abre http://localhost:5173 y crea tu cuenta.

### Tests

```sh
docker exec mypersonalfinance-dev-db-1 psql -U mypersonalfinance -c "create database mypersonalfinance_test"  # una vez
pnpm test         # shared (dinero), api (integración contra Postgres) y web (componentes)
pnpm typecheck
```

### Cambios en la base de datos

Edita `apps/api/src/db/schema.ts` y genera la migración:

```sh
pnpm --filter @mypersonalfinance/api db:generate
```

## Despliegue en el Home Server (CI/CD)

Cada merge a `main` pasa CI, publica las imágenes en GHCR y actualiza el stack en Portainer; la app queda en https://mpf.emmapj18.dev. Configuración, migración de datos y respaldos: [`deploy/README.md`](deploy/README.md).

## Producción con Docker (local)

1. En `.env` define al menos `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -base64 48`), `WEB_ORIGIN` (URL pública, usada en los enlaces de invitación) y `WEB_PORT`. Si se sirve por HTTPS, `COOKIE_SECURE=true`.
2. Construye y levanta:

   ```sh
   docker compose up -d --build
   ```

   La API aplica las migraciones al arrancar. La web queda en `http://<host>:${WEB_PORT}` (nginx sirve la SPA y hace proxy de `/api` a la API). Postgres no se expone fuera de la red de Docker.

3. Respaldos:

   ```sh
   ./scripts/backup.sh                      # backups/mypersonalfinance-<fecha>.sql.gz
   ./scripts/restore.sh backups/<archivo>   # restaura
   ```
