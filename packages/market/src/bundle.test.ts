// The Edge Functions run a bundle of this package (pnpm functions:build). Build it the same
// way in memory and check it is self-contained and refuses an unauthenticated call.
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('Edge Function bundle', () => {
  it('has no external imports and answers 401 without the cron secret', async () => {
    const out = await build({
      entryPoints: [new URL('./edge.ts', import.meta.url).pathname],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    });
    const code = out.outputFiles[0]?.text ?? '';
    expect(code).not.toMatch(/^\s*import\s.+\sfrom\s/m);
    expect(code).not.toMatch(/\brequire\(/);
    const mod = (await import(
      `data:text/javascript,${encodeURIComponent(code)}`
    )) as typeof import('./edge');
    const res = await mod.handleJob('fx', new Request('https://fn.test', { method: 'POST' }), {
      LEDGR_CRON_SECRET: 'x'.repeat(40),
    });
    expect(res.status).toBe(401);
  });
});
