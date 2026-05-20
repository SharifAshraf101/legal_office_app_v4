'use client';

import { useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  exportLegalOfficeBackupFile,
  importLegalOfficeBackupFile,
} from '@/lib/storage';
import { availableFontsForLang } from '@/lib/translations';
import { Modal } from './Modal';
import type { FontSize, Lang, Theme } from '@/types';

/**
 * Settings drawer. Port of settingsPanelHtml (source line 3828) + the
 * various v179/v180/v181/v202/v211/v212 settings drawer behaviors — all
 * collapsed into a single React modal here, since the original drawer was a
 * fixed-position panel anchored to the gear button and the vNNN scripts only
 * existed to keep it stable across re-renders. In React the panel re-renders
 * cleanly on every state change so the drawer-stability patches aren't needed.
 *
 * Wired into Topbar (home tab) and into MobileNav (settings entry) at the
 * end of Stage 4c-3.
 */
export function SettingsDrawer() {
  const { state, dispatch, loadBackup } = useAppState();
  const { t, settingsText, lang } = useT();
  const modalStack = useModalStack();
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const fonts = availableFontsForLang(lang);

  const onExport = () => {
    exportLegalOfficeBackupFile(state);
  };
  const onImportClick = () => fileRef.current?.click();
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importLegalOfficeBackupFile(file);
      loadBackup(data);
      window.alert(
        settingsText(
          'הגיבוי יובא בהצלחה, כולל שם וכתובת המשרד.',
          'تم استيراد النسخة الاحتياطية بنجاح، بما في ذلك اسم المكتب وعنوانه.',
        ),
      );
    } catch (err) {
      console.error(err);
      window.alert(
        settingsText(
          'ייבוא הגיבוי נכשל. ודא שמדובר בקובץ JSON תקין של המערכת.',
          'فشل استيراد النسخة الاحتياطية. تأكد أنه ملف JSON صالح خاص بالنظام.',
        ),
      );
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Modal onClose={close} boxClassName="settings-modal-box" hideBackBtn>
      <h2 style={{ margin: 0, textAlign: 'center', padding: '0 48px' }}>
        {t('settings')}
      </h2>

      {/* Office name + address */}
      <Section
        title={settingsText('שם וכתובת משרד', 'اسم وعنوان المكتب')}
        icon="fa-gear"
        pillClass="gear"
      >
        <div className="settings-field clean-office-field">
          <label htmlFor="officeNameCleanInput">
            {settingsText('שם המשרד', 'اسم المكتب')}
          </label>
          <input
            id="officeNameCleanInput"
            className="clean-office-input"
            type="text"
            value={state.officeName}
            placeholder={t('firmName')}
            autoComplete="off"
            onChange={(e) => dispatch({ type: 'SET_OFFICE_NAME', name: e.target.value })}
          />
        </div>
        <div className="settings-field clean-office-field">
          <label htmlFor="officeAddressCleanInput">
            {settingsText('כתובת המשרד', 'عنوان المكتب')}
          </label>
          <input
            id="officeAddressCleanInput"
            className="clean-office-input"
            type="text"
            value={state.officeAddress}
            placeholder={
              lang === 'ar' ? 'السورج 2، القدس' : 'הסורג 2, ירושלים'
            }
            autoComplete="off"
            onChange={(e) =>
              dispatch({ type: 'SET_OFFICE_ADDRESS', address: e.target.value })
            }
          />
        </div>
        <div className="settings-save-hint">
          {settingsText(
            'השינוי נשמר אוטומטית ומופיע ליד הלוגו.',
            'يتم حفظ التغيير تلقائياً ويظهر بجانب الشعار.',
          )}
        </div>
      </Section>

      {/* Home-screen design */}
      <Section
        title={settingsText('עיצוב מסך ראשי', 'تصميم الشاشة الرئيسية')}
        icon="fa-table-cells-large"
        pillClass="home-style"
      >
        <div className="settings-actions">
          <button
            type="button"
            className={
              'mini-btn' + (state.homeStyle === 'modern' ? ' active' : '')
            }
            data-settings-home-style="modern"
            onClick={() => dispatch({ type: 'SET_HOME_STYLE', style: 'modern' })}
          >
            {settingsText('עיצוב מודרני', 'تصميم حديث')}
          </button>
          <button
            type="button"
            className={
              'mini-btn' + (state.homeStyle === 'classic' ? ' active' : '')
            }
            data-settings-home-style="classic"
            onClick={() => dispatch({ type: 'SET_HOME_STYLE', style: 'classic' })}
          >
            {settingsText('עיצוב קלאסי', 'تصميم كلاسيكي')}
          </button>
        </div>
        <div className="settings-save-hint">
          {settingsText(
            'עיצוב קלאסי מציג את הכרטיסים כריבועים סימטריים שלא חופפים את "אירועים קרובים" שבמרכז.',
            'التصميم الكلاسيكي يعرض البطاقات كمربعات متماثلة لا تتداخل مع زر "أحداث قريبة" في الوسط.',
          )}
        </div>
      </Section>

      {/* Language */}
      <Section title={t('language')} icon="fa-globe" pillClass="lang">
        <div className="settings-actions">
          {(['he', 'ar'] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              className={'mini-btn' + (state.currentLang === l ? ' active' : '')}
              data-settings-lang={l}
              onClick={() => dispatch({ type: 'SET_LANG', lang: l })}
            >
              {l === 'he' ? 'עברית' : 'العربية'}
            </button>
          ))}
        </div>
      </Section>

      {/* Theme */}
      <Section title={t('theme')} icon="fa-sun" pillClass="theme">
        <div className="settings-actions">
          {(['light', 'dark'] as Theme[]).map((th) => (
            <button
              key={th}
              type="button"
              className={'mini-btn' + (state.currentTheme === th ? ' active' : '')}
              data-settings-theme={th}
              onClick={() => dispatch({ type: 'SET_THEME', theme: th })}
            >
              {t(th)}
            </button>
          ))}
        </div>
      </Section>

      {/* Font family + size */}
      <Section
        title={`${t('fontFamily')} / ${settingsText('גודל גופן', 'حجم الخط')}`}
        icon="fa-text-height"
        pillClass="font"
      >
        <div className="settings-field">
          <label>{t('fontFamily')}</label>
          <select
            className="settings-font-select"
            data-settings-font-family
            aria-label={t('fontFamily')}
            value={state.currentFontFamily || fonts[0].id}
            onChange={(e) =>
              dispatch({ type: 'SET_FONT_FAMILY', family: e.target.value })
            }
          >
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>{settingsText('גודל גופן', 'حجم الخط')}</label>
          <div className="settings-actions">
            {(['small', 'normal', 'large'] as FontSize[]).map((sz) => (
              <button
                key={sz}
                type="button"
                className={
                  'mini-btn' + (state.currentFontSize === sz ? ' active' : '')
                }
                data-settings-font={sz}
                onClick={() => dispatch({ type: 'SET_FONT_SIZE', size: sz })}
              >
                {sz === 'small'
                  ? settingsText('קטן', 'صغير')
                  : sz === 'normal'
                    ? settingsText('רגיל', 'عادي')
                    : settingsText('גדול', 'كبير')}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Upcoming-event alerts */}
      <Section
        title={settingsText(
          'התראות פגישות קרובות',
          'تنبيهات المواعيد القريبة',
        )}
        icon="far fa-bell"
        pillClass="alerts"
      >
        <div className="settings-actions">
          <button
            type="button"
            className={'mini-btn' + (state.showUpcomingHome ? ' active' : '')}
            data-settings-upcoming="on"
            onClick={() => dispatch({ type: 'SET_SHOW_UPCOMING', show: true })}
          >
            {settingsText('הצג', 'عرض')}
          </button>
          <button
            type="button"
            className={'mini-btn' + (!state.showUpcomingHome ? ' active' : '')}
            data-settings-upcoming="off"
            onClick={() => dispatch({ type: 'SET_SHOW_UPCOMING', show: false })}
          >
            {settingsText('כבה', 'إيقاف')}
          </button>
        </div>
        <div className="settings-save-hint">
          {settingsText(
            'בחירה זו מציגה או מסתירה את כפתור אירועים קרובים במסך הראשי.',
            'هذا الخيار يظهر أو يخفي زر الأحداث القريبة في الشاشة الرئيسية.',
          )}
        </div>
      </Section>

      {/* Backup */}
      <Section
        title={settingsText(
          'גיבוי ושחזור נתונים',
          'نسخ احتياطي واستعادة البيانات',
        )}
        icon="fa-file-arrow-down"
        pillClass="backup"
      >
        <div className="settings-actions">
          <button
            type="button"
            className="mini-btn"
            data-backup-export
            onClick={onExport}
          >
            {settingsText('ייצוא גיבוי', 'تصدير نسخة احتياطية')}
          </button>
          <button
            type="button"
            className="mini-btn"
            data-backup-import
            onClick={onImportClick}
          >
            {settingsText('ייבוא גיבוי', 'استيراد نسخة احتياطية')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            data-backup-file-input
            hidden
            onChange={onImportFile}
          />
        </div>
        <div className="settings-save-hint">
          {settingsText(
            'הגיבוי כולל גם את שם המשרד, כתובת המשרד, שפה, תצוגה וגופן.',
            'تشمل النسخة الاحتياطية أيضاً اسم المكتب، عنوان المكتب، اللغة، العرض والخط.',
          )}
        </div>
      </Section>
    </Modal>
  );
}

/** Source's `<div class="settings-section-card">` wrapper. Always open in
 *  this React port — the original drawer collapsed sections; we leave them
 *  expanded for simplicity (Stage 5 polish if it matters). */
function Section({
  title,
  icon,
  pillClass,
  children,
}: {
  title: string;
  icon: string;
  pillClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-section-card open" data-settings-section={pillClass}>
      <div className="settings-section-head">
        <span className={'settings-icon-pill ' + pillClass}>
          <i className={'fas ' + icon} />
        </span>
        <span className="settings-section-title">{title}</span>
      </div>
      <div className="settings-section-body">{children}</div>
    </div>
  );
}
