# NocoDB backend

Database service for the spreadsheet interface and REST APIs.

# Quick try

## Docker

```bash
# for SQLite
docker run -d --name nocodb \
-v "$(pwd)"/nocodb:/usr/app/data/ \
-p 8080:8080 \
nocodb/nocodb:latest


# for PostgreSQL
docker run -d --name nocodb-postgres \
-v "$(pwd)"/nocodb:/usr/app/data/ \
-p 8080:8080 \
-e NC_DB="pg://host.docker.internal:5432?u=root&p=password&d=d1" \
-e NC_AUTH_JWT_SECRET="569a1821-0a93-45e8-87ab-eb857f20a010" \
nocodb/nocodb:latest
```

> To persist data in docker you can mount volume at `/usr/app/data/` since 0.10.6. Otherwise your data will be lost after recreating the container.

> If you plan to input some special characters, you may need to change the character set and collation yourself when creating the database. Please check out the examples for [MySQL Docker](https://github.com/nocodb/nocodb/issues/1340#issuecomment-1049481043).

## Binaries

##### MacOS (x64)

```bash
curl http://get.nocodb.com/macos-x64 -o nocodb -L && chmod +x nocodb && ./nocodb
```

##### MacOS (arm64)

```bash
curl http://get.nocodb.com/macos-arm64 -o nocodb -L && chmod +x nocodb && ./nocodb
```

##### Linux (x64)

```bash
curl http://get.nocodb.com/linux-x64 -o nocodb -L && chmod +x nocodb && ./nocodb
```

##### Linux (arm64)

```bash
curl http://get.nocodb.com/linux-arm64 -o nocodb -L && chmod +x nocodb && ./nocodb
```

##### Windows (x64)

```bash
iwr http://get.nocodb.com/win-x64.exe
.\Noco-win-x64.exe
```

##### Windows (arm64)

```bash
iwr http://get.nocodb.com/win-arm64.exe
.\Noco-win-arm64.exe
```

## Docker Compose

We provide different docker-compose.yml files under [this directory](https://github.com/nocodb/nocodb/tree/master/docker-compose). Here are some examples.

```bash
git clone https://github.com/nocodb/nocodb
# for PostgreSQL
cd nocodb/docker-compose/2_pg
docker compose up -d
```

> To persist data in docker, you can mount volume at `/usr/app/data/` since 0.10.6. Otherwise your data will be lost after recreating the container.

> If you plan to input some special characters, you may need to change the character set and collation yourself when creating the database. Please check out the examples for [MySQL Docker Compose](https://github.com/nocodb/nocodb/issues/1313#issuecomment-1046625974).

# GUI

Access Dashboard using: [http://localhost:8080/dashboard](http://localhost:8080/dashboard)

# Screenshots

![1](https://user-images.githubusercontent.com/35857179/194844858-d353bd15-1edf-406c-889b-ba60f76831f4.png)
![2](https://user-images.githubusercontent.com/35857179/194844872-1a1094b9-761b-4ab6-a0ab-8e11dcae6571.png)
![3](https://user-images.githubusercontent.com/35857179/194844881-23f12c4c-7a5f-403e-928c-ef4c53b2665d.png)
![4](https://user-images.githubusercontent.com/35857179/194844885-faaf042f-bad2-4924-84f0-2c08813271d8.png)
![5](https://user-images.githubusercontent.com/35857179/194844886-a17006e0-979d-493f-83c4-0e72f5a9b716.png)
![6](https://user-images.githubusercontent.com/35857179/194844890-b9f265ae-6e40-4fa5-9267-d1367c27c8e6.png)
![7](https://user-images.githubusercontent.com/35857179/194844891-bee9aea3-aff3-4247-a918-b2f3fbbc672e.png)
![8](https://user-images.githubusercontent.com/35857179/194844893-82d5e21b-ae61-41bd-9990-31ad659bf490.png)
![9](https://user-images.githubusercontent.com/35857179/194844897-cfd79946-e413-4c97-b16d-eb4d7678bb79.png)
![10](https://user-images.githubusercontent.com/35857179/194844902-c0122570-0dd5-41cf-a26f-6f8d71fefc99.png)
![11](https://user-images.githubusercontent.com/35857179/194844903-c1e47f40-e782-4f5d-8dce-6449cc70b181.png)
![12](https://user-images.githubusercontent.com/35857179/194844907-09277d3e-cbbf-465c-9165-6afc4161e279.png)

# Table of Contents

- [Quick try](#quick-try)
  - [Docker](#docker)
  - [Docker Compose](#docker-compose)
- [GUI](#gui)
- [Screenshots](#screenshots)
- [Table of Contents](#table-of-contents)
- [Features](#features)
  - [Rich Spreadsheet Interface](#rich-spreadsheet-interface)
  - [App Store for Workflow Automations](#app-store-for-workflow-automations)
  - [Programmatic Access](#programmatic-access)
  - [Sync Schema](#sync-schema)
  - [Audit](#audit)
- [Production Setup](#production-setup)
  - [Environment variables](#environment-variables)
- [Development Setup](#development-setup)
- [Contributing](#contributing)
- [License](#license)

# Features

### Rich Spreadsheet Interface

- ⚡ &nbsp;Basic Operations: Create, Read, Update and Delete Tables, Columns, and Rows
- ⚡ &nbsp;Fields Operations: Sort, Filter, Hide / Unhide Columns
- ⚡ &nbsp;Multiple Views Types: Grid (By default), Gallery, Form View and Kanban View
- ⚡ &nbsp;View Permissions Types: Collaborative Views, & Locked Views
- ⚡ &nbsp;Share Bases / Views: either Public or Private (with Password Protected)
- ⚡ &nbsp;Variant Cell Types: ID, LinkToAnotherRecord, Lookup, Rollup, SingleLineText, Attachment, Currency, Formula, etc
- ⚡ &nbsp;Access Control with Roles: Fine-grained Access Control at different levels
- ⚡ &nbsp;and more ...

### App Store for Workflow Automations

We provide different integrations in three main categories. See <a href="https://docs.nocodb.com/setup-and-usages/account-settings#app-store" target="_blank">App Store</a> for details.

- ⚡ &nbsp;Chat: Slack, Discord, Mattermost, and etc
- ⚡ &nbsp;Email: AWS SES, SMTP, MailerSend, and etc
- ⚡ &nbsp;Storage: AWS S3, Google Cloud Storage, Minio, and etc

### Programmatic Access

We provide the following ways to let users programmatically invoke actions. You can use a token (either JWT or Social Auth) to sign your requests for authorization to NocoDB.

- ⚡ &nbsp;REST APIs
- ⚡ &nbsp;NocoDB SDK

### Sync Schema

We allow you to sync schema changes if you have made changes outside NocoDB GUI. However, it has to be noted then you will have to bring your own schema migrations for moving from one environment to another. See <a href="https://docs.nocodb.com/data-sources/sync-with-data-source" target="_blank">Sync Schema</a> for details.

### Audit

We are keeping all the user operation logs in one place. See <a href="https://docs.nocodb.com/data-sources/actions-on-data-sources/#audit-logs" target="_blank">Audit</a> for details.

# Production Setup

By default, SQLite is used for storing metadata. However, you can specify your database. The connection parameters for this database can be specified in `NC_DB` environment variable. Moreover, we also provide the below environment variables for configuration.

## Environment variables

Please refer to the [Environment variables](https://docs.nocodb.com/getting-started/self-hosted/environment-variables)

# Development Setup

Please refer to [Development Setup](https://docs.nocodb.com/engineering/development-setup)

# Contributing

Please refer to [Contribution Guide](https://github.com/nocodb/nocodb/blob/master/.github/CONTRIBUTING.md).

# License

<p>
This project is licensed under <a href="./LICENSE">Sustainable Use License</a>.
</p>
