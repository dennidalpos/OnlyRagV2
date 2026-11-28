// Setup for the `dom` Vitest project: every renderer test drives React through act(), so React must
// know it runs in an act environment, or it warns on each update that the environment is unsupported.
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Node 26 defines its own `localStorage` accessor on globalThis that yields undefined unless the process is
// started with --localstorage-file, and it shadows the happy-dom one. Restore a real in-memory Storage so the
// renderer persistence code under test runs against genuine Storage semantics.
if (typeof globalThis.localStorage === 'undefined') {
  const StorageClass = (globalThis as unknown as { Storage: new () => Storage }).Storage
  Object.defineProperty(globalThis, 'localStorage', { value: new StorageClass(), configurable: true, writable: true })
}
