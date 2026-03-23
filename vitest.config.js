import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.{test,spec,property}.?(c|m)[jt]s?(x)',
    ],
  },
});
