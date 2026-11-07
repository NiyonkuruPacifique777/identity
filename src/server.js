import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { config } from './config.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Identity API listening on port ${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async error => {
    if (error) {
      console.error('HTTP server shutdown failed:', error);
      process.exitCode = 1;
    }
    await pool.end();
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
