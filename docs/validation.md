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
  loaded from `https://imd-ipfs.xyz/ipfs/<CID>/artifacts/print.png`, then from the IMD API (revision 4).
- `DESIGN.md` is at the repository root (moved from `docs/DESIGN.md` in revision 4, when the write
  scope allowed it).

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

## Revision 4: delivered images and the about page (this round)

### What changed

| Request | Change | Source |
| --- | --- | --- |
| Images showed "image unavailable": ipfs.io and dweb.link answer image requests with a bot check (403) | A delivered image loads from `https://imd-ipfs.xyz/ipfs/<CID>/artifacts/print.png` first. On error the site finds the fifth word's transaction (`WordAdded` with `image`, `slot = 5`, looked up in the block whose timestamp is the image's `orderedAt`, found by stepping 12-second slots from the latest block), reads `entries[0].admission.result.jobId` from `GET https://api.imd.fun/intake/1/<tx>`, then shows the `url` of the file named `print` from `GET https://api.imd.fun/jobs/<id>/result`. If both fail, the sentence stays with "image unavailable" and the next contract refresh (12 s) starts again from the gateway. ipfs.io and dweb.link are no longer used | `web/src/image-source.ts`, `web/src/Frame.tsx`, `web/src/config.ts` (`IMD_IPFS_GATEWAY`, `IMD_API`), `web/src/game.ts` (`readAt` per image) |
| About: only "what will you build?" is a link | The sentence "this is just a tiny five word example." is plain text, then the link to `https://explorer.imd.fun/launch` | `web/src/App.tsx` `About` |
| About: link "imd swarm" to https://imd.fun | Linked. The about page's first line, "a mini experiment in multiplayer ai.", does not contain "imd swarm"; the first paragraph that does is the next one, and that is where the link is | `web/src/App.tsx` `About`, `IMD_SITE` in `config.ts` |
| About: IMD address under "where to get imd" | "imd address: 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", linked to `https://etherscan.io/token/<address>`. The address comes from the manifest's `network.pairToken` (the same value as the deployment's `imd_` constructor argument), the explorer from `network.explorer`; nothing new is hard-coded | `web/src/App.tsx` `About` |
| About: last section "how this was built" | `h2` "how this was built" and "built by a distributed swarm of agents (imd). see the prompt and job breakdown.", with "prompt and job breakdown" linked to `https://explorer.imd.fun/jobs/7c1baf52-c412-4eff-9dc7-612016bac5d8` | `web/src/App.tsx` `About`, `BUILD_JOB` in `config.ts` |

Live state when this was built: `currentImage()` = 2, image 1 delivered with result
`ipfs://bafybeigmq6qhme4m27uvg5n5fque46p3yba7bicszaynpapaytuqaylqae/result.json`, the words
"slifer parade everlight garden candlelight", fifth word in transaction
`0xaccac19952629dd05c2a90a7a35b9b22959bc7dba025ddd84fea4e60e78d00c5` (block 26500324). Image 2 opens
at unix 1795725551. Until then `/` shows image 1, as before: between rounds the play page shows the
image just ordered. Once image 2 opens, `/` shows image 2's frame for writing, and image 1 stays in
the gallery and on `/#/image/1`. That rule predates this revision and was kept.

### Checks run on the final export

Chromium 156 headless shell (Playwright 1.64.1). Its missing system libraries and fonts were
unpacked from Ubuntu 24.04 packages into `test/scratch/` and loaded with `LD_LIBRARY_PATH` and a
local fontconfig file. Nothing was installed system-wide.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` | passed, no errors |
| Production build | `cd web && npm run build` | passed. Manifest script: "1 contract(s), 10 assets", 1,405,255 bytes |
| Mocked interaction, full suite | `cd web && node tests/mock-rpc.mjs` | **106 passed, 0 failed**. This includes the new `delivered` scenarios: gateway 200 (picture on `/`, the gallery tile and `/#/image/1`, the API not asked, ipfs.io/dweb.link never asked, alt text has the five words). Gateway 403 with the API answering (the `WordAdded(image 1, slot 5)` log query on FiveWords, `/intake/1/<that tx>`, `/jobs/job-1234/result`, the `print` URL shown on all three pages). Both failing, once with the intake answering 404 and once with the print URL answering 404 ("image unavailable", the words inside the frame). Recovery: the gateway turns to 200 and the next refresh shows the picture. The new `about` scenario covers every link and text above, the section order, and no sideways scroll and no page errors at 320, 390 and 1440 |
| Live network, gateway | the export served at a fake origin in Chromium, real RPC and real hosts | image 1 loaded from `https://imd-ipfs.xyz/ipfs/bafybeigmq…/artifacts/print.png` (naturalWidth 1254) on `/`, `/#/gallery` and `/#/image/1`. Once loaded, the picture has no `loading` class, opacity 1, and the sentence is removed |
| Live network, API fallback | the same, with `imd-ipfs.xyz` answered 403 | the site asked `api.imd.fun/intake/1/0xaccac199…d00c5`, then `/jobs/c9eff464-dbfe-46cb-834c-c94102f021b3/result`, then showed `https://api.imd.fun/artifacts/7b7dd4c9…10bc` in the frame of `/#/image/1`. The block lookup found the exact block |
| Design probe | `IMD_PLAYWRIGHT=web/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **15/16**. Before the fix below it was 14/16, with `eyebrows` failing. Now only `type-faces` fails (monospace prose, from the brief's "black monospace"). The 390 screenshot shows the headline, the lede, image 1 from the live gateway, "image 1 of 5", the countdown and the word input with "add · 0.1 IMD" on the first screen |
| Fork interaction | `web/tests/interaction.mjs` | **not run this round**: it needs Foundry's `anvil`, which is not on this machine. Its about-page link check was updated to the new link text ("what will you build?") |

WebKit was not run (as in revision 3). No screen reader, no physical phone and no native 200% zoom
were used.

### Better Interface review of the changed surfaces

Scope: the frame on `/`, `/#/gallery` and `/#/image/n`, and the about page. The rest of the site is
unchanged since revision 3 and was not reviewed again.

| Domain | Coverage | Notes |
| --- | --- | --- |
| Accessibility | Checked | The picture has alt text "image n: <five words>". While it loads it is `aria-hidden` and the sentence (with its `aria-label`) is still the frame's text. New links are native `<a>` with visible names and the existing focus ring. The status caption is text, not colour. Screen reader: not verified |
| Layout | Checked | The 42-character address wraps with `.break` at 320 (no sideways scroll, measured). The "how this was built" section follows the existing `.prose` rhythm. The stage gap changed, see finding 1 |
| Writing | Checked | The brief's sentences are used verbatim, in lowercase. Link text names its destination ("imd swarm", "prompt and job breakdown"). "image unavailable" was kept as the brief asks |
| Typography | Checked | No new sizes or weights. The probe's `type-sizes` and `tracking` pass |
| Colors | Checked | No new colours. The probe's `contrast` check passes at 320, 390 and 1440. Text over the picture: none (the caption is its own white row) |
| UI | Checked | Loading, failed and retried states of the picture, see finding 2. No motion was added |

| # | Severity | Finding | Fix | Recheck |
| --- | --- | --- | --- | --- |
| 1 | Medium | `web/src/styles.css:220` `.stage` had a 16px gap under 820px, so at 390 the frame's "1/5" caption (`web/src/Frame.tsx` caption) sat within 40px above the panel heading "image 1 of 5" and read as a kicker label (probe `eyebrows`, first screen) | The `.stage` gap is 40px (`--space-6`) at every width, the value desktop already used | Probe `eyebrows` passes. The 390 first screen still shows the word form and its button |
| 2 | Medium | `web/src/Frame.tsx`: a delivered image (3.8 MB print) showed an empty white square until it finished downloading, with no words and no picture | The picture and the sentence share the frame's first row. The picture is hidden (`.frame-img.loading`, `styles.css:311`) until `onLoad`, and the sentence stays until then | Live: loaded picture visible (opacity 1), sentence removed. Mocked: frames-inside checks pass in all states |

Completion: complete for the stated scope. The limitations are the ones listed above: the fork
interaction test, WebKit, screen reader and physical devices were not run.

## Revision 3: review findings

Three findings were reported. Each was reproduced with new scenarios in `web/tests/mock-rpc.mjs`
(Chromium 1255 via Playwright 1.64.1), first against the previously accepted export and then
against the rebuilt one. Old export: the new checks failed as listed below. New export: the full
mocked suite gives **75 passed, 0 failed**.

| Finding | Reproduced on the old export | Fix | Check on the new export |
| --- | --- | --- | --- |
| Add / Order Again could request more than the button quoted (high, `130f5cbf…`) | `clickprice`: with the button showing "add · 0.1 IMD" and `amountDue` moved to 0.2 before the click, the first click sent `approve,addWord` and no note was shown | `AddWord` and `Retry` pass the price on the clicked button to the flow. The click-time read is compared with it. If they differ, nothing goes to the wallet, the note reads "the price changed to {amount} IMD. review the amount and press the button again.", the draft stays, and the refetch puts the new price on the button. The post-approval recheck in `exactApproval` is unchanged (`web/src/Actions.tsx` `addFlow`, `Retry.submit`) | `clickprice`: add and retry both send **zero** transactions on the stale click, show the note and update the button ("add · 0.2 IMD", "order again · 1 IMD"). The draft "lantern" is kept. A fresh click then approves exactly 0.2 and adds. The existing `allowance` scenario still covers a price move after approval |
| Full-precision prices push payment buttons off the viewport (high, `d16609f7…`) | `longprice`: at 320×700, "add · 0.099999999999999999 IMD" right edge 322.05, scrollWidth 322. At 390×844, "order again · 0.499999999999999999 IMD" right edge 394.06, scrollWidth 394 | `.add-row > .btn, .retry > .btn`: `max-inline-size: 100%`, `white-space: normal`, `overflow-wrap: anywhere`, 8px block padding. The 44px minimum and the full labels are kept (`web/src/styles.css`) | `longprice`: both buttons stay inside the viewport, height ≥ 44, document scrollWidth ≤ the viewport width, full label matched by its accessible name |
| Image 2 inherited Image 1's retry receipt (medium, `4c4891f6…`) | `retry`: after the image 1 order and refetch, the "image 2" link showed a `.retry` panel with "image 1 is ordered again (attempt 2)." and both links | `<Retry key={n} …>` in `web/src/App.tsx`, so each image page has its own panel state | `retry`: the receipt survives the refetch on image 1. On image 2 there is no retry panel and nothing was sent. Back on image 1 the page shows a fresh state |

WebKit could not launch here (Playwright reported missing `libgtk-4`, `libgraphene`, `libevent`
and GStreamer libraries). The new scenarios loop over WebKit when `WEBKIT=1` is set, but that run
did not happen on this machine, so the WebKit results are unverified here.

Re-run this round, on the final export:

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` | passed, no errors |
| Production build | `cd web && npm run build` | passed. The manifest script printed "1 contract(s), 10 assets", 1,402,196 bytes |
| Mocked interaction | `cd web && node tests/mock-rpc.mjs` | **75 passed, 0 failed** |
| Fork interaction | `FORK_URL=<contributor mainnet RPC> ANVIL=anvil node web/tests/interaction.mjs` | **39 passed, 0 failed**, 0 blocked outside requests |
| Design probe, offline | `IMD_PLAYWRIGHT=… node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | **15/16**, the same as the accepted round. Only `type-faces` fails (monospace prose, from the brief) |
| Design probe, online | the same command without `--offline` | 14/16. `type-faces` as above, plus `eyebrows`: at 390, the frame's "1/5" counter (`web/src/Frame.tsx:48`) sits within 40px above the panel heading "image 1 of 5". It is a data caption under the image, not a kicker. The code is unchanged since the accepted round and no finding names it, so it was left as it is and is recorded here |
| Manifest re-check | script: file set vs `assets`, SHA-256 of each, `network`/`walletAddChain` byte-equal, contract/address/abiHash and identifiers present in the handoff, key set | passed: 10 files, all hashes match, 9 keys, no `poolKey` (the handoff has none). The ABI files are byte-identical to the accepted round, and the build's manifest script checks their canonical Keccak hash against the handoff |

## Revision 2: review findings

An outside review reported eleven defects. Each was reproduced before it was changed: the new
mocked-RPC harness `web/tests/mock-rpc.mjs` (Chromium 1255 via Playwright 1.65.1, 390×844 unless
stated) was run against the previously accepted export (`git archive HEAD dist`) and against the
new one. Old export: 1 passed, 16 failed across the scenarios below, plus 5 frame failures. New
export: **60 passed, 0 failed**.

| Finding | Reproduced on the old export | Fix | Check on the new export |
| --- | --- | --- | --- |
| Words clipped or covered in frames (high) | Play frame y=257–613, first word line from y=250, caption from y=578; the 320×700 play frame and the 390/1440 gallery tiles clipped too | The frame is a two-row grid, sentence then caption (`web/src/styles.css:253`). A container query sets 20px and 16px sides in large frames under 461px. Gallery tiles: 13px, 4px padding, 168px minimum, `auto-fit`, 8px gap. The gateway-failure notice is gone; the caption says "image unavailable" and the URI stays in the details (`web/src/Frame.tsx`) | `frames`: every word box inside its frame and above its caption on play and gallery at 390×844, 320×700 and 1440×844. `delivered`: both gateways 502, the words stay visible and the caption says "image unavailable" |
| Unavailable price shown as free (high) | `add · price unavailable` never appeared; the page showed `add · 0 IMD` | `amountDue` read failure is `null`, not `0n` (`web/src/game.ts:92`). Button "add · price unavailable", disabled, and the recovery line. The click-time read is caught and shown beside the draft. Same for "order again" | `price`: disabled label and message. A failed click-time read shows the message, keeps the draft, sends nothing and raises no page error |
| Surplus allowance could pay more (high) | Allowance 0.5, price 0.1: only `addWord` was sent | Approval is skipped only when the allowance equals the price, else set to exactly the price. Before the paying transaction the price and allowance are read again. If either moved the flow stops, shows the new price and needs a new click (`web/src/Actions.tsx` `exactApproval`) | `allowance`: `approve(FiveWords, 0.1)` then `addWord`. With the price moved to 0.2 after the approval: no `addWord`, "the price changed to 0.2 IMD…", and the button reads "add · 0.2 IMD" |
| Decline cleared the draft (medium) | Draft empty, add disabled | The runner returns whether every receipt confirmed. The draft is cleared only then; otherwise focus returns to the input | `decline`: word kept, focus in `#word`, add enabled |
| Retry panel lost its feedback (medium) | No switch message; the panel was gone after the refetch | The panel stays while it has steps or a result. Only the button and its note hide. The switch error renders under the button | `retry`: "the wallet declined the switch." shown. After `ImageOrdered` and the refetch, the result "(attempt 2)" and both transaction links remain |
| "nothing was sent" after a mined approval (medium) | Step and summary said "nothing was sent" | Step: "the wallet declined the add transaction." Summary: "your 0.1 IMD approval is onchain. your word was not added." (from the approval receipt). For a retry, "…image n was not ordered again." | `decline`: exact texts asserted |
| Mobile sheet hid an announced wallet (medium) | Test Wallet missing on an iPhone UA | Announced wallets always show. The generic row shows only when `window.ethereum` exists. The open-in rows show on phones with no in-page wallet. Desktop with none gets a note instead of a failing row | `sheet`: iPhone + EIP-6963 lists and connects Test Wallet. iPhone without a wallet gets the open-in rows. Desktop without one has no "browser wallet" row |
| One failed holder hid all (medium) | No "holder unavailable"; zero links | One query per token with 2 retries. A failed slot shows "holder unavailable · retry" (`.linkbtn`) | `holders`: 4 links and 1 "holder unavailable · retry". Its retry restores the fifth |
| Escape dropped focus (low) | `activeElement` not the address button | Escape focuses the address button | `escape` |
| "opened" for a future time (low) | (by reading `App.tsx`) | "opens" while `opensAt` is ahead, the same comparison as the countdown | `holders`: image 1 "opened", image 2 "opens" |
| "open in Rabby" went to rabby.io (low) | Row label "open in Rabby" | The row reads "get Rabby" | `sheet`: "get Rabby" → `https://rabby.io/`. The other rows carry the page URL |

WebKit could not be launched on this machine (Playwright reported missing `libgtk-4`, `libpango`
and `libcairo`). The WebKit gallery report is therefore unverified here. The fix is plain CSS
grid and flex, with a container query (WebKit 16+). The harness has `WEBKIT=1` to include it.

The fork-backed `web/tests/interaction.mjs` was **not re-run** this round. This machine has no
`anvil` and no mainnet RPC. Its results below are from the accepted round. The mocked harness
covers the changed flows (approve and add, decline, retry, wrong chain), but not against the real
deployed bytecode.

## Verification (commands actually run)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck (this round) | `cd web && npx tsc -p tsconfig.json` | passed, no errors |
| Production build (this round) | `cd web && npm run build` | passed. The manifest script printed "1 contract(s), 10 assets", 1,401,864 bytes |
| Mocked interaction (this round) | `cd web && node tests/mock-rpc.mjs` | **60 passed, 0 failed** |
| Design probe (this round) | `IMD_PLAYWRIGHT=… node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | **15/16**, the same as before: only `type-faces` (monospace prose, from the brief) fails. The 390 screenshot shows the frame, "your word" and "add" on the first screen |
| Manifest re-check (this round) | script: file set vs `assets`, SHA-256 of each, `network`/`walletAddChain` byte-equal, key set | passed: 10 files, all hashes match, 9 keys, no `poolKey` (the handoff has none) |
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
- **`retry`** was exercised only against the mocked RPC (`retry` scenario): an exact approval of
  `retryPrice()`, the `retry` call and the `ImageOrdered` receipt report. It has not run against the
  deployed bytecode, because the fork test did not simulate an Intake failure callback.
- **A delivered image** has not been seen: none exists yet on mainnet. With mocked state, the
  gateway-failure path was checked (both gateways 502: "image unavailable", words kept). A
  successful picture load was not tested.
- **WebKit/Safari** and physical devices were not tested. Only Chromium ran. WebKit could not
  launch here (missing GTK libraries). Screen-reader and
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
