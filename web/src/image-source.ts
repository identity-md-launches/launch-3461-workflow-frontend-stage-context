/**
 * Where a delivered image comes from.
 *
 * 1. The IMD IPFS gateway: `https://imd-ipfs.xyz/ipfs/<CID>/artifacts/print.png`, the CID taken
 *    from the image's onchain URI.
 * 2. The IMD API, when 1 fails: find the fifth word's transaction (the `WordAdded` log of slot 5),
 *    read `entries[0].admission.result.jobId` from `GET /intake/1/<tx hash>`, then the `url` of the
 *    file named "print" from `GET /jobs/<job id>/result`.
 *
 * Both are public and need no key. When both fail the frame keeps the sentence and tries again on
 * the next game refresh.
 */
import type { AbiEvent, Hash, PublicClient } from "viem";
import { IMD_API, IMD_IPFS_GATEWAY } from "./config";
import type { Deployment } from "./config";
import { WORDS, type ImageInfo } from "./game";

const CID_RE = /^ipfs:\/\/([A-Za-z0-9]+)(?:[/?#]|$)/;

/** The gateway URL of a delivered image, or null when neither onchain URI names an IPFS CID. */
export function gatewayImageUrl(info: Pick<ImageInfo, "imageURI" | "uri">): string | null {
  const cid = CID_RE.exec(info.imageURI)?.[1] ?? CID_RE.exec(info.uri)?.[1];
  return cid ? `${IMD_IPFS_GATEWAY}${cid}/artifacts/print.png` : null;
}

/**
 * The block mined at `timestamp` (unix seconds), or the closest lower bound found. Mainnet blocks
 * sit on 12-second slots and a missed slot only makes blocks fewer, so stepping by the time gap
 * never overshoots; a few steps land on the block itself.
 */
async function blockAt(c: PublicClient, timestamp: number): Promise<{ n: bigint; exact: boolean }> {
  const latest = await c.getBlock({ blockTag: "latest" });
  let n = latest.number - BigInt(Math.max(0, Math.floor((Number(latest.timestamp) - timestamp) / 12)));
  for (let i = 0; i < 6; i++) {
    const b = await c.getBlock({ blockNumber: n });
    const ts = Number(b.timestamp);
    if (ts === timestamp) return { n, exact: true };
    const step = BigInt(Math.max(1, Math.round(Math.abs(timestamp - ts) / 12)));
    n = ts < timestamp ? n + step : n - step;
    if (n > latest.number) n = latest.number;
  }
  return { n, exact: false };
}

/** The transaction that wrote an image's fifth word (it also placed the image's first order). */
export async function fifthWordTx(d: Deployment, info: ImageInfo): Promise<Hash> {
  const event = d.abi.find((x) => x.type === "event" && x.name === "WordAdded") as AbiEvent | undefined;
  if (!event) throw new Error("the ABI has no WordAdded event");
  const c = d.publicClient;
  const args = { image: BigInt(info.n), slot: BigInt(WORDS) };
  // The fifth word is mined in the block whose timestamp is the image's orderedAt.
  const at = info.orderedAt > 0 ? await blockAt(c, info.orderedAt) : null;
  const ranges: [bigint, bigint][] = at
    ? at.exact
      ? [[at.n, at.n]]
      : [[at.n > 200n ? at.n - 200n : 0n, at.n + 2000n]]
    : [];
  for (const [fromBlock, toBlock] of ranges) {
    const logs = await c.getLogs({ address: d.address, event, args, fromBlock, toBlock });
    if (logs[0]?.transactionHash) return logs[0].transactionHash;
  }
  throw new Error(`no fifth-word transaction found for image ${info.n}`);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

type Intake = { entries?: { admission?: { result?: { jobId?: unknown } } }[] };
type JobResult = { files?: { name?: unknown; url?: unknown }[] };

/** The image URL the IMD API gives for an image's job: the `url` of the file named "print". */
export async function apiImageUrl(d: Deployment, info: ImageInfo): Promise<string> {
  const tx = await fifthWordTx(d, info);
  const intake = (await getJson(`${IMD_API}/intake/1/${tx}`)) as Intake;
  const jobId = intake.entries?.[0]?.admission?.result?.jobId;
  if (typeof jobId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(jobId)) throw new Error("the intake record names no job");
  const result = (await getJson(`${IMD_API}/jobs/${jobId}/result`)) as JobResult;
  const url = result.files?.find((f) => f?.name === "print")?.url;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new Error("the job result has no print file");
  return url;
}
