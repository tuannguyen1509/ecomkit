# Ecomkit - Vui Khỏe

Docker-first local foundation for ECOM-KIT. Stage 0 provides only the local PostgreSQL and Redis infrastructure required by later stages; application source is intentionally not scaffolded here.

## Requirements

- Docker with Docker Compose
- Git
- Node.js and npm (application scaffolding is planned for Stage 1)

## Configure environment

From this directory, copy `.env.example` to `.env` and adjust local-only values as needed:

```powershell
Copy-Item .env.example .env
```

`.env` is ignored by Git. Do not commit real passwords or tokens.

## Start infrastructure

```powershell
docker compose -p ecomkit-vuikhoe up -d
```

## Stop infrastructure

```powershell
docker compose -p ecomkit-vuikhoe down
```

The named volumes are preserved by `down`, so local data remains available on the next start.

## Inspect containers and logs

```powershell
docker compose -p ecomkit-vuikhoe ps
docker compose -p ecomkit-vuikhoe logs -f postgres
docker compose -p ecomkit-vuikhoe logs -f redis
```

## Test PostgreSQL

```powershell
docker compose -p ecomkit-vuikhoe exec -T postgres psql -U ecomkit -d ecomkit -c "SELECT 1;"
```

## Test Redis

```powershell
docker compose -p ecomkit-vuikhoe exec -T redis redis-cli PING
```

Services are connected to the private `ecomkit-network` Docker network and are not published to the host or Internet in Stage 0.
