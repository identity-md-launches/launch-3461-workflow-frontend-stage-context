# fivewords design system

This file belongs at the repository root. This assignment can write only `web/**`, `dist/**` and
`docs/**`, so it is here instead. Everything below comes from the final source in `web/src/`.

## Overview

fivewords is a small onchain game: five strangers each write one word, and the five words become an
image prompt. The brief sets the look: "light grey, black monospace, black outlines", with one white
frame per image. The site is flat and quiet. A light grey page holds white surfaces with 2px black
outlines, everything is set in one monospace family, and all copy is lowercase. The product comes
first on every screen: the frame and its five slots, then the word form. Prose stays short and sits
next to the control it explains.

## Colors

Tokens in `web/src/styles.css` (`:root`, line 2). Hex is the canonical format.

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#e4e4e4` | page background, the light grey |
| `--paper` | `#ffffff` | frames, slot lists, inputs, quiet buttons, menus, the connect sheet |
| `--ink` | `#000000` | text, every outline, the one filled (primary) button, the focus ring |
| `--muted` | `#4d4d4d` | secondary text: lede, notes, captions, inactive nav, footer, disabled buttons |
| `--faint` | `#767676` | unwritten slots (`____`, "open") and the input placeholder, on white |
| `--hover` | `#f0f0f0` | hover on quiet buttons and sheet rows |
| `--press` | `#d6d6d6` | pressed quiet buttons and rows |
| `--error` | `#9e0000` | error text and the invalid input border, always together with words |

The primary button's hover and press shades (`#262626`, `#404040`) are written in `.btn-primary`.
The sheet backdrop is `rgb(0 0 0 / 0.35)`. There is no dark theme. The taste@1 probe measured text
contrast on the rendered entry page at 320, 390 and 1440 and found no failures. Individual pairs
were not measured one by one.

## Typography

- Family: `--font`: `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`.
  System fonts only. No font files ship.
- Weights: 400 and 700. 700 is used only for `h1`, the `.logo` and the sheet title.
- Sizes (tokens): `--fs-meta` 13px (notes, captions, steps, footer, facts), `--fs-body` 15px (body,
  buttons, slots), `--fs-input` 16px (inputs, so iOS does not zoom), `--fs-h2` 20px (panel
  headings), `--fs-h1` 28px (page headline and the sentence in the large frame). Five sizes in all.
- The sentence inside a frame: 28px in a large frame at least 461px wide, 20px (`--fs-h2`) with 16px
  side padding in a narrower large frame (a container query on `.frame`), and 13px (`--fs-meta`)
  with 4px padding and line-height 1.2 in a gallery tile. At each size a 20-letter word fits on one
  line in a monospace face of 0.6em, and five such words fit above the caption.
- `h1` letter-spacing is -0.02em. Headings use `line-height: 1.2` and `text-wrap: balance`. Body
  line-height is 1.5.
- Numbers that change (countdown, slot numbers) use `font-variant-numeric: tabular-nums` (`.num`,
  `.slot-n`).
- Addresses, words, URIs and request data wrap with `overflow-wrap: anywhere`. They are never
  truncated with an ellipsis, except the short `0x1234…abcd` address on buttons, which always comes
  with the full address (in the wallet menu, or as the link's `title`).

## Layout

- Spacing scale: `--space-1` to `--space-6` = 4, 8, 12, 16, 24 and 40px.
- Content width: `--max` 1080px, centred. `main` has 40px of padding above it (so the header does
  not read as a label over the headline) and 16px at the sides.
- Header (`.top`): the logo at the left edge, the page links, then the wallet control at the right
  edge. Under 560px the page links drop to their own row (`styles.css:142`).
- `.stage` is the frame-plus-panel layout used on the play page and the image pages. It is one
  column under 820px and two columns from 820px (`1.15fr` frame, `1fr` panel, 40px gap,
  `styles.css:240`). Under 820px (`styles.css:227`) the panel shows its heading, countdown and word
  form before the slot list, so the main action stays on the first phone screen.
- The gallery grid (`.grid`) is `repeat(auto-fit, minmax(168px, 1fr))` with an 8px gap: one
  column at 320, two at 390, and the five tiles share the row at 1440.
- The payment buttons wrap their full-precision price inside the panel rather than widen the page.
- No horizontal scrolling at 320, 390 or 1440, measured by the interaction test and the probe.

## Elevation & Depth

Flat. There are no shadows. Depth comes from 2px black outlines (`--line`) and white surfaces on
grey. The only overlays are the wallet menu (absolute, `z-index: 5`) and the connect sheet (fixed
backdrop, `z-index: 20`). The connect sheet is a bottom sheet under 640px and centred above that.

## Shapes

Square corners everywhere (`border-radius: 0`). Outlines are 2px (`--line`) on frames, slot lists,
buttons, inputs, menus, the sheet and result boxes. Lighter 1px black rules separate slot rows, sheet
rows, step numbers and the sheet's × button. The frame is a 1:1 square (`aspect-ratio`), and the
large frame is capped at 64vh. Inside, the frame is a two-row grid: the sentence (or the picture)
fills the first row and the caption is the second, so the caption never covers words.

## Components

| Component | Source | Use and states |
| --- | --- | --- |
| Button `.btn` / `.btn-primary` | `styles.css` (`.btn`), used across `src/` | 44px minimum height. Quiet buttons are white with a black outline; hover `--hover`, pressed `--press`, disabled has grey text and border. Use `.btn-primary` (black fill) for exactly one action per view: "add · 0.1 IMD". Focus shows a 2px `--ink` ring offset 2px (`:focus-visible`, `styles.css:81`). Buttons do not wrap (`nowrap`), except the two payment buttons ("add · …" in `.add-row`, "order again · …" in `.retry`): they carry the full-precision live price, so they are capped at the panel width (`max-inline-size: 100%`), wrap (`white-space: normal`, `overflow-wrap: anywhere`) and get 8px block padding, keeping the 44px minimum. |
| Frame | `src/Frame.tsx` `Frame` | `size="large"` (play page, image page) or `"small"` (gallery). Words are plain text and `____` stands for open slots. When the image is delivered the frame flips to the picture from `imageURI` through `IPFS_GATEWAYS`, trying the next gateway on error. If every gateway fails the sentence stays and the caption says "image unavailable"; the full result URI is in the image page's details. The caption shows `n/5` and the status line (a short form in gallery tiles: "ordered", "order failed", "3 of 5 words"). `FramePlaceholder` in `App.tsx` keeps the same shape while loading. |
| Slot list `.slots` | `App.tsx` (`Play`, `ImagePage`) | Five numbered rows. A filled row is `--ink`; an open row is `--faint` "open". On the image page each row also shows `.slot-meta` (the NFT and its holder, linked to OpenSea). |
| Word form | `src/Actions.tsx` `AddWord` | A labelled input (16px) and the primary button. The help text sits under the input and turns into the error text (`role="alert"`) when the word is invalid. One blocker line says why the button is disabled. Before the first prompt it says "two wallet prompts: approve exactly …". Disconnected, the button opens the connect sheet; on the wrong chain it reads "switch to Ethereum". If the price read fails the button reads "add · price unavailable", disabled, with "the image price is unavailable. try again after the next refresh." The click reads `amountDue()` again; if it differs from the price on the button, nothing goes to the wallet, the button updates, the draft stays and the note reads "the price changed to {amount} IMD. review the amount and press the button again." The draft is cleared only when a receipt shows `WordAdded`; after a decline or a failure the word stays and focus returns to the input. |
| Steps `.steps` | `Actions.tsx` `Steps` | The numbered steps of a transaction flow, each `todo`, `wait`, `sign`, `mining`, `done` or `error`, with a note and a "view transaction" explorer link. `aria-live="polite"`. A `.result` box under the steps gives what the receipt shows. |
| Retry | `Actions.tsx` `Retry` | Appears when `canRetry(image)` is true: a quiet button "order again · {price}" with the same exact-approve-then-call steps, the same click-time price check against the button, and its switch error under it. The panel is keyed by image number, so its steps and receipt stay with that image and do not follow the visitor to another image page. Once the order goes through, the button and its note go, and the steps, links and result stay. |
| Inline action `.linkbtn` | `styles.css` | A button styled as underlined text for an action inside a line, such as "holder unavailable · retry" on the image page. |
| Wallet control and connect sheet | `src/wallet/ConnectSheet.tsx` | "connect" opens the sheet: wallets announced by EIP-6963 (on any device), a generic "browser wallet" row only when `window.ethereum` exists and nothing announced itself, then Coinbase Wallet. On a phone with no wallet in the page, the "open in …" rows come first ("get Rabby" goes to rabby.io, as Rabby has no page link). On a desktop with none, a note says no browser wallet was found. Rows are 48px with 28px marks (`wallet-icons.ts`). The sheet closes on Escape, the backdrop or ×, keeps focus inside, and returns focus when it closes. Connected, the control shows the short address and opens a menu with the full address and "disconnect"; Escape closes the menu and returns focus to the address button. |
| Notes, banner, facts | `styles.css` `.note`, `.banner`, `.facts` | `.note` is 13px muted text. `.banner` is an outlined white box for read errors. `.facts` is a two-column `dl` for image details. |

## Do's and Don'ts

- Do start a new page with `<div className="page">`, an `h1`, then `.stage` if it pairs a frame with
  a panel. Use only the spacing and size tokens.
- Do keep one `.btn-primary` per view. Every other action is a quiet `.btn` or a link.
- Do show words, addresses and URIs as React text. Never use `dangerouslySetInnerHTML`. Words are
  user input.
- Do read addresses, chain and ABI from `useDeployment()`. Never add them to source.
- Do report a transaction from its receipt (events) or a fresh read, never from the simulation.
- Don't add a second font family, a third weight, shadows, rounded corners or colour accents. The
  brief fixes grey, black, white and monospace.
- Don't put labels in all caps or tracked small caps above headings. Copy is lowercase. Write
  "onchain" as one word.

Recipe for one more page: add a hash route in `App.tsx` (`useRoute`), render
`<div className="page"><h1>…</h1>…</div>`, reuse `Frame`, `.slots`, `.note` and `.btn`, and link it
from the header's `nav` list.
