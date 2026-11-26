// Writes dist/abi/<Contract>.json and dist/imd-deployment.json after `vite build`.
//
// Inputs, all committed beside this script:
//   web/deployment/handoff.json  the validated deployment handoff, unchanged
//   web/deployment/network.json  the chain table entry for the handoff's chain, unchanged
//   docs/abi/<Contract>.json     the implementation-derived ABI at the deployed source commit
//
// The site reads dist/imd-deployment.json at runtime and nothing else for addresses, chain, RPCs
// and ABIs, so this script is the only place those values are assembled.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const root = resolve(web, "..");
const dist = join(root, "dist");

const handoff = JSON.parse(readFileSync(join(web, "deployment/handoff.json"), "utf8"));
const networkFile = JSON.parse(readFileSync(join(web, "deployment/network.json"), "utf8"));

/** Canonical JSON: object keys sorted, no whitespace. */
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
      : JSON.stringify(v);
const abiHash = (abi) => keccak256(toBytes(canonical(abi))).slice(2);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (handoff.version !== 1) throw new Error("handoff version is not 1");
if (networkFile.network.chainId !== handoff.chainId) throw new Error("network.json is for another chain");

mkdirSync(join(dist, "abi"), { recursive: true });
const contracts = handoff.contracts.map((c) => {
  const source = join(root, "docs/abi", `${c.name}.json`);
  const abi = JSON.parse(readFileSync(source, "utf8"));
  if (!Array.isArray(abi)) throw new Error(`${source} is not a raw ABI array`);
  const got = abiHash(abi);
  if (got !== c.abiHash) throw new Error(`${c.name}: ABI hash ${got} does not match handoff ${c.abiHash}`);
  const abiPath = `abi/${c.name}.json`;
  copyFileSync(source, join(dist, abiPath));
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(dist)
  .map((p) => relative(dist, p).split(sep).join("/"))
  .filter((p) => p !== "imd-deployment.json")
  .sort();
if (!files.includes("index.html")) throw new Error("dist/index.html is missing");
if (files.length > 128) throw new Error(`${files.length} assets, more than 128`);
let total = 0;
const assets = files.map((path) => {
  const buf = readFileSync(join(dist, path));
  if (buf.length > 8 * 1024 * 1024) throw new Error(`${path} is over 8 MiB`);
  total += buf.length;
  return { path, sha256: sha256(buf) };
});

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  network: networkFile.network,
  ...(networkFile.walletAddChain ? { walletAddChain: networkFile.walletAddChain } : {}),
};
writeFileSync(join(dist, "imd-deployment.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`imd-deployment.json: ${contracts.length} contract(s), ${assets.length} assets, ${total} bytes`);
