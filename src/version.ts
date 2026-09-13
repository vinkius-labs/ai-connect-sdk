/**
 * SDK version. The single source of truth is `package.json`; the value is
 * injected at build/test time via the `__SDK_VERSION__` compile-time constant
 * (see `tsup.config.ts` and `vitest.config.ts`), so it never drifts.
 *
 * Falls back to a dev sentinel when the constant is not injected (e.g. when the
 * source is consumed unbundled).
 */
declare const __SDK_VERSION__: string | undefined;

export const VERSION: string = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0-dev';
