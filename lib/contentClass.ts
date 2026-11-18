/** The class list of the `#content` section, by screen and design. The screens'
 *  CSS is scoped by these classes ("contacts-classic", "calendar-modern", …). */
export function contentClassFor(tab: string, hs: string): string {
  const classic = hs === 'classic';
  const modern = hs === 'modern';
  return (
    'content' +
    (tab === 'home' ? ' home-content' : '') +
    (tab === 'home' && (classic || modern || hs === 'minimalist') ? ' home-classic' : '') +
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
    (tab === 'briefing' ? ' analytics-content briefing-content' + (classic ? ' briefing-classic' : '') : '')
  );
}
