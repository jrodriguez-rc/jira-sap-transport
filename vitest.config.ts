import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Default to node; frontend tests opt into jsdom via the per-file
    // `// @vitest-environment jsdom` pragma so the lib/handler tests don't
    // pay the jsdom startup cost.
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'static/issue-panel/src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
        'src/lib/types.ts',
        'src/__tests__/**',
        'static/issue-panel/src/index.tsx',
        'static/issue-panel/src/types.ts',
        'static/issue-panel/src/**/*.test.{ts,tsx}'
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      }
    }
  }
});
