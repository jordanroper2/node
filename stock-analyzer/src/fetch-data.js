import { buildMasterList } from './constituents.js';
import { analyzeAll } from './stock-data.js';

async function main() {
  const stocks = buildMasterList();
  console.log(`Analyzing ${stocks.length} unique stocks across DJIA, S&P 500, and NASDAQ-100...\n`);

  const { results, errors } = await analyzeAll(stocks, {
    batchSize: 5,
    delayMs: 600,
    onProgress(done, total) {
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%)`);
    },
  });

  console.log('\n');

  const flagged = results
    .filter((r) => r.atOrBelowMA)
    .sort((a, b) => a.pctFromMA - b.pctFromMA);

  if (flagged.length === 0) {
    console.log('No stocks are currently trading at or below their 200-week moving average.');
  } else {
    console.log(`=== ${flagged.length} stocks AT or BELOW their 200-week MA ===\n`);
    console.log(
      'Symbol'.padEnd(8) +
      'Price'.padStart(10) +
      '200w MA'.padStart(10) +
      '% From MA'.padStart(12) +
      '  Indexes'
    );
    console.log('-'.repeat(70));

    for (const s of flagged) {
      const sign = s.pctFromMA >= 0 ? '+' : '';
      console.log(
        s.symbol.padEnd(8) +
        `$${s.price.toFixed(2)}`.padStart(10) +
        `$${s.ma200w.toFixed(2)}`.padStart(10) +
        `${sign}${s.pctFromMA.toFixed(2)}%`.padStart(12) +
        `  ${s.indexes.join(', ')}`
      );
    }
  }

  if (errors.length > 0) {
    console.log(`\n${errors.length} symbols had errors and were skipped.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
