// End-to-end interaction test of the built export against the deployed FiveWords contract on a
// local anvil fork of Ethereum mainnet. Nothing is broadcast to a real chain.
//
//   FORK_URL=<mainnet rpc> node tests/interaction.mjs
//
// - starts `anvil --fork-url $FORK_URL` (Foundry) on 127.0.0.1:8545 and gives five anvil accounts
//   100 IMD each by writing IMD's balance mapping (slot 5) on the fork;
// - serves ../dist from a fake gateway subpath (http://fivewords.test/ipfs/bafytest/) through
//   Playwright routing, so relative asset paths are exercised;
// - answers the manifest's public RPC URLs from the fork, and blocks every other outside request;
// - injects an EIP-1193 wallet announced by EIP-6963 whose requests go to the fork (anvil's
//   unlocked accounts sign), starting on the wrong chain and not knowing chain 1, so the switch
//   and wallet_addEthereumChain path runs.
// Then it walks the page as a visitor: connect, switch, validate a word, approve + addWord with
// five wallets (the fifth orders the image through the live Intake's code on the fork), a
// rejected signature, the countdown, the gallery, the image page and the about page, at 390 wide,
// and checks for sideways scrolling at 320 and 390.
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { decodeFunctionData, erc20Abi, keccak256, encodeAbiParameters, pad, toHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../../dist");
const shots = process.env.SHOTS ?? resolve(here, "../../test/scratch/shots");
mkdirSync(shots, { recursive: true });
const FORK_URL = process.env.FORK_URL;
if (!FORK_URL) throw new Error("set FORK_URL to a mainnet RPC");
const ANVIL = process.env.ANVIL ?? "anvil";
const LOCAL = "http://127.0.0.1:8545";
const ORIGIN = "http://fivewords.test";
const BASE = `${ORIGIN}/ipfs/bafytest/`;

const manifest = JSON.parse(readFileSync(join(dist, "imd-deployment.json"), "utf8"));
const FIVE = manifest.contracts[0].address.toLowerCase();
const IMD = manifest.network.pairToken.address;

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
};

const anvil = spawn(ANVIL, ["--fork-url", FORK_URL, "--port", "8545", "--silent"], { stdio: "ignore" });
const rpc = async (method, params = []) => {
  const r = await fetch(LOCAL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
  return j.result;
};
const cleanup = () => anvil.kill();

try {
  for (let i = 0; ; i++) {
    try {
      await rpc("eth_blockNumber");
      break;
    } catch {
      if (i > 60) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const accounts = (await rpc("eth_accounts")).slice(0, 6);
  for (const a of accounts) {
    const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 5n]));
    await rpc("anvil_setStorageAt", [IMD, slot, pad(toHex(100n * 10n ** 18n))]);
  }

  // The wallet: state lives here, the page calls in through an exposed function.
  const wallet = { account: accounts[0], chainId: "0xaa36a7", knows1: false, reject: false, authorized: false, sent: [], added: [], switches: 0 };
  const walletRequest = async (method, params) => {
    switch (method) {
      case "eth_requestAccounts":
        wallet.authorized = true;
        return [wallet.account];
      case "eth_accounts":
        return wallet.authorized ? [wallet.account] : [];
      case "eth_chainId":
        return wallet.chainId;
      case "net_version":
        return String(parseInt(wallet.chainId, 16));
      case "wallet_switchEthereumChain":
        wallet.switches++;
        if (params[0].chainId === "0x1" && !wallet.knows1) return { __error: { code: 4902, message: "Unrecognized chain ID" } };
        wallet.chainId = params[0].chainId;
        return { __event: ["chainChanged", wallet.chainId], value: null };
      case "wallet_addEthereumChain":
        wallet.added.push(params[0]);
        wallet.knows1 = true;
        return null;
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "eth_sendTransaction": {
        if (wallet.reject) return { __error: { code: 4001, message: "User rejected the request." } };
        if (wallet.chainId !== "0x1") return { __error: { code: 4100, message: "wrong chain" } };
        wallet.sent.push(params[0]);
        return await rpc(method, [{ ...params[0], from: wallet.account }]);
      }
      default:
        if (wallet.chainId !== "0x1" && method === "eth_call") return "0x";
        return await rpc(method, params);
    }
  };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const outside = [];
  let rpcCalls = 0;
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
    if (manifest.network.rpcUrls.some((u) => req.url().startsWith(u)) && req.method() === "POST") {
      rpcCalls++;
      try {
        const r = await fetch(LOCAL, { method: "POST", headers: { "content-type": "application/json" }, body: req.postData() });
        return await route.fulfill({ status: 200, contentType: "application/json", body: await r.text() });
      } catch {
        return route.abort().catch(() => {});
      }
    }
    if (manifest.network.rpcUrls.some((u) => req.url().startsWith(u))) return route.fulfill({ status: 204, body: "" });
    outside.push(req.url());
    return route.abort();
  });
  await ctx.exposeFunction("__wallet", async (method, params) => {
    try {
      return await walletRequest(method, params ?? []);
    } catch (e) {
      return { __error: { code: e.code ?? -32603, message: e.message, data: e.data } };
    }
  });
  await ctx.addInitScript(() => {
    const listeners = {};
    const provider = {
      isTestWallet: true,
      on: (e, f) => ((listeners[e] ??= []).push(f), provider),
      removeListener: (e, f) => ((listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)), provider),
      emit: (e, v) => (listeners[e] ?? []).forEach((f) => f(v)),
      request: async ({ method, params }) => {
        const r = await window.__wallet(method, params);
        if (r && r.__error) throw Object.assign(new Error(r.__error.message), r.__error);
        if (r && r.__event) {
          setTimeout(() => provider.emit(...r.__event), 0);
          return r.value;
        }
        return r;
      },
    };
    window.__provider = provider;
    const icon =
      "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#000"/></svg>');
    const detail = Object.freeze({ info: { uuid: "6b1e1c3e-0000-4000-8000-000000000001", name: "Test Wallet", icon, rdns: "test.wallet" }, provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });

  const page = await ctx.newPage();
  globalThis.__page = page;
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(BASE);
  await page.getByRole("heading", { name: "image 1 of 5" }).waitFor();
  const add = page.getByRole("button", { name: /^add · 0\.1 IMD$/ });
  await add.waitFor();
  check("loads from a gateway subpath and reads the contract", rpcCalls > 0);
  check("title", (await page.title()) === "fivewords");
  const box = await add.boundingBox();
  check("main action on the first screen at 390x844", !!box && box.y + box.height <= 844, JSON.stringify(box));
  check("frame on the first screen", (await page.locator(".frame").boundingBox()).y < 844);
  check("connect control in the header", await page.locator("header").getByRole("button", { name: "connect" }).isVisible());
  await page.screenshot({ path: join(shots, "390-disconnected.png") });

  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll at 390", (await overflow()) <= 0);
  await page.setViewportSize({ width: 320, height: 700 });
  check("no sideways scroll at 320", (await overflow()) <= 0);
  await page.screenshot({ path: join(shots, "320-disconnected.png") });
  await page.setViewportSize({ width: 390, height: 844 });

  // Disconnected: the add button opens the connect sheet; Escape closes it.
  await add.click();
  const sheet = page.getByRole("dialog", { name: "connect a wallet" });
  check("add while disconnected opens the connect sheet", await sheet.isVisible());
  check("sheet lists the EIP-6963 wallet by name", await sheet.getByRole("button", { name: /Test Wallet/ }).isVisible());
  check("generic injected row hidden when a wallet is named", (await sheet.getByText("browser wallet").count()) === 0);
  check("sheet offers Coinbase Wallet", await sheet.getByRole("button", { name: /Coinbase Wallet/ }).isVisible());
  await page.screenshot({ path: join(shots, "390-connect-sheet.png") });
  await page.keyboard.press("Escape");
  check("Escape closes the sheet", !(await sheet.isVisible()));

  // Connect, on the wrong chain.
  await page.locator("header").getByRole("button", { name: "connect" }).click();
  await sheet.getByRole("button", { name: /Test Wallet/ }).click();
  const switchBtn = page.locator("header").getByRole("button", { name: "switch to Ethereum" });
  await switchBtn.waitFor({ timeout: 15000 });
  check("wrong chain shows a single switch control in the header", await switchBtn.isVisible());
  check("main button offers the switch on the wrong chain", await page.locator("form.add").getByRole("button", { name: "switch to Ethereum" }).isVisible());
  await page.screenshot({ path: join(shots, "390-wrong-chain.png") });
  await switchBtn.click();
  const short = `${accounts[0].slice(0, 6)}…${accounts[0].slice(-4)}`;
  await page.locator("header").getByRole("button", { name: short }).waitFor({ timeout: 15000 });
  check("unknown chain: wallet_addEthereumChain sent after 4902", wallet.added.length === 1 && wallet.switches >= 2);
  check("wallet_addEthereumChain params equal network.json walletAddChain", JSON.stringify(wallet.added[0]) === JSON.stringify(manifest.walletAddChain));
  check("connected address shown", true);

  // Word validation.
  const input = page.getByLabel("your word");
  await input.fill("Hello world");
  await input.blur();
  check("bad word explained beside the input", await page.getByText("a to z only, 1 to 20 letters. no spaces or capitals.").isVisible());
  check("add disabled for a bad word", await add.isDisabled());
  await input.fill("lantern");
  await page.getByText(/two wallet prompts: approve exactly 0\.1 IMD/).waitFor();
  check("approval explained before signing", true);
  check("add enabled for a good word", await add.isEnabled());

  // Approve exactly the amount due, then addWord, and report from the receipt.
  const due = BigInt(await page.evaluate(() => 0)) || 10n ** 17n;
  await add.click();
  await page.locator(".result").waitFor({ timeout: 60000 });
  const r1 = await page.locator(".result").innerText();
  check("receipt report names word, slot, image and token", /"lantern" is word 1 of image 1\. nft #1 is yours, paid 0\.1 IMD\./.test(r1), r1);
  const approve = decodeFunctionData({ abi: erc20Abi, data: wallet.sent[0].data });
  check("approval is exactly the amount due to FiveWords", wallet.sent[0].to.toLowerCase() === IMD && approve.functionName === "approve" && approve.args[0].toLowerCase() === FIVE && approve.args[1] === due, JSON.stringify(approve.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  check("addWord sent to the deployed address", wallet.sent[1].to.toLowerCase() === FIVE);
  await page.locator(".slot.filled", { hasText: "lantern" }).first().waitFor({ timeout: 20000 });
  check("slot 1 shows the word read back from the chain", true);
  await page.screenshot({ path: join(shots, "390-after-word.png") });

  // Same wallet again: refused before signing.
  await page.getByText("this wallet already wrote a word in image 1").waitFor({ timeout: 20000 });
  check("one word per wallet per image enforced in the page", true);

  // A rejected signature.
  const switchAccount = async (i) => {
    wallet.account = accounts[i];
    await page.evaluate((a) => window.__provider.emit("accountsChanged", [a]), accounts[i]);
    await page.locator("header").getByRole("button", { name: `${accounts[i].slice(0, 6)}…${accounts[i].slice(-4)}` }).waitFor();
  };
  await switchAccount(1);
  wallet.reject = true;
  await input.fill("quiet");
  await page.getByText(/two wallet prompts/).waitFor({ timeout: 20000 });
  await add.click();
  await page.locator(".result.error").waitFor({ timeout: 30000 });
  check("rejection reported, nothing sent", /declined/.test(await page.locator(".result.error").innerText()) && wallet.sent.length === 2);
  wallet.reject = false;

  // Words 2 to 5 from four more wallets; the fifth orders the image through the Intake.
  const words = ["quiet", "glass", "river", "moon"];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await switchAccount(i + 1);
    await input.fill(words[i]);
    await page.getByRole("button", { name: /^add · / }).waitFor();
    await page.waitForFunction(() => !document.querySelector("form.add button[type=submit]")?.disabled, null, { timeout: 20000 });
    await page.getByRole("button", { name: /^add · / }).click();
    await page.locator(".result").filter({ hasText: `"${words[i]}"` }).waitFor({ timeout: 60000 });
  }
  const r5 = await page.locator(".result").innerText();
  check("fifth word report says the image is ordered", /word 5 of image 1.*the image is ordered/.test(r5), r5);
  await page.getByRole("timer").filter({ hasText: /image 2 opens in 0[45]:\d\d:\d\d/ }).waitFor({ timeout: 20000 });
  check("countdown to the next image", true);
  check("countdown shown once", (await page.getByText(/image 2 opens in/).count()) === 1);
  check("frame keeps the ordered image during the countdown", await page.getByText("ordered, the swarm is drawing it").first().isVisible());
  await page.screenshot({ path: join(shots, "390-countdown.png") });

  // Gallery and the image page with its holders.
  await page.getByRole("link", { name: "gallery" }).click();
  await page.getByRole("heading", { name: "gallery" }).waitFor();
  check("gallery shows five frames", (await page.locator(".grid .frame").count()) === 5);
  await page.locator(".grid a").first().click();
  await page.getByRole("heading", { name: "its five holders" }).waitFor();
  await page.getByText(/held by/).nth(4).waitFor({ timeout: 20000 });
  const links = await page.locator(".holders a").evaluateAll((as) => as.map((a) => a.href));
  check("five holders linked to OpenSea", links.filter((h) => h.startsWith("https://opensea.io/0x")).length === 5 && links.some((h) => h.includes(`/assets/ethereum/`)));
  check("words shown as plain text", (await page.locator(".holders .slot-w").allInnerTexts()).join(" ") === "lantern quiet glass river moon");
  await page.screenshot({ path: join(shots, "390-image-1.png"), fullPage: true });

  await page.getByRole("link", { name: "about" }).click();
  await page.getByText("a mini experiment in multiplayer ai.").waitFor();
  check("about links the launch explorer", (await page.getByRole("link", { name: "this is just a tiny five word example. what will you build?" }).getAttribute("href")) === "https://explorer.imd.fun/launch");
  check("footer on every page", await page.getByText("experimental, unaudited software. use at your own risk.").isVisible());
  for (const w of [320, 390]) {
    await page.setViewportSize({ width: w, height: 700 });
    check(`about: no sideways scroll at ${w}`, (await overflow()) <= 0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "#/");
  await page.getByRole("heading", { name: /image \d of 5/ }).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, "1440-play.png") });

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  console.log(`blocked outside requests: ${outside.length}${outside.length ? ` (${[...new Set(outside.map((u) => new URL(u).host))].join(", ")})` : ""}`);
  await browser.close();
} catch (e) {
  failures.push(`threw: ${e.message.split("\n")[0]}`);
  if (globalThis.__page) {
    console.log("--- page text at failure ---\n" + (await globalThis.__page.locator("body").innerText().catch(() => "")).slice(0, 1500));
    await globalThis.__page.screenshot({ path: join(shots, "failure.png") }).catch(() => {});
  }
  console.log("FAIL", e);
} finally {
  cleanup();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `- ${f}`).join("\n"));
  process.exitCode = 1;
}
