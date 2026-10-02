import dns from 'node:dns';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import Noco from '~/Noco';
import { handleUncaughtErrors } from '~/utils';
handleUncaughtErrors(process);

// ref: https://github.com/nodejs/node/issues/40702#issuecomment-1103623246
dns.setDefaultResultOrder('ipv4first');

const server = express();
server.enable('trust proxy');
server.use(cors());

server.set('view engine', 'ejs');

(async () => {
  const httpServer = createServer(server);
  server.use(await Noco.init({}, httpServer, server));
  httpServer.listen(process.env.PORT || 8080);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
