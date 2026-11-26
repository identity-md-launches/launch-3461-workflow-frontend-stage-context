import type { Connector } from "wagmi";
import type { Deployment } from "../config";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/**
 * Asks the wallet to switch to the deployment's chain. When the wallet does not know the chain
 * (code 4902, or a message saying so), adds it with the manifest's `walletAddChain` parameters,
 * copied unchanged from the network's chain table, then switches again.
 */
export async function switchToChain(connector: Connector | undefined, d: Deployment) {
  if (!connector) throw new Error("no wallet is connected");
  const provider = (await connector.getProvider()) as Eip1193;
  const chainId = `0x${d.chain.id.toString(16)}`;
  const doSwitch = () => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  try {
    await doSwitch();
  } catch (e) {
    const err = e as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    const code = err.code ?? err.data?.originalError?.code;
    const unknown = code === 4902 || /unrecognized|unknown chain|not been added|add.*chain/i.test(err.message ?? "");
    if (!unknown) {
      if (code === 4001) throw new Error("the wallet declined the switch.");
      throw new Error(err.message?.split("\n")[0] ?? "the wallet could not switch.");
    }
    if (!d.walletAddChain) throw new Error(`the wallet does not know ${d.chain.name}. add it in the wallet, then retry.`);
    await provider.request({ method: "wallet_addEthereumChain", params: [d.walletAddChain] });
    await doSwitch();
  }
}
