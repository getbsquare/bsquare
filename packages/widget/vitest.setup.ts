// Ensure a full localStorage implementation is available in the test environment.
// Node 25 provides a native localStorage stub (when --localstorage-file is absent
// it lacks clear/key/etc), so we replace it with a simple in-memory map that
// implements the full Storage interface expected by the session manager.

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  value: createLocalStorageMock(),
  writable: true,
});

// jsdom doesn't implement scrollIntoView; ChatInterface calls it on every
// message change. Stub it so component tests don't emit "Not implemented" noise.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
