import type { Metadata } from 'next';
import './globals.css';

// The v155 early mobile resize guard from the source HTML (lines 7-48).
// It wraps EventTarget.prototype.addEventListener BEFORE any other script runs
// so mobile browser-chrome resize and orientationchange events that only change
// height (not width) are swallowed. This prevents the panel-body repaint loops
// the rest of the app was originally designed against.
//
// It MUST run before React hydrates, hence the inline <script> in <head>.
const V155_EARLY_MOBILE_RESIZE_GUARD = `
(function(){
  if(window.__LEGAL_OFFICE_V155_EARLY_RESIZE_GUARD__) return;
  window.__LEGAL_OFFICE_V155_EARLY_RESIZE_GUARD__ = true;
  var originalAdd = EventTarget.prototype.addEventListener;
  var lastW = 0, lastH = 0;
  try{ lastW = window.innerWidth || document.documentElement.clientWidth || 0; lastH = window.innerHeight || document.documentElement.clientHeight || 0; }catch(e){}
  function isMobile(){
    try{return (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'');}
    catch(e){return false;}
  }
  function guarded(listener, type){
    if(typeof listener !== 'function') return listener;
    if(listener.__legalOfficeV155Guarded) return listener;
    var wrapped = function(ev){
      if(isMobile()){
        var w = 0, h = 0;
        try{ w = window.innerWidth || document.documentElement.clientWidth || 0; h = window.innerHeight || document.documentElement.clientHeight || 0; }catch(e){}
        var widthChanged = Math.abs(w - lastW) > 3;
        lastW = w || lastW;
        lastH = h || lastH;
        if(type === 'resize' && !widthChanged) return;
        if(type === 'orientationchange') return;
      }
      return listener.apply(this, arguments);
    };
    wrapped.__legalOfficeV155Guarded = true;
    return wrapped;
  }
  EventTarget.prototype.addEventListener = function(type, listener, options){
    try{
      if((this === window || this === window.visualViewport) && (type === 'resize' || type === 'orientationchange')){
        return originalAdd.call(this, type, guarded(listener, type), options);
      }
    }catch(e){}
    return originalAdd.call(this, type, listener, options);
  };
})();
`;

export const metadata: Metadata = {
  title: 'Legal Office - Ashraf Sharif',
  description: 'Legal Office Management',
  other: {
    // Cache-control meta tags preserved from the source HTML so behavior on
    // the same hosting matches: every visit re-fetches the entry document.
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // dir="rtl" lang="he" matches the source default (the language selector lets
  // the user switch to Arabic at runtime; both languages are RTL so dir stays).
  return (
    <html dir="rtl" lang="he">
      <head>
        {/* v155 early resize guard — must run before any React hydration */}
        <script
          id="legal-office-v155-early-mobile-resize-guard"
          dangerouslySetInnerHTML={{ __html: V155_EARLY_MOBILE_RESIZE_GUARD }}
        />
        {/* Font Awesome 6.5 — stable release, supports modern icon names
           like fa-house, fa-user-group, fa-coins, fa-circle-check, etc. */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
        />
        {/* Google Fonts — unified Hebrew + Arabic typography.
           Hebrew: Heebo (primary, modern UI font) + Assistant (fallback).
           Arabic: Cairo (primary) + Tajawal (fallback).
           Applied via the `html[lang="he"]` and `html[lang="ar"]`
           typography blocks in globals.css. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&family=Assistant:wght@400;500;600;700;800&family=Cairo:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700;800;900&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
