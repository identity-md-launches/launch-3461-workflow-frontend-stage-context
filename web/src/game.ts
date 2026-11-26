import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  formatUnits,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { useDeployment } from "./deployment";
import { IPFS_GATEWAYS } from "./config";

export const IMAGES = 5;
export const WORDS = 5;
export const STATUS = ["writing", "ordered", "failed", "delivered"] as const;
export type StatusName = (typeof STATUS)[number];
export const WORD_RE = /^[a-z]{1,20}$/;

export type ImageInfo = {
  n: number;
  status: StatusName;
  wordCount: number;
  failureStatus: number;
  orders: number;
  opensAt: number;
  orderedAt: number;
  requestedAt: number;
  requestId: Hex;
  resultHash: Hex;
  failureReason: Hex;
  uri: string;
  words: string[];
  imageURI: string;
  canRetry: boolean;
};

export type Game = {
  codeOk: boolean;
  rpcChainOk: boolean;
  currentImage: number;
  imagesOrdered: number;
  totalSupply: number;
  amountDue: bigint;
  retryPrice: bigint | null;
  pot: bigint;
  token: { address: Address; symbol: string; decimals: number };
  images: ImageInfo[];
  readAt: number;
};

type RawImage = {
  status: number;
  wordCount: number;
  failureStatus: number;
  orders: number;
  opensAt: number;
  orderedAt: number;
  requestedAt: number;
  requestId: Hex;
  resultHash: Hex;
  failureReason: Hex;
  uri: string;
  words: readonly string[];
};

/** Live contract state over the configured public RPCs, refreshed every 12 seconds. */
export function useGame() {
  const d = useDeployment();
  return useQuery({
    queryKey: ["game", d.address],
    refetchInterval: 12_000,
    queryFn: async (): Promise<Game> => {
      const c = d.publicClient;
      const read = <T>(functionName: string, args: unknown[] = []) =>
        c.readContract({ address: d.address, abi: d.abi, functionName, args }) as Promise<T>;
      const [code, rpcChain] = await Promise.all([c.getCode({ address: d.address }), c.getChainId()]);
      const codeOk = !!code && code !== "0x";
      const rpcChainOk = rpcChain === d.chain.id;
      if (!codeOk || !rpcChainOk) throw new Error(!rpcChainOk ? "the configured rpc answers for another chain" : "no contract code at the configured address");
      const ns = [1, 2, 3, 4, 5];
      const [currentImage, imagesOrdered, totalSupply, amountDue, retryPrice, pot, imd, infos, retries, uris] = await Promise.all([
        read<bigint>("currentImage"),
        read<bigint>("imagesOrdered"),
        read<bigint>("totalSupply"),
        read<bigint>("amountDue").catch(() => 0n),
        read<bigint>("retryPrice").catch(() => null),
        read<bigint>("pot"),
        read<Address>("imd"),
        Promise.all(ns.map((n) => read<RawImage>("imageInfo", [BigInt(n)]))),
        Promise.all(ns.map((n) => read<boolean>("canRetry", [BigInt(n)]))),
        Promise.all(ns.map((n) => read<string>("imageURI", [BigInt(n)]))),
      ]);
      const [symbol, decimals] = await Promise.all([
        c.readContract({ address: imd, abi: erc20Abi, functionName: "symbol" }),
        c.readContract({ address: imd, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return {
        codeOk,
        rpcChainOk,
        currentImage: Number(currentImage),
        imagesOrdered: Number(imagesOrdered),
        totalSupply: Number(totalSupply),
        amountDue,
        retryPrice,
        pot,
        token: { address: imd, symbol, decimals },
        readAt: Date.now(),
        images: infos.map((r, i) => ({
          n: i + 1,
          status: STATUS[r.status] ?? "writing",
          wordCount: Number(r.wordCount),
          failureStatus: Number(r.failureStatus),
          orders: Number(r.orders),
          opensAt: Number(r.opensAt),
          orderedAt: Number(r.orderedAt),
          requestedAt: Number(r.requestedAt),
          requestId: r.requestId,
          resultHash: r.resultHash,
          failureReason: r.failureReason,
          uri: r.uri,
          words: [...r.words],
          imageURI: uris[i]!,
          canRetry: retries[i]!,
        })),
      };
    },
  });
}

/** The connected wallet's IMD balance and allowance to FiveWords, and whether it wrote in an image. */
export function useMine(token: Address | undefined, image: number) {
  const d = useDeployment();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["mine", address, token, image],
    enabled: !!address && !!token,
    refetchInterval: 12_000,
    queryFn: async () => {
      const c = d.publicClient;
      const [balance, allowance, wrote] = await Promise.all([
        c.readContract({ address: token!, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
        c.readContract({ address: token!, abi: erc20Abi, functionName: "allowance", args: [address!, d.address] }),
        image > 0
          ? (c.readContract({ address: d.address, abi: d.abi, functionName: "hasWord", args: [BigInt(image), address!] }) as Promise<boolean>)
          : Promise.resolve(false),
      ]);
      return { balance, allowance, wrote };
    },
  });
}

/** Current holders of an image's minted tokens, slot by slot. */
export function useHolders(image: number, wordCount: number) {
  const d = useDeployment();
  return useQuery({
    queryKey: ["holders", image, wordCount],
    enabled: wordCount > 0,
    refetchInterval: 30_000,
    queryFn: async () =>
      Promise.all(
        Array.from({ length: wordCount }, (_, i) =>
          d.publicClient.readContract({
            address: d.address,
            abi: d.abi,
            functionName: "ownerOf",
            args: [BigInt((image - 1) * WORDS + i + 1)],
          }) as Promise<Address>,
        ),
      ),
  });
}

export const tokenIdOf = (image: number, slot: number) => (image - 1) * WORDS + slot;

export const fmt = (v: bigint, decimals: number) => {
  const s = formatUnits(v, decimals);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** ipfs://CID/path to a public gateway URL; any other URI unchanged. */
export const gatewayUrl = (uri: string, i = 0) => (uri.startsWith("ipfs://") ? `${IPFS_GATEWAYS[i]}${uri.slice(7)}` : uri);

/** What the visitor should read for a failed call: the contract's own reason, in its words. */
export function describeError(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = reverted?.data?.errorName;
    const args = reverted?.data?.args ?? [];
    switch (name) {
      case "BadWord":
        return "a word is a to z only, 1 to 20 letters.";
      case "AlreadyAdded":
        return `this wallet already wrote a word in image ${args[0]}. one word per wallet per image.`;
      case "NotOpenYet":
        return `image ${args[0]} is not open yet.`;
      case "GameOver":
        return "all five images are ordered. the game is over.";
      case "NotSold":
        return "the intake is not selling images right now, so no word can be added.";
      case "NotRetryable":
        return `image ${args[0]} cannot be ordered again now.`;
      case "PaymentNotTaken":
      case "RequestIdReused":
        return "the intake did not take this order, so the transaction would revert.";
    }
    if (name) return `the contract refused: ${name}.`;
    if (/reject|denied/i.test(e.message)) return "the wallet declined. nothing was sent.";
    if (/insufficient allowance/i.test(e.message)) return "the imd allowance is too low. approve again.";
    if (/insufficient balance|exceeds balance/i.test(e.message)) return "this wallet does not hold enough imd.";
    return e.shortMessage;
  }
  return (e as Error)?.message?.split("\n")[0] ?? "something went wrong.";
}

export type Step = { label: string; state: "todo" | "wait" | "sign" | "mining" | "done" | "error"; hash?: Hash; note?: string };

/**
 * Runs a sequence of writes: each is simulated first (its revert reason shown, nothing signed),
 * then signed by the visitor's wallet, then reported from its receipt.
 */
export function useTxRunner() {
  const d = useDeployment();
  const { address, chainId } = useAccount();
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  type Write = {
    label: string;
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: unknown[];
    /** Skip this step when it is already satisfied (an allowance that is already enough). */
    skip?: () => Promise<boolean>;
    /** Says what the receipt shows; throws when the receipt shows the step did not happen. */
    report: (receipt: TransactionReceipt) => Promise<string>;
  };

  async function run(writes: Write[]) {
    setRunning(true);
    setResult(null);
    if (!address || chainId !== d.chain.id) {
      setResult({ ok: false, text: !address ? "connect a wallet first." : `switch to ${d.chain.name} first.` });
      setRunning(false);
      return;
    }
    const st: Step[] = writes.map((w) => ({ label: w.label, state: "todo" }));
    const set = (i: number, s: Partial<Step>) => {
      st[i] = { ...st[i]!, ...s };
      setSteps([...st]);
    };
    setSteps([...st]);
    let last = "";
    try {
      for (let i = 0; i < writes.length; i++) {
        const w = writes[i]!;
        set(i, { state: "wait", note: "checking…" });
        if (w.skip && (await w.skip())) {
          set(i, { state: "done", note: "already done" });
          continue;
        }
        let request;
        try {
          ({ request } = await d.publicClient.simulateContract({
            account: address,
            address: w.address,
            abi: w.abi as never,
            functionName: w.functionName as never,
            args: w.args as never,
          }));
        } catch (e) {
          set(i, { state: "error", note: describeError(e) });
          throw e;
        }
        set(i, { state: "sign", note: "confirm in your wallet" });
        let hash: Hash;
        try {
          const wallet = await getWalletClient(d.wagmi, { chainId: d.chain.id, account: address });
          hash = await wallet.writeContract({ ...(request as object), account: address, chain: d.chain } as never);
        } catch (e) {
          set(i, { state: "error", note: describeError(e) });
          throw e;
        }
        set(i, { state: "mining", hash, note: "waiting for the block…" });
        const receipt = await d.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          set(i, { state: "error", hash, note: "the transaction reverted onchain. nothing changed." });
          throw new Error("reverted");
        }
        try {
          last = await w.report(receipt);
        } catch (e) {
          set(i, { state: "error", hash, note: (e as Error).message });
          throw e;
        }
        set(i, { state: "done", hash, note: last });
      }
      setResult({ ok: true, text: last });
    } catch (e) {
      setResult({ ok: false, text: describeError(e) === "reverted" ? "the transaction reverted." : describeError(e) });
    } finally {
      setRunning(false);
    }
  }

  return { steps, running, result, run, reset: () => (setSteps([]), setResult(null)) };
}

/** Events FiveWords emitted in a receipt, decoded with the deployment's ABI. */
export function fiveWordsEvents(receipt: TransactionReceipt, abi: readonly unknown[], address: Address) {
  return parseEventLogs({ abi: abi as never, logs: receipt.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()) }) as unknown as {
    eventName: string;
    args: Record<string, unknown>;
  }[];
}

export const approvalEvents = (receipt: TransactionReceipt, token: Address) =>
  parseEventLogs({ abi: erc20Abi, eventName: "Approval", logs: receipt.logs.filter((l) => l.address.toLowerCase() === token.toLowerCase()) });
