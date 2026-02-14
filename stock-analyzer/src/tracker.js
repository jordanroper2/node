import EventEmitter from 'events';
import { analyzeAll, fetchQuote, fetchStockData } from './stock-data.js';
import { buildMasterList } from './constituents.js';

const INDEX_TICKERS = [
  { symbol: '^DJI', name: 'Dow Jones Industrial Average' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ Composite' },
];

export class StockTracker extends EventEmitter {
  constructor(opts = {}) {
    super();
    // How often to refresh quotes for flagged stocks (default 60 s)
    this.quoteIntervalMs = opts.quoteIntervalMs || 60_000;
    // How often to do a full re-scan of all stocks (default 4 hours)
    this.fullScanIntervalMs = opts.fullScanIntervalMs || 4 * 60 * 60_000;
    this.batchSize = opts.batchSize || 5;
    this.delayMs = opts.delayMs || 600;

    this.masterList = buildMasterList();
    // Map<symbol, entry> for stocks currently at or below 200w MA
    this.flagged = new Map();
    // Map<symbol, entry> for all analyzed stocks (above or below)
    this.all = new Map();
    // Index-level 200w MA data
    this.indexes = new Map();

    this._quoteTimer = null;
    this._scanTimer = null;
    this._running = false;
  }

  /** Run the initial full scan, then start periodic refresh loops. */
  async start() {
    this._running = true;
    this.emit('status', 'Starting initial full scan...');
    await this._fullScan();
    this.emit('status', 'Initial scan complete. Starting live tracking.');

    // Periodic quick-quote refresh for flagged stocks
    this._quoteTimer = setInterval(() => {
      if (this._running) this._refreshFlaggedQuotes();
    }, this.quoteIntervalMs);

    // Periodic full re-scan
    this._scanTimer = setInterval(() => {
      if (this._running) this._fullScan();
    }, this.fullScanIntervalMs);
  }

  stop() {
    this._running = false;
    clearInterval(this._quoteTimer);
    clearInterval(this._scanTimer);
    this.emit('status', 'Tracker stopped.');
  }

  /** Fetch 200w MA data for the 3 major index tickers. */
  async _scanIndexes() {
    for (const idx of INDEX_TICKERS) {
      try {
        const data = await fetchStockData(idx.symbol);
        if (data && data.maData && data.quoteData && data.quoteData.price != null) {
          const { maData, quoteData } = data;
          this.indexes.set(idx.symbol, {
            symbol: idx.symbol,
            name: idx.name,
            price: quoteData.price,
            ma200w: maData.ma200w,
            pctFromMA: Math.round(((quoteData.price - maData.ma200w) / maData.ma200w) * 10000) / 100,
            atOrBelowMA: quoteData.price <= maData.ma200w,
            change: quoteData.change,
            changePercent: quoteData.changePercent,
            dayHigh: quoteData.dayHigh,
            dayLow: quoteData.dayLow,
            fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow,
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(`[tracker] Error fetching index ${idx.symbol}: ${err.message}`);
      }
    }
  }

  /** Full scan: fetch 200w MA + quote for every constituent. */
  async _fullScan() {
    this.emit('scan:start', this.masterList.length);

    // Scan indexes in parallel with the stock scan start
    const indexPromise = this._scanIndexes();

    const { results, errors } = await analyzeAll(this.masterList, {
      batchSize: this.batchSize,
      delayMs: this.delayMs,
      onProgress: (done, total) => this.emit('scan:progress', done, total),
    });

    await indexPromise;

    this.all.clear();
    this.flagged.clear();

    for (const entry of results) {
      this.all.set(entry.symbol, entry);
      if (entry.atOrBelowMA) {
        this.flagged.set(entry.symbol, entry);
      }
    }

    this.emit('scan:complete', {
      total: results.length,
      flagged: this.flagged.size,
      errors: errors.length,
    });
    this.emit('update', this.getSnapshot());
  }

  /** Quick refresh: update only the quote for already-flagged stocks + borderline ones. */
  async _refreshFlaggedQuotes() {
    // Also re-check stocks within 5% of their MA
    const watchSymbols = [];
    for (const [, entry] of this.all) {
      if (entry.atOrBelowMA || Math.abs(entry.pctFromMA) <= 5) {
        watchSymbols.push(entry.symbol);
      }
    }

    if (watchSymbols.length === 0) return;

    this.emit('refresh:start', watchSymbols.length);

    for (let i = 0; i < watchSymbols.length; i += this.batchSize) {
      const batch = watchSymbols.slice(i, i + this.batchSize);
      const settled = await Promise.allSettled(
        batch.map(async (sym) => {
          const q = await fetchQuote(sym);
          return { symbol: sym, quote: q };
        })
      );

      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        const { symbol, quote } = r.value;
        const existing = this.all.get(symbol);
        if (!existing || quote.price == null) continue;

        existing.price = quote.price;
        existing.change = quote.change;
        existing.changePercent = quote.changePercent;
        existing.marketState = quote.marketState;
        existing.volume = quote.volume;
        existing.dayHigh = quote.dayHigh;
        existing.dayLow = quote.dayLow;
        existing.pctFromMA =
          Math.round(((quote.price - existing.ma200w) / existing.ma200w) * 10000) / 100;
        existing.atOrBelowMA = quote.price <= existing.ma200w;
        existing.lastUpdated = new Date().toISOString();

        if (existing.atOrBelowMA) {
          this.flagged.set(symbol, existing);
        } else {
          this.flagged.delete(symbol);
        }
      }

      if (i + this.batchSize < watchSymbols.length) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }

    // Also refresh index quotes
    for (const idx of INDEX_TICKERS) {
      try {
        const q = await fetchQuote(idx.symbol);
        const existing = this.indexes.get(idx.symbol);
        if (existing && q.price != null) {
          existing.price = q.price;
          existing.change = q.change;
          existing.changePercent = q.changePercent;
          existing.dayHigh = q.dayHigh;
          existing.dayLow = q.dayLow;
          existing.pctFromMA =
            Math.round(((q.price - existing.ma200w) / existing.ma200w) * 10000) / 100;
          existing.atOrBelowMA = q.price <= existing.ma200w;
          existing.lastUpdated = new Date().toISOString();
        }
      } catch {
        // ignore refresh errors for indexes
      }
    }

    this.emit('refresh:complete', watchSymbols.length);
    this.emit('update', this.getSnapshot());
  }

  /** Return a plain-object snapshot of current state. */
  getSnapshot() {
    const allArr = Array.from(this.all.values()).sort(
      (a, b) => a.pctFromMA - b.pctFromMA
    );
    return {
      timestamp: new Date().toISOString(),
      totalAnalyzed: this.all.size,
      totalFlagged: this.flagged.size,
      stocks: allArr,
      flagged: allArr, // kept for backward compat with any cached HTML
      indexes: Array.from(this.indexes.values()),
    };
  }
}
