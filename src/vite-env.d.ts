/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set when building for the Playwright suite; enables test-only hooks. */
  readonly VITE_E2E?: string;
}
