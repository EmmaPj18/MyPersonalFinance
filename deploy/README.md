# Despliegue en el Home Server (Portainer)

Cada merge a `main` ejecuta `.github/workflows/deploy.yml`:

1. **CI**: typecheck, tests (con Postgres) y build.
2. **Imágenes**: `ghcr.io/emmapj18/mypersonalfinance-api` y `-web` (`linux/amd64`, la arquitectura del servidor), tags `latest` y `sha-<commit>`.
3. **Deploy**: `deploy/portainer-deploy.sh` crea o actualiza el stack `mypersonalfinance` en Portainer con `deploy/docker-compose.server.yml`, el tag nuevo y `pullImage`.
4. **Salud**: espera a que `${APP_URL}/api/health` responda.

Los PRs solo corren CI (`.github/workflows/ci.yml`).

## Configuración (una vez)

### Portainer
- Mi cuenta → **Access tokens** → crear token.
- ID del environment: el número en la URL al abrirlo (`/#!/<ID>/docker/dashboard`).

### GitHub → Settings → Environments → `production`
| Tipo | Nombre | Valor |
| --- | --- | --- |
| Secret | `PORTAINER_URL` | `https://docker.emmapj18.dev` |
| Secret | `PORTAINER_API_KEY` | token de Portainer |
| Secret | `PORTAINER_ENDPOINT_ID` | ID del environment |
| Secret | `POSTGRES_PASSWORD` | contraseña larga aleatoria |
| Secret | `SESSION_SECRET` | `openssl rand -base64 48` |
| Variable | `APP_URL` | `https://mpf.emmapj18.dev` |
| Variable | `WEB_PORT` | puerto del servidor para la web (por defecto `8085`) |

`POSTGRES_PASSWORD` solo se usa al crear la base; cambiarlo después no cambia la contraseña ya creada.

### Cloudflare Tunnel
Zero Trust → Networks → Tunnels → tu túnel → **Public hostname**: `mpf.emmapj18.dev` → `HTTP` → `<ip-del-servidor>:8085`.

### Imágenes en GHCR
Si tras el primer build Portainer no puede descargar las imágenes, en GitHub → Packages → cada paquete → *Package settings* → **Change visibility → Public** (o registra `ghcr.io` en Portainer con un token `read:packages`).

## Probar sin desplegar
```sh
PORTAINER_URL=… PORTAINER_API_KEY=… PORTAINER_ENDPOINT_ID=… APP_IMAGE_TAG=latest deploy/portainer-deploy.sh --dry-run
```

## Migrar datos al servidor
```sh
./scripts/backup.sh                                   # respaldo del Docker local
PORTAINER_URL=… PORTAINER_API_KEY=… PORTAINER_ENDPOINT_ID=… \
  deploy/restore-remote.sh backups/mypersonalfinance-<fecha>.sql.gz
```
Reemplaza la base del servidor por el respaldo (detiene la API, restaura y la vuelve a iniciar). Luego apaga el stack local con `docker compose down` para tener una sola fuente de verdad.

## Respaldos en el servidor
Desde la consola del contenedor `db` en Portainer:
```sh
pg_dump -U mypersonalfinance mypersonalfinance | gzip > /var/lib/postgresql/data/backup-$(date +%F).sql.gz
```
