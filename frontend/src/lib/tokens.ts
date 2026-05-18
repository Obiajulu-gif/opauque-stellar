/**
 * Token configuration for Stellar. Native XLM only.
 */

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

export const NATIVE_TOKEN: TokenInfo = {
  symbol: "XLM",
  name: "Stellar Lumens",
  decimals: 7,
};

export function getNativeToken(): TokenInfo {
  return NATIVE_TOKEN;
}
