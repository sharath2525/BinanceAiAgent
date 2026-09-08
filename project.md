# Agent Invoice — Complete Project Documentation

> Last updated: September 2026 | Version: 1.0.0 | Hackathon: Binance Agent OS 2026

---

## 1. Project Overview

**Agent Invoice** is a self-funding AI market analysis agent built on Binance Agent OS. It is the first working end-to-end implementation of Binance's x402/B402 payment protocol applied to an AI agent service.

### One-Line Pitch
> "The first AI agent that charges for its work, collects payment on-chain, verifies it cryptographically, and reinvests autonomously — built entirely on Binance infrastructure."

### What Makes It Unique
| Feature | Agent Invoice | Typical AI Tools |
|---|---|---|
| Charges per task (x402) | ✅ | ❌ |
| Collects USDC on-chain | ✅ | ❌ |
| Verifies payment cryptographically | ✅ | ❌ |
| Reinvests earnings autonomously | ✅ | ❌ |
| Uses 5 Binance MCP tools | ✅ | ❌ |
| Works on 6 blockchain networks | ✅ | ❌ |
| No account/signup for users | ✅ | ❌ |

---

## 2. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        AGENT INVOICE                               │
│                                                                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────────┐  │
│  │ Browser  │    │ Express  │    │  agent   │    │  Binance   │  │
│  │   UI     │◄──►│  Server  │◄──►│   .js    │◄──►│   MCP /   │  │
│  │(3 tabs)  │    │(index.js)│    │          │    │  REST API  │  │
│  └──────────┘    └────┬─────┘    └──────────┘    └────────────┘  │
│                       │                                            │
│                  ┌────┴─────┐    ┌──────────┐    ┌────────────┐  │
│                  │payment.js│    │ wallet.js│    │ledger.json │  │
│                  │ x402/B402│◄──►│ earnings │◄──►│  (on disk) │  │
│                  └────┬─────┘    └────┬─────┘    └────────────┘  │
│                       │               │                            │
│                  ┌────┴──────────────┘                            │
│                  │   BNB Smart Chain (ethers.js verification)      │
│                  └────────────────────────────────────────────────│
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. File Structure — Every File Explained

```
agent-invoice/
│
├── index.js              Server entry point
├── agent.js              Market analysis engine
├── payment.js            x402/B402 payment protocol
├── wallet.js             Earnings tracker + auto-reinvest
│
├── public/               Browser UI (served as static files)
│   ├── index.html        3-tab dashboard
│   ├── style.css         Binance dark theme
│   └── app.js            Client-side logic + MetaMask
│
├── ledger.json           Auto-created earnings database
├── .env                  Your private configuration
├── .env.example          Template for production setup
├── .env.test             Template for demo/test mode
├── package.json          Node.js dependencies
├── README.md             Setup and usage guide
└── project.md            This file — full technical docs
```

---

## 4. index.js — Server Entry Point

**Purpose:** Express HTTP server. Orchestrates all routes. Holds in-memory state for pending analyses.

### Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/analyze` | Run analysis, issue HTTP 402 invoice |
| `POST` | `/pay` | Verify payment tx hash, release report |
| `GET` | `/wallet` | Return earnings state from ledger.json |
| `GET` | `/status` | Health check (polled every 10s by UI) |
| `GET` | `/log` | Last 50 activity log entries |
| `GET` | `/` | Serve the browser UI |

### Key Concepts

**In-memory pending store:**
```javascript
const pendingReports = new Map();
// key: requestId (UUID)
// value: { report, symbol, expiresAt, clientWallet }
```
When POST /analyze runs, the full analysis report is computed and stored here, but NOT delivered. The client only gets an HTTP 402 invoice. When POST /pay verifies the payment, the report is pulled from this Map and sent to the user. Reports expire after `PAYMENT_TIMEOUT_SECONDS` (default: 300 seconds = 5 minutes).

**Activity log:**
```javascript
const activityLog = [];  // max 100 entries, newest first
function log(msg) { ... } // auto-timestamps + console.log
```
Every significant server action is logged here. Accessible via GET /log and displayed in the Activity Log tab.

### Flow: POST /analyze
1. Extract `symbol` and `clientWallet` from body
2. Call `analyzeToken(symbol)` — fetches live data from Binance
3. Generate `requestId` via `randomUUID()` from Node's built-in `crypto`
4. Store report in `pendingReports` Map with expiry
5. Call `issueInvoice(requestId, expiresAt)` to build the 402 payload
6. Return HTTP 402 — report NOT included

### Flow: POST /pay
1. Extract `requestId`, `txHash`, `chain` from body
2. Look up pending report in Map (error if not found or expired)
3. Call `verifyPayment(txHash, chain)` — checks on-chain
4. If verified: call `logEarning()`, delete from Map, check `checkAndReinvest()`
5. Return HTTP 200 with full report

---

## 5. agent.js — Market Analysis Engine

**Purpose:** Connects to Binance data sources and runs 4-signal analysis. Has automatic fallback from MCP to public REST API.

### Data Strategy

```
Primary:  Binance MCP (agent.binance.com/mcp/agentic)
              ↓ (if MCP auth fails or is unreachable)
Fallback: Binance Public REST API (api.binance.com/api/v3)
              ↓ (if wrong symbol or network error)
Error:    Clear error message with instructions
```

The fallback is critical — market data endpoints on Binance's public REST API require NO authentication. This means the analysis engine always works, even without an Agentic sub-account API key.

### 4 Data Pulls (run in parallel)

| Tool / Endpoint | Data | Used For |
|---|---|---|
| `bn_24hr_ticker` / `/ticker/24hr` | Price, 24h change, volume | Signal 4, price snapshot |
| `bn_order_book` / `/depth?limit=20` | Top 20 bid/ask levels | Signal 1, support/resistance |
| `bn_recent_trades` / `/trades?limit=500` | Last 500 trades | Signal 2, buy/sell pressure |
| `bn_klines` / `/klines?interval=1h&limit=24` | 24 hourly candles | Signal 3, trend direction |

### 4 Analysis Signals

**Signal 1 — Order Book Imbalance**
- Sums total volume at all bid levels vs all ask levels
- Ratio > 1.5x → BULLISH (buyers dominating)
- Ratio < 0.67x → BEARISH (sellers dominating)
- Also identifies largest single bid/ask wall (key support/resistance)

**Signal 2 — Trade Momentum**
- Counts buyer-initiated vs seller-initiated in last 500 trades
- On Binance, `isBuyerMaker: false` = buyer hit the ask (aggressive buy)
- > 60% buyer-initiated → BULLISH
- < 40% buyer-initiated → BEARISH

**Signal 3 — Kline Trend**
- Splits 24 hourly candles into first-half (hours 1–12) and second-half (hours 13–24)
- Compares average closing price of each half
- Rising in second half → BULLISH; Falling → BEARISH

**Signal 4 — 24h Price Change**
- Straight from the ticker's `priceChangePercent`
- > +2% → BULLISH; < -2% → BEARISH

**Combined Verdict**
- 3–4 bullish → BUY (74% or 90% confidence)
- 3–4 bearish → EXIT (74% or 90% confidence)
- Mixed → HOLD (40–60% confidence)

### Narrative Generation

Each signal includes a `narrative` field — a human-readable paragraph explaining the WHY using actual computed values. For example:

> "Sellers are overwhelming buyers. The bid-to-ask ratio is 0.38x — for every 1 unit buyers want, sellers are offering 2.6x more supply. The largest ask wall of 450.32 units at $79,202.44 acts as an immediate ceiling..."

A `summaryNarrative` field covers the overall verdict with actionable context.

---

## 6. payment.js — x402/B402 Protocol

**Purpose:** Implements Binance's B402 HTTP payment standard. Issues invoices and verifies on-chain USDC transfers.

### x402 / B402 Explained

HTTP 402 "Payment Required" has existed since HTTP 1.0 (1991) but was never standardized — until Binance built B402 specifically for AI agents. The protocol:

1. Server does the work (analyzes market data)
2. Server responds HTTP 402 with a machine-readable invoice JSON
3. Client (human or AI agent) pays USDC directly on-chain
4. Client submits tx hash
5. Server verifies the blockchain event and releases the result

This creates **machine-to-machine payment** — an AI agent calling this service can pay completely autonomously, no human involved.

### Where x402 Is Visible in This App

```
POST /analyze
   │
   └─ Returns HTTP 402 status code (the standard response code)
   └─ Body contains invoice with:
      - amount: 0.01 USDC
      - recipient: agent wallet
      - supported chains (6 options)
      - protocol: "x402 / B402"
      - expiry timestamp
      - step-by-step instructions

POST /pay
   │
   └─ verifyPayment() reads blockchain
   └─ On success: HTTP 200 + full report
   └─ On failure: HTTP 402 (still unpaid)
```

The x402 box shown in the UI invoice panel visually explains the 5-step flow to users.

### Supported Chains and USDC Addresses

| Chain | Contract | Decimals | Notes |
|---|---|---|---|
| BNB Smart Chain | `0x8AC76a51...Cd580d` | **18** | Binance-pegged — 18 decimals! |
| Ethereum | `0xA0b86991...eB48` | 6 | Native Circle USDC |
| Polygon | `0x3c499c54...c3359` | 6 | Native Circle USDC |
| Arbitrum | `0xaf88d065...5831` | 6 | Native Circle USDC |
| Base | `0x833589fC...d913` | 6 | Native Circle USDC |
| Optimism | `0x0b2C639c...ff85` | 6 | Native Circle USDC |

⚠️ BSC's Binance-pegged USDC uses 18 decimals (not 6). This is a critical distinction — using the wrong decimal would mean the agent charges $10,000,000,000 instead of $0.01.

### verifyPayment() Logic

```javascript
// 1. Connect to chain's RPC endpoint
const provider = new ethers.JsonRpcProvider(rpcUrl);

// 2. Get tx receipt (must have status = 1, meaning success)
const receipt = await provider.getTransactionReceipt(txHash);

// 3. Loop through all event logs in the transaction
for (const log of receipt.logs) {
  // 4. Only look at logs from the USDC contract on that chain
  if (log.address !== chain.usdc) continue;
  
  // 5. Decode the Transfer(from, to, value) event
  const parsed = usdcInterface.parseLog(log);
  
  // 6. Check: was the transfer TO our agent wallet?
  //          was the amount >= required?
  if (parsed.args.to === agentWallet && parsed.args.value >= requiredAmount) {
    return true; // VERIFIED
  }
}
```

### DEMO_MODE

Setting `DEMO_MODE=true` in `.env` makes `verifyPayment()` return `true` for any non-empty tx hash. Use this for local testing without real USDC.

---

## 7. wallet.js — Earnings & Auto-Reinvest

**Purpose:** Tracks all USDC earned. When balance hits threshold, buys BNB on Binance Spot via MCP.

### Ledger Structure (ledger.json)

```json
{
  "currentBalance": 0.05,
  "totalEarned":    0.23,
  "transactions": [
    {
      "id": 23,
      "type": "EARN",
      "symbol": "ETHUSDT",
      "amount": 0.01,
      "txHash": "0x...",
      "timestamp": "2026-09-08T..."
    },
    {
      "id": 5,
      "type": "REINVEST",
      "symbol": "BNBUSDT",
      "amount": -8.00,
      "orderId": "12345678",
      "timestamp": "2026-09-08T..."
    }
  ],
  "reinvestments": [
    {
      "id": 1,
      "usdcSpent":  "8.00",
      "bnbBought":  "0.0098",
      "bnbPrice":   "812.50",
      "orderId":    "12345678",
      "timestamp":  "2026-09-08T..."
    }
  ]
}
```

### Exported Functions

| Function | Purpose |
|---|---|
| `logEarning(symbol, amount, txHash)` | Credits USDC to balance after verified payment |
| `getWalletStatus()` | Returns full wallet state for GET /wallet |
| `checkAndReinvest(logFn)` | Checks if balance ≥ threshold, triggers BNB buy |

### checkAndReinvest() Flow

```
currentBalance >= BNB_REINVEST_THRESHOLD?
    │ NO → return false
    │ YES ↓
    Connect to Binance MCP (createMCPClient from agent.js)
    Call bn_24hr_ticker(BNBUSDT) → get live BNB price
    Calculate: spendAmount = currentBalance - $2 reserve
    Call bn_place_order({
      symbol: 'BNBUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: spendAmount  ← spend USDC, get BNB
    })
    Record reinvestment in ledger
    Reset currentBalance to $2
    return true
```

The `quoteOrderQty` parameter tells Binance "spend this exact amount of USDC and give me as much BNB as that buys at market price." This is cleaner than calculating BNB quantity manually.

---

## 8. Frontend Architecture

### index.html — 3-Tab Dashboard

**Tab 1: Analyzer**
- Token selector (5 quick buttons + free text input)
- Request Analysis button
- **Invoice Panel** (shown after analysis):
  - Amount + recipient display with copy button
  - 6-chain selector with icons
  - x402 protocol showcase (5-step visual)
  - Payment states:
    - `state-no-metamask` — MetaMask not detected
    - `state-connect` — MetaMask detected, not connected
    - `state-ready` — Connected, showing wallet + "Pay 0.01 USDC"
    - `state-awaiting-mm` — MetaMask popup open
    - `state-pending` — Tx submitted, waiting confirmation
    - `state-verifying` — Server verifying
    - `state-error` — Failed, with retry
  - Manual fallback (`<details>` collapsed) for non-MetaMask users
- **Report Panel** (shown after payment):
  - Success toast notification
  - Verdict banner (BUY/HOLD/EXIT) with confidence + risk
  - Market snapshot grid (4 values)
  - **Summary Narrative** — paragraph explaining the overall call
  - Signal Breakdown (4 cards with metrics + narrative paragraphs)
  - Risk Analysis section
  - Disclaimer

**Tab 2: Wallet**
- 4 stat cards: Balance | Total Earned | Transactions | BNB Buys
- BNB reinvestment progress bar (0–100% of $10 threshold)
- Transaction ledger (last 10)
- Reinvestment history (last 5)

**Tab 3: Activity Log**
- Real-time list of last 50 server events
- Auto-refreshes every 5 seconds
- Shows MCP calls, REST fallbacks, payments, reinvestments

### style.css — Design System

**Color palette:**
```css
--bg:      #0b0e11  /* page background */
--surface: #161a1e  /* panel background */
--surface2:#1e2329  /* input/card background */
--border:  #2b3139  /* dividers */
--accent:  #f0b90b  /* Binance yellow */
--accent2: #f8d33a  /* hover yellow */
--text:    #eaecef  /* primary text */
--text2:   #848e9c  /* secondary text */
--green:   #03c087  /* BUY / bullish / verified */
--red:     #f6465d  /* EXIT / bearish / error */
--blue:    #1890ff  /* x402 protocol info */
```

**Typography:**
```css
--font: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace  /* code/numbers */
--sans: system-ui, -apple-system, ...                        /* UI text */
```

### app.js — Client Logic

**Key state variables:**
```javascript
let currentSymbol    = 'ETHUSDT';  // selected token
let currentRequestId = null;       // active invoice ID
let currentChainKey  = 'bsc';      // selected payment chain
let currentInvoice   = null;       // full invoice object from server
let invoiceTimer     = null;       // countdown interval
let walletAddress    = null;       // connected MetaMask address
let lastTxHash       = null;       // for retry after error
```

**MetaMask Integration Flow:**
```javascript
// 1. Connect
const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

// 2. Switch/add chain
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: chain.hex }]
});
// If chain not in MetaMask, auto-adds it via wallet_addEthereumChain

// 3. Check USDC balance
const usdc = new ethers.Contract(chain.usdc, USDC_ABI, signer);
const balance = await usdc.balanceOf(walletAddress);
// Show error immediately if insufficient

// 4. Send USDC transfer
const tx = await usdc.transfer(agentWallet, amount);
// MetaMask popup appears here — user clicks Confirm

// 5. Wait for confirmation (auto)
const receipt = await tx.wait(1);  // 1 block

// 6. Auto-verify (auto)
await verifyAndUnlock(tx.hash, currentChainKey);
// Calls POST /pay — server checks on-chain — report released
```

**ethers.js version:** v6 (loaded via CDN `ethers.umd.min.js`)
This exposes `ethers` as a global. Used in browser for: `BrowserProvider`, `Contract`, `parseUnits`.

---

## 9. Environment Variables Reference

```env
# Core
DEMO_MODE=false              # true = skip payment verification (testing)
PORT=3000                    # server port

# Binance MCP (requires Agentic sub-account)
BINANCE_MCP_URL=https://agent.binance.com/mcp/agentic
BINANCE_API_KEY=...          # from Binance sub-account → API Management
BINANCE_SECRET_KEY=...       # keep secret, used for order signing

# Agent Wallet (BNB Chain — receives USDC payments)
AGENT_WALLET_ADDRESS=0x...   # public address (shown to users in invoice)
AGENT_PRIVATE_KEY=0x...      # private key (kept secret, used for verification)

# BNB Chain (for payment verification)
BNB_CHAIN_RPC=https://bsc-dataseed.binance.org/
USDC_CONTRACT_BSC=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d

# Optional: other chain RPCs (defaults to public endpoints if not set)
ETH_RPC=https://eth.llamarpc.com
POLYGON_RPC=https://polygon-rpc.com
ARBITRUM_RPC=https://arb1.arbitrum.io/rpc
BASE_RPC=https://mainnet.base.org
OPTIMISM_RPC=https://mainnet.optimism.io

# Pricing
ANALYSIS_PRICE_USDC=0.01     # price per report in USDC
BNB_REINVEST_THRESHOLD=10    # auto-buy BNB when balance hits this
PAYMENT_TIMEOUT_SECONDS=300  # invoice expires after 5 minutes
```

---

## 10. Data Flow — Complete Request Lifecycle

```
User opens http://yoursite.com
         │
[1] Browser loads index.html + style.css + app.js + ethers.js CDN
         │
[2] app.js: checkStatus() → GET /status → "Online — 0.23 USDC earned"
         │
[3] User clicks ETH → clicks "Request Analysis"
         │
[4] POST /analyze { symbol: "ETHUSDT" }
         │
[5] server: analyzeToken("ETHUSDT")
    ├─ Try MCP: bn_24hr_ticker + bn_order_book + bn_recent_trades + bn_klines
    └─ (fallback) REST: /ticker/24hr + /depth + /trades + /klines
         │
[6] runAnalysis() → 4 signals → verdict + confidence + narratives
         │
[7] pendingReports.set(requestId, report)
         │
[8] server returns HTTP 402 + invoice JSON
         │
[9] app.js shows invoice panel:
    - Amount: 0.01 USDC
    - Chain selector (6 options)
    - x402 protocol box (5 steps)
    - "Connect Wallet" or "Pay 0.01 USDC"
    - 5-min countdown timer
         │
[10] User selects chain (e.g. Polygon) → MetaMask switches to Polygon
         │
[11] User clicks "Pay 0.01 USDC"
         │
[12] app.js: checks USDC balance
     if insufficient → shows error "You have 0.003 USDC, need 0.01 USDC"
         │
[13] usdc.transfer(agentWallet, amount) → MetaMask popup
         │
[14] User clicks "Confirm" in MetaMask
         │
[15] app.js: tx.wait(1) → UI shows spinner + explorer link
         │
[16] 1 block confirmed (~5–15 seconds on most chains)
         │
[17] app.js: POST /pay { requestId, txHash, chain: "polygon" }
         │
[18] server: verifyPayment(txHash, "polygon")
     - ethers.JsonRpcProvider("https://polygon-rpc.com")
     - getTransactionReceipt(txHash) → status must be 1
     - parse Transfer event from USDC contract logs
     - check: to = agentWallet, value >= 0.01 USDC (6 decimals on Polygon)
         │
[19] VERIFIED → logEarning("ETHUSDT", 0.01, txHash)
         │
[20] server: HTTP 200 + full report JSON
         │
[21] app.js: showReport() — renders:
     - Success toast: "✅ Payment verified — 0.01 USDC received"
     - EXIT banner in red (or BUY/HOLD)
     - Summary narrative paragraph
     - 4 signal cards with metrics + explanations
     - Risk analysis with support/resistance levels
         │
[22] server: checkAndReinvest() → if balance ≥ $10:
     - bn_24hr_ticker(BNBUSDT) → get live price
     - bn_place_order({ quoteOrderQty: 8.00 }) → buy ~$8 of BNB
     - Update ledger.json
```

---

## 11. Binance Agent OS — Full Integration

| OS Component | Where Used | What It Does |
|---|---|---|
| **Binance MCP** | agent.js `fetchFromMCP()` | Primary data source: 4 tool calls per analysis |
| `bn_24hr_ticker` | agent.js | Price, 24h change, volume for Signal 4 |
| `bn_order_book` | agent.js | Depth-20 bid/ask for Signal 1 |
| `bn_recent_trades` | agent.js | 500 trades for Signal 2 |
| `bn_klines` | agent.js | 24 hourly candles for Signal 3 |
| `bn_place_order` | wallet.js | MARKET BUY BNB on reinvestment trigger |
| **Agentic Sub-account** | All | Isolated wallet, API key, trade history |
| **x402 / B402** | payment.js + UI | HTTP 402 payment standard, machine-readable invoices |
| **BNB Smart Chain** | payment.js | Default payment chain for USDC receipts |

---

## 12. Security Considerations

- **Private key** (`AGENT_PRIVATE_KEY`): Keep in `.env` only, never commit to git. Used for wallet operations.
- **API key** (`BINANCE_API_KEY`): Server-side only. Never exposed to browser.
- **Payment verification**: Always done server-side via ethers.js — the browser cannot forge a valid on-chain USDC transfer.
- **Invoice expiry**: 5-minute timeout prevents replay attacks.
- **requestId**: UUID v4 — random and unguessable. Cannot predict or reuse.
- **USDC contract check**: `verifyPayment()` only reads logs from the EXACT USDC contract address — cannot be spoofed with a fake token.

---

## 13. Deployment

### Local (dev)
```bash
cp .env.test .env   # DEMO_MODE=true, no real keys needed
node index.js
open http://localhost:3000
```

### Production
```bash
cp .env.example .env
# Fill in real keys
node index.js
# Or: pm2 start index.js --name agent-invoice
```

### Cloud (Railway / Render / Heroku)
1. Push to GitHub
2. Connect repo in cloud dashboard
3. Set environment variables (copy from .env)
4. Deploy — get public URL

### ngrok (quick demo)
```bash
node index.js &
ngrok http 3000
# Share the https URL
```

---

## 14. Known Limitations & Future Work

| Limitation | Future Fix |
|---|---|
| `ledger.json` is local file | Replace with PostgreSQL or Redis |
| No WebSocket — log tab polls every 5s | Add WebSocket for real-time log |
| MCP requires Agentic sub-account | Falls back to REST (fine for demo) |
| Single server instance | Add load balancer + shared state |
| No auth for wallet/log endpoints | Add API key protection |
| DEMO_MODE accepts any hash | Keep for testing, disable in prod |

---

## 15. Tech Stack Summary

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (ES Modules) | ≥18.0 |
| Server | Express | ^4.18 |
| MCP Client | @modelcontextprotocol/sdk | ^1.0 |
| Blockchain | ethers.js (server) | ^6.0 |
| Blockchain | ethers.js (browser CDN) | ^6.13 |
| UI | Vanilla HTML/CSS/JS | — |
| Dependencies | uuid, dotenv | — |
| Data format | JSON (ledger), .env | — |

Total package size: ~137 npm packages, 4 moderate vulnerabilities (non-blocking).

---

*Agent Invoice — Built for Binance Agent OS Hackathon 2026. Not financial advice.*
