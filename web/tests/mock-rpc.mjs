// Mocked-RPC browser checks of the built export (no chain, no anvil, nothing broadcast).
//
//   cd web && npm run build && node tests/mock-rpc.mjs [scenario ...]
//
// Serves ../dist from a fake gateway subpath (http://fivewords.test/ipfs/bafytest/), answers the
// manifest's RPC URLs from an in-memory FiveWords + IMD state (calls are decoded and answered
// with the deployment ABI, reverts carry the contract's own errors), answers the IPFS gateways
// with 502, and injects an EIP-6963 "Test Wallet" whose transactions produce receipts with the
// events the real contracts emit. Scenarios: frames, delivered, price, allowance, decline, retry,
// clickprice, longprice, sheet, holders, escape. Env: DIST (export dir), PW_DIR (a playwright package dir), WEBKIT=1
// (add WebKit to the frame checks), SHOTS (screenshot dir; default test/scratch/shots).
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(join(root, "web/package.json"));
const { chromium, webkit } = (process.env.PW_DIR ? createRequire(process.env.PW_DIR + "/package.json") : require)("playwright");
const viem = require("viem");
const { decodeFunctionData, encodeFunctionResult, encodeErrorResult, encodeEventTopics, encodeAbiParameters, erc20Abi, keccak256, toHex, getAddress } = viem;

const dist = process.env.DIST ?? join(root, "dist");
const shots = process.env.SHOTS ?? join(root, "test/scratch/shots");
mkdirSync(shots, { recursive: true });
const ORIGIN = "http://fivewords.test";
const BASE = `${ORIGIN}/ipfs/bafytest/`;
const manifest = JSON.parse(readFileSync(join(dist, "imd-deployment.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(dist, manifest.contracts[0].abiPath), "utf8"));
const FIVE = manifest.contracts[0].address.toLowerCase();
const IMD = manifest.network.pairToken.address.toLowerCase();
const ACCT = "0x70997970c51812dc3a048ab7be3e7b1d0bc5e0f2";
const E = 10n ** 18n;
const now = () => Math.floor(Date.now() / 1000);
const Z32 = "0x" + "00".repeat(32);

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const img = (o = {}) => ({
  status: 0, wordCount: 0, failureStatus: 0, orders: 0, opensAt: 0, orderedAt: 0, requestedAt: 0,
  requestId: Z32, resultHash: Z32, failureReason: Z32, uri: "", words: ["", "", "", "", ""], ...o,
});
const words5 = (w) => [...w, "", "", "", "", ""].slice(0, 5);

function baseState(o = {}) {
  return {
    currentImage: 1, imagesOrdered: 0, totalSupply: 0, amountDue: 1n * E / 10n, retryPrice: 5n * E / 10n, pot: 0n,
    amountDueFail: 0, // >0: that many next amountDue reads revert NotSold; Infinity: always
    images: [img({ opensAt: now() - 100 }), img(), img(), img(), img()],
    canRetry: [false, false, false, false, false], imageURI: ["", "", "", "", ""],
    owners: {}, ownerFail: new Set(), balance: 100n * E, allowance: 0n, hasWord: false,
    block: 1000n, receipts: {}, onSend: null,
    ...o,
  };
}

const revert = (errorName, args) => ({ __rpcError: { code: 3, message: "execution reverted", data: encodeErrorResult({ abi, errorName, args }) } });

function call(S, to, data) {
  to = to.toLowerCase();
  if (to === FIVE) {
    const { functionName: f, args = [] } = decodeFunctionData({ abi, data });
    const r = (result) => encodeFunctionResult({ abi, functionName: f, result });
    switch (f) {
      case "currentImage": return r(BigInt(S.currentImage));
      case "imagesOrdered": return r(BigInt(S.imagesOrdered));
      case "totalSupply": return r(BigInt(S.totalSupply));
      case "amountDue":
        if (S.amountDueFail > 0) { S.amountDueFail--; return revert("NotSold"); }
        return r(S.amountDue);
      case "retryPrice": return r(S.retryPrice);
      case "pot": return r(S.pot);
      case "imd": return r(getAddress(IMD));
      case "imageInfo": { const i = S.images[Number(args[0]) - 1]; return r({ ...i, opensAt: i.opensAt, words: words5(i.words) }); }
      case "canRetry": return r(S.canRetry[Number(args[0]) - 1]);
      case "imageURI": return r(S.imageURI[Number(args[0]) - 1]);
      case "hasWord": return r(S.hasWord);
      case "ownerOf": {
        const id = Number(args[0]);
        if (S.ownerFail.has(id)) return { __rpcError: { code: -32603, message: "internal error" } };
        if (!S.owners[id]) return revert("ERC721NonexistentToken", [args[0]]);
        return r(S.owners[id]);
      }
      case "addWord": return r(BigInt(S.totalSupply + 1));
      case "retry": return r(keccak256(toHex("req2")));
      default: throw new Error("unmocked " + f);
    }
  }
  if (to === IMD) {
    const { functionName: f, args = [] } = decodeFunctionData({ abi: erc20Abi, data });
    const r = (result) => encodeFunctionResult({ abi: erc20Abi, functionName: f, result });
    switch (f) {
      case "symbol": return r("IMD");
      case "decimals": return r(18);
      case "balanceOf": return r(S.balance);
      case "allowance": return r(S.allowance);
      case "approve": return r(true);
    }
  }
  return "0x";
}

function logOf(a, address, eventName, args) {
  const ev = a.find((x) => x.type === "event" && x.name === eventName);
  const idx = Object.fromEntries(ev.inputs.filter((i) => i.indexed).map((i) => [i.name, args[i.name]]));
  const topics = encodeEventTopics({ abi: [ev], eventName, args: idx });
  const non = ev.inputs.filter((i) => !i.indexed);
  return { address, topics, data: encodeAbiParameters(non, non.map((i) => args[i.name])) };
}

function rpc(S, { method, params = [] }) {
  switch (method) {
    case "eth_chainId": return "0x1";
    case "net_version": return "1";
    case "eth_blockNumber": return toHex(S.block++);
    case "eth_getCode": return "0x6080604052";
    case "eth_call": return call(S, params[0].to, params[0].data ?? params[0].input);
    case "eth_getTransactionReceipt": return S.receipts[params[0]] ?? null;
    case "eth_getTransactionByHash": {
      const rc = S.receipts[params[0]];
      return rc ? { hash: params[0], blockHash: rc.blockHash, blockNumber: rc.blockNumber, from: ACCT, to: rc.to, input: "0x", value: "0x0", nonce: "0x0", gas: "0x5208", gasPrice: "0x1", transactionIndex: "0x0", type: "0x0", v: "0x1b", r: "0x1", s: "0x1" } : null;
    }
    case "eth_getBlockByNumber":
      return { number: toHex(S.block), hash: keccak256(toHex(S.block)), parentHash: Z32, timestamp: toHex(now()), transactions: [], baseFeePerGas: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", logsBloom: "0x" + "00".repeat(256), miner: ACCT, nonce: "0x0000000000000000", difficulty: "0x0", extraData: "0x", size: "0x1", stateRoot: Z32, receiptsRoot: Z32, transactionsRoot: Z32, sha3Uncles: Z32, uncles: [], mixHash: Z32 };
    case "eth_estimateGas": return "0x30000";
    case "eth_gasPrice": return "0x1";
    case "eth_maxPriorityFeePerGas": return "0x1";
    default: throw new Error("unmocked rpc " + method);
  }
}

function send(S, tx) {
  const hash = keccak256(toHex(`tx${Object.keys(S.receipts).length}-${Date.now()}`));
  const to = tx.to.toLowerCase();
  let logs = [];
  if (to === IMD) {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    if (functionName === "approve") {
      S.allowance = args[1];
      logs.push(logOf(erc20Abi, IMD, "Approval", { owner: ACCT, spender: args[0], value: args[1] }));
    }
  }
  const extra = S.onSend?.(tx, to === FIVE ? decodeFunctionData({ abi, data: tx.data }) : decodeFunctionData({ abi: erc20Abi, data: tx.data }));
  if (extra) logs = logs.concat(extra);
  const blockNumber = toHex(S.block);
  const blockHash = keccak256(blockNumber);
  S.receipts[hash] = {
    transactionHash: hash, transactionIndex: "0x0", blockHash, blockNumber, from: ACCT, to: tx.to, cumulativeGasUsed: "0x1", gasUsed: "0x1",
    effectiveGasPrice: "0x1", contractAddress: null, logsBloom: "0x" + "00".repeat(256), status: "0x1", type: "0x2",
    logs: logs.map((l, i) => ({ ...l, logIndex: toHex(i), transactionIndex: "0x0", transactionHash: hash, blockHash, blockNumber, removed: false })),
  };
  return hash;
}

async function open(S, { browserType = chromium, viewport = { width: 390, height: 844 }, ua, wallet = true, walletChain = "0x1", hash = "" } = {}) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport, userAgent: ua });
  const W = { chainId: walletChain, authorized: false, reject: new Set(), rejectSwitch: 0, sent: [], requests: [] };
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN) {
      const rel = url.pathname.replace(/^\/ipfs\/bafytest\//, "") || "index.html";
      const file = join(dist, rel);
      if (!file.startsWith(dist) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
      return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
    }
    if (manifest.network.rpcUrls.some((u) => req.url().startsWith(u))) {
      if (req.method() !== "POST") return route.fulfill({ status: 204, body: "" });
      const body = JSON.parse(req.postData());
      const one = (b) => {
        try {
          const res = rpc(S, b);
          if (res && res.__rpcError) return { jsonrpc: "2.0", id: b.id, error: res.__rpcError };
          return { jsonrpc: "2.0", id: b.id, result: res };
        } catch (e) {
          return { jsonrpc: "2.0", id: b.id, error: { code: -32603, message: e.message } };
        }
      };
      const out = Array.isArray(body) ? body.map(one) : one(body);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
    }
    if (/ipfs\.io|dweb\.link/.test(url.host)) return route.fulfill({ status: 502, body: "bad gateway" });
    return route.abort();
  });
  await ctx.exposeFunction("__wallet", async (method, params = []) => {
    W.requests.push(method);
    switch (method) {
      case "eth_requestAccounts": W.authorized = true; return [ACCT];
      case "eth_accounts": return W.authorized ? [ACCT] : [];
      case "eth_chainId": return W.chainId;
      case "net_version": return String(parseInt(W.chainId, 16));
      case "wallet_requestPermissions": case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
      case "wallet_switchEthereumChain":
        if (W.rejectSwitch > 0) { W.rejectSwitch--; return { __error: { code: 4001, message: "User rejected the request." } }; }
        W.chainId = params[0].chainId;
        return { __event: ["chainChanged", W.chainId], value: null };
      case "wallet_addEthereumChain": return null;
      case "eth_sendTransaction": {
        const tx = params[0];
        const fn = tx.to.toLowerCase() === FIVE ? decodeFunctionData({ abi, data: tx.data }).functionName : decodeFunctionData({ abi: erc20Abi, data: tx.data }).functionName;
        W.sent.push({ fn, tx });
        if (W.reject.has(fn)) { W.reject.delete(fn); return { __error: { code: 4001, message: "User rejected the request." } }; }
        return send(S, tx);
      }
      default: {
        const r = rpc(S, { method, params });
        if (r && r.__rpcError) return { __error: r.__rpcError };
        return r;
      }
    }
  });
  if (wallet) {
    await ctx.addInitScript(() => {
      const listeners = {};
      const provider = {
        on: (e, f) => ((listeners[e] ??= []).push(f), provider),
        removeListener: (e, f) => ((listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)), provider),
        emit: (e, v) => (listeners[e] ?? []).forEach((f) => f(v)),
        request: async ({ method, params }) => {
          const r = await window.__wallet(method, params);
          if (r && r.__error) throw Object.assign(new Error(r.__error.message), r.__error);
          if (r && r.__event) { setTimeout(() => provider.emit(...r.__event), 0); return r.value; }
          return r;
        },
      };
      const icon = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28"/></svg>');
      const detail = Object.freeze({ info: { uuid: "6b1e1c3e-0000-4000-8000-000000000001", name: "Test Wallet", icon, rdns: "test.wallet" }, provider });
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(BASE + hash);
  return { browser, page, W, errors };
}

async function connect(page) {
  await page.locator("header").getByRole("button", { name: "connect" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Test Wallet/ }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

/** Every written word inside its frame and above its caption. */
async function framesOk(page) {
  return page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".frame").forEach((f, k) => {
      const fr = f.getBoundingClientRect();
      const cap = f.querySelector(".caption")?.getBoundingClientRect();
      const capBottom = f.querySelector(".caption") ? cap.bottom : fr.bottom;
      if (cap && cap.bottom > fr.bottom + 0.5) bad.push(`frame ${k} caption below frame`);
      f.querySelectorAll(".w:not(.blank)").forEach((w) => {
        for (const r of w.getClientRects()) {
          if (r.left < fr.left - 0.5 || r.right > fr.right + 0.5 || r.top < fr.top - 0.5 || r.bottom > (cap ? cap.top : fr.bottom) + 0.5)
            bad.push(`frame ${k} "${w.textContent}" ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)} vs frame ${Math.round(fr.left)},${Math.round(fr.top)}-${Math.round(fr.right)},${Math.round(capBottom)} cap.top ${cap && Math.round(cap.top)}`);
        }
      });
      if (f.querySelector(".frame-note")) bad.push(`frame ${k} has a notice over it`);
    });
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (over > 0) bad.push(`sideways scroll ${over}`);
    return bad;
  });
}

const LONG = ["abcdefghijklmnopqrst", "zyxwvutsrqponmlkjihg", "monochromatographic", "intercontinentalism", "spectrophotometrical"];
const S_LONG = () =>
  baseState({
    currentImage: 2, imagesOrdered: 1, totalSupply: 5,
    images: [img({ status: 1, wordCount: 5, words: LONG, orders: 1, opensAt: now() - 9000, orderedAt: now() - 60 }), img({ opensAt: now() + 5 * 3600 }), img(), img(), img()],
  });

const scenarios = {
  async frames() {
    for (const [bt, btName] of [[chromium, "chromium"], ...(process.env.WEBKIT ? [[webkit, "webkit"]] : [])]) {
      for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 1440, height: 844 }]) {
        const { browser, page, errors } = await open(S_LONG(), { browserType: bt, viewport: vp });
        await page.getByText("ordered, the swarm is drawing it").first().waitFor();
        const tag = `${btName} ${vp.width}x${vp.height}`;
        let bad = await framesOk(page);
        check(`play: long words inside the frame, above the caption (${tag})`, !bad.length, bad.join("; "));
        await page.screenshot({ path: join(shots, `play-long-${btName}-${vp.width}.png`) });
        await page.goto(BASE + "#/gallery");
        await page.locator(".frame-small").first().waitFor();
        await page.waitForTimeout(300);
        bad = await framesOk(page);
        check(`gallery: long words inside every tile (${tag})`, !bad.length, bad.join("; "));
        await page.screenshot({ path: join(shots, `gallery-long-${btName}-${vp.width}.png`), fullPage: true });
        check(`no page errors (${tag})`, !errors.length, errors.join(" | "));
        await browser.close();
      }
    }
  },
  async delivered() {
    const S = baseState({
      currentImage: 2, imagesOrdered: 1, totalSupply: 5,
      images: [img({ status: 3, wordCount: 5, words: ["lantern", "under", "soft", "moss", "arches"], orders: 1, opensAt: now() - 9000, orderedAt: now() - 600, uri: "ipfs://bafyresult/1.png" }), img({ opensAt: now() - 10 }), img(), img(), img()],
      imageURI: ["ipfs://bafyresult/1.png", "", "", "", ""],
    });
    const { browser, page } = await open(S, { hash: "#/gallery" });
    await page.locator(".frame-small").first().getByText("image unavailable").waitFor({ timeout: 15000 });
    const bad = await framesOk(page);
    check("gateway 502: words visible in the tile, caption says image unavailable, no notice", !bad.length, bad.join("; "));
    await page.screenshot({ path: join(shots, "gallery-502.png") });
    await page.goto(BASE + "#/image/1");
    await page.getByText("ipfs://bafyresult/1.png").waitFor();
    check("image page keeps the full result uri in the details", true);
    await page.locator(".frame .caption").getByText("image unavailable").waitFor({ timeout: 15000 }).then(() => true, () => false).then(async (ok) => {
      check("image page frame: caption says 'image unavailable', words inside", ok && !(await framesOk(page)).length);
    });
    await browser.close();
  },
  async price() {
    const S = baseState({ amountDueFail: Infinity });
    const { browser, page, errors } = await open(S);
    const btn = page.getByRole("button", { name: "add · price unavailable" });
    await btn.waitFor();
    check("unavailable price: button reads 'add · price unavailable' and is disabled", await btn.isDisabled());
    check("unavailable price: recovery message shown", await page.getByText("the image price is unavailable. try again after the next refresh.").isVisible());
    check("no 'add · 0 IMD'", (await page.getByRole("button", { name: /add · 0 IMD/ }).count()) === 0);
    await browser.close();
    // Click-time recheck fails.
    const S2 = baseState();
    const r = await open(S2);
    await r.page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
    await connect(r.page);
    await r.page.locator("#word").fill("lantern");
    S2.amountDueFail = 1;
    await r.page.getByRole("button", { name: "add · 0.1 IMD" }).click();
    await r.page.getByText("the image price is unavailable. try again after the next refresh.").waitFor({ timeout: 8000 });
    check("failed click-time recheck: message beside the draft, no page error", !r.errors.length, r.errors.join(" | "));
    check("failed click-time recheck: draft kept, nothing sent", (await r.page.locator("#word").inputValue()) === "lantern" && r.W.sent.length === 0);
    await r.browser.close();
    // Retry price unavailable.
    const S3 = baseState({ currentImage: 2, images: [img({ status: 2, wordCount: 5, words: ["a", "b", "c", "d", "e"], orders: 1, failureStatus: 1 }), img({ opensAt: now() - 10 }), img(), img(), img()], canRetry: [true, false, false, false, false] });
    S3.retryPrice = undefined;
    const r3 = await open(S3, { hash: "#/image/1" });
    await r3.page.getByRole("button", { name: /order again · price unavailable/ }).waitFor({ timeout: 10000 }).then(
      async () => check("unavailable retry price: 'order again · price unavailable' disabled", await r3.page.getByRole("button", { name: /order again · price unavailable/ }).isDisabled()),
      () => check("unavailable retry price: 'order again · price unavailable' disabled", false, "not shown"),
    );
    await r3.browser.close();
  },
  async allowance() {
    // A larger existing allowance is replaced by an exact approval.
    const S = baseState({ allowance: 5n * E / 10n });
    S.onSend = (tx, d) => {
      if (d.functionName !== "addWord") return;
      const paid = S.amountDue;
      S.images[0].wordCount = 1; S.images[0].words = [d.args[0]]; S.totalSupply = 1; S.hasWord = true; S.owners[1] = ACCT;
      return [logOf(abi, FIVE, "WordAdded", { image: 1n, slot: 1n, wallet: ACCT, tokenId: 1n, word: d.args[0], paid })];
    };
    const { browser, page, W, errors } = await open(S);
    await page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
    await connect(page);
    await page.locator("#word").fill("lantern");
    await page.getByRole("button", { name: "add · 0.1 IMD" }).click();
    await page.locator(".result").waitFor({ timeout: 30000 });
    const fns = W.sent.map((s) => s.fn);
    check("surplus allowance: approve sent first, then addWord", fns.join(",") === "approve,addWord", fns.join(","));
    const ap = decodeFunctionData({ abi: erc20Abi, data: W.sent[0].tx.data });
    check("approval is exactly 0.1 IMD to FiveWords", ap.args[0].toLowerCase() === FIVE && ap.args[1] === E / 10n, `${ap.args}`);
    check("result from the receipt", /paid 0\.1 IMD/.test(await page.locator(".result").innerText()), await page.locator(".result").innerText());
    check("draft cleared after WordAdded", (await page.locator("#word").inputValue()) === "");
    check("no page errors", !errors.length, errors.join(" | "));
    await browser.close();

    // The price moves after the approval mines: no addWord, fresh confirmation asked for.
    const S2 = baseState();
    S2.onSend = (tx, d) => {
      if (d.functionName === "approve") S2.amountDue = 2n * E / 10n;
    };
    const r = await open(S2);
    await r.page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
    await connect(r.page);
    await r.page.locator("#word").fill("lantern");
    await r.page.getByRole("button", { name: "add · 0.1 IMD" }).click();
    await r.page.locator(".result").waitFor({ timeout: 30000 });
    const text = await r.page.locator(".result").innerText();
    check("price moved: only the approval was sent", r.W.sent.map((s) => s.fn).join(",") === "approve", r.W.sent.map((s) => s.fn).join(","));
    check("price moved: says the new price and that the approval is onchain", /price changed to 0\.2 IMD/.test(text) && /your 0\.1 IMD approval is onchain\. your word was not added\./.test(text), text);
    await r.page.getByRole("button", { name: "add · 0.2 IMD" }).waitFor({ timeout: 15000 });
    check("price moved: button shows the new price, draft kept", (await r.page.locator("#word").inputValue()) === "lantern");
    await r.page.screenshot({ path: join(shots, "price-moved.png"), fullPage: true });
    await r.browser.close();
  },
  async decline() {
    const S = baseState();
    const { browser, page, W, errors } = await open(S);
    await page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
    await connect(page);
    await page.locator("#word").fill("lantern");
    W.reject.add("approve");
    await page.getByRole("button", { name: "add · 0.1 IMD" }).click();
    await page.locator(".result").waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    check("approval declined: draft kept", (await page.locator("#word").inputValue()) === "lantern");
    check("approval declined: focus back in the input", await page.evaluate(() => document.activeElement?.id === "word"));
    check("approval declined: add enabled again", await page.getByRole("button", { name: "add · 0.1 IMD" }).isEnabled());
    check("approval declined: says nothing was sent", /declined the approval\. nothing was sent/.test(await page.locator(".result").innerText()), await page.locator(".result").innerText());
    W.reject.add("addWord");
    await page.getByRole("button", { name: "add · 0.1 IMD" }).click();
    await page.getByText("the wallet declined the add transaction.").first().waitFor({ timeout: 30000 });
    const result = await page.locator(".result").innerText();
    check("add declined after approval: summary says approval is onchain", result === "your 0.1 IMD approval is onchain. your word was not added.", result);
    const notes = await page.locator(".steps .step-note").allInnerTexts();
    check("add declined: step 1 approved, step 2 declined, no 'nothing was sent'", notes.some((n) => n === "approved 0.1 IMD.") && notes.includes("the wallet declined the add transaction.") && !notes.join("|").includes("nothing was sent"), notes.join(" | "));
    check("add declined: draft kept", (await page.locator("#word").inputValue()) === "lantern");
    check("one approval and one declined add request", W.sent.map((s) => s.fn).join(",") === "approve,approve,addWord", W.sent.map((s) => s.fn).join(","));
    check("no page errors", !errors.length, errors.join(" | "));
    await page.screenshot({ path: join(shots, "decline.png"), fullPage: true });
    await browser.close();
  },
  async retry() {
    const S = baseState({
      currentImage: 2, imagesOrdered: 1, totalSupply: 5,
      images: [img({ status: 2, wordCount: 5, words: ["lantern", "under", "soft", "moss", "arches"], orders: 1, failureStatus: 1, opensAt: now() - 9000 }), img({ opensAt: now() + 3600 }), img(), img(), img()],
      canRetry: [true, false, false, false, false],
    });
    for (let i = 1; i <= 5; i++) S.owners[i] = ACCT;
    S.onSend = (tx, d) => {
      if (d.functionName !== "retry") return;
      S.images[0] = { ...S.images[0], status: 1, orders: 2, orderedAt: now() };
      S.canRetry[0] = false;
      return [logOf(abi, FIVE, "ImageOrdered", { image: 1n, requestId: keccak256(toHex("req2")), payer: ACCT, price: S.retryPrice, attempt: 2n })];
    };
    const { browser, page, W, errors } = await open(S, { hash: "#/image/1", walletChain: "0xaa36a7" });
    await page.locator(".retry").waitFor();
    await connect(page);
    W.rejectSwitch = 1;
    await page.locator(".retry").getByRole("button", { name: "switch to Ethereum" }).click();
    await page.locator(".retry").getByText("the wallet declined the switch.").waitFor({ timeout: 8000 }).then(
      () => check("retry panel: declined switch is reported under its button", true),
      () => check("retry panel: declined switch is reported under its button", false),
    );
    await page.locator(".retry").getByRole("button", { name: "switch to Ethereum" }).click();
    await page.locator(".retry").getByRole("button", { name: "order again · 0.5 IMD" }).waitFor({ timeout: 10000 });
    await page.locator(".retry").getByRole("button", { name: "order again · 0.5 IMD" }).click();
    await page.locator(".retry .result").waitFor({ timeout: 30000 });
    await page.locator(".frame .caption").getByText("ordered, the swarm is drawing it").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    check("after refetch: retry panel still there", (await page.locator(".retry").count()) === 1);
    check("after refetch: receipt result kept", /ordered again \(attempt 2\)/.test(await page.locator(".retry .result").innerText()));
    check("after refetch: explorer links kept", (await page.locator(".retry a", { hasText: "view transaction" }).count()) === 2);
    check("after refetch: order button gone", (await page.locator(".retry").getByRole("button", { name: /order again/ }).count()) === 0);
    check("approval exactly the retry price", decodeFunctionData({ abi: erc20Abi, data: W.sent[0].tx.data }).args[1] === 5n * E / 10n);
    check("no page errors", !errors.length, errors.join(" | "));
    await page.screenshot({ path: join(shots, "retry.png"), fullPage: true });
    const sentBefore = W.sent.length;
    await page.locator(".crumbs").getByRole("link", { name: "image 2" }).click();
    await page.getByRole("heading", { name: "image 2" }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    check("image 2: no retry panel carried over from image 1", (await page.locator(".retry").count()) === 0, await page.locator(".retry").allInnerTexts().then((t) => t.join(" | ")));
    check("image 2: nothing sent for it", W.sent.length === sentBefore);
    await page.locator(".crumbs").getByRole("link", { name: "image 1" }).click();
    await page.getByRole("heading", { name: "image 1" }).waitFor({ timeout: 10000 });
    check("back on image 1: fresh panel, no stale receipt", (await page.locator(".retry").count()) === 0);
    await browser.close();
  },
  async clickprice() {
    // The price moves between the last read and the click: nothing goes to the wallet.
    for (const [bt, btName] of [[chromium, "chromium"], ...(process.env.WEBKIT ? [[webkit, "webkit"]] : [])]) {
      const S = baseState();
      S.onSend = (tx, d) => {
        if (d.functionName !== "addWord") return;
        S.images[0].wordCount = 1; S.images[0].words = [d.args[0]]; S.totalSupply = 1; S.hasWord = true; S.owners[1] = ACCT;
        return [logOf(abi, FIVE, "WordAdded", { image: 1n, slot: 1n, wallet: ACCT, tokenId: 1n, word: d.args[0], paid: S.amountDue })];
      };
      const { browser, page, W, errors } = await open(S, { browserType: bt });
      await page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
      await connect(page);
      await page.locator("#word").fill("lantern");
      await page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
      S.amountDue = 2n * E / 10n;
      await page.getByRole("button", { name: "add · 0.1 IMD" }).click();
      await page.getByText("the price changed to 0.2 IMD. review the amount and press the button again.").waitFor({ timeout: 15000 }).then(
        () => check(`${btName} add: price-change note shown`, true),
        () => check(`${btName} add: price-change note shown`, false),
      );
      await page.getByRole("button", { name: "add · 0.2 IMD" }).waitFor({ timeout: 15000 }).then(
        () => check(`${btName} add: button updated to 0.2 IMD`, true),
        () => check(`${btName} add: button updated to 0.2 IMD`, false),
      );
      check(`${btName} add: zero transactions on the stale click`, W.sent.length === 0, W.sent.map((x) => x.fn).join(","));
      check(`${btName} add: draft kept`, (await page.locator("#word").inputValue()) === "lantern");
      await page.getByRole("button", { name: "add · 0.2 IMD" }).click();
      await page.locator(".result").waitFor({ timeout: 30000 });
      check(`${btName} add: fresh click approves exactly 0.2 then adds`, W.sent.map((x) => x.fn).join(",") === "approve,addWord" && decodeFunctionData({ abi: erc20Abi, data: W.sent[0].tx.data }).args[1] === 2n * E / 10n, W.sent.map((x) => x.fn).join(","));
      check(`${btName} add: no page errors`, !errors.length, errors.join(" | "));
      await browser.close();

      const R = baseState({
        currentImage: 2, imagesOrdered: 1, totalSupply: 5,
        images: [img({ status: 2, wordCount: 5, words: ["lantern", "under", "soft", "moss", "arches"], orders: 1, failureStatus: 1, opensAt: now() - 9000 }), img({ opensAt: now() + 3600 }), img(), img(), img()],
        canRetry: [true, false, false, false, false],
      });
      const r = await open(R, { browserType: bt, hash: "#/image/1" });
      await r.page.locator(".retry").getByRole("button", { name: "order again · 0.5 IMD" }).waitFor({ timeout: 15000 });
      await connect(r.page);
      await r.page.locator(".retry").getByRole("button", { name: "order again · 0.5 IMD" }).waitFor();
      R.retryPrice = 1n * E;
      await r.page.locator(".retry").getByRole("button", { name: "order again · 0.5 IMD" }).click();
      await r.page.locator(".retry").getByText("the price changed to 1 IMD. review the amount and press the button again.").waitFor({ timeout: 15000 }).then(
        () => check(`${btName} retry: price-change note shown`, true),
        () => check(`${btName} retry: price-change note shown`, false),
      );
      await r.page.locator(".retry").getByRole("button", { name: "order again · 1 IMD" }).waitFor({ timeout: 15000 }).then(
        () => check(`${btName} retry: button updated to 1 IMD`, true),
        () => check(`${btName} retry: button updated to 1 IMD`, false),
      );
      check(`${btName} retry: zero transactions on the stale click`, r.W.sent.length === 0, r.W.sent.map((x) => x.fn).join(","));
      check(`${btName} retry: no page errors`, !r.errors.length, r.errors.join(" | "));
      await r.browser.close();
    }
  },
  async longprice() {
    // Full-precision prices on the payment buttons stay inside the viewport.
    for (const [bt, btName] of [[chromium, "chromium"], ...(process.env.WEBKIT ? [[webkit, "webkit"]] : [])]) {
      const S = baseState({ amountDue: 99999999999999999n });
      const a = await open(S, { browserType: bt, viewport: { width: 320, height: 700 } });
      const addBtn = a.page.getByRole("button", { name: "add · 0.099999999999999999 IMD" });
      await addBtn.waitFor({ timeout: 15000 });
      const box = await addBtn.boundingBox();
      const sw = await a.page.evaluate(() => document.documentElement.scrollWidth);
      check(`${btName} 320: add button inside viewport, full label`, box.x + box.width <= 320 && box.height >= 44 && sw <= 320, `right=${(box.x + box.width).toFixed(2)} h=${box.height} scrollWidth=${sw}`);
      await a.page.screenshot({ path: join(shots, `longprice-add-${btName}.png`) });
      await a.browser.close();

      const R = baseState({
        currentImage: 2, imagesOrdered: 1, totalSupply: 5, retryPrice: 499999999999999999n,
        images: [img({ status: 2, wordCount: 5, words: ["lantern", "under", "soft", "moss", "arches"], orders: 1, failureStatus: 1, opensAt: now() - 9000 }), img({ opensAt: now() + 3600 }), img(), img(), img()],
        canRetry: [true, false, false, false, false],
      });
      const r = await open(R, { browserType: bt, hash: "#/image/1" });
      const rb = r.page.locator(".retry").getByRole("button", { name: "order again · 0.499999999999999999 IMD" });
      await rb.waitFor({ timeout: 15000 });
      const rbox = await rb.boundingBox();
      const rsw = await r.page.evaluate(() => document.documentElement.scrollWidth);
      check(`${btName} 390: order again button inside viewport, full label`, rbox.x + rbox.width <= 390 && rbox.height >= 44 && rsw <= 390, `right=${(rbox.x + rbox.width).toFixed(2)} h=${rbox.height} scrollWidth=${rsw}`);
      await r.page.screenshot({ path: join(shots, `longprice-retry-${btName}.png`) });
      await r.browser.close();
    }
  },
  async sheet() {
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    let r = await open(baseState(), { ua: IPHONE });
    await r.page.locator("header").getByRole("button", { name: "connect" }).click();
    let sheet = r.page.getByRole("dialog");
    check("iPhone + EIP-6963 wallet: Test Wallet listed", (await sheet.getByRole("button", { name: /Test Wallet/ }).count()) === 1);
    check("iPhone + in-page wallet: no open-in links", (await sheet.locator("a.row").count()) === 0);
    await sheet.getByRole("button", { name: /Test Wallet/ }).click();
    await sheet.waitFor({ state: "detached" });
    check("iPhone: Test Wallet connects", await r.page.locator("header").getByRole("button", { name: /^0x7099/ }).isVisible());
    await r.browser.close();
    r = await open(baseState(), { ua: IPHONE, wallet: false });
    await r.page.locator("header").getByRole("button", { name: "connect" }).click();
    sheet = r.page.getByRole("dialog");
    const links = await sheet.locator("a.row").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
    console.log("     open-in rows:", JSON.stringify(links));
    check("iPhone no wallet: 'get Rabby' to rabby.io", links.some(([t, h]) => t === "get Rabby" && h === "https://rabby.io/"));
    check("iPhone no wallet: no 'open in Rabby'", !links.some(([t]) => t === "open in Rabby"));
    check("iPhone no wallet: MetaMask link carries the page", links.some(([t, h]) => t === "open in MetaMask" && h.includes("fivewords.test/ipfs/bafytest")));
    check("iPhone no wallet: no browser wallet row", (await sheet.getByText("browser wallet").count()) === 0);
    await r.browser.close();
    r = await open(baseState(), { wallet: false });
    await r.page.locator("header").getByRole("button", { name: "connect" }).click();
    sheet = r.page.getByRole("dialog");
    check("desktop no provider: no 'browser wallet' row", (await sheet.getByText("browser wallet", { exact: true }).count()) === 0);
    check("desktop no provider: Coinbase offered", (await sheet.getByRole("button", { name: /Coinbase/ }).count()) === 1);
    await r.page.screenshot({ path: join(shots, "sheet-desktop-none.png") });
    await r.browser.close();
  },
  async holders() {
    const S = baseState({
      currentImage: 2, imagesOrdered: 1, totalSupply: 5,
      images: [img({ status: 1, wordCount: 5, words: ["lantern", "under", "soft", "moss", "arches"], orders: 1, opensAt: now() - 9000, orderedAt: now() - 60 }), img({ opensAt: now() + 5 * 3600 }), img(), img(), img()],
    });
    for (let i = 1; i <= 5; i++) S.owners[i] = getAddress("0x" + String(i).repeat(40));
    S.ownerFail.add(2);
    const { browser, page, errors } = await open(S, { hash: "#/image/1" });
    await page.getByText("holder unavailable").waitFor({ timeout: 20000 });
    const holderLinks = await page.locator(".holders a[title]").count();
    check("one failed holder: other four holder links shown", holderLinks === 4, String(holderLinks));
    check("one failed holder: 'holder unavailable · retry' on its slot only", (await page.getByText("holder unavailable").count()) === 1 && (await page.getByRole("button", { name: "retry" }).count()) === 1);
    check("no 'reading holder…' left", (await page.getByText("reading holder").count()) === 0);
    S.ownerFail.clear();
    await page.getByRole("button", { name: "retry" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".holders a[title]").length === 5, null, { timeout: 10000 }).then(
      () => check("retry restores the fifth holder link", true),
      () => check("retry restores the fifth holder link", false),
    );
    const dts = await page.locator(".facts dt").allInnerTexts();
    check("image 1 details: 'opened' for a past opensAt", dts.includes("opened"), dts.join(","));
    await page.goto(BASE + "#/image/2");
    await page.locator(".facts").waitFor();
    const dts2 = await page.locator(".facts dt").allInnerTexts();
    check("image 2 details: 'opens' for a future opensAt", dts2.includes("opens") && !dts2.includes("opened"), dts2.join(","));
    check("no page errors", !errors.length, errors.join(" | "));
    await browser.close();
  },
  async escape() {
    const { browser, page } = await open(baseState());
    await page.getByRole("button", { name: "add · 0.1 IMD" }).waitFor();
    await connect(page);
    const addr = page.locator("header").getByRole("button", { name: /^0x7099/ });
    await addr.click();
    await page.getByRole("button", { name: "disconnect" }).focus();
    await page.keyboard.press("Escape");
    check("Escape closes the wallet menu", (await page.getByRole("button", { name: "disconnect" }).count()) === 0);
    check("Escape returns focus to the address button", await page.evaluate(() => document.activeElement?.getAttribute("aria-controls") === "wallet-menu"));
    await browser.close();
  },
};

const wanted = process.argv.slice(2);
for (const [name, fn] of Object.entries(scenarios)) {
  if (wanted.length && !wanted.includes(name)) continue;
  console.log(`-- ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name} ran to completion`, false, e.message.split("\n")[0]);
  }
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log(failures.map((f) => " - " + f).join("\n"));
process.exit(failures.length ? 1 : 0);
