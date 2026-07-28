import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — declares this app as installable in
 * standalone mode. Once installed via Chrome/Edge's "Install app"
 * (the icon in the omnibox) or iOS Safari's "Add to Home Screen",
 * the app opens in its own window without the URL/tab bar.
 *
 * Works on localhost too — Chrome treats `http://localhost`
 * as a secure origin for PWA purposes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Legal Office - Ashraf Sharif',
    short_name: 'Legal Office',
    description: 'Legal Office Management',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#FDFBF5',
    theme_color: '#FDFBF5',
    lang: 'he',
    dir: 'rtl',
    icons: [
      // `any` — shown as-is where the platform doesn't mask (e.g. the
      // install prompt, task switcher). Cream background matches theme_color.
      {
        src: '/icons/app-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/app-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // `maskable` — Android crops to its device shape (circle/squircle).
      // The mark is padded into the inner-80% safe zone so nothing clips.
      {
        src: '/icons/app-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/app-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
