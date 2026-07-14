import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['scripts/**/*.ts', 'actions/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'scripts/templates/**',
        // Bundled entry points, generated code and build output carry no logic worth covering.
        'actions/**/src/generated/**',
        'actions/**/dist/**',
      ],
    },
  },
});
