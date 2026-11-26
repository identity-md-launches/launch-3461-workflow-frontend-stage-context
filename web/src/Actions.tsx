import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { erc20Abi, type Address, type TransactionReceipt } from "viem";
import { useDeployment } from "./deployment";
import { approvalEvents, fiveWordsEvents, fmt, isRejection, PRICE_UNAVAILABLE, useMine, useTxRunner, WORD_RE, type Game, type Step } from "./game";
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
      setSwitchNote(isRejection(e) ? "the wallet declined the switch." : (e as Error).message);
    }
  };
  return { isConnected, wrongChain, openSheet, doSwitch, switchNote, verified: !!game?.codeOk && !!game?.rpcChainOk };
}

const tokenIdText = (v: unknown) => `#${String(v)}`;

type Token = NonNullable<Game["token"]>;

/**
 * The approval step and the price recheck shared by "add" and "order again". The allowance is set
 * to exactly the quoted price (a larger leftover allowance is replaced, not reused), and the price
 * is read again before the paying transaction: if it moved, the flow stops and asks for a fresh
 * click at the new amount.
 */
function exactApproval(d: ReturnType<typeof useDeployment>, token: Token, owner: Address, price: bigint, priceFn: string) {
  const text = `${fmt(price, token.decimals)} ${token.symbol}`;
  let approved = "";
  const allowance = () =>
    d.publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [owner, d.address] });
  return {
    approved: () => approved,
    step: {
      label: `approve exactly ${text} to fivewords`,
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [d.address, price],
      skip: async () => (await allowance()) === price,
      skipped: `the allowance is already exactly ${text}.`,
      declined: "the wallet declined the approval. nothing was sent.",
      report: async (r: TransactionReceipt) => {
        const ev = approvalEvents(r, token.address).find((e) => (e.args.spender as Address).toLowerCase() === d.address.toLowerCase());
        if (!ev) throw new Error("the receipt shows no approval to fivewords.");
        approved = `${fmt(ev.args.value, token.decimals)} ${token.symbol}`;
        return `approved ${approved}.`;
      },
    },
    /** Before the paying transaction: same price, and the allowance still exactly that price. */
    recheck: async () => {
      let now: bigint;
      try {
        now = (await d.publicClient.readContract({ address: d.address, abi: d.abi, functionName: priceFn })) as bigint;
      } catch {
        throw new Error(PRICE_UNAVAILABLE);
      }
      if (now !== price) {
        throw new Error(`the price changed to ${fmt(now, token.decimals)} ${token.symbol}. press the button again to approve exactly that.`);
      }
      if ((await allowance()) !== price) throw new Error(`the allowance is no longer exactly ${text}. press the button again.`);
    },
  };
}

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
  const [priceNote, setPriceNote] = useState("");
  const [refocus, setRefocus] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const left = useCountdown(opensAt);
  // After a declined or failed flow the input is enabled again; put the cursor back in the draft.
  useEffect(() => {
    if (refocus && !tx.running) input.current?.focus();
  }, [refocus, tx.running]);

  const due = game?.amountDue ?? null;
  const priceUnknown = !!game && due === null;
  const dueText = !token || !game ? "…" : due === null ? "price unavailable" : `${fmt(due, token.decimals)} ${token.symbol}`;
  const valid = WORD_RE.test(word);
  const over = !!game && game.currentImage === 0;
  const lowBalance = !!mine.data && due !== null && mine.data.balance < due;
  const needsApproval = !!mine.data && due !== null && mine.data.allowance !== due;

  let blocker = "";
  if (!game) blocker = "reading the contract…";
  else if (over) blocker = "all five images are ordered. the game is over.";
  else if (!gate.verified) blocker = "the contract could not be verified on this chain, so adding is off.";
  else if (!open) blocker = `image ${image} opens in ${hms(left)}.`;
  else if (priceUnknown) blocker = PRICE_UNAVAILABLE;
  else if (!gate.isConnected) blocker = "connect a wallet to add a word.";
  else if (gate.wrongChain) blocker = `your wallet is on another network. switch to ${d.chain.name}.`;
  else if (mine.data?.wrote) blocker = `this wallet already wrote a word in image ${image}. one word per wallet per image.`;
  else if (lowBalance) blocker = `you need ${dueText}. this wallet holds ${fmt(mine.data!.balance, token!.decimals)} ${token!.symbol}.`;

  const wordError = touched && word && !valid ? "a to z only, 1 to 20 letters. no spaces or capitals." : "";

  async function submit() {
    if (!token || !address) return;
    setPriceNote("");
    try {
      await addFlow(token, address);
    } finally {
      await qc.invalidateQueries();
    }
  }

  async function addFlow(token: Token, address: Address) {
    // The price is the Intake's and can move: read what is due right before approving it.
    let liveDue: bigint;
    try {
      liveDue = (await d.publicClient.readContract({ address: d.address, abi: d.abi, functionName: "amountDue" })) as bigint;
    } catch {
      setPriceNote(PRICE_UNAVAILABLE);
      setRefocus((n) => n + 1);
      return;
    }
    const liveText = `${fmt(liveDue, token.decimals)} ${token.symbol}`;
    const approval = exactApproval(d, token, address, liveDue, "amountDue");
    const ok = await tx.run([
      approval.step,
      {
        label: `add "${word}" · ${liveText}`,
        address: d.address,
        abi: d.abi,
        functionName: "addWord",
        args: [word],
        before: approval.recheck,
        declined: "the wallet declined the add transaction.",
        notDone: () => (approval.approved() ? `your ${approval.approved()} approval is onchain. your word was not added.` : ""),
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
    // Only a receipt with WordAdded clears the draft; a decline or a revert keeps it to try again.
    if (ok) {
      setWord("");
      setTouched(false);
    } else setRefocus((n) => n + 1);
  }

  const canSubmit = !blocker && valid && !tx.running;
  const onButton = () => {
    if (!gate.isConnected) return gate.openSheet();
    if (gate.wrongChain) return gate.doSwitch();
    setTouched(true);
    if (canSubmit) void submit();
  };
  const buttonDisabled =
    tx.running || (gate.isConnected && !gate.wrongChain && (!!blocker || !valid)) || (!gate.isConnected && (!open || over || priceUnknown));
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
          ref={input}
          id="word"
          name="word"
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            setPriceNote("");
          }}
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
      {priceNote && (
        <p className="note error" role="status">
          {priceNote}
        </p>
      )}
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
  const [priceNote, setPriceNote] = useState("");
  const info = game?.images[image - 1];
  const token = game?.token;
  const mine = useMine(token?.address, 0);
  // Once the order went through the image is no longer retryable, but the panel stays to show
  // the steps, the receipt summary and the transaction link.
  const hasFeedback = tx.steps.length > 0 || !!tx.result;
  if (!game || !info || !token || (!info.canRetry && !hasFeedback)) return null;
  const price = game.retryPrice;
  const priceText = price != null ? `${fmt(price, token.decimals)} ${token.symbol}` : "price unavailable";
  const low = !!mine.data && price != null && mine.data.balance < price;

  async function submit() {
    if (!token || !address) return;
    setPriceNote("");
    try {
      let live: bigint;
      try {
        live = (await d.publicClient.readContract({ address: d.address, abi: d.abi, functionName: "retryPrice" })) as bigint;
      } catch {
        setPriceNote(PRICE_UNAVAILABLE);
        return;
      }
      const liveText = `${fmt(live, token.decimals)} ${token.symbol}`;
      const approval = exactApproval(d, token, address, live, "retryPrice");
      await tx.run([
        approval.step,
        {
          label: `order image ${image} again · ${liveText}`,
          address: d.address,
          abi: d.abi,
          functionName: "retry",
          args: [BigInt(image)],
          before: approval.recheck,
          declined: "the wallet declined the order transaction.",
          notDone: () => (approval.approved() ? `your ${approval.approved()} approval is onchain. image ${image} was not ordered again.` : ""),
          report: async (r) => {
            const ev = fiveWordsEvents(r, d.abi, d.address).find((e) => e.eventName === "ImageOrdered");
            if (!ev) throw new Error("the transaction succeeded but the receipt shows no order.");
            return `image ${ev.args.image} is ordered again (attempt ${ev.args.attempt}).`;
          },
        },
      ]);
    } finally {
      await qc.invalidateQueries();
    }
  }

  const why = info.status === "failed" ? "the order failed." : "the order has had no answer for a day.";
  return (
    <div className="retry">
      {info.canRetry && (
        <>
          <p className="note">
            {why} anyone can pay the full price to order it again, with the same five words. no refunds.
          </p>
          <button
            className="btn"
            disabled={tx.running || price == null || (gate.isConnected && !gate.wrongChain && (low || !gate.verified))}
            onClick={() => (!gate.isConnected ? gate.openSheet() : gate.wrongChain ? gate.doSwitch() : submit())}
          >
            {tx.running ? "working…" : gate.wrongChain ? `switch to ${d.chain.name}` : `order again · ${priceText}`}
          </button>
          {gate.switchNote && (
            <p className="note error" role="status">
              {gate.switchNote}
            </p>
          )}
          {(price == null || priceNote) && (
            <p className="note error" role="status">
              {PRICE_UNAVAILABLE}
            </p>
          )}
          {low && <p className="note">this wallet holds less than {priceText}.</p>}
        </>
      )}
      <Steps steps={tx.steps} summarized={!!tx.result?.ok} />
      {tx.result && (
        <p className={tx.result.ok ? "result" : "result error"} role="status">
          {tx.result.text}
        </p>
      )}
    </div>
  );
}
