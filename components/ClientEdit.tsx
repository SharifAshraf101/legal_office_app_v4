'use client';

import { useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { clientDisplayName } from '@/lib/clients';
import { Modal } from './Modal';
import { ClientDetail } from './ClientDetail';

/**
 * Port of showClientEdit (source line 4269) + saveClientEdit (line 4282).
 *
 * Same per-language handling: in Arabic mode, the primary fields write
 * to nameAr/addressAr/notesAr; in Hebrew mode they write to name/address/notes.
 * The optional "other-language name" field always writes to the opposite
 * column, falling back to the primary value when blank.
 */
export interface ClientEditProps {
  clientId: string;
}

export function ClientEdit({ clientId }: ClientEditProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const c = state.clients.find((x) => x.id === clientId);
  if (!c) return null;

  const initialName = clientDisplayName(c, lang);
  const initialPhone = String(c.phone || '');
  const initialIdNumber = String(c.idNumber || '');
  const initialAddress =
    lang === 'ar' ? c.addressAr || c.address || '' : c.address || c.addressAr || '';
  const initialNotes =
    lang === 'ar' ? c.notesAr || c.notes || '' : c.notes || c.notesAr || '';
  const initialOtherName = lang === 'ar' ? c.name || '' : c.nameAr || '';
  const otherNameLabel =
    lang === 'ar' ? 'اسم الموكل بالعبرية' : 'שם הלקוח בערבית';
  const title = lang === 'ar' ? 'تفاصيل الموكل' : 'פרטי לקוח';
  const notesLabel =
    lang === 'ar' ? 'ملاحظات مرتبطة بالموكل' : 'הערות קשורות ללקוח';

  const [name, setName] = useState(initialName);
  const [otherName, setOtherName] = useState(initialOtherName);
  const [phone, setPhone] = useState(initialPhone);
  const [idNumber, setIdNumber] = useState(initialIdNumber);
  const [address, setAddress] = useState(initialAddress);
  const [notes, setNotes] = useState(initialNotes);

  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const backToDetail = () => {
    close();
    modalStack.open(<ClientDetail clientId={clientId} />);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const updated = state.clients.map((x) => {
      if (x.id !== clientId) return x;
      const next = { ...x, phone, idNumber };
      if (lang === 'ar') {
        next.nameAr = name;
        next.addressAr = address;
        next.notesAr = notes;
        next.name = otherName;
        if (!next.address) next.address = address;
        if (!next.notes) next.notes = notes;
      } else {
        next.name = name;
        next.address = address;
        next.notes = notes;
        next.nameAr = otherName;
        if (!next.addressAr) next.addressAr = address;
        if (!next.notesAr) next.notesAr = notes;
      }
      return next;
    });
    dispatch({ type: 'SET_CLIENTS', clients: updated });
    backToDetail();
  };

  return (
    <Modal
      onClose={close}
      className="client-mobile-fullscreen client-details-existing-v137 client-detail-stable-v229"
      boxClassName="client-mobile-fullscreen-box client-detail-box-v225 client-detail-box-stable-v228"
    >
      <h2>{title}</h2>
      <div className="case-edit-toolbar client-edit-toolbar">
        <button type="button" className="case-edit-btn active">
          <i className="fas fa-pen" />
          <span>{t('edit')}</span>
        </button>
      </div>
      <form className="case-edit-form client-edit-form" onSubmit={onSubmit}>
        <label>
          {t('clientName')}
          <input
            id="editClientName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          {otherNameLabel}
          <input
            id="editClientOtherName"
            type="text"
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
          />
        </label>
        <label>
          {t('phone')}
          <input
            id="editClientPhone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label>
          {t('idNumber')}
          <input
            id="editClientIdNumber"
            type="text"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </label>
        <label>
          {t('address')}
          <input
            id="editClientAddress"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label>
          {notesLabel}
          <textarea
            id="editClientNotes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="case-edit-actions">
          <button type="button" className="cancel" onClick={backToDetail}>
            {t('cancel')}
          </button>
          <button type="submit" className="save">
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
