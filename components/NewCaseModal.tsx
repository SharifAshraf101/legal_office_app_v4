'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { clientDisplayName } from '@/lib/clients';
import { nextCaseId } from '@/lib/cases';
import type { Case, TimelineItem } from '@/types';

/**
 * Port of showNewCaseModalFromCases (source line 3970).
 *
 * Includes the inline client-search dropdown that lets users pick an existing
 * client by name / id / phone before filling out the case fields. On submit
 * the case is pushed to the end of casesArr (source line 4017) and a "case
 * opened" timeline entry is added (line 4018).
 */
export function NewCaseModal() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const [clientQuery, setClientQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [title, setTitle] = useState('');
  const [court, setCourt] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [fee, setFee] = useState('');
  const [desc, setDesc] = useState('');

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const clientResults = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    const list = q
      ? state.clients.filter((c) =>
          [c.name, c.nameAr, c.idNumber, c.phone]
            .filter(Boolean)
            .join(' · ')
            .toLowerCase()
            .includes(q),
        )
      : state.clients;
    return list.slice(0, 12);
  }, [state.clients, clientQuery]);

  const onChooseClient = (id: string) => {
    const c = state.clients.find((x) => x.id === id);
    if (!c) return;
    setSelectedClientId(c.id);
    setClientQuery(clientDisplayName(c, lang));
    setShowResults(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clientId = selectedClientId;
    if (!clientId) {
      alert(lang === 'ar' ? 'يجب اختيار موكل من القائمة' : 'יש לבחור לקוח מהרשימה');
      return;
    }
    const tTitle = title.trim();
    const tCourt = court.trim();
    const tNumber = caseNumber.trim();
    if (!tTitle || !tCourt || !tNumber) {
      alert(lang === 'ar' ? 'أكمل الحقول المطلوبة' : 'יש להשלים את השדות הנדרשים');
      return;
    }
    const tDesc = desc.trim();
    const tFee = parseFloat(fee) || 0;
    const newCase: Case = {
      id: nextCaseId(state.casesArr),
      clientId,
      caseNumber: tNumber,
      title: tTitle,
      titleAr: tTitle,
      status: 'active',
      description: tDesc,
      descriptionAr: tDesc,
      court: tCourt,
      courtAr: tCourt,
      agreedFee: tFee,
      lastHearing: '',
    };
    const today = new Date().toISOString().slice(0, 10);
    const entry: TimelineItem = {
      id: 'NOTE-NEW-' + Date.now(),
      caseId: newCase.id,
      type: 'note',
      title: 'פתיחת תיק',
      titleAr: 'فتح ملف',
      date: today,
      description: tDesc || 'נפתח תיק חדש',
      descriptionAr: tDesc || 'تم فتح ملف جديد',
    };
    dispatch({ type: 'SET_CASES', cases: [...state.casesArr, newCase] });
    dispatch({ type: 'SET_TIMELINE', timeline: [...state.timelineItems, entry] });
    dispatch({ type: 'SET_TAB', tab: 'cases' });
    close();
  };

  return (
    <div
      className="new-case-popup-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 700,
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        pointerEvents: 'auto',
        background: 'transparent',
        backdropFilter: 'none',
      }}
    >
      <div
        className="new-case-popup-box modal-box"
        style={{
          position: 'relative',
          width: 'min(520px, 92vw)',
          maxHeight: 'min(88vh, 820px)',
          overflowY: 'auto',
          background: '#FDFBF5',
          borderRadius: 22,
          padding: '60px 22px 22px',
          boxShadow:
            '0 28px 70px rgba(15,23,42,.55), 0 0 0 1px rgba(15,23,42,.08)',
        }}
      >
        <button
          type="button"
          aria-label={lang === 'ar' ? 'إغلاق' : 'סגור'}
          onClick={close}
          className="modal-close-x"
          style={{
            position: 'absolute',
            top: 14,
            left: '0.25cm',
            width: 38,
            height: 38,
            display: 'inline-grid',
            placeItems: 'center',
            border: '1px solid #e2ebf6',
            borderRadius: 0,
            background: '#FFFBF2',
            color: '#0f172a',
            cursor: 'pointer',
            fontWeight: 900,
            fontSize: 18,
            zIndex: 70,
          }}
        >
          ×
        </button>
        <h2 style={{ margin: 0, textAlign: 'center', padding: '0 48px' }}>
          {lang === 'ar' ? 'ملف جديد' : 'תיק חדש'}
        </h2>
      <form id="newCaseForm" className="form-grid new-case-form" onSubmit={onSubmit}>
        <div className="form-field search-box">
          <label>{lang === 'ar' ? 'بحث عن موكل' : 'חיפוש לקוח'}</label>
          <input
            id="newCaseClientSearchInput"
            autoComplete="off"
            placeholder={
              lang === 'ar'
                ? 'بحث بحسب الاسم، الهوية أو الهاتف'
                : 'חיפוש לפי שם, תעודת זהות או מספר טלפון'
            }
            value={clientQuery}
            onChange={(e) => {
              setClientQuery(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 180)}
          />
          <div
            id="newCaseClientResults"
            className={'case-results' + (showResults ? '' : ' is-hidden')}
          >
            {clientResults.length === 0 ? (
              <div className="case-result">
                <strong>{lang === 'ar' ? 'لا توجد نتائج' : 'לא נמצאו תוצאות'}</strong>
              </div>
            ) : (
              clientResults.map((c) => (
                <div
                  key={c.id}
                  className="case-result"
                  data-client-id={c.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChooseClient(c.id);
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    onChooseClient(c.id);
                  }}
                >
                  <strong>{clientDisplayName(c, lang)}</strong>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="form-field">
          <label>{t('caseType')}</label>
          <input
            id="newCaseTypeInput"
            required
            placeholder={
              lang === 'ar' ? 'مثال: حضانة، نفقة، أضرار' : 'לדוגמה: משמורת, מזונות, נזיקין'
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('court')}</label>
          <input
            id="newCaseCourtInput"
            required
            placeholder={lang === 'ar' ? 'اسم المحكمة' : 'שם בית המשפט'}
            value={court}
            onChange={(e) => setCourt(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('caseNumber')}</label>
          <input
            id="newCaseNumberInput"
            required
            placeholder={lang === 'ar' ? 'رقم الدعوى' : 'מספר התביעה'}
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('agreedFee')}</label>
          <input
            id="newCaseFeeInput"
            type="number"
            min="0"
            step="1"
            required
            placeholder="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('description')}</label>
          <textarea
            id="newCaseDescInput"
            placeholder={lang === 'ar' ? 'شرح موجز عن الملف' : 'הסבר קצר על התיק'}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-warning">
            <i className="fas fa-check" />
            {t('save')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            id="cancelNewCaseBtn"
            onClick={close}
          >
            {t('cancel')}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
