import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function privacyViolations(code: string, filePath = 'src/probe.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId?.startsWith('no-restricted')).length;
}

describe('privacy lint rule (spec §8)', () => {
  it.each([
    'localStorage.setItem("a", "b");',
    'window.localStorage.getItem("a");',
    'window.sessionStorage.clear();',
    'sessionStorage.clear();',
    'indexedDB.open("x");',
    'document.cookie = "a=b";',
    'navigator.sendBeacon("/x");',
    'navigator.serviceWorker.register("/sw.js");',
    'fetch("https://evil.example/x");',
    'fetch(`http://x.example/${1}`);',
    'fetch("//evil.example/x");',
  ])('rejects %s', async (code) => {
    expect(await privacyViolations(code)).toBeGreaterThan(0);
  });

  it('allows same-origin relative fetch', async () => {
    expect(await privacyViolations('fetch("/fonts/a.ttf");')).toBe(0);
  });

  it('forbids the engine from importing UI code', async () => {
    expect(
      await privacyViolations('import { App } from "../ui/App";', 'src/engine/probe.ts'),
    ).toBeGreaterThan(0);
  });

  it('forbids the UI from importing mupdf', async () => {
    expect(
      await privacyViolations('import * as m from "mupdf";', 'src/ui/probe.tsx'),
    ).toBeGreaterThan(0);
  });
});
