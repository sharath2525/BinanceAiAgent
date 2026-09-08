import { ethers } from 'ethers';

const USDC_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];

// ── SUPPORTED CHAINS ────────────────────────────────────────────
// All verified addresses + correct decimals per chain.
export const SUPPORTED_CHAINS = {
  bsc: {
    chainId:     56,
    name:        'BNB Chain',
    symbol:      'BNB',
    rpcEnv:      'BNB_CHAIN_RPC',
    defaultRpc:  'https://bsc-dataseed.binance.org/',
    usdc:        '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals:    18,            // Binance-pegged USDC = 18 decimals!
    explorer:    'https://bscscan.com',
    icon:        'BNB',
    hex:         '0x38',
    rpcUrls:     ['https://bsc-dataseed.binance.org/'],
    native:      { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
  ethereum: {
    chainId:     1,
    name:        'Ethereum',
    symbol:      'ETH',
    rpcEnv:      'ETH_RPC',
    defaultRpc:  'https://cloudflare-eth.com',
    usdc:        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals:    6,
    explorer:    'https://etherscan.io',
    icon:        'ETH',
    hex:         '0x1',
    rpcUrls:     ['https://cloudflare-eth.com'],
    native:      { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  polygon: {
    chainId:     137,
    name:        'Polygon',
    symbol:      'MATIC',
    rpcEnv:      'POLYGON_RPC',
    defaultRpc:  'https://polygon-rpc.com',
    usdc:        '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    decimals:    6,
    explorer:    'https://polygonscan.com',
    icon:        'POL',
    hex:         '0x89',
    rpcUrls:     ['https://polygon-rpc.com'],
    native:      { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  arbitrum: {
    chainId:     42161,
    name:        'Arbitrum',
    symbol:      'ETH',
    rpcEnv:      'ARBITRUM_RPC',
    defaultRpc:  'https://arb1.arbitrum.io/rpc',
    usdc:        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals:    6,
    explorer:    'https://arbiscan.io',
    icon:        'ARB',
    hex:         '0xa4b1',
    rpcUrls:     ['https://arb1.arbitrum.io/rpc'],
    native:      { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    chainId:     8453,
    name:        'Base',
    symbol:      'ETH',
    rpcEnv:      'BASE_RPC',
    defaultRpc:  'https://mainnet.base.org',
    usdc:        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals:    6,
    explorer:    'https://basescan.org',
    icon:        'BASE',
    hex:         '0x2105',
    rpcUrls:     ['https://mainnet.base.org'],
    native:      { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    chainId:     10,
    name:        'Optimism',
    symbol:      'ETH',
    rpcEnv:      'OPTIMISM_RPC',
    defaultRpc:  'https://mainnet.optimism.io',
    usdc:        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    decimals:    6,
    explorer:    'https://optimistic.etherscan.io',
    icon:        'OP',
    hex:         '0xa',
    rpcUrls:     ['https://mainnet.optimism.io'],
    native:      { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

// ── DEMO MODE ──────────────────────────────────────────────────
const DEMO_MODE = process.env.DEMO_MODE === 'true';

// ── ISSUE INVOICE ───────────────────────────────────────────────
export function issueInvoice(requestId, expiresAt, price = null) {
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || '0xDEMO_WALLET_NOT_SET';
  const finalPrice  = price || process.env.ANALYSIS_PRICE_USDC || '0.01';

  // Build chain list for the UI
  const chains = Object.entries(SUPPORTED_CHAINS).map(([key, c]) => ({
    key,
    name:     c.name,
    chainId:  c.chainId,
    icon:     c.icon,
    usdc:     c.usdc,
    decimals: c.decimals,
    explorer: c.explorer,
    hex:      c.hex,
  }));

  return {
    requestId,
    amount:      parseFloat(finalPrice),
    currency:    'USDC',
    recipient:   agentWallet,
    expiresAt:   expiresAt.toISOString(),
    demoMode:    DEMO_MODE,
    chains,
    protocol:    'x402 / B402 — Binance HTTP Payment Standard',
  };
}

// ── VERIFY PAYMENT ──────────────────────────────────────────────
export async function verifyPayment(txHash, chainKey = 'bsc', expectedPrice = null) {
  if (DEMO_MODE) {
    console.log(`[payment] DEMO MODE — approving: ${txHash} on ${chainKey}`);
    return true;
  }

  const chain = SUPPORTED_CHAINS[chainKey];
  if (!chain) {
    console.error(`[payment] Unknown chain key: ${chainKey}`);
    return false;
  }

  try {
    const rpc      = process.env[chain.rpcEnv] || chain.defaultRpc;
    const provider = new ethers.JsonRpcProvider(rpc);
    const receipt  = await provider.getTransactionReceipt(txHash);

    if (!receipt || receipt.status !== 1) {
      console.log(`[payment] Tx failed or not found on ${chain.name}: ${txHash}`);
      return false;
    }

    const iface          = new ethers.Interface(USDC_ABI);
    const agentWallet    = (process.env.AGENT_WALLET_ADDRESS || '').toLowerCase();
    const requiredAmount = ethers.parseUnits(
      (expectedPrice || process.env.ANALYSIS_PRICE_USDC || '0.01').toString(),
      chain.decimals
    );

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== chain.usdc.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog(log);
        if (
          parsed.name === 'Transfer' &&
          parsed.args.to.toLowerCase() === agentWallet &&
          parsed.args.value >= requiredAmount
        ) {
          const amount = ethers.formatUnits(parsed.args.value, chain.decimals);
          console.log(`[payment] VERIFIED on ${chain.name} — ${amount} USDC received`);
          return true;
        }
      } catch { continue; }
    }

    console.log(`[payment] No valid USDC transfer in tx ${txHash} on ${chain.name}`);
    return false;

  } catch (err) {
    console.error(`[payment] Verification error on ${chain.name}: ${err.message}`);
    return false;
  }
}
