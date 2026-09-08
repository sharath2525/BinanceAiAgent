import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { analyzeToken } from './agent.js';
import { issueInvoice, verifyPayment } from './payment.js';
import { logEarning, getWalletStatus, checkAndReinvest } from './wallet.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// In-memory store for pending analyses (requestId → report)
const pendingReports = new Map();

// Activity log for the UI
import fs from 'fs';
const LOG_FILE = join(__dirname, 'logs.json');
let activityLog = [];
try {
  if (fs.existsSync(LOG_FILE)) {
    activityLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  }
} catch (e) { console.error('Error loading logs:', e); }

function log(msg) {
  const entry = { time: new Date().toISOString(), msg };
  activityLog.unshift(entry);
  if (activityLog.length > 100) activityLog.pop();
  console.log(`[${entry.time}] ${msg}`);
  fs.writeFile(LOG_FILE, JSON.stringify(activityLog, null, 2), (err) => {
    if (err) console.error('Log save error:', err);
  });
}

// ── ROUTE 1: POST /analyze ──────────────────────────────────────
// Client sends token symbol. Agent fetches data, builds report,
// locks it behind HTTP 402 invoice. Report NOT delivered yet.
app.post('/analyze', async (req, res) => {
  const { symbol = 'ETHUSDT', clientWallet = '' } = req.body;

  log(`Task received: analyze ${symbol} for client ${clientWallet || 'anonymous'}`);

  try {
    // Pull all 4 data sources from Binance MCP
    log(`Connecting to Binance MCP for ${symbol}...`);
    const report = await analyzeToken(symbol);
    log(`Analysis complete for ${symbol} — verdict: ${report.verdict} (${report.confidence})`);

    // Generate unique request ID and store report
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + parseInt(process.env.PAYMENT_TIMEOUT_SECONDS) * 1000);
    const price = report.pricing?.price || parseFloat(process.env.ANALYSIS_PRICE_USDC || '0.01');
    pendingReports.set(requestId, { report, symbol, expiresAt, clientWallet, price });

    // Issue HTTP 402 — report locked behind invoice
    const invoice = issueInvoice(requestId, expiresAt, price);
    log(`HTTP 402 issued — requestId: ${requestId} — amount: ${invoice.amount} USDC`);

    return res.status(402).json({
      status: 402,
      message: 'Payment required. Your analysis is complete and locked behind this invoice.',
      invoice
    });

  } catch (err) {
    log(`ERROR during analysis: ${err.message}`);
    return res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
});

// ── ROUTE 2: POST /pay ──────────────────────────────────────────
// Client submits their BNB Chain tx hash proving USDC payment.
// Agent verifies on-chain, releases report, logs earnings.
app.post('/pay', async (req, res) => {
  const { requestId, txHash, chain = 'bsc' } = req.body;

  if (!requestId || !txHash) {
    return res.status(400).json({ error: 'requestId and txHash are required' });
  }

  const pending = pendingReports.get(requestId);
  if (!pending) {
    return res.status(404).json({ error: 'Request not found or already delivered' });
  }

  if (new Date() > pending.expiresAt) {
    pendingReports.delete(requestId);
    return res.status(410).json({ error: 'Invoice expired. Please request a new analysis.' });
  }

  log(`Payment submitted for requestId: ${requestId} — tx: ${txHash} on chain: ${chain}`);

  try {
    // Verify USDC Transfer event on BNB Chain
    const verified = await verifyPayment(txHash, chain, pending.price);
    if (!verified) {
      log(`Payment verification FAILED for tx: ${txHash}`);
      return res.status(402).json({ error: 'Payment not verified. Check tx hash and try again.' });
    }

    log(`Payment VERIFIED — releasing report for ${pending.symbol}`);

    // Log earning and check reinvestment threshold
    await logEarning(pending.symbol, parseFloat(process.env.ANALYSIS_PRICE_USDC), txHash);
    pendingReports.delete(requestId);

    // Check if we hit the reinvest threshold
    const reinvested = await checkAndReinvest(log);
    if (reinvested) {
      log(`AUTO-REINVEST triggered — bought BNB on Binance Spot`);
    }

    return res.status(200).json({
      status: 200,
      message: 'Payment verified. Full report delivered.',
      report: pending.report,
      txHash,
      earnedUsdc: process.env.ANALYSIS_PRICE_USDC
    });

  } catch (err) {
    log(`ERROR during payment verification: ${err.message}`);
    return res.status(500).json({ error: 'Verification failed', detail: err.message });
  }
});

// ── ROUTE 3: GET /wallet ────────────────────────────────────────
app.get('/wallet', async (req, res) => {
  const status = await getWalletStatus();
  return res.json(status);
});

// ── ROUTE 4: GET /status ────────────────────────────────────────
app.get('/status', async (req, res) => {
  const wallet = await getWalletStatus();
  return res.json({
    agent: 'Agent Invoice',
    status: 'online',
    version: '1.0.0',
    agentOS: 'Binance Agent OS',
    balance: `${wallet.currentBalance} USDC`,
    totalEarned: `${wallet.totalEarned} USDC`,
    totalTransactions: wallet.transactionCount,
    pendingReports: pendingReports.size,
    timestamp: new Date().toISOString()
  });
});

// ── ROUTE 5: GET /log ───────────────────────────────────────────
app.get('/log', (req, res) => {
  res.json({ log: activityLog.slice(0, 50) });
});

// ── ROUTE 6: GET / — redirect browsers to UI ───────────────────
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect('/index.html');
  }
  res.json({ agent: 'Agent Invoice', version: '1.0.0', ui: '/index.html' });
});


// ── ROUTE: POST /live-request ───────────────────────────────────
app.post('/live-request', async (req, res) => {
  const { symbol = 'ETHUSDT', clientWallet = '' } = req.body;
  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseInt(process.env.PAYMENT_TIMEOUT_SECONDS || 300) * 1000);
  const livePrice = parseFloat(process.env.LIVE_MODE_PRICE_USDC || '0.05');

  log(`Live Mode requested — symbol: ${symbol}`);

  pendingReports.set(`live_${requestId}`, { symbol, clientWallet, expiresAt, price: livePrice, isLive: true });

  const invoice = issueInvoice(requestId, expiresAt, livePrice);
  invoice.productType = 'LIVE_MODE';
  invoice.duration = '15 minutes';
  invoice.updateInterval = '10 seconds';

  log(`HTTP 402 issued for Live Mode — requestId: ${requestId} — price: ${livePrice} USDC`);

  return res.status(402).json({ status: 402, message: 'Payment required for Live Mode', invoice });
});

// ── ROUTE: POST /live-pay ───────────────────────────────────────
app.post('/live-pay', async (req, res) => {
  const { requestId, txHash, chain } = req.body;
  if (!requestId || !txHash) return res.status(400).json({ error: 'requestId and txHash are required' });

  const pending = pendingReports.get(`live_${requestId}`);
  if (!pending) return res.status(404).json({ error: 'Live Mode request not found or expired' });
  if (new Date() > pending.expiresAt) {
    pendingReports.delete(`live_${requestId}`);
    return res.status(410).json({ error: 'Invoice expired.' });
  }

  log(`Live Mode payment submitted — requestId: ${requestId} — tx: ${txHash}`);

  try {
    const verified = await verifyPayment(txHash, chain, pending.price);
    if (!verified) {
      log(`Live Mode payment FAILED — tx: ${txHash}`);
      return res.status(402).json({ error: 'Payment not verified.' });
    }

    log(`Live Mode payment VERIFIED — creating session for ${pending.symbol}`);

    const sessionToken = crypto.randomUUID();
    const sessionExpiry = new Date(Date.now() + 15 * 60 * 1000); 
    
    liveSessions.set(sessionToken, { symbol: pending.symbol, expiresAt: sessionExpiry, createdAt: new Date() });

    await logEarning(pending.symbol, pending.price, txHash);
    pendingReports.delete(`live_${requestId}`);

    const reinvested = await checkAndReinvest(log);
    if (reinvested) log(`AUTO-REINVEST triggered after Live Mode payment`);

    log(`Live Mode session created — token: ${sessionToken}`);

    return res.status(200).json({
      status: 200,
      message: 'Payment verified. Live Mode session active.',
      session: {
        token: sessionToken,
        symbol: pending.symbol,
        expiresAt: sessionExpiry.toISOString(),
        websocketUrl: `ws://localhost:${PORT}?token=${sessionToken}`,
        durationMinutes: 15,
        updateIntervalSeconds: 10
      }
    });
  } catch (err) {
    log(`Live Mode payment error: ${err.message}`);
    return res.status(500).json({ error: 'Verification failed', detail: err.message });
  }
});

// ── WEBSOCKET SERVER ───────────────────────────────────────────
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const liveSessions = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');
  const session = liveSessions.get(token);

  if (!token || !session) { ws.send(JSON.stringify({ error: 'Invalid token' })); ws.close(); return; }

  log(`Live Mode WS connected — symbol: ${session.symbol}`);
  sendLiveUpdate(ws, session.symbol, token);

  const pushInterval = setInterval(async () => {
    if (new Date() > session.expiresAt) {
      ws.send(JSON.stringify({ type: 'expired', message: 'Session ended' }));
      ws.close(); clearInterval(pushInterval); liveSessions.delete(token); return;
    }
    if (ws.readyState === ws.OPEN) await sendLiveUpdate(ws, session.symbol, token);
  }, 1000);

  ws.on('close', () => { clearInterval(pushInterval); log(`Live Mode WS disconnected — token: ${token}`); });
});

async function sendLiveUpdate(ws, symbol, token) {
  try {
    const report = await analyzeToken(symbol);
    const session = liveSessions.get(token);
    const secondsLeft = session ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : 0;
    
    ws.send(JSON.stringify({
      type: 'update', symbol, secondsLeft, timestamp: new Date().toISOString(),
      verdict: report.verdict, confidence: report.confidence, riskLevel: report.riskLevel,
      marketSnapshot: report.marketSnapshot, signals: report.signals, riskAnalysis: report.riskAnalysis, pricing: report.pricing
    }));
  } catch (err) {
    log(`Live Mode update error: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}

// ── START SERVER ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`
\u250c\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2510
\u2551         AGENT INVOICE v1.1.0 (Live Mode)          \u2551
\u2551   Binance Agent OS Hackathon 2026     \u2551
\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563
\u2551  UI:      http://localhost:${PORT}        \u2551
\u2551  MCP:     agent.binance.com            \u2551
\u2551  Chain:   BNB Smart Chain              \u2551
\u2551  Price:   ${process.env.ANALYSIS_PRICE_USDC} USDC per analysis       \u2551
\u2551  Wallet:  ${(process.env.AGENT_WALLET_ADDRESS || 'NOT SET').slice(0,20)}...  \u2551
\u2514\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2518
  `);
});
