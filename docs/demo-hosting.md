# Free demo on Render with Neon

Neon stores the database. Render runs this checkout's Docker image, which includes
both NocoDB and its frontend. `neon deploy` applies the database configuration;
it does not publish the application.

## Neon setup

This workspace is linked locally to project `young-cake-13379570`, branch
`production`. The context (`.neon`) and credentials (`.env.local`) are ignored by
Git. Another checkout needs its own link:

```sh
neon login
neon link --project-id young-cake-13379570 --branch production -y
neon deploy
node scripts/neon-render-env.cjs
```

The script converts Neon's direct PostgreSQL URL to NocoDB's `NC_DB` format with
SSL enabled. It writes `.env.render` with owner-only permissions and does not
print the credentials. Re-running it replaces that file. If Neon wrote `.env`
instead, pass that filename as the script's argument.

## Render setup

1. Make this branch available in GitHub and connect the repository to Render.
2. In the [Render dashboard](https://dashboard.render.com/), select **New →
   Blueprint**, choose the repository and this branch, and use `render.yaml`.
3. For the prompted `NC_DB`, copy the value after `NC_DB=` in the local
   `.env.render` file. Keep this value in Render's environment settings.
4. Confirm the service uses the **Free** plan and deploy.
5. Open the assigned HTTPS URL and register the first NocoDB administrator before
   sharing the demo.

The Blueprint generates a stable JWT secret and sets `NC_SITE_URL` to the
service's assigned URL. It uses Virginia, near this Neon project's AWS US East
region, and limits the application's database pool to five connections. NocoDB
creates its tables in the linked production database on first startup.

For manual **New → Web Service** setup, choose Docker, the repository root as the
build context, `./Dockerfile`, the Free plan, and `/api/v1/health` as the health
check. Import `.env.render`, set `PORT=8080`, `NC_DB_POOL_MAX=5`, a fixed random
`NC_AUTH_JWT_SECRET`, and `NC_SITE_URL` to the assigned HTTPS URL.

## Free-plan limits

Render's [free web services](https://render.com/docs/free) sleep after 15 minutes
without traffic, and the next request takes roughly a minute to wake the app.
Database records persist in Neon; local attachments are lost when Render
restarts or sleeps. Configure external attachment storage before relying on
uploads.

This checkout's frontend build needs roughly 8 GB of builder memory. If Render's
builder cannot complete it, build a Linux AMD64 image locally and deploy that
image from a registry instead (see [Docker instructions](docker.md)). The free
runtime's memory capacity still needs verification with this application.

The [Neon Free plan](https://neon.com/pricing) also has storage and compute limits.
The OAuth MCP connection in `.codex/config.toml` needs sign-in through Codex on
first use; CLI sign-in does not authenticate that connection.
