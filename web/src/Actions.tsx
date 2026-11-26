import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { useDeployment } from "./deployment";
import { approvalEvents, fiveWordsEvents, fmt, useMine, useTxRunner, WORD_RE, type Game, type Step } from "./game";
import { useConnectSheet } from "./wallet/ConnectSheet";
import { switchToChain } from "./wallet/switch";
import { hms, useCountdown } from "./Frame";

/** The steps of a running or finished transaction flow, each with its receipt's explorer link. */
export function Steps({ steps, summarized }: { steps: Step[]; summarized?: boolean }) {
  const d = useDeployment();
  if (!steps.length) return null;
  return (
    <ol className="steps" aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className={`step step-${s.state}`}>
          <span className="step-n">{i + 1}</span>
          <span className="step-body">
            <span>{s.label}</span>
            {s.note && !(summarized && i === steps.length - 1 && s.state === "done") && <span className="step-note">{s.note}</span>}
            {s.hash && (
              <a className="step-note" href={`${d.explorer}/tx/${s.hash}`} target="_blank" rel="noreferrer">
                view transaction
              </a>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Shared gate for every write: wallet connected, right chain, deployment verified. */
function useGate(game: Game | undefined) {
  const d = useDeployment();
  const { isConnected, chainId, connector } = useAccount();
  const { openSheet } = useConnectSheet();
  const [switchNote, setSwitchNote] = useState("");
  const wrongChain = isConnected && chainId !== d.chain.id;
  const doSwitch = async () => {
    setSwitchNote("");
    try {
      await switchToChain(connector, d);
    } catch (e) {
      setSwitchNote((e as Error).message);
    }
  };
  return { isConnected, wrongChain, openSheet, doSwitch, switchNote, verified: !!game?.codeOk && !!game?.rpcChainOk };
}

const tokenIdText = (v: unknown) => `#${String(v)}`;

/** The word input and "add · 0.1 IMD": approve exactly what is due, then addWord. */
export function AddWord({ game, image, open, opensAt }: { game: Game | undefined; image: number; open: boolean; opensAt: number }) {
  const d = useDeployment();
  const qc = useQueryClient();
  const { address } = useAccount();
  const gate = useGate(game);
  const token = game?.token;
  const mine = useMine(token?.address, image);
  const tx = useTxRunner();
  const [word, setWord] = useState("");
  const [touched, setTouched] = useState(false);
  const left = useCountdown(opensAt);

  const due = game?.amountDue ?? 0n;
  const dueText = token ? `${fmt(due, token.decimals)} ${token.symbol}` : "…";
  const valid = WORD_RE.test(word);
  const over = !!game && game.currentImage === 0;
  const lowBalance = !!mine.data && mine.data.balance < due;
  const needsApproval = !!mine.data && mine.data.allowance < due;

  let blocker = "";
  if (!game) blocker = "reading the contract…";
  else if (over) blocker = "all five images are ordered. the game is over.";
  else if (!gate.verified) blocker = "the contract could not be verified on this chain, so adding is off.";
  else if (!open) blocker = `image ${image} opens in ${hms(left)}.`;
  else if (!gate.isConnected) blocker = "connect a wallet to add a word.";
  else if (gate.wrongChain) blocker = `your wallet is on another network. switch to ${d.chain.name}.`;
  else if (mine.data?.wrote) blocker = `this wallet already wrote a word in image ${image}. one word per wallet per image.`;
  else if (lowBalance) blocker = `you need ${dueText}. this wallet holds ${fmt(mine.data!.balance, token!.decimals)} ${token!.symbol}.`;

  const wordError = touched && word && !valid ? "a to z only, 1 to 20 letters. no spaces or capitals." : "";

  async function submit() {
    if (!token || !address) return;
    try {
      await addFlow(token, address);
    } finally {
      await qc.invalidateQueries();
    }
  }

  async function addFlow(token: NonNullable<Game["token"]>, address: Address) {
    // The price is the Intake's and can move: read what is due right before approving it.
    const liveDue = (await d.publicClient.readContract({ address: d.address, abi: d.abi, functionName: "amountDue" })) as bigint;
    const liveText = `${fmt(liveDue, token.decimals)} ${token.symbol}`;
    await tx.run([
      {
        label: `approve exactly ${liveText} to fivewords`,
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [d.address, liveDue],
        skip: async () =>
          (await d.publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [address, d.address] })) >=
          liveDue,
        report: async (r) => {
          const ev = approvalEvents(r, token.address).find((e) => (e.args.spender as Address).toLowerCase() === d.address.toLowerCase());
          if (!ev) throw new Error("the receipt shows no approval to fivewords.");
          return `approved ${fmt(ev.args.value, token.decimals)} ${token.symbol}.`;
        },
      },
      {
        label: `add "${word}" · ${liveText}`,
        address: d.address,
        abi: d.abi,
        functionName: "addWord",
        args: [word],
        report: async (r) => {
          const evs = fiveWordsEvents(r, d.abi, d.address);
          const added = evs.find((e) => e.eventName === "WordAdded");
          if (!added) throw new Error("the transaction succeeded but the receipt shows no word added.");
          const a = added.args;
          const ordered = evs.find((e) => e.eventName === "ImageOrdered");
          return (
            `"${String(a.word)}" is word ${a.slot} of image ${a.image}. nft ${tokenIdText(a.tokenId)} is yours, paid ${fmt(a.paid as bigint, token.decimals)} ${token.symbol}.` +
            (ordered ? " that was the fifth word: the image is ordered." : "")
          );
        },
      },
    ]);
    setWord("");
    setTouched(false);
  }

  const canSubmit = !blocker && valid && !tx.running;
  const onButton = () => {
    if (!gate.isConnected) return gate.openSheet();
    if (gate.wrongChain) return gate.doSwitch();
    setTouched(true);
    if (canSubmit) void submit();
  };
  const buttonDisabled = tx.running || (gate.isConnected && !gate.wrongChain && (!!blocker || !valid)) || (!gate.isConnected && (!open || over));
  const label = tx.running ? "working…" : gate.wrongChain ? `switch to ${d.chain.name}` : `add · ${dueText}`;

  return (
    <form
      className="add"
      onSubmit={(e) => {
        e.preventDefault();
        onButton();
      }}
    >
      <label htmlFor="word">your word</label>
      <div className="add-row">
        <input
          id="word"
          name="word"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="lantern"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          inputMode="text"
          aria-invalid={!!wordError}
          aria-describedby="word-help"
          disabled={over || !open || tx.running}
        />
        <button className="btn btn-primary" type="submit" disabled={buttonDisabled}>
          {label}
        </button>
      </div>
      <p id="word-help" className={wordError ? "note error" : "note"} role={wordError ? "alert" : undefined}>
        {wordError || "a to z, 1 to 20 letters. it is public and permanent, and mints you that slot's nft."}
      </p>
      {/* the countdown itself sits above the form, so a closed round adds no second line here */}
      {blocker && open && <p className="note">{blocker}</p>}
      {gate.switchNote && <p className="note error">{gate.switchNote}</p>}
      {!blocker && needsApproval && (
        <p className="note">two wallet prompts: approve exactly {dueText} to fivewords, then add your word.</p>
      )}
      <Steps steps={tx.steps} summarized={!!tx.result?.ok} />
      {tx.result && (
        <p className={tx.result.ok ? "result" : "result error"} role="status">
          {tx.result.text}
        </p>
      )}
    </form>
  );
}

/** "order again": anyone may pay the full live price to order a failed or unanswered image. */
export function Retry({ game, image }: { game: Game | undefined; image: number }) {
  const d = useDeployment();
  const qc = useQueryClient();
  const { address } = useAccount();
  const gate = useGate(game);
  const tx = useTxRunner();
  const info = game?.images[image - 1];
  const token = game?.token;
  const mine = useMine(token?.address, 0);
  if (!game || !info || !info.canRetry || !token) return null;
  const price = game.retryPrice;
  const priceText = price != null ? `${fmt(price, token.decimals)} ${token.symbol}` : "…";
  const low = !!mine.data && price != null && mine.data.balance < price;

  async function submit() {
    if (!token || !address) return;
    const live = (await d.publicClient.readContract({ address: d.address, abi: d.abi, functionName: "retryPrice" })) as bigint;
    const liveText = `${fmt(live, token.decimals)} ${token.symbol}`;
    await tx.run([
      {
        label: `approve exactly ${liveText} to fivewords`,
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [d.address, live],
        skip: async () =>
          (await d.publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [address, d.address] })) >= live,
        report: async (r) => {
          const ev = approvalEvents(r, token.address).find((e) => (e.args.spender as Address).toLowerCase() === d.address.toLowerCase());
          if (!ev) throw new Error("the receipt shows no approval to fivewords.");
          return `approved ${fmt(ev.args.value, token.decimals)} ${token.symbol}.`;
        },
      },
      {
        label: `order image ${image} again · ${liveText}`,
        address: d.address,
        abi: d.abi,
        functionName: "retry",
        args: [BigInt(image)],
        report: async (r) => {
          const ev = fiveWordsEvents(r, d.abi, d.address).find((e) => e.eventName === "ImageOrdered");
          if (!ev) throw new Error("the transaction succeeded but the receipt shows no order.");
          return `image ${ev.args.image} is ordered again (attempt ${ev.args.attempt}).`;
        },
      },
    ]);
    await qc.invalidateQueries();
  }

  const why = info.status === "failed" ? "the order failed." : "the order has had no answer for a day.";
  return (
    <div className="retry">
      <p className="note">
        {why} anyone can pay the full price to order it again, with the same five words. no refunds.
      </p>
      <button
        className="btn"
        disabled={tx.running || (gate.isConnected && !gate.wrongChain && (low || !gate.verified))}
        onClick={() => (!gate.isConnected ? gate.openSheet() : gate.wrongChain ? gate.doSwitch() : submit())}
      >
        {tx.running ? "working…" : gate.wrongChain ? `switch to ${d.chain.name}` : `order again · ${priceText}`}
      </button>
      {low && <p className="note">this wallet holds less than {priceText}.</p>}
      <Steps steps={tx.steps} summarized={!!tx.result?.ok} />
      {tx.result && (
        <p className={tx.result.ok ? "result" : "result error"} role="status">
          {tx.result.text}
        </p>
      )}
    </div>
  );
}
