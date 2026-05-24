/**
 * Canonical asset alias map.
 * Keys are lowercase aliases → canonical uppercase symbol.
 */
const ASSET_ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  eth: "ETH",
  solana: "SOL",
  sol: "SOL",
  "usd tether": "USDT",
  "tether usd": "USDT",
  tether: "USDT",
  usdt: "USDT",
  polygon: "MATIC",
  matic: "MATIC",
  "chain link": "LINK",
  chainlink: "LINK",
  link: "LINK",
};

/**
 * Normalise an asset string to its canonical symbol.
 * e.g. "bitcoin" → "BTC", "eth" → "ETH"
 * Unknown assets are upper-cased and returned as-is.
 */
export function normalizeAsset(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return ASSET_ALIASES[lower] ?? raw.trim().toUpperCase();
}

/**
 * Returns true if two asset strings refer to the same canonical asset.
 */
export function assetsMatch(a: string, b: string): boolean {
  return normalizeAsset(a) === normalizeAsset(b);
}
