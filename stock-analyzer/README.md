# Stock 200-Week Moving Average Analyzer

Real-time dashboard that flags stocks in the **Dow Jones Industrial Average**, **S&P 500**, and **NASDAQ-100** that are trading at or below their **200-week simple moving average** — a widely-watched long-term support level.

## Quick Start

```bash
cd stock-analyzer
npm install
npm start          # launches the web dashboard on http://localhost:3000
```

## How It Works

1. **Initial scan** — fetches 200 weeks of weekly closing prices for every constituent in the three indexes (~550 unique symbols), calculates each stock's 200-week simple moving average, and compares it to the current price.
2. **Flagging** — any stock whose current price is at or below its 200-week MA is flagged and shown on the dashboard.
3. **Live refresh** — flagged stocks (plus those within 5% of their MA) are re-quoted every 60 seconds via WebSocket push.
4. **Full re-scan** — every 4 hours the complete dataset is recalculated to capture moving average drift.

## Dashboard Features

- **Summary cards** — total stocks tracked, total flagged, per-index flagged counts
- **Search & filter** — filter by symbol/name, index, or sort by % from MA, price, market cap, etc.
- **Live progress bar** — shows scan progress during the initial load
- **WebSocket updates** — prices update automatically, no manual refresh needed

## CLI Mode

Run a one-shot analysis without the web server:

```bash
npm run fetch
```

Prints a table of all stocks at or below their 200-week MA.

## Configuration (Environment Variables)

| Variable         | Default   | Description                              |
|------------------|-----------|------------------------------------------|
| `PORT`           | `3000`    | HTTP server port                         |
| `QUOTE_INTERVAL` | `60000`   | ms between quote refreshes for flagged   |
| `SCAN_INTERVAL`  | `14400000`| ms between full re-scans (4 hours)       |
| `BATCH_SIZE`     | `5`       | concurrent API requests per batch        |
| `DELAY_MS`       | `600`     | delay between batches (rate limiting)    |

## Data Source

All market data is fetched from Yahoo Finance via the `yahoo-finance2` library. Quotes may be delayed up to 15 minutes depending on the exchange.
