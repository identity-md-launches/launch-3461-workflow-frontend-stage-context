# fivewords: the website

A static Vite + React + TypeScript site for the `FiveWords` contract on Ethereum mainnet
(`0x241cc9f4525d6184b29e0bbc9f8af015dcaa4ea2`). Visitors read the five frames, write a word
(approve exactly the amount due in IMD, then `addWord`), order a failed image again (`retry`),
browse the gallery and a page per image with its holders linked to OpenSea, and read the about page.

The built export is committed at the repository root in `dist/`. It is plain files with a relative
base and hash routes (`#/`, `#/gallery`, `#/image/1` … `#/image/5`, `#/about`), so it works from an
IPFS gateway subpath or an ENS name with no server rewrites.

## Configuration: one place

The site reads its deployment at runtime from **`dist/imd-deployment.json`** and the ABI that file
names (`dist/abi/FiveWords.json`). Nothing else holds an address, chain id, ABI or RPC URL.

- `web/scripts/manifest.mjs` writes that file after `vite build`, from
  - `web/deployment/handoff.json`, the deployment handoff, unchanged;
  - `web/deployment/network.json`, the network's chain-table entry for chain 1, unchanged (its
    `network` and `walletAddChain` blocks are copied byte-for-byte into the manifest);
  - `docs/abi/FiveWords.json`, the implementation-derived ABI at the deployed source commit. The
    script checks its canonical keccak (keys sorted, no whitespace) against the handoff's `abiHash`
    and stops if they differ.
  It then lists every exported file except itself with its SHA-256 hash.
- `web/src/config.ts` loads the manifest and ABI, builds the viem chain (`network.rpcUrls` with
  fallback, `network.explorer`), the read client and the wagmi config. It also holds the site's own
  public constants: name, description, the sources of delivered images (`IMD_IPFS_GATEWAY`
  `https://imd-ipfs.xyz/ipfs/` and `IMD_API` `https://api.imd.fun`), OpenSea, imd.fun, the
  explorer.imd.fun launch and build-job links and the Uniswap link on the about page. There are no keys, private
  RPCs or WalletConnect project IDs.

Wallets: browser extensions by EIP-6963, phones by opening the page in the wallet's own browser
(MetaMask, Coinbase Wallet, Phantom links; Rabby links to its install page because it publishes no
page link), and Coinbase Smart Wallet. One connect control. On the wrong chain the control reads
"switch to Ethereum": it sends `wallet_switchEthereumChain`, and on code 4902 it sends
`wallet_addEthereumChain` with the manifest's `walletAddChain`, then switches again.

This launch has no token or pool of its own (`evm_contracts`), so the site has no swap, quote or
liquidity flow and uses none of the `network.uniswapV4` addresses. Its only approval is IMD to the
FiveWords contract, for exactly `amountDue()` (or `retryPrice()` for a retry).

## Install, build, preview

```
cd web
npm ci                # installs from package-lock.json
npm run typecheck     # tsc, no emit
npm run build         # tsc, vite build into ../dist, then scripts/manifest.mjs
npm run preview       # serves ../dist at http://localhost:4173
```

Any change to the export means running `npm run build` again: it rewrites `dist/` and the manifest
together. Commit `dist/` with the source.

## Validation

`web/tests/interaction.mjs` drives the built export in Chromium (Playwright) against a local anvil
fork of mainnet running the deployed contract, with a scripted EIP-6963 wallet. It needs Foundry's
`anvil`, Playwright with a Chromium build, and a mainnet RPC:

```
FORK_URL=https://ethereum-rpc.publicnode.com ANVIL=anvil node tests/interaction.mjs
```

`web/tests/mock-rpc.mjs` needs no chain: it serves the built export in Chromium, answers the RPC
URLs from an in-memory contract state decoded with the deployment ABI, and drives a scripted wallet
through the frame layout, delivered-image sources (gateway, API fallback, both failing and the
retry on refresh, a delivery seen by the poll, the sentence kept until `decode()`), image 1 kept on
play while image 2 takes words, the add button at 390x790, about page, price, exact-approval, decline, retry, connect-sheet, holder and
keyboard scenarios. It needs only Playwright with a Chromium build:

```
npm run build && npm run test:mock          # or: node tests/mock-rpc.mjs delivered about
```

## Delivered images

`src/image-source.ts` and `src/Frame.tsx`. A delivered image loads from
`https://imd-ipfs.xyz/ipfs/<CID>/artifacts/print.png` (the CID of the image's onchain URI). If that
fails, the site finds the fifth word's transaction (the `WordAdded` log of slot 5, looked up in the
block whose timestamp is the image's `orderedAt`), reads `entries[0].admission.result.jobId` from
`GET https://api.imd.fun/intake/1/<tx hash>`, then shows the `url` of the file named "print" from
`GET https://api.imd.fun/jobs/<job id>/result`. If both fail the frame keeps the sentence with
"image unavailable" and tries again on the next refresh of the contract read (every 12 seconds).
The API is asked only after the gateway URL has failed (or when there is none), never because of
an earlier state of the frame. Once image 1 is delivered it stays on the play page: in the stage
while it is the focus, then below the stage while a later image takes words.
The site no longer uses ipfs.io or dweb.link: both answer image requests with a bot check (403).

Results, the design review and what was not tested are in `docs/validation.md`. The design
system is described in `DESIGN.md` at the repository root.
