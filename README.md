# ⚡ Agent Invoice | Binance Agent OS Hackathon (Track A)

> **A self-funding, economically-aware AI agent built on Binance Agent OS.**
> *Official Submission for the 2026 Binance Agent OS Mini Hackathon (Track A).*

**Agent Invoice** is a proof-of-concept for the **Machine-to-Machine (M2M) economy**. It proves that an AI agent can perform valuable work, issue machine-readable invoices via the **X402 / B402 HTTP protocol**, collect USDC directly on-chain, cryptographically verify its own payments, and autonomously reinvest its earnings on Binance.

Instead of costing developers money to run, **this agent earns its own keep.**

---

## 🏆 Key Binance Technologies Integrated

To maximize the potential of the Binance ecosystem, this project deeply integrates the following core components:

1. **Binance Agent OS & MCP (Model Context Protocol)**
   - **Market Data MCP:** Pulls real-time Order Book Depth, Trade Momentum, 24h Klines, and Futures Premium Index (Funding Rates) to generate a 5-signal deterministic analysis.
   - **Trading MCP (n_place_order):** When the agent accumulates \ USDC in global earnings, it autonomously calls the Binance Spot MCP to market-buy BNB, acting as a self-reinvesting entity.
2. **X402 / B402 Payment Protocol**
   - Implements the first HTTP-native payment standard for AI agents.
   - The server actively gates the analysis payload, returning a 402 Payment Required HTTP code alongside a machine-readable invoice.
3. **Web3 On-Chain Verification**
   - Zero intermediaries. Payments are made directly to the agent's wallet across 6 EVM blockchains (BNB Chain, Ethereum, Base, Polygon, Arbitrum, Optimism).
   - The backend utilizes ethers.js to read blockchain RPC logs, cryptographically verifying the exact Transfer event before the backend unlocks the report.

---

## 🌟 Hackathon Winning Features

- **Dynamic "Self-Aware" Surge Pricing:** The agent is economically aware. It reads the 24-hour Kline volatility via Binance MCP. If the market is stable (volatility < 1%), it charges **0.01 USDC**. If the market is highly chaotic (volatility > 3%), the agent autonomously implements **Surge Pricing** and charges **0.05 USDC**.
- **Live Market Dashboard (WebSocket):** Instead of a static report, users can pay to unlock a 15-minute secure WebSocket session. The agent streams fresh Binance MCP Data every **1 second**.
- **Terminal OS Desktop Interface:** A zero-scroll, 100vh locked "Bloomberg Terminal" style layout. Features 2-column dynamic CSS grids, persistent localStorage sessions (survives accidental page reloads), and a sleek horizontal X402 settlement pipeline.

---

## 🛠️ Architecture

### Backend (index.js, gent.js, payment.js)
* **Framework:** Node.js Express.
* **Agent Engine:** 5-signal deterministic weighting using live Binance MCP data.
* **Payment Verifier:** Cloudflare RPC integration tracking ERC-20 Transfer(from, to, value) events.
* **Reinvestment Loop:** Global state tracker that triggers n_place_order via MCP upon reaching payment thresholds.

### Frontend (pp.js, style.css, index.html)
* **Web3 Injector:** Connects seamlessly to MetaMask (window.ethereum) with custom hooks to prevent default chainChanged page reloads.
* **UI/UX:** Dense, professional trading terminal interface.

---

## 🚀 How to Run Locally

1. **Clone the repository.**
2. **Install dependencies:**
   \\\ash
   npm install
   \\\
3. **Set up Environment Variables:**
   Copy .env.example to .env.
4. **Start the Agent Server:**
   \\\ash
   node index.js
   \\\
5. **Launch:** Open http://localhost:3000 in your browser.
6. **Requirements:** MetaMask installed and connected to an EVM network (BNB Chain recommended).

---
*Built for the Binance Agent OS Mini Hackathon. We built what's next. 🫡*
