export const CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_GOERLI: 5,
  ETHEREUM_SEPOLIA: 11155111,
  POLYGON_MAINNET: 137,
  POLYGON_MUMBAI: 80001,
  BSC_MAINNET: 56,
  BSC_TESTNET: 97,
  ARBITRUM_ONE: 42161,
  ARBITRUM_GOERLI: 421613,
  OPTIMISM: 10,
  OPTIMISM_GOERLI: 420,
  AVALANCHE: 43114,
  AVALANCHE_FUJI: 43113,
  BASE: 8453,
  BASE_GOERLI: 84531,
};

// Known Tornado Cash contracts (mixer)
export const KNOWN_MIXER_ADDRESSES = new Set([
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', // Tornado Cash Router
  '0x722122df12d4e14e13ac3b6895a86e84145b6967', // Tornado Cash Proxy
  '0x905b63fff465b9ffbf41dea908ceb12478ec7601', // TC ETH 0.1
  '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', // TC ETH 1
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf', // TC ETH 10
  '0xa160cdab225685da1d56aa342ad8841c3b53f291', // TC ETH 100
  '0x23773e65ed146a459667130a0c95b16840b4a23e', // TC Notes
  '0xe4b679400f0f267212d5d812b95f58c83243ee71', // RenBridge
  '0xba214c1c1928a32bffe790263e38b4af9bfcd659', // TC USDT
  '0xd96f2b1c14db8458374d9aca76e26c3950218744', // TC DAI
]);

// Known cross-chain bridge contracts
export const KNOWN_BRIDGE_ADDRESSES = new Set([
  '0x3ee18b2214aff97000d974cf647e7c347e8fa585', // Wormhole
  '0x5427fefa711eff984124bfbb1ab6fbf5e3da1820', // Celer cBridge
  '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf', // Polygon Bridge
  '0xa0c68c638235ee32657e8f720a23cec1bfc77c77', // Polygon Bridge (old)
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', // Optimism Bridge
  '0x8484ef722627bf18ca5ae6bcf031c23e6e922b30', // Arbitrum Bridge
]);

export const LARGE_TRANSFER_THRESHOLDS: Record<string, number> = {
  ETH: 10,
  WETH: 10,
  BTC: 0.5,
  WBTC: 0.5,
  USDC: 50000,
  USDT: 50000,
  DAI: 50000,
  BUSD: 50000,
  MATIC: 100000,
  BNB: 500,
};
