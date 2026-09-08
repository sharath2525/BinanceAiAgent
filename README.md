# ⚡ Agent Invoice | Binance Agent OS Hackathon (Track A)

> **A self-funding, economically-aware AI agent built on Binance Agent OS.**
> *Official submission for the 2026 Binance Agent OS Mini Hackathon (Track A).*

**Agent Invoice** is a proof-of-concept for the **Machine-to-Machine (M2M) economy**. It shows how an AI agent can perform useful work, issue machine-readable invoices through the **X402 / B402 HTTP protocol**, collect USDC on-chain, verify its own payments, and reinvest its earnings on Binance.

Instead of only costing money to run, **the agent can earn its own keep.**

---

## 🏆 Binance Technologies Used

### 1. Binance Agent OS & MCP (Model Context Protocol)

* **Market Data MCP:** Pulls real-time Order Book Depth, Trade Momentum, 24h Klines, and Futures Premium Index (Funding Rates) for a 5-signal deterministic analysis.
* **Trading MCP (`bn_place_order`):** When the agent reaches the configured USDC earnings threshold, it calls the Binance Spot MCP to market-buy BNB.

### 2. X402 / B402 Payment Protocol

The analysis is payment-gated using HTTP `402 Payment Required`.

The server returns a machine-readable invoice, waits for payment, and only unlocks the analysis after the transaction is verified.

### 3. Web3 On-Chain Verification

Payments go directly to the agent's wallet across six EVM chains:

* BNB Chain
* Ethereum
* Base
* Polygon
* Arbitrum
* Optimism

The backend uses `ethers.js` to read blockchain RPC logs and verify the exact ERC-20 `Transfer(from, to, value)` event before unlocking the report.

---

## 🌟 Features

### Dynamic Surge Pricing

The agent reads 24-hour Kline volatility through Binance MCP and adjusts its price based on market conditions.

* **Volatility < 1%:** 0.01 USDC
* **Volatility > 3%:** 0.05 USDC

### Live Market Dashboard

Users can pay to unlock a **15-minute WebSocket session** that streams fresh Binance MCP data every **1 second**.

### Terminal Interface

A zero-scroll, 100vh trading terminal layout with:

* 2-column dynamic CSS grids
* Persistent `localStorage` sessions
* Session recovery after page reloads
* Horizontal X402 settlement pipeline

---

## 🛠️ Architecture

### Backend (`index.js`, `agent.js`, `payment.js`)

* **Framework:** Node.js + Express
* **Agent Engine:** 5-signal deterministic weighting using live Binance MCP data
* **Payment Verifier:** Cloudflare RPC integration for ERC-20 Transfer verification
* **Reinvestment Loop:** Tracks global earnings and triggers `bn_place_order` through MCP after reaching the configured threshold

### Frontend (`app.js`, `style.css`, `index.html`)

* **Web3:** MetaMask integration through `window.ethereum`
* **Chain Handling:** Custom handling to prevent default `chainChanged` page reloads
* **UI:** Compact trading terminal interface

---

## 🚀 Run Locally

1. **Clone the repository**

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Copy `.env.example` to `.env` and add the required values.

4. **Start the server**

```bash
node index.js
```

5. **Open the app**

```text
http://localhost:3000
```

6. **Requirements**

MetaMask must be installed and connected to a supported EVM network. BNB Chain is recommended.

---

*Built for the Binance Agent OS Mini Hackathon (Track A).*
