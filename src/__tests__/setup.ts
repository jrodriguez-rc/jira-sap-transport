// Global Vitest setup.
//
// 1. Registers @testing-library/jest-dom matchers on Vitest's `expect`.
//    Safe to load under node-only tests — matchers are only executed when
//    invoked, and our backend tests never call them.
// 2. Stubs `globalThis.__bridge` so that loading any module that imports
//    `@forge/bridge` succeeds at module init. The real bridge throws from
//    `getCallBridge()` (called at the top of `@forge/bridge/out/invoke/invoke.js`)
//    unless a `__bridge` global is present. Per-test mocks of `@forge/bridge`
//    still override what `invoke()` and `view.getContext()` return.
import '@testing-library/jest-dom/vitest';

type BridgeGlobal = typeof globalThis & {
  __bridge?: { callBridge: (...args: unknown[]) => Promise<unknown> };
};
const g = globalThis as BridgeGlobal;
if (!g.__bridge) {
  g.__bridge = { callBridge: async () => undefined };
}

// `@atlaskit/tokens` (a transitive dep of every @atlaskit/* component used by
// the Custom UI issue panel) calls `window.matchMedia` at module init to wire
// up its color-mode listeners. jsdom doesn't implement matchMedia, so without
// this stub the import throws before any test in the issue-panel suite runs.
// Guarded with `typeof window` so the node-only suites stay untouched.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// React DOM emits warnings when JSX uses uppercase element names that aren't
// known components — @forge/react ships all UI Kit primitives as plain string
// tags (`Button`, `Label`, `Stack`…), so JSDOM-based tests log thousands of
// "incorrect casing" warnings. They are not test failures, just noise that
// makes real errors hard to spot. The `act` warning is similarly noisy and
// comes from `useForm`'s internal state being initialised after render.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string') {
    if (first.includes('is using incorrect casing')) return;
    if (first.includes('was not wrapped in act')) return;
    if (first.includes('The tag') && first.includes('is unrecognized')) return;
    if (first.includes('React does not recognize the')) return;
  }
  originalConsoleError(...args);
};
