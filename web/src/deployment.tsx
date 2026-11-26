import { createContext, useContext } from "react";
import type { Deployment } from "./config";

export const DeploymentCtx = createContext<Deployment | null>(null);

/** The loaded `imd-deployment.json`, its ABI and the clients built from it. */
export function useDeployment(): Deployment {
  const d = useContext(DeploymentCtx);
  if (!d) throw new Error("deployment not loaded");
  return d;
}
