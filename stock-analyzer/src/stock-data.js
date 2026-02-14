const WEEKS_NEEDED = 200;

const YF_CHART_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Shared cookie jar — populated on first request
let _cookie = null;

async function ensureCookie() {
  if (_cookie) return;
  try {
    const res = await fetch('https://fc.yahoo.com', {
      headers: HEADERS,
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      _cookie = setCookie.split(';')[0];
    }
  } catch {
    // Continue without cookie — chart API often works without one
  }
}

function buildHeaders() {
  const h = { ...HEADERS };
  if (_cookie) h['Cookie'] = _cookie;
  return h;
}

/**
 * Fetch weekly chart data for a symbol. Returns both the 200-week MA
 * and current quote data from a single API call.
 */
export async function fetchStockData(symbol) {
  await ensureCookie();

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - WEEKS_NEEDED * 7 - 70);
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(now.getTime() / 1000);

  const url = `${YF_CHART_BASE}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1wk`;

  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    throw new Error(`Yahoo chart API returned ${res.status} for ${symbol}`);
  }

  const data = await res.json();
  const chartResult = data?.chart?.result?.[0];
  if (!chartResult) return null;

  const meta = chartResult.meta || {};
  const closes = chartResult.indicators?.quote?.[0]?.close;

  // --- Moving average ---
  let maData = null;
  if (closes) {
    const validCloses = closes.filter((c) => c != null);
    if (validCloses.length >= WEEKS_NEEDED) {
      const recent200 = validCloses.slice(-WEEKS_NEEDED);
      const sum = recent200.reduce((acc, c) => acc + c, 0);
      maData = {
        ma200w: Math.round((sum / WEEKS_NEEDED) * 100) / 100,
        weeklyCloses: recent200.length,
      };
    }
  }

  // --- Quote data from chart meta ---
  const price = meta.regularMarketPrice ?? null;
  const previousClose = meta.previousClose ?? null;
  const quoteData = {
    price,
    change: price != null && previousClose != null ? Math.round((price - previousClose) * 100) / 100 : null,
    changePercent:
      price != null && previousClose != null && previousClose !== 0
        ? Math.round(((price - previousClose) / previousClose) * 10000) / 100
        : null,
    volume: meta.regularMarketVolume ?? null,
    previousClose,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    marketCap: null, // not available in chart meta
    marketState: null,
  };

  return { maData, quoteData };
}

/**
 * Fetch a quick quote refresh for a single symbol using a short-range chart call.
 */
export async function fetchQuote(symbol) {
  await ensureCookie();

  const url = `${YF_CHART_BASE}/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    throw new Error(`Yahoo chart API returned ${res.status} for ${symbol}`);
  }

  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No chart data for ${symbol}`);

  const price = meta.regularMarketPrice ?? null;
  const previousClose = meta.previousClose ?? null;

  return {
    price,
    change: price != null && previousClose != null ? Math.round((price - previousClose) * 100) / 100 : null,
    changePercent:
      price != null && previousClose != null && previousClose !== 0
        ? Math.round(((price - previousClose) / previousClose) * 10000) / 100
        : null,
    volume: meta.regularMarketVolume ?? null,
    previousClose,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    marketCap: null,
    marketState: null,
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
        const data = await fetchStockData(stock.symbol);
        return { stock, data };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        const { stock, data } = r.value;
        if (data && data.maData && data.quoteData && data.quoteData.price != null) {
          const { maData, quoteData } = data;
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
