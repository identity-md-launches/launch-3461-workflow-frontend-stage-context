import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { loadDeployment, type Deployment } from "./config";
import { DeploymentCtx } from "./deployment";
import { ConnectProvider } from "./wallet/ConnectSheet";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 6_000 } } });

function Root() {
  const [d, setD] = useState<Deployment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    loadDeployment().then(setD, (e: Error) => setError(e.message));
  }, []);
  if (error)
    return (
      <main className="page">
        <h1>fivewords</h1>
        <p className="banner error" role="alert">
          the deployment file did not load: {error}
        </p>
      </main>
    );
  if (!d) return <div className="boot" aria-busy="true" />;
  return (
    <DeploymentCtx.Provider value={d}>
      <WagmiProvider config={d.wagmi}>
        <QueryClientProvider client={queryClient}>
          <ConnectProvider>
            <App />
          </ConnectProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
