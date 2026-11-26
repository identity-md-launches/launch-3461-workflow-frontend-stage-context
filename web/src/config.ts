/**
 * The site's one configuration.
 *
 * Deployment values (chain id, contract address, ABI, public RPC URLs, explorer, wallet chain
 * parameters) are not written here: they are read at runtime from `./imd-deployment.json`, the
 * manifest published beside index.html, and the ABI file it points to. This module loads that
 * file and turns it into the objects the rest of the site uses. The constants below are the
 * site's own metadata and public, credential-free links.
 */
import { createConfig, fallback, http, type Config } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { createPublicClient, defineChain, getAddress, type Abi, type Address, type Chain, type PublicClient } from "viem";

export const SITE_NAME = "fivewords";
export const SITE_DESCRIPTION =
  "five strangers write one image prompt, one word each, and the imd swarm draws it. five images, then it ends.";

/**
 * Where a delivered image is loaded from, in order. First the IMD IPFS gateway, at
 * `<gateway><CID>/artifacts/print.png`. If that fails, the IMD API: the intake record of the
 * fifth word's transaction names the job, and the job's result lists its files; the one named
 * "print" has the image URL. (ipfs.io and dweb.link answer image requests with a bot check.)
 */
export const IMD_IPFS_GATEWAY = "https://imd-ipfs.xyz/ipfs/";
export const IMD_API = "https://api.imd.fun";
/** The IMD swarm's home, linked from the about page. */
export const IMD_SITE = "https://imd.fun";
/** The prompt and job breakdown of the job that built this site. */
export const BUILD_JOB = "https://explorer.imd.fun/jobs/7c1baf52-c412-4eff-9dc7-612016bac5d8";
/** OpenSea, for token and holder links. */
export const OPENSEA = "https://opensea.io";
/** The IMD launch explorer the about page links to. */
export const IMD_EXPLORER_LAUNCH = "https://explorer.imd.fun/launch";
/** Where to swap ETH for IMD (an outside site; this site has no swap of its own). */
export const uniswapLink = (token: string) => `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${token}`;

/** No WalletConnect project ID: the brief supplies none, and mobile wallets connect without a relay. */
export const walletConnectProjectId = "";

export type ManifestContract = { name: string; address: string; abiHash: string; abiPath: string };
export type Manifest = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  walletAddChain?: Record<string, unknown> & { chainId: string };
};

export type Deployment = {
  manifest: Manifest;
  chain: Chain;
  address: Address;
  abi: Abi;
  explorer: string;
  walletAddChain?: Manifest["walletAddChain"];
  publicClient: PublicClient;
  wagmi: Config;
};

/** Loads `imd-deployment.json` and the FiveWords ABI it names, relative to the page. */
export async function loadDeployment(base = "./"): Promise<Deployment> {
  const res = await fetch(`${base}imd-deployment.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`imd-deployment.json answered ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  if (manifest.version !== 1) throw new Error("imd-deployment.json is not version 1");
  if (manifest.network?.chainId !== manifest.chainId) throw new Error("imd-deployment.json network is for another chain");
  const entry = manifest.contracts.find((c) => c.name === "FiveWords");
  if (!entry) throw new Error("imd-deployment.json lists no FiveWords contract");
  if (/^[a-z]+:|\.\./i.test(entry.abiPath)) throw new Error("abiPath must be relative to the site");
  const abiRes = await fetch(`${base}${entry.abiPath}`, { cache: "no-cache" });
  if (!abiRes.ok) throw new Error(`${entry.abiPath} answered ${abiRes.status}`);
  const abi = (await abiRes.json()) as Abi;

  const n = manifest.network;
  const chain = defineChain({
    id: manifest.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: { default: { name: "explorer", url: n.explorer } },
    testnet: n.testnet,
  });
  const transport = fallback(n.rpcUrls.map((u) => http(u)));
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const wagmi = createConfig({
    chains: [chain],
    // EIP-6963 discovery lists every installed extension under its own name.
    multiInjectedProviderDiscovery: true,
    connectors: [injected(), coinbaseWallet({ appName: SITE_NAME, preference: { options: "all", telemetry: false } })],
    transports: { [chain.id]: transport },
  });
  return {
    manifest,
    chain,
    address: getAddress(entry.address),
    abi,
    explorer: n.explorer.replace(/\/$/, ""),
    walletAddChain: manifest.walletAddChain,
    publicClient,
    wagmi,
  };
}
