import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const QUOTE_INTERVAL = parseInt(process.env.QUOTE_INTERVAL, 10) || 60_000;
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL, 10) || 4 * 60 * 60_000;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 5;
const DELAY_MS = parseInt(process.env.DELAY_MS, 10) || 600;

const srv = createServer({
  port: PORT,
  quoteIntervalMs: QUOTE_INTERVAL,
  fullScanIntervalMs: SCAN_INTERVAL,
  batchSize: BATCH_SIZE,
  delayMs: DELAY_MS,
});

srv.start().then(() => {
  console.log('  Configuration:');
  console.log(`    Quote refresh : every ${QUOTE_INTERVAL / 1000}s`);
  console.log(`    Full re-scan  : every ${SCAN_INTERVAL / 3600000}h`);
  console.log(`    Batch size    : ${BATCH_SIZE}`);
  console.log(`    Batch delay   : ${DELAY_MS}ms\n`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  srv.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  srv.stop();
  process.exit(0);
});
