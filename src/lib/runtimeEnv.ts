// Reads a configuration value from whichever runtime is hosting this code:
//  - Browser/Vite: import.meta.env (only VITE_-prefixed vars are exposed by Vite).
//  - Node (recognition-worker, scripts): process.env.
//
// Accessed via globalThis so this file needs neither @types/node nor a DOM lib
// assumption — it works under both tsconfig.app.json and a Node-only tsconfig.
export function readEnv(key: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  if (viteEnv && viteEnv[key] !== undefined) return viteEnv[key]

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[key]
}
