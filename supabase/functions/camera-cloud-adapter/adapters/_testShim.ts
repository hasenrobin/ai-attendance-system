// ============================================================================
// Registers a minimal `Deno.test` global so the *.test.ts files in this
// directory (written in idiomatic Deno form) can also run under Node via
// vite-node. Must be imported (for its side effect) before any *.test.ts
// file. See _testRunner.ts.
// ============================================================================

export type TestFn = () => void | Promise<void>
export const tests: { name: string; fn: TestFn }[] = []

;(globalThis as unknown as { Deno: { test: (name: string, fn: TestFn) => void } }).Deno = {
  test: (name, fn) => tests.push({ name, fn }),
}
