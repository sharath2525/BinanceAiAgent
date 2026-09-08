import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ── BINANCE PUBLIC REST API FALLBACK ────────────────────────────
// Market data is PUBLIC — no API key needed.
// Used automatically when MCP is unavailable or auth fails.
const BINANCE_REST = 'https://api.binance.com/api/v3';

async function fetchFromREST(symbol) {
  console.log(`[agent] Fetching market data via Binance REST API for ${symbol}...`);
  try {
    const [tickerRes, depthRes, tradesRes, klinesRes, fundingRes] = await Promise.all([
      fetch(`${BINANCE_REST}/ticker/24hr?symbol=${symbol}`),
      fetch(`${BINANCE_REST}/depth?symbol=${symbol}&limit=20`),
      fetch(`${BINANCE_REST}/trades?symbol=${symbol}&limit=500`),
      fetch(`${BINANCE_REST}/klines?symbol=${symbol}&interval=1h&limit=24`),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`).catch(() => ({ ok: false }))
    ]);

    if (!tickerRes.ok) {
      const errData = await tickerRes.json().catch(() => ({}));
      throw new Error(`Binance REST error: ${errData.msg || tickerRes.statusText} (symbol: ${symbol})`);
    }

    const ticker = await tickerRes.json();
    const orderBook = await depthRes.json();
    const trades = await tradesRes.json();
    const klines = await klinesRes.json();
    let fundingData = null;
    if (fundingRes.ok) {
        fundingData = await fundingRes.json().catch(() => null);
    }

    console.log(`[agent] REST data fetched OK for ${symbol} — price: ${ticker.lastPrice}`);
    return { ticker, orderBook, trades, klines, fundingData, source: 'Binance REST API (public)' };
  } catch (err) {
    throw new Error(`REST API fetch failed: ${err.message}`);
  }
}

// ── MCP CLIENT ──────────────────────────────────────────────────
async function fetchFromMCP(symbol) {
  console.log(`[agent] Attempting Binance MCP connection for ${symbol}...`);
  const client = new Client({ name: 'agent-invoice', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.BINANCE_MCP_URL),
    { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
  );

  await client.connect(transport);

  async function callTool(name, args) {
    const result = await client.callTool({ name, arguments: args });
    if (result.content && result.content[0]) {
      const text = result.content[0].text;
      try { return JSON.parse(text); } catch { return text; }
    }
    return null;
  }

  try {
    const [ticker, orderBook, trades, klines, fundingResult] = await Promise.all([
      callTool('bn_24hr_ticker',   { symbol }),
      callTool('bn_order_book',    { symbol, limit: 20 }),
      callTool('bn_recent_trades', { symbol, limit: 500 }),
      callTool('bn_klines',        { symbol, interval: '1h', limit: 24 }),
      callTool('bn_funding_rate',  { symbol }).catch(() => null)
    ]);

    await client.close();
    console.log(`[agent] MCP data fetched OK for ${symbol}`);
    
    const fundingData = Array.isArray(fundingResult) ? fundingResult[0] : fundingResult;
    return { ticker, orderBook, trades, klines, fundingData, source: 'Binance MCP (agent.binance.com)' };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

// ── ANALYSIS ENGINE ─────────────────────────────────────────────
function runAnalysis(symbol, { ticker, orderBook, trades, klines, source, fundingData }) {
  // ── SIGNAL 6: Futures funding rate ─────────────────────────
  let fundingRate = 0;
  let fundingSignal = 'NEUTRAL';
  if (fundingData) {
    fundingRate = parseFloat(fundingData.fundingRate || fundingData.lastFundingRate || 0);
    if (fundingRate < -0.0001) fundingSignal = 'BULLISH';
    else if (fundingRate > 0.0001) fundingSignal = 'BEARISH';
  } else {
    fundingRate = null;
  }


  // ── SIGNAL 1: Order book imbalance ─────────────────────────
  const bids = orderBook.bids || [];
  const asks = orderBook.asks || [];
  const bidVol = bids.reduce((s, [, q]) => s + parseFloat(q), 0);
  const askVol = asks.reduce((s, [, q]) => s + parseFloat(q), 0);
  const imbalanceRatio = bidVol / (askVol || 1);
  const totalVol = bidVol + askVol || 1;
  const bidPct = (bidVol / totalVol * 100).toFixed(1);
  const askPct = (askVol / totalVol * 100).toFixed(1);

  let obSignal = 'NEUTRAL';
  if (imbalanceRatio > 1.5)  obSignal = 'BULLISH';
  if (imbalanceRatio < 0.67) obSignal = 'BEARISH';

  const biggestBid = bids.reduce((m, b) => parseFloat(b[1]) > parseFloat(m[1]) ? b : m, bids[0] || ['0','0']);
  const biggestAsk = asks.reduce((m, a) => parseFloat(a[1]) > parseFloat(m[1]) ? a : m, asks[0] || ['0','0']);

  // Narrative
  const inverseRatio = (1 / imbalanceRatio).toFixed(1);
  let obNarrative;
  if (obSignal === 'BULLISH') {
    obNarrative = `Buyers are dominant with a ${imbalanceRatio.toFixed(2)}x bid-to-ask volume ratio — meaning buyers are offering ${imbalanceRatio.toFixed(1)}x more liquidity than sellers right now. The largest support wall of ${parseFloat(biggestBid[1]).toFixed(2)} units sits at $${parseFloat(biggestBid[0]).toFixed(2)}, creating a strong price floor. When buy walls significantly outweigh sell walls, upward price pressure is the natural result.`;
  } else if (obSignal === 'BEARISH') {
    obNarrative = `Sellers are overwhelming buyers. The bid-to-ask ratio is ${imbalanceRatio.toFixed(2)}x — for every 1 unit buyers want, sellers are offering ${inverseRatio}x more supply. The largest ask wall of ${parseFloat(biggestAsk[1]).toFixed(2)} units at $${parseFloat(biggestAsk[0]).toFixed(2)} acts as an immediate ceiling. Heavy ask-side pressure like this typically precedes price decline as sellers absorb any buy orders that come in.`;
  } else {
    obNarrative = `The order book is balanced with a ${imbalanceRatio.toFixed(2)}x bid/ask ratio — neither buyers nor sellers are dominating. The market is in a state of equilibrium at current price levels. No directional bias can be inferred from depth alone.`;
  }

  // ── SIGNAL 2: Trade momentum ────────────────────────────────
  const tradeList = Array.isArray(trades) ? trades : [];
  const buyTrades = tradeList.filter(t => !t.isBuyerMaker).length;
  const buyPct    = tradeList.length > 0 ? (buyTrades / tradeList.length) * 100 : 50;
  const sellPct   = (100 - buyPct).toFixed(1);

  let momentumSignal = 'NEUTRAL';
  if (buyPct > 60) momentumSignal = 'BULLISH';
  if (buyPct < 40) momentumSignal = 'BEARISH';

  let momentumNarrative;
  if (momentumSignal === 'BULLISH') {
    momentumNarrative = `${buyPct.toFixed(1)}% of the last ${tradeList.length} real trades were buyer-initiated (aggressive market buy orders). This above-60% threshold means participants are actively paying the ask price rather than waiting — a sign of conviction buying and demand exceeding passive supply. Sustained buy-side aggression like this historically precedes price continuation.`;
  } else if (momentumSignal === 'BEARISH') {
    momentumNarrative = `Only ${buyPct.toFixed(1)}% of the last ${tradeList.length} trades were buyer-initiated — meaning ${sellPct}% were seller-initiated market sell orders. This aggressive selling pattern indicates active distribution: holders are dumping into any available liquidity. When sell aggression this high persists, price typically continues lower as buyers are unable to absorb the flow.`;
  } else {
    momentumNarrative = `${buyPct.toFixed(1)}% buyer-initiated out of ${tradeList.length} trades sampled. The market is relatively balanced between aggressive buyers and sellers. Neither side has conviction strong enough to move price decisively, suggesting range-bound conditions.`;
  }

  // ── SIGNAL 3: 24h kline trend ───────────────────────────────
  const closes = (klines || []).map(k => parseFloat(k[4]));
  const highs  = (klines || []).map(k => parseFloat(k[2]));
  const lows   = (klines || []).map(k => parseFloat(k[3]));

  const first12avg = closes.slice(0, 12).reduce((a, b) => a + b, 0) / (Math.min(closes.length, 12) || 1);
  const last12avg  = closes.slice(12).reduce((a, b) => a + b, 0)  / (Math.max(closes.length - 12, 1));
  const trendSignal = last12avg >= first12avg ? 'BULLISH' : 'BEARISH';
  const trendDiffPct = Math.abs((last12avg - first12avg) / first12avg * 100).toFixed(2);

  const high24 = highs.length ? Math.max(...highs) : 0;
  const low24  = lows.length  ? Math.min(...lows)  : 0;

  let trendNarrative;
  if (trendSignal === 'BULLISH') {
    trendNarrative = `Price trended upward through the day. The average hourly closing price in the last 12 hours ($${last12avg.toFixed(2)}) is ${trendDiffPct}% above the first 12 hours ($${first12avg.toFixed(2)}). This sustained momentum across 24 hourly candles — not just a spike — signals genuine trend strength. The 24h range was $${low24.toFixed(2)} to $${high24.toFixed(2)}.`;
  } else {
    trendNarrative = `Price drifted lower through the day. The average hourly closing price in the last 12 hours ($${last12avg.toFixed(2)}) is ${trendDiffPct}% below the first 12 hours ($${first12avg.toFixed(2)}). This consistent downward drift over 24 candles is not random noise — it reflects sustained selling pressure throughout the session. The 24h range was $${low24.toFixed(2)} to $${high24.toFixed(2)}.`;
  }

  const currentPrice = parseFloat(ticker.lastPrice || ticker.price || ticker.c || 0);
  const rangePos = high24 > low24
    ? ((currentPrice - low24) / (high24 - low24) * 100).toFixed(1)
    : '50.0';

  const avgVol = klines && klines.length > 0
    ? (klines.reduce((s, k) =>
        s + (parseFloat(k[2]) - parseFloat(k[3])) / (parseFloat(k[4]) || 1) * 100, 0
      ) / klines.length).toFixed(2)
    : '0.00';

  // ── SIGNAL 4: 24h price change ──────────────────────────────
  const priceChangePct = parseFloat(ticker.priceChangePercent || ticker.P || 0);
  let changeSignal = 'NEUTRAL';
  if (priceChangePct > 2)  changeSignal = 'BULLISH';
  if (priceChangePct < -2) changeSignal = 'BEARISH';

  let changeNarrative;
  if (changeSignal === 'BULLISH') {
    changeNarrative = `The asset is up ${priceChangePct.toFixed(2)}% over the last 24 hours, crossing the +2% threshold that separates noise from meaningful momentum. This daily gain, combined with a current price of $${currentPrice.toFixed(2)} sitting at ${rangePos}% of the 24h range, shows buyers are sustaining price at elevated levels rather than letting gains erode. Average hourly volatility is ${avgVol}%.`;
  } else if (changeSignal === 'BEARISH') {
    changeNarrative = `The asset has fallen ${Math.abs(priceChangePct).toFixed(2)}% in 24 hours, crossing the -2% threshold into bearish territory. At $${currentPrice.toFixed(2)}, price is at ${rangePos}% of the day's range — closer to the low than the high. This daily decline combined with ${avgVol}% average hourly volatility indicates instability and continued selling pressure.`;
  } else {
    changeNarrative = `The 24h price change of ${priceChangePct > 0 ? '+' : ''}${priceChangePct.toFixed(2)}% is within the neutral -2% to +2% zone. At $${currentPrice.toFixed(2)}, the asset sits at ${rangePos}% of the day's range. No strong directional bias from daily performance; await a breakout above or below the daily range for confirmation.`;
  }

  // ── SIGNAL 5: Technicals (RSI & SMA) ──────────────────────────
  let rsi = 50, sma7 = currentPrice, sma21 = currentPrice;
  let rsiSignal = 'NEUTRAL', smaSignal = 'NEUTRAL';
  if (closes.length >= 21) {
    // 14-period RSI
    let gains = 0, losses = 0;
    for (let i = 1; i <= 14; i++) {
      let diff = closes[closes.length - 15 + i] - closes[closes.length - 16 + i];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / 14) / ((losses / 14) || 1);
    rsi = 100 - (100 / (1 + rs));
    if (rsi > 70) rsiSignal = 'BEARISH'; // Overbought
    if (rsi < 30) rsiSignal = 'BULLISH'; // Oversold

    // SMA 7 vs SMA 21
    sma7 = closes.slice(-7).reduce((a, b) => a + b, 0) / 7;
    sma21 = closes.slice(-21).reduce((a, b) => a + b, 0) / 21;
    smaSignal = sma7 > sma21 ? 'BULLISH' : 'BEARISH';
  }

  // ── COMBINED VERDICT ────────────────────────────────────────
  const signals   = [obSignal, momentumSignal, trendSignal, changeSignal, rsiSignal, smaSignal, fundingSignal];
  const bullCount = signals.filter(s => s === 'BULLISH').length;
  const bearCount = signals.filter(s => s === 'BEARISH').length;

  let verdict, confidence, riskLevel;
  if (bullCount >= 4) {
    verdict = 'BUY';  confidence = bullCount >= 5 ? '92%' : '78%'; riskLevel = 'LOW';
  } else if (bearCount >= 4) {
    verdict = 'EXIT'; confidence = bearCount >= 5 ? '92%' : '78%'; riskLevel = 'HIGH';
  } else {
    verdict = 'HOLD'; confidence = `${40 + Math.abs(bullCount - bearCount) * 10}%`; riskLevel = 'MEDIUM';
  }

  // ── SUMMARY NARRATIVE ───────────────────────────────────────
  const bullSignalNames = [
    obSignal === 'BULLISH' ? 'order book depth' : null,
    momentumSignal === 'BULLISH' ? 'trade momentum' : null,
    trendSignal === 'BULLISH' ? '24h price trend' : null,
    changeSignal === 'BULLISH' ? 'daily performance' : null,
  ].filter(Boolean);
  const bearSignalNames = [
    obSignal === 'BEARISH' ? 'order book depth' : null,
    momentumSignal === 'BEARISH' ? 'trade momentum' : null,
    trendSignal === 'BEARISH' ? '24h price trend' : null,
    changeSignal === 'BEARISH' ? 'daily performance' : null,
  ].filter(Boolean);

  let summaryNarrative;
  if (verdict === 'BUY') {
    summaryNarrative = `${bullCount} out of 4 independent signals agree: ${bullSignalNames.join(', ')} all point bullish for ${symbol.replace('USDT','')} at $${currentPrice.toFixed(2)}. The weight of evidence favors buyers. Key support is at $${parseFloat(biggestBid[0]).toFixed(2)} — a disciplined entry near this level with a stop below it manages downside risk. This is a ${confidence} confidence signal based on live market microstructure data.`;
  } else if (verdict === 'EXIT') {
    summaryNarrative = `${bearCount} out of 4 signals are bearish: ${bearSignalNames.join(', ')} all converge on a sell signal for ${symbol.replace('USDT','')} at $${currentPrice.toFixed(2)}. The evidence strongly favors reducing exposure. Immediate resistance sits at $${parseFloat(biggestAsk[0]).toFixed(2)} and the order book shows sellers are in control. If you hold this asset, current levels represent an opportunity to exit before further decline. This is a ${confidence} confidence signal.`;
  } else {
    summaryNarrative = `Mixed signals prevent a high-confidence directional call. ${bullCount} indicator${bullCount !== 1 ? 's are' : ' is'} bullish${bullSignalNames.length ? ' (' + bullSignalNames.join(', ') + ')' : ''} and ${bearCount} ${bearCount !== 1 ? 'are' : 'is'} bearish${bearSignalNames.length ? ' (' + bearSignalNames.join(', ') + ')' : ''}. In ambiguous markets, the disciplined approach is to wait for clearer alignment. Watch for a break above $${parseFloat(biggestAsk[0]).toFixed(2)} (bullish confirmation) or below $${parseFloat(biggestBid[0]).toFixed(2)} (bearish confirmation).`;
  }

  
  // DYNAMIC SURGE PRICING
  const volatilityNum = parseFloat(avgVol);
  let dynamicPrice;
  let priceReason;

  if (volatilityNum > 3.0) {
    dynamicPrice = 0.05;
    priceReason = 'HIGH VOLATILITY — surge pricing active';
  } else if (volatilityNum > 1.5) {
    dynamicPrice = 0.03;
    priceReason = 'MODERATE VOLATILITY — standard premium';
  } else {
    dynamicPrice = 0.01;
    priceReason = 'LOW VOLATILITY — base price';
  }

  return {
    symbol,
    generatedAt:   new Date().toISOString(),
    dataSource:    source,
    dataFreshness: 'Live',
    verdict,
    confidence,
    riskLevel,
    summaryNarrative,

    marketSnapshot: {
      currentPrice:        currentPrice.toFixed(2),
      priceChange24h:      `${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%`,
      high24h:             high24.toFixed(2),
      low24h:              low24.toFixed(2),
      volume24h:           parseFloat(ticker.volume || ticker.v || 0).toFixed(2),
      rangePosition:       `${rangePos}%`,
      avgHourlyVolatility: `${avgVol}%`
    },

    pricing: { price: dynamicPrice, reason: priceReason, volatility: `${avgVol}%` },
    signals: {
      technicals: {
        rsi: rsi.toFixed(1),
        rsiSignal,
        sma7: sma7.toFixed(2),
        sma21: sma21.toFixed(2),
        smaSignal
      },
      orderBook: {
        signal:         obSignal,
        imbalanceRatio: imbalanceRatio.toFixed(2),
        bidPct,
        askPct,
        biggestBidWall: { price: biggestBid[0], qty: biggestBid[1] },
        biggestAskWall: { price: biggestAsk[0], qty: biggestAsk[1] },
        narrative:      obNarrative,
      },
      tradeMomentum: {
        signal:      momentumSignal,
        buyPressure: `${buyPct.toFixed(1)}%`,
        buyPctNum: buyPct.toFixed(1),
        sampleSize:  tradeList.length,
        narrative:   momentumNarrative,
      },
      klineTrend: {
        signal:      trendSignal,
        first12hAvg: first12avg.toFixed(2),
        last12hAvg:  last12avg.toFixed(2),
        narrative:   trendNarrative,
      },
      priceChange: {
        signal:    changeSignal,
        change24h: `${priceChangePct.toFixed(2)}%`,
        narrative: changeNarrative,
      },
      fundingRate: {
        signal: fundingSignal,
        rate: fundingRate !== null ? `${(fundingRate * 100).toFixed(4)}%` : 'N/A (spot only)',
        interpretation: fundingRate === null 
          ? 'Not available for spot-only tokens'
          : fundingRate < -0.0001 
            ? 'Shorts are heavily paying longs — squeeze potential is HIGH'
            : fundingRate > 0.0001 
              ? 'Longs are heavily paying shorts — overleveraged bulls at risk'
              : 'Funding rate is balanced — no extreme positioning detected'
      }
    },

    riskAnalysis: {
      level:          riskLevel,
      keySupport:     parseFloat(biggestBid[0]).toFixed(2),
      keyResistance:  parseFloat(biggestAsk[0]).toFixed(2),
      bullishSignals: bullCount,
      bearishSignals: bearCount
    },


    disclaimer: 'Algorithmic analysis only. Not financial advice.'
  };
}

// ── MAIN EXPORT ─────────────────────────────────────────────────
// Tries MCP first, automatically falls back to Binance REST API.
// Analysis always works — even with no API key.
export async function analyzeToken(symbol = 'ETHUSDT') {
  const sym = symbol.toUpperCase().trim();

  // Validate symbol format
  if (!/^[A-Z]{2,20}$/.test(sym)) {
    throw new Error(`Invalid symbol format: "${symbol}". Use format like ETHUSDT, BTCUSDT.`);
  }

  let data = null;
  const errors = [];

  // 1. Try Binance MCP (requires Agentic sub-account API key)
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_MCP_URL &&
      !process.env.BINANCE_API_KEY.includes('demo')) {
    try {
      data = await fetchFromMCP(sym);
    } catch (mcpErr) {
      console.warn(`[agent] MCP failed (${mcpErr.message}) — falling back to REST API`);
      errors.push(`MCP: ${mcpErr.message}`);
    }
  }

  // 2. Fall back to Binance public REST API (no key needed)
  if (!data) {
    try {
      data = await fetchFromREST(sym);
    } catch (restErr) {
      errors.push(`REST: ${restErr.message}`);
      throw new Error(
        `All data sources failed.\n${errors.join('\n')}\n\nCheck that "${sym}" is a valid Binance pair (e.g. ETHUSDT, BTCUSDT).`
      );
    }
  }

  return runAnalysis(sym, data);
}

// ── MCP CLIENT FACTORY (for wallet.js reinvestment) ─────────────
export async function createMCPClient() {
  const client = new Client({ name: 'agent-invoice-wallet', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.BINANCE_MCP_URL),
    { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
  );
  await client.connect(transport);
  return client;
}
