import type { Config } from 'tailwindcss';

/**
 * Tailwind is scoped ONLY to the portal-modern (Communication) screen.
 *  - `content` only scans the portal-modern folder, so other components
 *    that happen to use class names won't generate utilities.
 *  - `important: '.modern-portal-root'` wraps every generated rule with
 *    that ancestor, so utilities ONLY apply inside the new screen.
 *  - `corePlugins.preflight: false` disables Tailwind's global CSS reset,
 *    leaving the existing app styles untouched.
 */
const config: Config = {
  content: ['./components/portal-modern/**/*.{ts,tsx}'],
  important: '.modern-portal-root',
  prefix: 'tw-',
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};

export default config;
