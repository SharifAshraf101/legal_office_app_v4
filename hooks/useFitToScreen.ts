'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Phones (≤899px): make `ref` fill exactly the space between its top and the
 * bottom navigation (#mobileNav), with no scrolling. If the content is taller
 * it is shrunk with CSS `zoom` (which shrinks the layout too, so no empty
 * space is left to scroll into); a transform is the fallback. Re-fits on
 * resize, address-bar changes, font load and when `key` changes.
 */
export function useFitToScreen(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    const host = (document.getElementById('content') as HTMLElement | null) || root?.parentElement;
    if (!root || !host) return;
    const mq = window.matchMedia('(max-width:899px)');
    // CSS `zoom` shrinks the LAYOUT as well (a transform leaves the full
    // unscaled height behind, which a phone could scroll into as empty space).
    const canZoom = typeof CSS !== 'undefined' && CSS.supports?.('zoom', '0.5');
    const reset = () => {
      root.style.removeProperty('zoom');
      root.style.transform = '';
      root.style.transformOrigin = '';
      root.style.width = '';
      root.style.height = '';
      root.style.minHeight = '';
    };
    const fit = () => {
      reset();
      if (!mq.matches) return;
      const nav = document.getElementById('mobileNav');
      const hostRect = host.getBoundingClientRect();
      const padBottom = parseFloat(getComputedStyle(host).paddingBottom) || 0;
      const top = root.getBoundingClientRect().top;
      // The bottom navigation floats over the page; above it is the space.
      const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const bottom = navRect && navRect.height > 0 ? Math.min(navRect.top, hostRect.bottom) : hostRect.bottom - padBottom;
      const avail = Math.floor(bottom - top);
      if (avail <= 0) return;
      if (canZoom) {
        let s = 1;
        for (let i = 0; i < 5; i++) {
          const h = root.getBoundingClientRect().height; // visual height
          if (h <= avail + 0.5) break;
          s = Math.max(0.3, s * (avail / h) * 0.995);
          root.style.setProperty('zoom', String(s));
        }
        // Exactly the visible space: zoomed px × s = avail, nothing below.
        root.style.height = `${avail / s}px`;
        root.style.overflow = 'hidden';
      } else {
        const rtl = getComputedStyle(root).direction === 'rtl';
        let s = 1;
        for (let i = 0; i < 4; i++) {
          const h = root.offsetHeight;
          const next = Math.min(1, avail / h);
          if (Math.abs(next - s) < 0.004 && h * s <= avail) break;
          s = next;
          root.style.width = s < 1 ? `${100 / s}%` : '';
        }
        if (s < 1) {
          root.style.transformOrigin = rtl ? 'top right' : 'top left';
          root.style.transform = `scale(${s})`;
        }
        root.style.height = `${Math.floor(avail / s)}px`;
        root.style.overflow = 'hidden';
      }
      host.scrollTop = 0;
    };
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    fit();
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    mq.addEventListener('change', schedule);
    window.addEventListener('resize', schedule);
    // Phones: the address bar / keyboard change the visible height.
    window.visualViewport?.addEventListener('resize', schedule);
    host.scrollTop = 0;
    document.fonts?.ready.then(schedule).catch(() => {});
    root.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', schedule, { once: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
