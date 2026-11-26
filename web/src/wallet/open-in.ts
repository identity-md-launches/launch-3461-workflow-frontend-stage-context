/**
 * Mobile without a relay: a phone browser has no extension, so the sheet offers to open this page
 * inside a wallet's own browser, where that wallet is injected. Each link is the one its vendor
 * documents; none needs a project ID or a server.
 */
export const OPEN_IN: ReadonlyArray<{ id: string; name: string; verb?: string; href: (url: string) => string }> = [
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks
  { id: "metamask", name: "MetaMask", href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}` },
  // https://docs.cdp.coinbase.com/wallet-sdk/docs/deep-link
  { id: "coinbase", name: "Coinbase Wallet", href: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  // Rabby publishes no page link, so this row goes to its site to get the app, and says so.
  { id: "rabby", name: "Rabby", verb: "get", href: () => "https://rabby.io/" },
  // https://docs.phantom.com/phantom-deeplinks/other-methods/browse
  {
    id: "phantom",
    name: "Phantom",
    href: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];

/** A phone or tablet browser: where the open-in links make sense when no wallet is in the page. */
export const isMobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** A wallet injected as window.ethereum (one that may not announce itself by EIP-6963). */
export const hasInjectedProvider = () => !!(window as unknown as { ethereum?: unknown }).ethereum;
