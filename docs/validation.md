# fivewords website: validation record

The frontend stage of launch `a9881956-4bea-4ae1-885e-94a534f54cdf`. Contract `FiveWords` at
`0x241cc9f4525d6184b29e0bbc9f8af015dcaa4ea2` on Ethereum mainnet (chain 1). Deployed source commit
`29c4264743a89978beb3af53dc78fcded3ffe804`.

## Scope and assumptions

- Pages: play (`#/`), gallery (`#/gallery`), one page per image (`#/image/1` to `#/image/5`) and
  about (`#/about`). The footer is on every page. Source is in `web/`, the export in `dist/`.
- Primary contract actions with controls: `addWord(word)` (after an exact IMD `approve`), and
  `retry(image)`, shown only when `canRetry` is true. The callbacks `onResult`/`onFailure` accept
  only the Intake, and the ERC-721 transfer functions are not part of the game, so neither has a
  control. The contract has no owner settings ("After launch: nothing is set").
- Reads come from the manifest's public RPCs (`network.rpcUrls`, with fallback) for every visitor.
  With a wallet connected the page also reads that wallet's IMD balance, its allowance to FiveWords
  and `hasWord`. Before enabling any write it checks that the RPC answers chain id 1 and that the
  address has code.
- This is an `evm_contracts` launch with no token or pool of its own and no `poolKey` in the
  handoff. The site therefore has no swap, quote or liquidity flow and uses none of the
  `network.uniswapV4` addresses. The about page links out to Uniswap for buying IMD. That link is
  not a swap built into the site.
- Inferred choices: all copy is lowercase (the brief asks for a lowercase about page, and the rest
  follows it for one voice), the headline is "five words, one image", and the delivered image is
  shown through public IPFS gateways (`ipfs.io`, then `dweb.link`).
- `DESIGN.md` is at `docs/DESIGN.md`, not the repository root. The assignment's write scope is
  `web/**`, `dist/**` and `docs/**`, and a root file would be outside it.

## Deployment binding

- `docs/abi/FiveWords.json` at the source commit gives canonical keccak (sorted keys, compact JSON)
  `39546ba2fddb8a2970d587fa0d2162165ea432d32b32c5a14da3478e834e6cda`. That equals the handoff
  `abiHash`. `web/scripts/manifest.mjs` checks this on every build.
- `dist/imd-deployment.json` holds exactly these top-level keys: `version`, `launchId`, `chainId`,
  `sourceCommit`, `attestationHash`, `contracts`, `assets`, `network` and `walletAddChain`.
  `network` and `walletAddChain` are copied unchanged from `network.json`. There is no `poolKey`
  because the handoff has none. Every other file in `dist/` is listed with its SHA-256: 10 assets,
  about 1.39 MB in all, the largest file 585 KB.
- The app loads `./imd-deployment.json` and its `abiPath` at runtime (`web/src/config.ts`). No
  other address, chain or ABI map exists in the source.
- Live mainnet reads through the contributor RPC at build time: `currentImage()` = 1,
  `amountDue()` = 0.1 IMD, `totalSupply()` = 0, and code is present (16,509 bytes).

## Verification (commands actually run)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` (`tsc -p tsconfig.json`) | passed, no errors |
| Production build | `cd web && npm run build` | passed. Vite 6 wrote `dist/`, then the manifest script printed "1 contract(s), 10 assets" |
| Interaction test | `FORK_URL=… ANVIL=anvil node web/tests/interaction.mjs` | **39 passed, 0 failed**, 0 outside requests |
| Design probe taste@1 | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | **15/16 passed**. `type-faces` fails on monospace prose (see below) |
| Manifest re-check | a separate script recomputes every asset hash, the ABI hash and the key set (see the last section) | passed |

### What the interaction test does

It runs the final export in Chromium (Playwright 1.64.1) at 390×844, served from a fake gateway
subpath (`http://fivewords.test/ipfs/bafytest/`) so the relative paths are exercised. Both manifest
RPC URLs are answered by a local anvil fork of mainnet that runs the deployed FiveWords bytecode
and the live Intake and IMD code. Five anvil accounts get 100 IMD each through IMD's balance slot.
A scripted EIP-6963 wallet ("Test Wallet") forwards to the fork. It starts on chain 0xaa36a7 and
does not know chain 1. Nothing was broadcast to mainnet. The test checked:

- The page loads from the subpath and reads the contract. The title is "fivewords". The frame and
  "add · 0.1 IMD" are on the first screen at 390×844. There is no horizontal scroll at 320 or 390
  (play and about pages).
- Disconnected, "add" opens the connect sheet. The sheet lists Test Wallet by name, hides the
  generic injected row, offers Coinbase Wallet, and closes on Escape.
- Wrong chain: the header and the main button both read "switch to Ethereum". The wallet answered
  4902, so the page sent `wallet_addEthereumChain` with params byte-equal to `walletAddChain`, then
  switched. The connected short address appeared.
- A bad word ("Hello world") shows the rule next to the input and disables the button. A good word
  enables it, and the page says "two wallet prompts" before the first one.
- Approve and add: the approval calldata is `approve(FiveWords, 100000000000000000)`, exactly the
  amount due. `addWord` is sent to the handoff address. The result reads "“lantern” is word 1 of
  image 1. nft #1 is yours, paid 0.1 IMD.", built from the receipt's `WordAdded` event. Slot 1 then
  shows the word read back from the chain.
- The same wallet is told "already wrote a word in image 1" before it can sign.
- When the wallet rejects with code 4001 the page reports "declined" and sends no transaction.
- Words 2 to 5 come from four more wallets. The fifth word's transaction ordered the image through
  the real Intake code on the fork, and the page reported "that was the fifth word: the image is
  ordered" from the `ImageOrdered` event. A single countdown, "image 2 opens in 04:59:5x", appeared,
  and the frame kept showing the ordered image.
- The gallery has five frames. Image 1's page lists five holders linked to `opensea.io/<address>`
  and NFT links `opensea.io/assets/ethereum/<contract>/<id>`. The words render as plain text.
- The about page links "this is just a tiny five word example. what will you build?" to
  `https://explorer.imd.fun/launch`. The footer is present.
- There are no console errors and no outside requests other than the RPCs.

Screenshots from the final run were viewed (390 disconnected, 390 countdown, 1440 play). They are in
`test/scratch/shots/`, which is not delivered.

## Better Interface review: coverage

| Domain | Status | Evidence |
| --- | --- | --- |
| Accessibility | Checked (keyboard and screen reader partly) | Native `button`/`a`/`label`/`input` throughout. `:focus-visible` 2px ring (`web/src/styles.css:81`). A skip link. The sheet is a `role="dialog"` with `aria-modal`, Escape, a focus trap and focus return (`ConnectSheet.tsx`). Input errors use `role="alert"` and `aria-invalid`. Steps are `aria-live`. The countdown is `role="timer"`. Probe `targets` passed. Not done: a screen-reader session, native 200% zoom, a full keyboard-only walk in a browser. |
| Layout | Checked | The product is first. The word form is on the first screen at 390 (test). No overflow at 320/390/1440 (test and probe `layout`). Long values wrap. |
| Writing | Checked | One lowercase voice with verb-first buttons ("add", "connect", "order again", "switch to Ethereum"). Errors say how to fix and sit next to the field. Every disabled state has a reason line. Probe `glyphs`, `slogans`, `repetition` and `copy-budget` passed (32 prose words on the first screen at 390). |
| Typography | Checked | 1 family, 2 weights, 5 sizes (probe `type-sizes` passed). Tabular numbers on the countdown. 16px inputs. |
| Colors | Checked | Token roles in `:root`. One filled action per view. The probe's `contrast` check passed on the rendered entry page. Other routes and the sheet were not contrast-measured. |
| UI | Checked | Flat surfaces with outline only (probe `chrome` passed). Transitions only on `background-color`/`color`. Reduced motion turns them off (probe `motion` passed). The marks are 28px with official wallet SVGs. |

## Findings and fixes

| # | Severity | Location | Finding | Fix and recheck |
| --- | --- | --- | --- | --- |
| 1 | High | `web/src/styles.css:227` | At 390×844 the "add" button sat at y=917, below the fold, under five slot rows (test measurement). | Under 820px the heading, countdown and word form now come before the slots. Recheck: the button is inside 844 (test passes, screenshot viewed). |
| 2 | High | `web/src/game.ts:285` | Clicking "add" did nothing: `useWalletClient()` had not resolved after the chain switch, and `run` threw before showing any step. | The flow now gets the wallet client with `getWalletClient` when it signs, and reports "connect/switch first" in the page instead of throwing. Recheck: five approve+add flows completed. |
| 3 | Medium | `web/src/Actions.tsx:184` | During the countdown, "image 2 opens in …" appeared twice (strict-mode locator found 2). | The form's blocker line is hidden when the round is closed. Recheck: the test asserts one countdown. |
| 4 | Medium | `web/src/Actions.tsx:22` | The final result repeated the last step's note word for word. | The last step's note is suppressed when the result box carries it. |
| 5 | Medium | `web/src/Actions.tsx:174` | The word input stayed editable while the round was closed. | It is disabled while not open. |
| 6 | Medium | `web/src/styles.css:103` | Probe `eyebrows`: the logo and nav link sat within 40px above the h1 and read as kicker labels. | `main` now has 40px of top padding. Recheck: probe `eyebrows` passes. |
| 7 | Low | `web/src/config.ts:90` | The Coinbase SDK logged "Failed to execute inlined telemetry script" to the console. | `preference.telemetry: false`. Recheck: no console errors. |
| 8 | Kept (brief) | `web/src/styles.css` `--font` | Probe `type-faces` fails on monospace prose (the lede and notes). | Not changed. The brief says "black monospace". |

## Not tested, and limitations

- **No real wallet or live mainnet transaction.** Signing was simulated by a scripted EIP-1193
  wallet against an anvil fork. MetaMask, Rabby, Coinbase Wallet/Smart Wallet popups, the mobile
  "open in" links and a real `wallet_addEthereumChain` prompt were not exercised.
- **`retry`** was not exercised. It needs a failed or day-old order, and the fork test did not
  simulate an Intake failure callback. The control, its approval of exactly `retryPrice()` and its
  `ImageOrdered` receipt report share code with the tested add flow.
- **A delivered image** has not been seen: none exists yet on mainnet, and the fork test did not
  deliver one. The frame flip (`Frame.tsx`) and gateway fallback are untested in a browser.
- **WebKit/Safari** and physical devices were not tested. Only Chromium ran. Screen-reader and
  native-zoom checks were not performed.
- **Gas**: the page sets no gas limit and lets the wallet estimate. FiveWords has no `gasleft()`
  check or fixed-gas forward on the paths the page calls. On the fork, the fifth word (which calls
  the Intake) succeeded with the wallet's estimate, and the order event was present.
- **og:image** is a relative path (`./og.png`). It becomes absolute only once the site's address is
  known at publication.
- **Countdown** uses the visitor's clock against the onchain `opensAt`. A skewed clock shifts the
  display, and the contract still enforces the real time (`NotOpenYet` is shown if simulation
  fails).
- The "0.1 imd" on the about page is the brief's wording. The button and approval always use the
  live `amountDue()`.
- Publication checks (CID, naming, hosted RPC checks) are run later by the control plane and are
  not claimed here.

## Completion

Complete for the stated scope, with the limitations above: build, typecheck, fork-backed
interaction test, the design probe and a source review against the six domains all ran on the final
export.
