# SmaDB

A database application with a spreadsheet interface, REST APIs, and PostgreSQL,
MySQL, and SQLite support.

SmaDB is maintained by [Sma-Das](https://github.com/Sma-Das/nocodb-clean) and is
derived from [NocoDB](https://github.com/nocodb/nocodb). It includes modifications
to the upstream software and is not an official NocoDB distribution.

This project removes promotional UI and automatic vendor telemetry, and improves
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

See [free demo hosting with Render and Neon](docs/demo-hosting.md) for the
deployment Blueprint and database setup.

## Development

The workspace uses pnpm and Node 24.14.0. Frontend and backend development commands
are `pnpm start:frontend` and `pnpm start:backend` after installing dependencies and
building the SDKs. Docker builds install and compile everything inside the container.

## License

This repository contains code under different licenses:

- Inherited NocoDB code remains under its **Sustainable Use License**, including
  its internal-business/non-commercial use and distribution restrictions.
- Original SmaDB work explicitly marked `SPDX-License-Identifier: Apache-2.0`
  is licensed under **Apache License 2.0**. This permits commercial use of that
  work, requires preservation of attribution and licensing notices, and includes
  patent provisions, warranty disclaimers, and limitations of liability.
- Third-party components retain their own licenses.

The application as a whole remains subject to the inherited restrictions.
Detaching this repository from GitHub's fork network does not change those terms.
See [licensing scope and inherited terms](LICENSE.md), the
[Apache 2.0 text](LICENSE-APACHE-2.0.txt), and [attribution notices](NOTICE).
