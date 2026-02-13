import yahooFinance from 'yahoo-finance2';

const WEEKS_NEEDED = 200;

/**
 * Fetch weekly historical closes for a symbol going back at least 200 weeks
 * and return the 200-week simple moving average plus the latest weekly close.
 */
export async function fetchWeeklyMA(symbol) {
  const now = new Date();
  // Go back ~210 weeks (~4 years) to be safe
  const start = new Date(now);
  start.setDate(start.getDate() - WEEKS_NEEDED * 7 - 70);

  const startStr = start.toISOString().slice(0, 10);

  const result = await yahooFinance.historical(symbol, {
    period1: startStr,
    interval: '1wk',
  });

  if (!result || result.length < WEEKS_NEEDED) {
    return null; // Not enough history
  }

  // result is sorted oldest-first; take the last 200 entries
  const recent200 = result.slice(-WEEKS_NEEDED);
  const sum = recent200.reduce((acc, bar) => acc + bar.close, 0);
  const ma200w = sum / WEEKS_NEEDED;

  return {
    ma200w: Math.round(ma200w * 100) / 100,
    weeklyCloses: recent200.length,
  };
}

/**
 * Fetch a real-time / delayed quote for a single symbol.
 */
export async function fetchQuote(symbol) {
  const q = await yahooFinance.quote(symbol);
  return {
    price: q.regularMarketPrice,
    change: q.regularMarketChange,
    changePercent: q.regularMarketChangePercent,
    marketState: q.marketState,
    volume: q.regularMarketVolume,
    previousClose: q.regularMarketPreviousClose,
    dayHigh: q.regularMarketDayHigh,
    dayLow: q.regularMarketDayLow,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow,
    marketCap: q.marketCap,
  };
}

/**
 * For a list of stock entries [{ symbol, name, indexes }], compute
 * the 200-week MA and current price, returning those at or below MA.
 *
 * Processes in batches to avoid hammering the API.
 */
export async function analyzeAll(stocks, { onProgress, batchSize = 5, delayMs = 600 } = {}) {
  const results = [];
  const errors = [];

  for (let i = 0; i < stocks.length; i += batchSize) {
    const batch = stocks.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (stock) => {
        const [maData, quoteData] = await Promise.all([
          fetchWeeklyMA(stock.symbol),
          fetchQuote(stock.symbol),
        ]);
        return { stock, maData, quoteData };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        const { stock, maData, quoteData } = r.value;
        if (maData && quoteData && quoteData.price != null) {
          const entry = {
            symbol: stock.symbol,
            name: stock.name,
            indexes: stock.indexes,
            price: quoteData.price,
            ma200w: maData.ma200w,
            pctFromMA: Math.round(((quoteData.price - maData.ma200w) / maData.ma200w) * 10000) / 100,
            atOrBelowMA: quoteData.price <= maData.ma200w,
            change: quoteData.change,
            changePercent: quoteData.changePercent,
            marketState: quoteData.marketState,
            volume: quoteData.volume,
            previousClose: quoteData.previousClose,
            dayHigh: quoteData.dayHigh,
            dayLow: quoteData.dayLow,
            fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow,
            marketCap: quoteData.marketCap,
            lastUpdated: new Date().toISOString(),
          };
          results.push(entry);
        }
      } else {
        errors.push({ symbol: batch[0]?.symbol, error: r.reason?.message });
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, stocks.length), stocks.length);
    }

    // Rate-limit delay between batches
    if (i + batchSize < stocks.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { results, errors };
}
