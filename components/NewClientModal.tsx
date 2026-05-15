'use client';

import { useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { nextClientId } from '@/lib/clients';
import { Modal } from './Modal';
import type { Client } from '@/types';

/**
 * Port of showNewClientModalFromContacts (source line 3930).
 *
 * Per-language layout:
 *   - In Hebrew mode the primary name field stores into name; the optional
 *     "other-language name" field stores into nameAr (and vice versa).
 *   - address / notes / addressAr / notesAr all start with the same value
 *     (source line 3963: `addressAr:address, notesAr:notes` — single-string mode).
 *   - New clients are unshifted to the front of the list (source line 3964).
 */
export function NewClientModal() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const [name, setName] = useState('');
  const [altName, setAltName] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [address, setAddress] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [notes, setNotes] = useState('');

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      alert(lang === 'ar' ? 'يجب إدخال اسم الموكل' : 'יש להזין שם לקוח');
      return;
    }
    const nameHe = lang === 'ar' ? altName.trim() : trimmed;
    const nameAr = lang === 'ar' ? trimmed : altName.trim();
    const next: Client = {
      id: nextClientId(state.clients),
      name: nameHe,
      nameAr,
      phone: phone.trim(),
      email: '',
      idNumber: idNumber.trim(),
      address: address.trim(),
      addressAr: address.trim(),
      notes: notes.trim(),
      notesAr: notes.trim(),
      photoUrl: photoUrl.trim(),
      photoIcon: '\u{1F464}',
    };
    dispatch({ type: 'SET_CLIENTS', clients: [next, ...state.clients] });
    close();
  };

  const title = lang === 'ar' ? 'إضافة موكل جديد' : 'הוספת לקוח חדש';
  const nameLabel = t('clientName');
  const altNameLabel =
    lang === 'ar' ? 'اسم الموكل بالعبرية' : 'שם הלקוח בשפה השנייה';
  const altNamePlaceholder =
    lang === 'ar' ? 'שם הלקוח בעברית' : 'اسم الموكل بالعربية';
  const namePlaceholder =
    lang === 'ar' ? 'اسم الموكل الكامل' : 'שם הלקוח המלא';
  const idPlaceholder = lang === 'ar' ? 'رقم الهوية' : 'מספר תעודת זהות';
  const addressPlaceholder =
    lang === 'ar' ? 'عنوان الموكل' : 'כתובת הלקוח';
  const notesPlaceholder =
    lang === 'ar' ? 'ملاحظات عامة حول الموكل' : 'הערות כלליות לגבי הלקוח';
  const photoLabel =
    lang === 'ar' ? 'رابط صورة الموكل' : 'קישור לתמונת הלקוח';
  const notesLabel =
    lang === 'ar' ? 'ملاحظات مرتبطة بالموكل' : 'הערות קשורות ללקוח';

  return (
    <Modal onClose={close}>
      <h2>{title}</h2>
      <form
        id="newClientForm"
        className="form-grid new-client-form"
        onSubmit={onSubmit}
      >
        <div className="form-field">
          <label>{nameLabel}</label>
          <input
            id="newClientNameInput"
            required
            placeholder={namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{altNameLabel}</label>
          <input
            id="newClientAltNameInput"
            placeholder={altNamePlaceholder}
            value={altName}
            onChange={(e) => setAltName(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('phone')}</label>
          <input
            id="newClientPhoneInput"
            inputMode="tel"
            placeholder="050-0000000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('idNumber')}</label>
          <input
            id="newClientIdNumberInput"
            placeholder={idPlaceholder}
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{t('address')}</label>
          <input
            id="newClientAddressInput"
            placeholder={addressPlaceholder}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{photoLabel}</label>
          <input
            id="newClientPhotoInput"
            placeholder="https://..."
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>{notesLabel}</label>
          <textarea
            id="newClientNotesInput"
            placeholder={notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-danger">
            <i className="fas fa-check" />
            {t('save')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            id="cancelNewClientBtn"
            onClick={close}
          >
            {t('cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
