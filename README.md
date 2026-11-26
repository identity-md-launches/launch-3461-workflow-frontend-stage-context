# fivewords

Five strangers write one image prompt, one word each, and the IMD swarm draws it. It runs five
times, then ends. `FiveWords` is the one contract of this launch: an immutable ERC-721 collection
named "fivewords", symbol `FIVE`, 25 NFTs in all, one per word. It has no owner, no admin function,
no proxy and no upgrade path.

This repository is the contract stage of the launch: the contract, its tests, its ABI
(`docs/abi/FiveWords.json`) and this document. It deploys nothing and writes no `launch.json`; the
manifest, the independent security review, the deployment and the website are later steps.

## Website

The site for this contract is in `web/` (Vite, React, TypeScript), and its built static export is
committed at `dist/` (relative asset URLs, hash routes). Install, preview and rebuild it from `web/`:

```
cd web
npm ci              # install from package-lock.json
npm run typecheck   # tsc, no emit
npm run build       # rebuild ../dist and dist/imd-deployment.json
npm run preview     # serve ../dist at http://localhost:4173
npm run test:mock   # browser checks of the export against a mocked RPC (needs Playwright Chromium)
```

`web/README.md` explains the configuration and tests, `DESIGN.md` the design system, and
`docs/validation.md` what was checked and what was not.

## Layout

| Path | What |
| --- | --- |
| `src/FiveWords.sol` | The collection and the game. |
| `src/IIntake.sol` | The Intake version 2 interface, as the protocol publishes it for clients. |
| `test/FiveWords.t.sol` | Writing words, ordering, the round clock, payments, price changes, rollback, reentrancy. |
| `test/FiveWordsCallbacks.t.sol` | Callback authentication, binding to the outstanding request, callback gas, result URI rules, ordering again. |
| `test/FiveWordsMetadata.t.sol` | Metadata before and after the image, deployment parameters, no owner, runtime opcodes and size. |
| `test/mocks/` | A local Intake that keeps the live one's rules, and a plain ERC-20. |
| `docs/abi/FiveWords.json` | The ABI the site binds to. |
| `lib/` | forge-std v1.11.0 and OpenZeppelin Contracts v5.4.0, vendored as ordinary files. |

## How the game works

Images are numbered 1 to 5 and the slots of an image 1 to 5. The NFT of image `i`, slot `s` is token
`(i - 1) * 5 + s`, so tokens are 1 to 25.

**Writing a word.** `addWord(word)` writes the next word of the open image and mints that slot's NFT
to the sender (`_mint`, so no receiver callback runs).

- The word is `a` to `z` only, 1 to 20 letters. Anything else reverts `BadWord`.
- One word per wallet per image (`AlreadyAdded`). The same wallet may write in every image. A wallet
  is not a person: one person with five wallets can write a whole image.
- It costs `amountDue()` in IMD, pulled from the sender with `transferFrom`: a fifth of
  `Intake.priceOf(action, IMD)` (rounded down) for words one to four, and for the fifth word
  whatever is missing to the whole live price. With an unchanged price of 0.5 IMD that is 0.1 IMD
  for every word.
- Before the image opens it reverts `NotOpenYet(image, opensAt)`; after the fifth image is ordered
  it reverts `GameOver`. If the Intake does not sell the action (`priceOf` is zero) it reverts
  `NotSold`.

**Ordering the image.** The fifth word's transaction also orders the image: it approves exactly the
live price to the Intake and calls
`requestWithFailure(action, body, Callback(this, onResult), onFailure, IMD, price)`. The body is
built onchain from the brief's text with the five words, space separated, in slot order
(`bodyOf(image)` returns it). The transaction then requires that nothing is left approved
(`PaymentNotTaken`) and that the request id is new (`RequestIdReused`). If any of this reverts, the
whole transaction reverts: no word, no NFT, no payment.

**The round clock.** Image 1 opens at deployment. Image `n + 1` opens `ROUND_INTERVAL` (5 hours)
after image `n` is ordered, whether or not its result has arrived. Nothing waits on a callback.

**What comes back.** `onResult(requestId, resultHash, uri)` and
`onFailure(requestId, status, reason, agreed, answered, signature)` accept only the Intake as sender
(`NotIntake`) and only the request an image is currently waiting on (`NotOutstanding`), so each is
settled once. They store and emit and do nothing else.

- A result marks the image `Delivered` and stores the hash and the URI. The URI must be 1 to 128
  bytes of printable ASCII with no `"` and no `\` (`BadUri`), so it is safe inside the JSON metadata
  and its storage cost is bounded. The Intake records a refused result as not delivered; the order
  then stays open and can be ordered again after `RETRY_AFTER`.
- A failure marks the image `Failed` and stores the status and reason. Nothing is refunded.

**Ordering again.** `retry(image)` orders an image again with the same five words and slots. Anyone
may call it; the sender pays the full live price (`retryPrice()`). It is accepted when the image is
`Failed`, or when it is `Ordered` and has had no answer for `RETRY_AFTER` (24 hours); otherwise
`NotRetryable`. `orderedAt` and the next image's `opensAt` do not move. The new request replaces the
old one: a late answer to the replaced request is refused. A `Delivered` image is final.

**Metadata.** `tokenURI` is a `data:application/json;base64` document built onchain. Until the image
arrives its `image` is an SVG of the image's words, the token's own word in black
(`svgOf(tokenId)`). Once delivered it is the file pinned beside the result document: for
`ipfs://CID/result.json` that is `ipfs://CID/artifacts/print.png` (`imageURI(image)`). A result URI
of any other shape gets `/artifacts/print.png` appended. ERC-4906 `BatchMetadataUpdate` is emitted
when a word is added and when the image arrives. `contractURI()` gives collection metadata.

## Money

- IMD enters only through `addWord` and `retry`, always from `msg.sender`.
- IMD leaves only to the Intake, exactly the live price per order, approved for that call only.
  The Intake forwards it to its treasury in the same call.
- `pot` is what words have paid and no order has spent. With a steady price it returns to zero at
  every order. If the price falls during a round the surplus stays in `pot` and lowers what the
  next image's fifth word pays. If the price rises, the later words of the round make it up.
- There are no fees, no refunds and no withdrawal function. A surplus left in `pot` after the fifth
  image, the words paid into a round nobody finishes, and IMD or ETH sent to the contract by
  mistake stay there for good. The contract refuses plain ETH transfers.
- The sender's allowance is their ceiling: a wallet that approves exactly `amountDue()` cannot be
  charged more if the price moves before its transaction lands (it reverts instead). A wallet that
  approves more than that accepts whatever the live price makes due, which for a fifth word after a
  large price rise could be much more than a fifth.

## Deployment parameters

`constructor(IIntake intake_, IERC20 imd_, bytes32 action_)`: three static words, nonpayable, calls
no other contract and needs none to exist. Values for Ethereum mainnet (chain id 1), all from the
brief:

| Argument | Value |
| --- | --- |
| `intake_` | `0xa43e6f75ee006411f79ac1c84120606c2330de82` (Intake version 2) |
| `imd_` | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` (IMD) |
| `action_` | `0x6a6f622e6f70656e406a6f622d31000000000000000000000000000000000000` (`job.open@job-1`, UTF-8 right-padded) |

There is no owner argument because the brief asks for no owner-only function. Zero for any argument
reverts. `foundry.toml` pins solc 0.8.26, EVM version cancun, optimizer on with 200 runs and
`bytecode_hash = "none"`. Runtime size is 16,509 bytes.

Constants, all in `FiveWords.sol`:

| Constant | Value | From |
| --- | --- | --- |
| `IMAGES`, `WORDS_PER_IMAGE`, `MAX_SUPPLY` | 5, 5, 25 | the brief |
| `MAX_WORD_LENGTH` | 20 | the brief |
| `ROUND_INTERVAL` | 5 hours | the brief |
| `RETRY_AFTER` | 24 hours | chosen here: how long an order may go unanswered before anyone may order it again |
| `MAX_URI_BYTES` | 128 | chosen here: the longest result URI stored; an `ipfs://CID/result.json` URI is about 78 bytes |

## After launch

Nothing is set after deployment: there is no setter and no owner. Image 1 is open from the block
the contract is deployed in.

## What was checked against the live protocol

- Ethereum mainnet state, read over JSON-RPC: the Intake at the address above has code holding the
  selectors of `priceOf(bytes32,address)` and
  `requestWithFailure(bytes32,bytes,(address,bytes4),bytes4,address,uint256)`;
  `priceOf(job.open@job-1, IMD)` returned 0.5 IMD; the token reports symbol `IMD`, 18 decimals.
- The brief's body with five sample words (the exact bytes `EXPECTED_BODY` in the tests) was sent to
  the plane's `POST /requests/check` as action `job.open`. It answered kind `image`, a one-step plan
  with skill `create-image`, and `"blockers":[]`.
- A fork test against mainnet state (run locally, not part of the delivered suite because the
  verifier has no network): five words written, the live Intake took the order and exactly 0.5 IMD
  and emitted its `Requested` event with this contract as payer and callback target; the live
  writer's `complete` then reached `onResult` (status 0) and, separately, `onFailure` (status 2),
  and `retry` ordered again. `addWord` used about 177,000 to 228,000 gas for words one to four and
  about 423,000 for the fifth.
- Callback gas, measured in the suite from cold storage: `onResult` with the longest accepted URI
  uses about 156,000 of its 200,000 (the test fails above 165,000); `onFailure` uses about 38,000.

## Assumptions and trust

- **The Intake is trusted for results.** Nothing is signed: the hash and the URI are the Intake
  writer's word. A wrong result cannot be replaced once delivered. No value moves on a callback.
- **The Intake, the asset and the action are fixed.** The protocol's client guidance prefers these
  owner-settable; the brief asks for an immutable contract with no owner-only function, and that is
  what is built. If the Intake moves, stops selling `job.open@job-1` or changes its asset, no more
  words or orders can be made (`NotSold` or a revert from the Intake) and whatever is in `pot`
  stays there. NFTs already minted are unaffected.
- **The price is the Intake's.** It is read live on every word. A price of 0.5 IMD is what makes a
  word cost 0.1 IMD.
- **The contract is the payer** of every order, so the plane treats every image's job as one
  project of this contract. Nothing here continues a job, and no user gains anything from another's.
- **Words are public and permanent**, and reach a worker's prompt. The body tells the worker to
  treat them as a description and to leave out names, brands and explicit requests; the plane's own
  screens apply. A refused order is a failure like any other, and the price is spent.
- **Time** is `block.timestamp`, used only for the five-hour and one-day waits.
- **A lost callback** leaves an image `Ordered`; the result stays readable from the plane, and
  after a day anyone may pay to order it again.

## Operational responsibilities

- The manifest step fills the three constructor arguments above; there is no `$owner` argument.
- The website reads `amountDue()` for the button and approves exactly that amount of IMD to this
  contract before `addWord`; for `retry` it approves exactly `retryPrice()`. It reads
  `currentImage()`, `imageInfo(image)` (status, counts, `opensAt`, `orderedAt`, request id, result
  hash, URI, words), `canRetry(image)`, `imageURI(image)` and `ownerOf(tokenId)` for holders, and
  shows words as plain text.
- Explorer verification of the source and the final independent security review belong to the
  launch. The tests here are not an audit. Slither was not available on this machine and was not
  run; the source uses no assembly, no `abi.encodePacked`, no `delegatecall`, no `selfdestruct` and
  pulls tokens only from `msg.sender`.

## Build and test

```
forge build
forge test
forge fmt --check
```

The suite passes with test isolation on and off and with the verifier's fuzz seed.
