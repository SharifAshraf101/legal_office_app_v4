/** The class list of the `#content` section, by screen and design. The screens'
 *  CSS is scoped by these classes ("contacts-classic", "calendar-modern", …). */
export function contentClassFor(tab: string, hs: string): string {
  const classic = hs === 'classic';
  // "Minimal Design" shares the Modern (light) screens; its own look is CSS
  // scoped by body[data-home-style="minimalist"].
  const modern = hs === 'modern' || hs === 'minimalist';
  return (
    'content' +
    (tab === 'home' ? ' home-content' : '') +
    (tab === 'home' && (classic || modern) ? ' home-classic' : '') +
    (tab === 'calendar' && classic ? ' calendar-classic' : '') +
    (tab === 'calendar' && modern ? ' calendar-modern' : '') +
    (tab === 'search' && modern ? ' calendar-modern search-modern' : '') +
    (tab === 'contacts' && modern ? ' contacts-classic contacts-modern' : '') +
    (tab === 'cases' && modern ? ' contacts-classic cases-classic contacts-modern' : '') +
    (tab === 'tasks' && modern ? ' contacts-classic tasks-classic contacts-modern' : '') +
    (tab === 'documents' && modern ? ' contacts-classic docs-classic contacts-modern' : '') +
    (tab === 'finance' && modern ? ' contacts-classic fees-classic contacts-modern' : '') +
    (tab === 'contacts' && classic ? ' contacts-classic' : '') +
    (tab === 'cases' && classic ? ' contacts-classic cases-classic' : '') +
    (tab === 'search' && classic ? ' contacts-classic search-classic' : '') +
    (tab === 'documents' && classic ? ' contacts-classic docs-classic' : '') +
    (tab === 'tasks' && classic ? ' contacts-classic tasks-classic' : '') +
    (tab === 'finance' && classic ? ' contacts-classic fees-classic' : '') +
    (tab === 'financeDetail' && (classic || modern) ? ' contacts-classic fd-classic' + (modern ? ' contacts-modern' : '') : '') +
    (tab === 'analytics' ? ' analytics-content' + (classic ? ' analytics-classic' : '') : '') +
    (tab === 'annexes' ? ' annexes-content' : '') +
    (tab === 'netsync' ? ' netsync-content' : '') +
    (tab === 'briefing' ? ' analytics-content briefing-content' + (classic ? ' briefing-classic' : '') : '')
  );
}

/** Every design (Classic, Modern, Minimal) renders the office markup of the
 *  windows and screens; they differ in CSS only. The older markup behind the
 *  `else` branches is kept for a design that opts out. */
export function officeMarkup(hs: string): boolean {
  return hs === 'classic' || hs === 'modern' || hs === 'minimalist';
}
