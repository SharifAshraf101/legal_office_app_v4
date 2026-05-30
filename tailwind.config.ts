import type { Config } from 'tailwindcss';

/**
 * Tailwind is scoped to screens that opt-in via the
 * `.modern-portal-root` ancestor class — currently the portal-modern
 * (Communication) screens AND the CaseBrainScreen modal inside
 * CaseDetail.tsx.
 *  - `content` scans the portal-modern folder + the file that
 *    declares `CaseBrainScreen`, so other components that happen
 *    to use `tw-*` class names won't generate utilities.
 *  - `important: '.modern-portal-root'` wraps every generated rule
 *    with that ancestor, so utilities ONLY apply inside those
 *    screens (and the brain modal adds `modern-portal-root` to its
 *    Modal className to opt in).
 *  - `corePlugins.preflight: false` disables Tailwind's global CSS
 *    reset, leaving the existing app styles untouched.
 */
const config: Config = {
  content: [
    './components/portal-modern/**/*.{ts,tsx}',
    './components/CaseDetail.tsx',
  ],
  important: '.modern-portal-root',
  prefix: 'tw-',
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};

export default config;
