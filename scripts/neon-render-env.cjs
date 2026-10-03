const fs = require('node:fs');
const { parseEnv } = require('node:util');

const source = process.argv[2] || '.env.local';
const destination = '.env.render';
const env = parseEnv(fs.readFileSync(source, 'utf8'));
// NocoDB runs migrations on startup; use Neon's direct connection.
const input = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!input) throw new Error(`${source} has no Neon database URL; run neon deploy.`);

const database = new URL(input);
if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
  throw new Error('Expected a PostgreSQL connection URL.');
}

const user = decodeURIComponent(database.username);
const password = decodeURIComponent(database.password);
const name = decodeURIComponent(database.pathname.slice(1));
if (!database.hostname || !user || !password || !name) {
  throw new Error('Database URL must include a host, user, password, and database.');
}

const connection = new URL(`pg://${database.hostname}:${database.port || 5432}`);
connection.searchParams.set('u', user);
connection.searchParams.set('p', password);
connection.searchParams.set('d', name);
connection.searchParams.set('connection.ssl', 'true');

fs.writeFileSync(destination, `NC_DB=${connection.href}\n`, { mode: 0o600 });
fs.chmodSync(destination, 0o600);
console.log(`Wrote ${destination}. Import it into Render; keep it out of Git.`);
