import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createMCPClient } from './agent.js';
import path from 'path';
import os from 'os';

const LEDGER_PATH = process.env.VERCEL ? path.join(os.tmpdir(), 'ledger.json') : './ledger.json';

// ── LEDGER HELPERS ──────────────────────────────────────────────
async function readLedger() {
  if (!existsSync(LEDGER_PATH)) {
    const empty = { currentBalance: 0, totalEarned: 0, transactions: [], reinvestments: [] };
    await writeFile(LEDGER_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
}

async function writeLedger(data) {
  await writeFile(LEDGER_PATH, JSON.stringify(data, null, 2));
}

// ── LOG EARNING ─────────────────────────────────────────────────
export async function logEarning(symbol, amount, txHash) {
  const ledger = await readLedger();
  ledger.currentBalance = parseFloat((ledger.currentBalance + amount).toFixed(6));
  ledger.totalEarned    = parseFloat((ledger.totalEarned + amount).toFixed(6));
  ledger.transactions.unshift({
    id:        ledger.transactions.length + 1,
    type:      'EARN',
    symbol,
    amount,
    txHash,
    timestamp: new Date().toISOString()
  });
  await writeLedger(ledger);
  return ledger;
}

// ── GET WALLET STATUS ───────────────────────────────────────────
export async function getWalletStatus() {
  const ledger    = await readLedger();
  const threshold = parseFloat(process.env.BNB_REINVEST_THRESHOLD);
  return {
    agentWallet:          process.env.AGENT_WALLET_ADDRESS,
    currentBalance:       ledger.currentBalance.toFixed(6),
    totalEarned:          ledger.totalEarned.toFixed(6),
    reinvestThreshold:    threshold,
    progressToReinvest:   `${Math.min((ledger.currentBalance / threshold * 100), 100).toFixed(1)}%`,
    transactionCount:     ledger.transactions.length,
    reinvestmentCount:    ledger.reinvestments.length,
    recentTransactions:   ledger.transactions.slice(0, 10),
    recentReinvestments:  ledger.reinvestments.slice(0, 5)
  };
}

// ── CHECK AND REINVEST ──────────────────────────────────────────
// When balance >= threshold, buy BNB on Binance Spot via MCP
export async function checkAndReinvest(logFn = console.log) {
  const ledger    = await readLedger();
  const threshold = parseFloat(process.env.BNB_REINVEST_THRESHOLD);
  const reserve   = 2; // Always keep $2 USDC as reserve

  if (ledger.currentBalance < threshold) return false;

  const spendAmount = ledger.currentBalance - reserve;
  if (spendAmount <= 0) return false;

  logFn(`[wallet] Balance ${ledger.currentBalance} USDC >= threshold ${threshold}. Buying BNB...`);

  try {
    // Connect to Binance MCP
    const client = await createMCPClient();

    // Get live BNB price
    const bnbTicker = await client.callTool({
      name: 'bn_24hr_ticker',
      arguments: { symbol: 'BNBUSDT' }
    });
    const bnbData  = JSON.parse(bnbTicker.content[0].text);
    const bnbPrice = parseFloat(bnbData.lastPrice || bnbData.price);
    const bnbQty   = (spendAmount / bnbPrice).toFixed(4);

    logFn(`[wallet] BNB price: $${bnbPrice} — buying ${bnbQty} BNB with $${spendAmount.toFixed(2)} USDC`);

    // Place MARKET BUY order via MCP using quoteOrderQty (spend exact USDC amount)
    const orderResult = await client.callTool({
      name: 'bn_place_order',
      arguments: {
        symbol:        'BNBUSDT',
        side:          'BUY',
        type:          'MARKET',
        quoteOrderQty: spendAmount.toFixed(2)
      }
    });

    await client.close();

    const order = JSON.parse(orderResult.content[0].text);

    // Record reinvestment in ledger
    ledger.reinvestments.unshift({
      id:          ledger.reinvestments.length + 1,
      usdcSpent:   spendAmount.toFixed(2),
      bnbBought:   bnbQty,
      bnbPrice:    bnbPrice.toFixed(2),
      orderId:     order.orderId || 'demo-order',
      timestamp:   new Date().toISOString()
    });

    // Deduct spend from balance (keep reserve)
    ledger.currentBalance = reserve;
    ledger.transactions.unshift({
      id:        ledger.transactions.length + 1,
      type:      'REINVEST',
      symbol:    'BNBUSDT',
      amount:    -spendAmount,
      orderId:   order.orderId || 'demo-order',
      timestamp: new Date().toISOString()
    });

    await writeLedger(ledger);
    logFn(`[wallet] SUCCESS — bought ${bnbQty} BNB. Order ID: ${order.orderId || 'demo-order'}`);
    return true;

  } catch (err) {
    logFn(`[wallet] Reinvestment failed: ${err.message}`);
    return false;
  }
}
