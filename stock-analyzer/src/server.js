import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { StockTracker } from './tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(opts = {}) {
  const port = opts.port || 3000;
  const app = express();
  const server = http.createServer(app);

  // Serve static dashboard files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // WebSocket for live updates
  const wss = new WebSocketServer({ server });

  // Create the tracker
  const tracker = new StockTracker({
    quoteIntervalMs: opts.quoteIntervalMs || 60_000,
    fullScanIntervalMs: opts.fullScanIntervalMs || 4 * 60 * 60_000,
    batchSize: opts.batchSize || 5,
    delayMs: opts.delayMs || 600,
  });

  // REST endpoint for current snapshot
  app.get('/api/snapshot', (_req, res) => {
    res.json(tracker.getSnapshot());
  });

  app.get('/api/all', (_req, res) => {
    const all = Array.from(tracker.all.values()).sort(
      (a, b) => a.pctFromMA - b.pctFromMA
    );
    res.json({ timestamp: new Date().toISOString(), total: all.length, stocks: all });
  });

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  tracker.on('status', (msg) => {
    console.log(`[tracker] ${msg}`);
    broadcast('status', { message: msg });
  });

  tracker.on('scan:start', (total) => {
    console.log(`[tracker] Full scan starting — ${total} symbols`);
    broadcast('scan:start', { total });
  });

  tracker.on('scan:progress', (done, total) => {
    const pct = Math.round((done / total) * 100);
    process.stdout.write(`\r[tracker] Scanning... ${done}/${total} (${pct}%)`);
    broadcast('scan:progress', { done, total, pct });
  });

  tracker.on('scan:complete', (summary) => {
    console.log(
      `\n[tracker] Scan complete — ${summary.total} analyzed, ${summary.flagged} flagged, ${summary.errors} errors`
    );
    broadcast('scan:complete', summary);
  });

  tracker.on('refresh:start', (count) => {
    broadcast('refresh:start', { count });
  });

  tracker.on('refresh:complete', (count) => {
    broadcast('refresh:complete', { count });
  });

  tracker.on('update', (snapshot) => {
    broadcast('update', snapshot);
  });

  // Send current snapshot to newly connected clients
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'update', data: tracker.getSnapshot() }));
  });

  return {
    start() {
      return new Promise((resolve) => {
        server.listen(port, () => {
          console.log(`\n  Dashboard running at http://localhost:${port}\n`);
          tracker.start();
          resolve({ server, tracker });
        });
      });
    },
    stop() {
      tracker.stop();
      wss.close();
      server.close();
    },
  };
}
