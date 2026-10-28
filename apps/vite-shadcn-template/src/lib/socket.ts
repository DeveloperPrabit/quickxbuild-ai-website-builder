/**
 * Realtime is optional. This stub NEVER imports socket.io-client so Vite Preview
 * always boots even when node_modules is incomplete (common on resumed sandboxes).
 * Call sites that need live sockets can swap this file after `bun add socket.io-client`.
 */
export type AppSocket = {
  auth?: { userId?: string }
  disconnect: () => void
  connect: () => void
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  emit?: (event: string, ...args: unknown[]) => void
}

export function getAppSocket(_userId?: string): AppSocket | undefined {
  return undefined
}

export async function ensureAppSocket(_userId?: string): Promise<AppSocket | undefined> {
  return undefined
}
