const http = require('node:http');

const request = http.get(
  {
    hostname: '127.0.0.1',
    port: process.env.PORT || 8080,
    path: '/api/v1/health',
    timeout: 4000,
  },
  (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  },
);
request.on('timeout', () =>
  request.destroy(new Error('Health check timed out')),
);
request.on('error', () => {
  process.exitCode = 1;
});
