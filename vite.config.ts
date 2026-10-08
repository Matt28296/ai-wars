import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build embeds the commit it was built from, so a running copy can say exactly what it is (/api/version later).
// CI checks that the output contains $GITHUB_SHA; a push is not a deploy, and a build without its sha proves nothing.
function resolveBuildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  define: { __BUILD_SHA__: JSON.stringify(resolveBuildSha()) },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
} as any);
