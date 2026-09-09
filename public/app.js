// ════════════════════════════════════════════════════════════════
// Agent Invoice — app.js
// Full Web3 wallet integration with MetaMask + multi-chain USDC
// ════════════════════════════════════════════════════════════════

// ── CHAIN CONFIG (mirrored from payment.js) ──────────────────────
const CHAINS = {
  bsc: {
    key: 'bsc', name: 'BNB Chain', icon: 'BNB',
    chainId: 56, hex: '0x38',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,                         // Binance-pegged USDC = 18 decimals
    explorer: 'https://bscscan.com',
    rpcUrls: ['https://bsc-dataseed.binance.org/'],
    native: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
  ethereum: {
    key: 'ethereum', name: 'Ethereum', icon: 'ETH',
    chainId: 1, hex: '0x1',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    explorer: 'https://etherscan.io',
    rpcUrls: ['https://eth.llamarpc.com'],
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  polygon: {
    key: 'polygon', name: 'Polygon', icon: 'POL',
    chainId: 137, hex: '0x89',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    decimals: 6,
    explorer: 'https://polygonscan.com',
    rpcUrls: ['https://polygon-rpc.com'],
    native: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  arbitrum: {
    key: 'arbitrum', name: 'Arbitrum', icon: 'ARB',
    chainId: 42161, hex: '0xa4b1',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
    explorer: 'https://arbiscan.io',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    key: 'base', name: 'Base', icon: 'BASE',
    chainId: 8453, hex: '0x2105',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    explorer: 'https://basescan.org',
    rpcUrls: ['https://mainnet.base.org'],
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    key: 'optimism', name: 'Optimism', icon: 'OP',
    chainId: 10, hex: '0xa',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    decimals: 6,
    explorer: 'https://optimistic.etherscan.io',
    rpcUrls: ['https://mainnet.optimism.io'],
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

// Minimal USDC ABI — only what we need
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ── APP STATE ─────────────────────────────────────────────────────
let currentSymbol    = 'ETHUSDT';
let currentRequestId = null;
let currentChainKey  = 'bsc';   // default chain
let currentInvoice   = null;
let invoiceTimer     = null;
let walletAddress    = null;    // connected wallet address
let lastTxHash       = null;    // for retry

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkStatus();
  setInterval(checkStatus, 10000);
  setInterval(refreshLog, 5000);

  // Tab switching — MUST remove 'hidden' class (it has !important)
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.classList.add('hidden');
      });
      tab.classList.add('active');
      const pane = document.getElementById(`tab-${tab.dataset.tab}`);
      if (pane) {
        pane.classList.add('active');
        pane.classList.remove('hidden');
      }
      if (tab.dataset.tab === 'wallet')   refreshWallet();
      if (tab.dataset.tab === 'activity') refreshLog();
    });
  });

  // Token buttons
  document.querySelectorAll('.token-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.token-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSymbol = btn.dataset.symbol;
      document.getElementById('symbol-input').value = currentSymbol;
    });
  });

  // Build chain selector
  buildChainGrid();

  // Auto-reconnect wallet if already connected
  if (window.ethereum) {
    window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
      if (accounts.length > 0) {
        walletAddress = accounts[0];
        updateWalletUI();
      }
    });
  }
  refreshLog(); // Fetch logs immediately on load

  // Check if MetaMask is installed
  if (!window.ethereum) {
    const btn = document.getElementById('wallet-btn');
    if (btn) { btn.textContent = 'Install MetaMask'; btn.onclick = () => window.open('https://metamask.io/download/', '_blank'); }
  }

  // Listen for MetaMask account/chain changes
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', accounts => {
      if (accounts.length === 0) { disconnectWallet(); }
      else { walletAddress = accounts[0]; updateWalletUI(); }
    });
    window.ethereum.on('chainChanged', () => window.location.reload());
  }


  refreshWallet();

  // Restore cached report if it exists
  const cachedReport = localStorage.getItem('cachedReport');
  if (cachedReport) {
    try { showReport(JSON.parse(cachedReport)); } catch (e) {}
  }
});


// ── CHAIN GRID ────────────────────────────────────────────────────
function buildChainGrid() {
  const grid = document.getElementById('chain-grid');
  if (!grid) return;
  grid.innerHTML = Object.values(CHAINS).map(c => `
    <button class="chain-btn ${c.key === currentChainKey ? 'active' : ''}"
            data-chain="${c.key}" onclick="selectChain('${c.key}')">
      <span class="chain-icon">${c.icon}</span>
      <span class="chain-name">${c.name}</span>
    </button>
  `).join('');
}

function selectChain(key) {
  currentChainKey = key;
  document.querySelectorAll('.chain-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.chain === key);
  });
  // If wallet connected, switch chain automatically
  if (walletAddress) switchChain(key);
}

// ── WALLET CONNECT ────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    window.open('https://metamask.io/download/', '_blank');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletAddress = accounts[0];
    updateWalletUI();
    // Switch to selected chain
    await switchChain(currentChainKey);
  } catch (err) {
    console.error('Wallet connect failed:', err.message);
    if (err.code !== 4001) alert('Wallet connection failed: ' + err.message);
  }
}

function disconnectWallet() {
  walletAddress = null;
  updateWalletUI();
}

function updateWalletUI() {
  const btn  = document.getElementById('wallet-btn');
  const area = document.getElementById('wallet-area');

  if (walletAddress) {
    const short = walletAddress.slice(0,6) + '...' + walletAddress.slice(-4);
    if (btn) {
      btn.innerHTML = `<span class="mm-icon">&#x1F98A;</span> ${short}`;
      btn.classList.add('connected');
      btn.onclick = disconnectWallet;
    }
    // Show ready state in invoice if open
    showPayState('state-ready');
    setText('wallet-short', short);
    setText('connected-chain-name', CHAINS[currentChainKey]?.name || '');
  } else {
    if (btn) {
      btn.innerHTML = `<span class="mm-icon">&#x1F98A;</span> Connect Wallet`;
      btn.classList.remove('connected');
      btn.onclick = connectWallet;
    }
    if (currentInvoice) showPayState('state-connect');
  }
}

// ── SWITCH CHAIN ──────────────────────────────────────────────────
async function switchChain(key) {
  if (!window.ethereum) return;
  const chain = CHAINS[key];
  if (!chain) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.hex }],
    });
  } catch (err) {
    // Chain not added to MetaMask yet — add it
    if (err.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId:            chain.hex,
            chainName:          chain.name,
            nativeCurrency:     chain.native,
            rpcUrls:            chain.rpcUrls,
            blockExplorerUrls:  [chain.explorer],
          }],
        });
      } catch (addErr) {
        console.error('Could not add chain:', addErr.message);
      }
    }
  }

  // Update UI
  if (walletAddress) {
    setText('connected-chain-name', chain.name);
  }
}

// ── STATUS CHECK ──────────────────────────────────────────────────
async function checkStatus() {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  try {
    const data = await fetch('/status').then(r => r.json());
    dot.className = 'status-dot online';
    txt.textContent = `Online \u2014 ${data.totalEarned} earned`;
  } catch {
    dot.className = 'status-dot offline';
    txt.textContent = 'Offline';
  }
}

// ── REQUEST ANALYSIS ──────────────────────────────────────────────
async function requestAnalysis() {
  isLiveMode = false;
  const symbol = (document.getElementById('symbol-input').value || 'ETHUSDT').trim().toUpperCase();
  const btn    = document.getElementById('analyze-btn');

  btn.disabled    = true;
  btn.textContent = '\u23f3 Fetching live market data\u2026';
  hide('invoice-panel');
  hide('report-panel');

  try {
    const res  = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, clientWallet: walletAddress || '' }),
    });
    const data = await res.json();

    if (res.status === 402 && data.invoice) {
      currentRequestId = data.invoice.requestId;
      currentInvoice   = data.invoice;
      showInvoice(data.invoice);
    } else {
      const errMsg = data.detail || data.error || 'Analysis failed';
      alert('Analysis failed:\n\n' + errMsg);
    }
  } catch (err) {
    alert('Connection error: ' + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = '\u26a1 Request Analysis \u2014 0.01 USDC';
  }
}

// ── SHOW INVOICE ──────────────────────────────────────────────────
function showInvoice(invoice) {
  const agentWallet = invoice.recipient || '—';
  const amt = invoice.amount || '0.01';
  setText('inv-amount', amt);
  setText('inv-recipient', agentWallet);
  
  // Update all dynamic UI text elements
  setText('inv-desc', `Your analysis is ready. Pay ${amt} USDC to unlock the full report.`);
  setText('x402-step-3', `You send ${amt} USDC directly on-chain (no intermediary)`);
  setText('manual-pay-desc', `Send exactly ${amt} USDC to the address above on your selected chain, then paste the tx hash:`);
  
  const payBtn = document.getElementById('pay-usdc-btn');
  if (payBtn) payBtn.innerHTML = `⚡ Pay ${amt} USDC`;

    hide('report-panel');
    hide('live-mode-panel');
    show('invoice-panel');
  buildChainGrid();

  // Determine pay state
  if (!window.ethereum) {
    showPayState('state-no-metamask');
  } else if (walletAddress) {
    showPayState('state-ready');
    const short = walletAddress.slice(0,6) + '...' + walletAddress.slice(-4);
    setText('wallet-short', short);
    setText('connected-chain-name', CHAINS[currentChainKey]?.name || '');
  } else {
    showPayState('state-connect');
  }

  // Countdown
  if (invoiceTimer) clearInterval(invoiceTimer);
  const expiry = new Date(invoice.expiresAt);
  invoiceTimer = setInterval(() => {
    const rem = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
    const m   = String(Math.floor(rem / 60)).padStart(2, '0');
    const s   = String(rem % 60).padStart(2, '0');
    const el  = document.getElementById('inv-countdown');
    if (el) {
      el.textContent = `${m}:${s}`;
      el.style.color = rem < 60 ? 'var(--red)' : 'var(--accent)';
    }
    if (rem === 0) {
      clearInterval(invoiceTimer);
      hide('invoice-panel');
      alert('Invoice expired. Please request a new analysis.');
    }
  }, 1000);
}

function cancelInvoice() {
  if (invoiceTimer) clearInterval(invoiceTimer);
  currentRequestId = null;
  currentInvoice   = null;
  hide('invoice-panel');
  hide('report-panel');
}

// ── PAY WITH METAMASK ─────────────────────────────────────────────
async function payWithWallet() {
  if (!window.ethereum || !walletAddress) { await connectWallet(); return; }
  if (!currentRequestId)  { alert('No active invoice. Please request analysis first.'); return; }

  const chain = CHAINS[currentChainKey];
  if (!chain) { alert('Please select a payment chain.'); return; }

  // Step 1 — Switch to the correct chain
  showPayState('state-awaiting-mm');
  try {
    await switchChain(currentChainKey);
  } catch (err) {
    showError('Chain switch failed', err.message);
    return;
  }

  // Step 2 — Send USDC transfer via MetaMask
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const usdc     = new ethers.Contract(chain.usdc, USDC_ABI, signer);

    // Parse amount with correct decimals for this chain
    const amount = ethers.parseUnits(
      (currentInvoice?.amount || '0.01').toString(),
      chain.decimals
    );

    const agentWallet = currentInvoice?.recipient || document.getElementById('inv-recipient')?.textContent?.trim();
    if (!agentWallet || agentWallet === '—') {
      showError('Configuration error', 'Agent wallet address not set.');
      return;
    }

    // Check USDC balance first
    try {
      const balance = await usdc.balanceOf(walletAddress);
      if (balance < amount) {
        const need = ethers.formatUnits(amount, chain.decimals);
        const have = ethers.formatUnits(balance, chain.decimals);
        showError(
          'Insufficient USDC balance',
          `You need ${need} USDC on ${chain.name} but have ${have} USDC.\n\nBridge USDC to ${chain.name} or select a different chain.`
        );
        return;
      }
    } catch (_) { /* skip balance check if call fails */ }

    // Send the transfer — MetaMask popup appears here
    const tx = await usdc.transfer(agentWallet, amount);
    lastTxHash = tx.hash;

    // Step 3 — Show pending state with explorer link
    const explorerUrl = `${chain.explorer}/tx/${tx.hash}`;
    showPayState('state-pending');
    const link = document.getElementById('pending-tx-link');
    if (link) {
      link.textContent = tx.hash.slice(0,18) + '...';
      link.href        = explorerUrl;
    }

    // Step 4 — Wait for 1 block confirmation
    let receipt;
    try {
      receipt = await tx.wait(1);
    } catch (waitErr) {
      showError('Transaction failed on-chain', waitErr.message + '\n\nCheck explorer: ' + explorerUrl);
      return;
    }

    if (!receipt || receipt.status !== 1) {
      showError('Transaction reverted', 'The USDC transfer was reverted on-chain.\n\nView on explorer: ' + explorerUrl);
      return;
    }

    // Step 5 — Auto-verify server-side
    showPayState('state-verifying');
    await verifyAndUnlock(tx.hash, currentChainKey);

  } catch (err) {
    if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
      // User rejected MetaMask popup — go back to ready state
      showPayState('state-ready');
    } else {
      showError('Payment error', err.reason || err.message);
    }
  }
}

// ── VERIFY AND UNLOCK ─────────────────────────────────────────────
async function verifyAndUnlock(txHash, chainKey) {
  try {
    const endpoint = isLiveMode ? '/live-pay' : '/pay';
    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: currentRequestId,
        txHash,
        chain: chainKey,
      }),
    });
    const data = await res.json();

    if (res.status === 200) {
      clearInterval(invoiceTimer);
      hide('invoice-panel');
      
      if (isLiveMode && data.session) {
         startLiveSession(data.session);
      } else if (data.report) {
         localStorage.setItem('cachedReport', JSON.stringify(data.report));
          showReport(data.report);
      } else {
         showError('Payment verified, but missing data');
         return;
      }
      
      refreshWallet();
      refreshLog();
    } else {
      const errMsg = data.detail || data.error || 'Verification failed';
      showError('Payment not verified', errMsg + '\n\nTx hash: ' + txHash);
    }
  } catch (err) {
    showError('Server error during verification', err.message);
  }
}

// ── MANUAL PAYMENT FALLBACK ───────────────────────────────────────
async function submitManualPayment() {
  const txHash = (document.getElementById('txhash-input')?.value || '').trim();
  if (!txHash) { alert('Please paste your transaction hash.'); return; }
  if (!currentRequestId) { alert('No active invoice.'); return; }

  showPayState('state-verifying');
  await verifyAndUnlock(txHash, currentChainKey);
}

function retryPayment() {
  if (walletAddress) showPayState('state-ready');
  else showPayState('state-connect');
}

// ── PAY STATES ────────────────────────────────────────────────────
function showPayState(stateId) {
  const states = [
    'state-no-metamask', 'state-connect', 'state-ready',
    'state-awaiting-mm', 'state-pending', 'state-verifying', 'state-error',
  ];
  states.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== stateId);
  });
}

function showError(title, detail) {
  showPayState('state-error');
  setText('error-title',  title);
  setText('error-detail', detail);
}

// ── REPORT DISPLAY ────────────────────────────────────────────────
function showReport(r) {
  const verdict = r.verdict || 'HOLD';
  const banner  = document.getElementById('verdict-banner');
  if (banner) banner.className = `verdict-banner ${verdict}`;
  setText('verdict-text', verdict);
  setText('confidence-text', `Confidence: ${r.confidence} — ${new Date(r.generatedAt).toLocaleTimeString()}`);

  const rb = document.getElementById('risk-badge');
  if (rb) { rb.textContent = `Risk: ${r.riskLevel}`; rb.className = `risk-badge risk-${r.riskLevel}`; }

  const ms  = r.marketSnapshot  || {};
  const chg = parseFloat(ms.priceChange24h) || 0;
  setHTML('snapshot-grid', `
    <div class="snap-item"><div class="snap-label">Price</div><div class="snap-val">$${ms.currentPrice || '—'}</div></div>
    <div class="snap-item"><div class="snap-label">24h Change</div><div class="snap-val ${chg>=0?'pos':'neg'}">${ms.priceChange24h || '—'}</div></div>
    <div class="snap-item"><div class="snap-label">24h High</div><div class="snap-val">$${ms.high24h || '—'}</div></div>
    <div class="snap-item"><div class="snap-label">Range Pos.</div><div class="snap-val">${ms.rangePosition || '—'}</div></div>
  `);

  const sig = r.signals || {};
  function sigCard(label, s, vizHtml, detail) {
    // Shorten narrative to just the first sentence for punchiness
    let shortNarrative = (s?.narrative || '').split('. ')[0] + '.';
    if (shortNarrative === '.') shortNarrative = '';

    return `<div class="signal-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div class="s-label" style="margin:0">${label}</div>
        <div class="s-value ${s?.signal || ''}" style="margin:0; font-size:14px;">${s?.signal || '—'}</div>
      </div>
      ${vizHtml}
      <div class="s-metrics" style="border:none; padding:0; margin-top:8px;">${detail}</div>
      ${shortNarrative ? `<div class="s-narrative">${shortNarrative}</div>` : ''}
    </div>`;
  }

  const obViz = `
    <div class="viz-labels"><span class="green">${sig.orderBook?.bidPct || 50}% Bids</span><span class="red">${sig.orderBook?.askPct || 50}% Asks</span></div>
    <div class="viz-bar-container">
      <div class="viz-buy" style="width: ${sig.orderBook?.bidPct || 50}%"></div>
      <div class="viz-sell" style="width: ${sig.orderBook?.askPct || 50}%"></div>
    </div>
  `;

  const tmViz = `
    <div class="viz-labels"><span class="green">${sig.tradeMomentum?.buyPctNum || 50}% Buys</span><span class="red">${(100 - (sig.tradeMomentum?.buyPctNum || 50)).toFixed(1)}% Sells</span></div>
    <div class="viz-bar-container">
      <div class="viz-buy" style="width: ${sig.tradeMomentum?.buyPctNum || 50}%"></div>
      <div class="viz-sell" style="width: ${(100 - (sig.tradeMomentum?.buyPctNum || 50)).toFixed(1)}%"></div>
    </div>
  `;

  // Parse range position from string "54.2%" to number
  const rPos = parseFloat(ms.rangePosition) || 50;
  const priceViz = `
    <div class="viz-labels"><span>24h Low</span><span>24h High</span></div>
    <div class="viz-bar-container" style="background: linear-gradient(90deg, var(--red) 0%, var(--green) 100%); opacity: 0.8;">
      <div class="viz-range-marker" style="left: calc(${rPos}% - 2px);"></div>
    </div>
    <div class="viz-range-labels"><span>$${ms.low24h}</span><span>$${ms.high24h}</span></div>
  `;

  const trendViz = `
    <div class="viz-labels"><span>First 12h: $${sig.klineTrend?.first12hAvg}</span><span>Last 12h: $${sig.klineTrend?.last12hAvg}</span></div>
    <div class="viz-bar-container" style="background: var(--surface2)">
      <div class="viz-buy" style="width: ${sig.klineTrend?.signal === 'BULLISH' ? '100%' : '0%'}; background: ${sig.klineTrend?.signal === 'BULLISH' ? 'var(--green)' : 'transparent'}"></div>
      <div class="viz-sell" style="width: ${sig.klineTrend?.signal === 'BEARISH' ? '100%' : '0%'}; background: ${sig.klineTrend?.signal === 'BEARISH' ? 'var(--red)' : 'transparent'}"></div>
    </div>
  `;

  const fundingViz = `
    <div class="viz-labels" style="justify-content:center;font-size:16px;">
      <span class="${sig.fundingRate?.signal === 'BULLISH' ? 'green' : (sig.fundingRate?.signal === 'BEARISH' ? 'red' : '')}">${sig.fundingRate?.rate || 'N/A'}</span>
    </div>
  `;

  setHTML('signals-grid',
    sigCard('Order Book', sig.orderBook, obViz,
      `Wall Support: $${sig.orderBook?.biggestBidWall?.price || '—'} &nbsp;|&nbsp; Wall Resist: $${sig.orderBook?.biggestAskWall?.price || '—'}`) +
    sigCard('Trade Momentum', sig.tradeMomentum, tmViz,
      `Last ${sig.tradeMomentum?.sampleSize || '—'} real-time trades analyzed`) +
    sigCard('24h Kline Trend', sig.klineTrend, trendViz,
      `Momentum shift over 24 hourly candles`) +
    sigCard('24h Price Range', sig.priceChange, priceViz,
      `Volatility: ${ms.avgHourlyVolatility || '—'}% / hr &nbsp;|&nbsp; Current Range Pos: ${ms.rangePosition || '—'}`) +
    sigCard('Technicals (RSI & SMA)', sig.technicals, `
      <div class="viz-labels"><span>RSI (14): ${sig.technicals?.rsi}</span><span class="${sig.technicals?.rsiSignal === 'BULLISH' ? 'green' : (sig.technicals?.rsiSignal === 'BEARISH' ? 'red' : '')}">${sig.technicals?.rsiSignal}</span></div>
      <div class="viz-bar-container" style="background: linear-gradient(90deg, var(--green) 0%, var(--surface2) 50%, var(--red) 100%);">
        <div class="viz-range-marker" style="left: calc(${sig.technicals?.rsi}% - 2px);"></div>
      </div>
    `, `SMA 7: $${sig.technicals?.sma7} &nbsp;|&nbsp; SMA 21: $${sig.technicals?.sma21} &nbsp;(<span class="${sig.technicals?.smaSignal === 'BULLISH' ? 'green' : 'red'}">${sig.technicals?.smaSignal}</span>)`) +
    sigCard('Futures Funding Rate', sig.fundingRate || { signal: 'NEUTRAL' }, fundingViz,
      sig.fundingRate?.interpretation || 'Spot token or unavailable')
  );

  // Overall summary narrative
  if (r.summaryNarrative) {
    const sumEl = document.getElementById('summary-narrative');
    if (sumEl) { sumEl.textContent = r.summaryNarrative; sumEl.style.display = 'block'; }
  }

  const ra = r.riskAnalysis || {};
  setHTML('risk-section', `
    <div class="risk-item"><div class="r-label">Key Support</div><div class="r-val">$${ra.keySupport || '—'}</div></div>
    <div class="risk-item"><div class="r-label">Key Resistance</div><div class="r-val">$${ra.keyResistance || '—'}</div></div>
    <div class="risk-item"><div class="r-label">Current Price</div><div class="r-val">$${ms.currentPrice || '—'}</div></div>
    <div class="risk-item"><div class="r-label">Bullish Signals</div><div class="r-val BULLISH">${ra.bullishSignals || 0} / 4</div></div>
    <div class="risk-item"><div class="r-label">Bearish Signals</div><div class="r-val BEARISH">${ra.bearishSignals || 0} / 4</div></div>
    <div class="risk-item"><div class="r-label">Data Source</div><div class="r-val" style="font-size:11px">${r.dataSource || '—'}</div></div>
  `);

  hide('invoice-panel');
  hide('live-mode-panel');
  show('report-panel');
  // Scroll to report
  const rp = document.getElementById('report-panel');
    // Show success toast
  const toast = document.getElementById('success-toast');
  if (toast) {
    toast.style.display = 'flex';
    setTimeout(() => { toast.style.display = 'none'; }, 5000);
  }
}

function resetAnalyzer() {
  if (invoiceTimer) clearInterval(invoiceTimer);
  currentRequestId = null;
  currentInvoice   = null;
  lastTxHash       = null;
  hide('invoice-panel');
  hide('report-panel');
  const txInput = document.getElementById('txhash-input');
  if (txInput) txInput.value = '';
}

// ── WALLET TAB ────────────────────────────────────────────────────
async function refreshWallet() {
  try {
    let localWallet = JSON.parse(localStorage.getItem('localWallet') || '{"balance":0,"earned":0,"txCount":0,"txs":[]}');
    
    const displayBalance = localWallet.balance.toFixed(6);
    const displayEarned  = localWallet.earned.toFixed(6);
    const displayTxCount = localWallet.txCount;

    setText('w-balance',      displayBalance);
    setText('w-total',        displayEarned);
    setText('w-txcount',      displayTxCount);
    
    const headerEl = document.getElementById('header-agent-status');
    if (headerEl) {
      headerEl.innerHTML = `<span class="status-indicator online"></span> Online — ${displayEarned} USDC earned`;
    }

    const t = 10; // threshold
    const progress = Math.min((localWallet.balance / t * 100), 100).toFixed(1);
    setText('w-progress',     `${progress}%`);
    
    const bar = document.getElementById('w-progress-bar');
    if (bar) bar.style.width = `${progress}%`;

    const ledger = document.getElementById('tx-ledger');
    if (ledger) {
      if (localWallet.txs && localWallet.txs.length > 0) {
        ledger.innerHTML = localWallet.txs.slice(0, 10).map(tx => {
          const ts = new Date(tx.timestamp).toLocaleTimeString();
          return `<div class="tx-row">
            <div>
              <span class="tx-id">TX-${tx.id}</span>
              <span class="tx-time">${ts}</span>
            </div>
            <span class="tx-amt">+${tx.amount} USDC</span>
          </div>`;
        }).join('');
      }
    }
  } catch (err) { console.error('Wallet refresh:', err.message); }
}

  // ── ACTIVITY LOG ──────────────────────────────────────────────────
async function refreshLog() {
  try {
    const { log } = await fetch('/log').then(r => r.json());
    const el = document.getElementById('activity-log');
    if (!el) return;
    if (!log?.length) { el.innerHTML = '<p class="empty-msg">No activity yet.</p>'; return; }
    el.innerHTML = log.map(e => `
      <div class="log-entry">
        <span class="log-time">[${new Date(e.time).toLocaleTimeString()}]</span>
        <span class="log-msg ${e.msg.includes('VERIFIED') ? 'highlight-green' : (e.msg.includes('failed') ? 'highlight-red' : '')}">${e.msg.replace('VERIFIED', '<b>VERIFIED</b>').replace('failed', '<b>failed</b>')}</span>
      </div>`).join('');
  } catch { /* silent */ }
}

// ── HELPERS ───────────────────────────────────────────────────────
function show(id)      { const e=document.getElementById(id); if(e) e.classList.remove('hidden'); }
function hide(id)      { const e=document.getElementById(id); if(e) e.classList.add('hidden'); }
function setText(id,v) { const e=document.getElementById(id); if(e) e.textContent=v; }
function setHTML(id,v) { const e=document.getElementById(id); if(e) e.innerHTML=v; }

function copyText(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim()).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '\u2713 Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  }).catch(() => alert('Copy failed — select and copy manually.'));
}


// ── LIVE MODE ─────────────────────────────────────────────────────
let liveSessionToken = null;
let liveSocket = null;
let liveCountdownInterval = null;
let liveSessionExpiry = null;
let isLiveMode = false;

async function requestLiveMode() {
  const btn = document.getElementById('live-request-btn');
  if (!btn) return;
  btn.disabled = true; 
  const origText = btn.textContent;
  btn.textContent = 'Requesting...';
  
  try {
    const symbol = document.getElementById('symbol-input').value.toUpperCase().trim() || 'ETHUSDT';
    const res = await fetch('/live-request', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ symbol }) 
    });
    
    const data = await res.json();
    if (res.status === 402 && data.invoice) {
      isLiveMode = true;
      currentRequestId = data.invoice.requestId;
      currentInvoice = data.invoice;
      showInvoice(data.invoice);
    } else {
      alert(data.error || 'Failed to start Live Mode');
    }
  } catch (err) { 
    alert('Error: ' + err.message); 
  } finally { 
    btn.disabled = false; 
    btn.textContent = origText; 
  }
}

function startLiveSession(session) {
  liveSessionToken = session.token; 
  liveSessionExpiry = new Date(session.expiresAt);
  
  // Persist session to survive page reloads
  localStorage.setItem('liveSession', JSON.stringify({
    token: session.token,
    expiresAt: session.expiresAt
  }));
  
  // Hide invoice/report, show live mode panel
  hide('invoice-panel');
  hide('report-panel');
  show('live-mode-panel');
    
  if (liveCountdownInterval) clearInterval(liveCountdownInterval);
  
  liveCountdownInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((liveSessionExpiry - Date.now()) / 1000));
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    
    const timerEl = document.getElementById('live-timer');
    if (timerEl) {
      timerEl.textContent = `${m}:${s}`;
      timerEl.style.color = remaining <= 60 ? 'var(--red)' : 'var(--accent)';
    }
    
    if (remaining === 0) { 
      clearInterval(liveCountdownInterval); 
      endLiveSession(); 
    }
  }, 1000);
  
  if (liveSocket) liveSocket.close();
  
  // Connect to WS
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}?token=${session.token}`;
  liveSocket = new WebSocket(wsUrl);
  
  liveSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'update') updateLiveDashboard(data);
      if (data.type === 'expired') endLiveSession();
    } catch (err) {}
  };
}

function updateLiveDashboard(r) {
  const verdict = r.verdict || 'HOLD';
  const banner  = document.getElementById('live-verdict-banner');
  if (banner) banner.className = `verdict-banner ${verdict}`;
  setText('live-verdict-text', verdict);
  setText('live-confidence-text', `Confidence: ${r.confidence} — Updated: ${new Date().toLocaleTimeString()}`);

  const rb = document.getElementById('live-risk-badge');
  if (rb) { rb.textContent = `Risk: ${r.riskLevel}`; rb.className = `risk-badge risk-${r.riskLevel}`; }

  const ms  = r.marketSnapshot  || {};
  const chg = parseFloat(ms.priceChange24h) || 0;
  setHTML('live-snapshot-grid', `
    <div class="snap-item"><div class="snap-label">Live Price</div><div class="snap-val">$${ms.currentPrice || '—'}</div></div>
    <div class="snap-item"><div class="snap-label">24h Change</div><div class="snap-val ${chg>=0?'pos':'neg'}">${ms.priceChange24h || '—'}</div></div>
    <div class="snap-item"><div class="snap-label">Vol Surge Pricing</div><div class="snap-val" style="color:var(--accent)">$${r.pricing?.price || '0.01'} USDC</div></div>
    <div class="snap-item"><div class="snap-label">Range Pos.</div><div class="snap-val">${ms.rangePosition || '—'}</div></div>
  `);

  const sig = r.signals || {};
  function sigCard(label, s, vizHtml, detail) {
    let shortNarrative = (s?.narrative || '').split('. ')[0] + '.';
    if (shortNarrative === '.') shortNarrative = '';

    return `<div class="signal-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div class="s-label" style="margin:0">${label}</div>
        <div class="s-value ${s?.signal || ''}" style="margin:0; font-size:14px;">${s?.signal || '—'}</div>
      </div>
      ${vizHtml}
      <div class="s-metrics" style="border:none; padding:0; margin-top:8px;">${detail}</div>
      ${shortNarrative ? `<div class="s-narrative">${shortNarrative}</div>` : ''}
    </div>`;
  }

  const obViz = `
    <div class="viz-labels"><span class="green">${sig.orderBook?.bidPct || 50}% Bids</span><span class="red">${sig.orderBook?.askPct || 50}% Asks</span></div>
    <div class="viz-bar-container">
      <div class="viz-buy" style="width: ${sig.orderBook?.bidPct || 50}%"></div>
      <div class="viz-sell" style="width: ${sig.orderBook?.askPct || 50}%"></div>
    </div>
  `;

  const tmViz = `
    <div class="viz-labels"><span class="green">${sig.tradeMomentum?.buyPctNum || 50}% Buys</span><span class="red">${(100 - (sig.tradeMomentum?.buyPctNum || 50)).toFixed(1)}% Sells</span></div>
    <div class="viz-bar-container">
      <div class="viz-buy" style="width: ${sig.tradeMomentum?.buyPctNum || 50}%"></div>
      <div class="viz-sell" style="width: ${(100 - (sig.tradeMomentum?.buyPctNum || 50)).toFixed(1)}%"></div>
    </div>
  `;

  const rPos = parseFloat(ms.rangePosition) || 50;
  const priceViz = `
    <div class="viz-labels"><span>24h Low</span><span>24h High</span></div>
    <div class="viz-bar-container" style="background: linear-gradient(90deg, var(--red) 0%, var(--green) 100%); opacity: 0.8;">
      <div class="viz-range-marker" style="left: calc(${rPos}% - 2px);"></div>
    </div>
    <div class="viz-range-labels"><span>$${ms.low24h}</span><span>$${ms.high24h}</span></div>
  `;

  const trendViz = `
    <div class="viz-labels"><span>First 12h: $${sig.klineTrend?.first12hAvg}</span><span>Last 12h: $${sig.klineTrend?.last12hAvg}</span></div>
    <div class="viz-bar-container" style="background: var(--surface2)">
      <div class="viz-buy" style="width: ${sig.klineTrend?.signal === 'BULLISH' ? '100%' : '0%'}; background: ${sig.klineTrend?.signal === 'BULLISH' ? 'var(--green)' : 'transparent'}"></div>
      <div class="viz-sell" style="width: ${sig.klineTrend?.signal === 'BEARISH' ? '100%' : '0%'}; background: ${sig.klineTrend?.signal === 'BEARISH' ? 'var(--red)' : 'transparent'}"></div>
    </div>
  `;

  const fundingViz = `
    <div class="viz-labels" style="justify-content:center;font-size:16px;">
      <span class="${sig.fundingRate?.signal === 'BULLISH' ? 'green' : (sig.fundingRate?.signal === 'BEARISH' ? 'red' : '')}">${sig.fundingRate?.rate || 'N/A'}</span>
    </div>
  `;

  setHTML('live-signals-grid',
    sigCard('Order Book', sig.orderBook, obViz,
      `Wall Support: $${sig.orderBook?.biggestBidWall?.price || '—'} &nbsp;|&nbsp; Wall Resist: $${sig.orderBook?.biggestAskWall?.price || '—'}`) +
    sigCard('Trade Momentum', sig.tradeMomentum, tmViz,
      `Last ${sig.tradeMomentum?.sampleSize || '—'} real-time trades analyzed`) +
    sigCard('24h Kline Trend', sig.klineTrend, trendViz,
      `Momentum shift over 24 hourly candles`) +
    sigCard('24h Price Range', sig.priceChange, priceViz,
      `Volatility: ${ms.avgHourlyVolatility || '—'}% / hr &nbsp;|&nbsp; Current Range Pos: ${ms.rangePosition || '—'}`) +
    sigCard('Technicals (RSI & SMA)', sig.technicals, `
      <div class="viz-labels"><span>RSI (14): ${sig.technicals?.rsi}</span><span class="${sig.technicals?.rsiSignal === 'BULLISH' ? 'green' : (sig.technicals?.rsiSignal === 'BEARISH' ? 'red' : '')}">${sig.technicals?.rsiSignal}</span></div>
      <div class="viz-bar-container" style="background: linear-gradient(90deg, var(--green) 0%, var(--surface2) 50%, var(--red) 100%);">
        <div class="viz-range-marker" style="left: calc(${sig.technicals?.rsi}% - 2px);"></div>
      </div>
    `, `SMA 7: $${sig.technicals?.sma7} &nbsp;|&nbsp; SMA 21: $${sig.technicals?.sma21} &nbsp;(<span class="${sig.technicals?.smaSignal === 'BULLISH' ? 'green' : 'red'}">${sig.technicals?.smaSignal}</span>)`) +
    sigCard('Futures Funding Rate', sig.fundingRate || { signal: 'NEUTRAL' }, fundingViz,
      sig.fundingRate?.interpretation || 'Spot token or unavailable')
  );
}

function endLiveSession() {
  if (liveSocket) liveSocket.close();
  if (liveCountdownInterval) clearInterval(liveCountdownInterval);
  isLiveMode = false;
  localStorage.removeItem('liveSession');
  
  const timerEl = document.getElementById('live-timer');
  if (timerEl) timerEl.textContent = '00:00';
  
  alert("Live session ended.");
  hide('live-mode-panel');
}


// ── AUTO-RESTORE LIVE SESSION ON PAGE RELOAD ───────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('liveSession');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (new Date(parsed.expiresAt) > Date.now()) {
         isLiveMode = true;
         startLiveSession(parsed);
      } else {
         localStorage.removeItem('liveSession');
      }
    } catch(e) {}
  }
});
