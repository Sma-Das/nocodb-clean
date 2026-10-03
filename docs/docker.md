# Building and running with Docker

Build this checkout and start it with persistent SQLite storage:

```sh
docker compose up --build -d
```

Open <http://localhost:8080>. View logs with `docker compose logs -f nocodb`.
`docker compose down` stops the service and preserves the `nocodb-data` volume.

To build or run without Compose:

```sh
docker build --target runtime -t nocodb-clean:local .
docker run -d --name nocodb-clean --init -p 8080:8080 \
  -v nocodb-data:/usr/app/data nocodb-clean:local
```

The image runs as the `node` user (UID 1000). Existing bind-mounted data directories
must be writable by that user. Named volumes in the examples initialize correctly.
The data directory contains the default SQLite database and local attachments.

Pass configuration at runtime, for example `-e NC_DB='pg://host:5432?u=user&p=password&d=nocodb'`
and `-e NC_AUTH_JWT_SECRET=...`, or use a private `--env-file`. Environment files
are excluded from the image build context. Compose can be extended with a local
override file for database configuration, ports, or secrets.

## Build stages and caching

The build uses Node 24.14.0 and pnpm 12.8.1. Both are pinned in the Dockerfile;
override deliberately with `--build-arg NODE_VERSION=...` or `--build-arg PNPM_VERSION=...`.
Dependencies use the committed lockfiles and patches.

- `dependencies` copies lockfiles, patches, and package manifests before source,
  then installs with the frozen lockfile. A BuildKit cache retains package downloads
  between builds. The installation prefers cached packages and can refill the
  store when a CI runner restores image layers without cache mounts.
  Install hooks are skipped; approved native dependencies are rebuilt across the
  workspace with Git hooks disabled.
- `sdk` compiles the checked-in SDK sources. Docker does not regenerate Swagger
  clients or download generators. Use the SDK `generate:sdk` scripts when updating
  API schemas, then commit the generated source.
- `frontend` generates the static Nuxt application.
- `backend` bundles the Docker server entry and integration core, then deploys
  production dependencies into a portable directory. The integration core uses
  its existing separate lockfile.
- `runtime` contains the server bundle, backend public assets, static frontend,
  and production dependencies. Nuxt, Rspack, pnpm, and system build tools remain
  in earlier stages. Node starts directly, and the health check calls `/api/v1/health`.

Frontend and backend stages share compiled SDKs and can run independently.
Source edits that leave dependencies unchanged rebuild only the affected stage.
Unchanged builds reuse completed layers.

Docker Desktop / BuildKit is required. Allow roughly 8 GB of builder memory for
the large frontend build. Runtime memory requirements depend on the workload.
Native dependencies are built for the requested platform. For multiple platforms:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --target runtime -t YOUR_REGISTRY/nocodb-clean:TAG --push .
```

The Dockerfile follows pnpm's [Docker caching guidance](https://pnpm.io/docker).
Deployment derives a portable production graph from the existing workspace lockfile.
The build adapts the legacy manifest settings to pnpm's current workspace settings
inside the container, preserving overrides, patches, and native-build approvals.

Convenience scripts: `pnpm docker:build`, `pnpm docker:up`, and `pnpm docker:down`.

## Verification

The Linux ARM64 image was built and run with Docker Desktop. Checks passed for
API readiness, login using an admin account retained across recreated containers,
SQLite volume storage, static frontend HTML and JavaScript, immutable asset caching,
disabled vendor-service flags, UID 1000, Sharp PNG generation, and Canvas PNG rendering.
Nuxt and Rspack are absent from the runtime. TypeScript remains an optional peer
dependency of Vue in the locked SDK production graph.

An unchanged rebuild reused all stages and completed in 2.08 seconds on this machine.
Production dependency deployment took 9.1 seconds using the locked graph. These
timings depend on hardware and cache state; the first build downloads dependencies.

The four readiness-probe tests cover success, unavailable service, refused connections,
and stalled responses:

```sh
node --test scripts/tests/docker-healthcheck.test.cjs
```

The 20 cleanup/performance regression checks also passed. Browser interaction,
external PostgreSQL/MySQL, and AMD64 execution were not tested.
