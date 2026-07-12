// Flat ESLint config (ESLint 9 + Next 16).
//
// `next lint` was removed in Next 16, so linting runs through the ESLint CLI
// (see the "lint" script in package.json). `eslint-config-next` ships a native
// flat-config array that bundles the Next, React, React-Hooks, import, and
// TypeScript rule sets, so we just spread it.
import next from 'eslint-config-next';

const config = [
  {
    // Build output, vendored browser assets, and the separately-packaged
    // Cloudflare Worker (it has its own tsconfig + Workers types) are not
    // linted here.
    ignores: [
      '.next/**',
      'worker/**',
      'public/**',
      'next-env.d.ts',
    ],
  },
  ...next,
  {
    // eslint-plugin-react-hooks@7 (bundled by eslint-config-next) enables the
    // React-Compiler rule set. These three flag intentional, safe patterns this
    // codebase uses deliberately (mount-time state sync, the "latest ref"
    // pattern, etc.) rather than correctness bugs, so keep them advisory —
    // `lint` should fail only on genuine problems. `rules-of-hooks` and
    // `exhaustive-deps` keep their defaults (error / warn) because those catch
    // real crashes and stale closures.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];

export default config;
