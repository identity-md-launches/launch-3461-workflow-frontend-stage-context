import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";
import { WALLET_ICONS } from "./wallet-icons";
import { OPEN_IN, isMobileBrowser } from "./open-in";
import { useDeployment } from "../deployment";
import { switchToChain } from "./switch";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const svgSrc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const SheetCtx = createContext<{ openSheet: () => void }>({ openSheet: () => {} });
/** Lets any control (the add button, for one) open the same connect sheet. */
export const useConnectSheet = () => useContext(SheetCtx);

export function ConnectProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SheetCtx.Provider value={{ openSheet: () => setOpen(true) }}>
      {children}
      {open && <Sheet onClose={() => setOpen(false)} />}
    </SheetCtx.Provider>
  );
}

/** The header's wallet control: Connect, Switch to <chain>, or the short address and Disconnect. */
export function WalletButton() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { openSheet } = useConnectSheet();
  const d = useDeployment();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [menu]);

  if (isConnected && address && chainId !== d.chain.id) {
    return (
      <span className="wallet">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote("");
            try {
              await switchToChain(connector, d);
            } catch (e) {
              setNote((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "switching…" : `switch to ${d.chain.name}`}
        </button>
        {note && <span className="note" role="status">{note}</span>}
      </span>
    );
  }
  if (isConnected && address) {
    return (
      <span className="wallet">
        <button className="btn" aria-expanded={menu} aria-controls="wallet-menu" onClick={() => setMenu(!menu)}>
          {short(address)}
        </button>
        {menu && (
          <span className="menu" id="wallet-menu">
            <span className="menu-addr">{address}</span>
            <button
              className="btn"
              onClick={() => {
                setMenu(false);
                disconnect();
              }}
            >
              disconnect
            </button>
          </span>
        )}
      </span>
    );
  }
  return (
    <button className="btn" onClick={openSheet}>
      connect
    </button>
  );
}

function Sheet({ onClose }: { onClose: () => void }) {
  const mobile = isMobileBrowser();
  const { isConnected } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const back = opener.current;
    return () => {
      removeEventListener("keydown", onKey);
      if (back instanceof HTMLElement) back.focus();
    };
  }, [onClose]);
  useEffect(() => {
    if (isConnected) onClose();
  }, [isConnected, onClose]);
  useEffect(() => () => reset(), [reset]);

  // EIP-6963 names each installed extension; wagmi's generic injected row is only for a browser
  // where discovery found nothing, and then it is called what it is.
  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")].filter(
    (c) => !(c.id === "injected" && named),
  );
  const label = (c: Connector) =>
    c.id === "injected" ? "browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name;
  const icon = (c: Connector) => c.icon ?? (WALLET_ICONS[c.id] ? svgSrc(WALLET_ICONS[c.id]!) : undefined);
  const rejected = error && /reject|denied|cancel/i.test(error.message);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="sheet-title">connect a wallet</h2>
          <button className="x" aria-label="close" onClick={onClose}>
            ×
          </button>
        </div>
        {mobile &&
          OPEN_IN.map((w) => (
            <a key={w.id} className="row" href={w.href(location.href)}>
              <span className="ic">{WALLET_ICONS[w.id] && <img width={28} height={28} src={svgSrc(WALLET_ICONS[w.id]!)} alt="" />}</span>
              <span>open in {w.name}</span>
            </a>
          ))}
        {listed
          .filter((c) => !mobile || c.type !== "injected")
          .map((c) => (
            <button key={c.uid} className="row" onClick={() => connect({ connector: c })} disabled={isPending}>
              <span className="ic">{icon(c) && <img width={28} height={28} src={icon(c)} alt="" />}</span>
              <span>
                {label(c)}
                {isPending && variables?.connector === c ? " · opening…" : ""}
              </span>
            </button>
          ))}
        {error && (
          <p className="note" role="status">
            {rejected ? "the wallet closed without connecting. pick a wallet to try again." : error.message.split("\n")[0]}
          </p>
        )}
      </div>
    </div>
  );
}
