# NocoDB

A database application with a spreadsheet interface, REST APIs, and PostgreSQL,
MySQL, and SQLite support.

This checkout removes promotional UI and automatic vendor telemetry, and improves
metadata loading and grid rendering. See [cleanup and performance changes](docs/cleanup-and-performance.md).

## Docker

Build and run this checkout with persistent SQLite storage:

```sh
docker compose up --build -d
```

Open <http://localhost:8080>. To build the image separately:

```sh
docker build --target runtime -t nocodb-clean:local .
```

See [Docker build and runtime configuration](docs/docker.md) for storage, database
configuration, caching, and platform builds. Upstream images do not include this
checkout's changes.

## Development

The workspace uses pnpm and Node 24.14.0. Frontend and backend development commands
are `pnpm start:frontend` and `pnpm start:backend` after installing dependencies and
building the SDKs. Docker builds install and compile everything inside the container.

## License

See [Sustainable Use License](LICENSE.md).
