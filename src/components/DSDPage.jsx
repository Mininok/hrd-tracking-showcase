import { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
import {
  Folder, Search, Plus, X, ChevronDown, ExternalLink, MoreVertical,
} from 'lucide-react';

const WAREHOUSES = ['IYR', 'LKB', 'ANR'];

const DSD_STATUS = {
  pending:   { label: 'รอดำเนินการ',   cls: 'dsd-status--pending'   },
  submitted: { label: 'ส่งเอกสารแล้ว', cls: 'dsd-status--submitted' },
  approved:  { label: 'อนุมัติแล้ว',   cls: 'dsd-status--approved'  },
  rejected:  { label: 'แก้ไขเอกสาร',   cls: 'dsd-status--rejected'  },
};

const fmtDate = (ts) => {
  if (!ts) return '–';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '–';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
};

const fmtUploader = (email) => {
  if (!email) return '';
  return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const isValidUrl = (s) => {
  if (!s?.trim()) return false;
  try { new URL(s.trim()); return true; } catch { return false; }
};

// ── Status badge — clickable dropdown for Super Admin ──────────
function StatusBadge({ status, isAdmin, onChangeStatus }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef();
  const info = DSD_STATUS[status] || DSD_STATUS.pending;

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!isAdmin) return <span className={`dsd-status-badge ${info.cls}`}>{info.label}</span>;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={`dsd-status-badge dsd-status-badge--btn ${info.cls}`}
        onClick={() => setOpen(v => !v)}
      >
        {info.label}
        <ChevronDown size={11} style={{ marginLeft: 4 }} />
      </button>
      {open && (
        <div className="dsd-status-dropdown">
          {Object.entries(DSD_STATUS).map(([key, val]) => (
            <button
              key={key}
              className={`dsd-status-dropdown-item${status === key ? ' active' : ''}`}
              onClick={() => { onChangeStatus(key); setOpen(false); }}
            >
              <span className={`dsd-status-dot dsd-status-dot--${key}`} />
              {val.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Submit modal ───────────────────────────────────────────────
function SubmitModal({ onClose, onSubmit, userWarehouse, isAdmin }) {
  const [warehouse, setWarehouse]       = useState(userWarehouse || '');
  const [trainingDate, setTrainingDate] = useState('');
  const [batchName, setBatchName]       = useState('');
  const [folderUrl, setFolderUrl]       = useState('');
  const [saving, setSaving]             = useState(false);
  const [errors, setErrors]             = useState({});

  // Auto-suggest folder name when batch + warehouse are filled
  const suggestedFolder = batchName.trim() && warehouse
    ? `DSD / ${batchName.trim()} / ${warehouse}`
    : '';

  const validate = () => {
    const e = {};
    if (!warehouse)          e.warehouse    = 'กรุณาเลือกคลัง';
    if (!trainingDate)       e.trainingDate = 'กรุณาระบุวันที่อบรม';
    if (!batchName.trim())   e.batchName    = 'กรุณาระบุชื่อรุ่น';
    if (!folderUrl.trim())   e.folderUrl    = 'กรุณาใส่ลิงก์โฟลเดอร์';
    else if (!isValidUrl(folderUrl)) e.folderUrl = 'URL ไม่ถูกต้อง';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      await onSubmit({
        warehouse,
        training_date: trainingDate,
        batch_name:    batchName.trim(),
        folder_url:    folderUrl.trim(),
      });
      onClose();
    } catch (err) {
      setErrors({ submit: err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
    setSaving(false);
  };

  const clear = (field) => setErrors(p => ({ ...p, [field]: '' }));

  return (
    <div className="dsd-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dsd-modal">
        <div className="dsd-modal-head">
          <h2>ส่งหลักฐานการอบรม</h2>
          <button className="dsd-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="dsd-modal-body">

          {/* Warehouse */}
          <div className="dsd-field">
            <label>คลัง <span className="dsd-req">*</span></label>
            {userWarehouse && !isAdmin
              ? <div className={`dsd-wh-pill dsd-wh-pill--${userWarehouse.toLowerCase()}`}>{userWarehouse}</div>
              : (
                <select
                  className={`dsd-input${errors.warehouse ? ' dsd-input--err' : ''}`}
                  value={warehouse}
                  onChange={e => { setWarehouse(e.target.value); clear('warehouse'); }}
                >
                  <option value="">เลือกคลัง...</option>
                  {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              )}
            {errors.warehouse && <span className="dsd-field-err-msg">{errors.warehouse}</span>}
          </div>

          {/* Training date */}
          <div className="dsd-field">
            <label>วันที่จัดอบรม <span className="dsd-req">*</span></label>
            <input
              type="date"
              className={`dsd-input${errors.trainingDate ? ' dsd-input--err' : ''}`}
              value={trainingDate}
              onChange={e => { setTrainingDate(e.target.value); clear('trainingDate'); }}
            />
            {errors.trainingDate && <span className="dsd-field-err-msg">{errors.trainingDate}</span>}
          </div>

          {/* Batch name */}
          <div className="dsd-field">
            <label>รุ่น <span className="dsd-req">*</span></label>
            <input
              type="text"
              className={`dsd-input${errors.batchName ? ' dsd-input--err' : ''}`}
              placeholder="เช่น รุ่นที่ 1-2569"
              value={batchName}
              onChange={e => { setBatchName(e.target.value); clear('batchName'); }}
            />
            {errors.batchName && <span className="dsd-field-err-msg">{errors.batchName}</span>}
          </div>

          {/* Folder link */}
          <div className="dsd-field">
            <label>
              <Folder size={13} style={{ display:'inline', verticalAlign:'middle', marginRight:5 }} />
              ลิงก์โฟลเดอร์ Google Drive <span className="dsd-req">*</span>
            </label>

            {/* Step guide */}
            <div className="dsd-folder-guide">
              <div className="dsd-folder-guide-title">วิธีสร้างโฟลเดอร์และรับลิงก์</div>
              <ol className="dsd-folder-steps">
                <li>สร้างโฟลเดอร์ใน Google Drive ตั้งชื่อว่า{suggestedFolder ? <strong> "{suggestedFolder}"</strong> : ' ตามรูปแบบ "DSD / รุ่นที่ X / คลัง"'}</li>
                <li>ใส่รูปภาพ <strong>3 รูป</strong> + PDF ใบลงชื่อ <strong>1 ไฟล์</strong> ลงในโฟลเดอร์นั้น</li>
                <li>คลิกขวาที่โฟลเดอร์ → <strong>Get link</strong> → เลือก <strong>"Anyone with the link"</strong></li>
                <li>Copy link แล้ววางด้านล่าง</li>
              </ol>
            </div>

            <div className="dsd-link-input-wrap">
              <Folder size={13} className="dsd-link-icon" />
              <input
                type="url"
                className={`dsd-input dsd-input--link${errors.folderUrl ? ' dsd-input--err' : ''}`}
                placeholder="https://drive.google.com/drive/folders/..."
                value={folderUrl}
                onChange={e => { setFolderUrl(e.target.value); clear('folderUrl'); }}
              />
              {folderUrl && isValidUrl(folderUrl) && (
                <a href={folderUrl} target="_blank" rel="noreferrer"
                  className="dsd-link-preview-btn" title="เปิดดูโฟลเดอร์">
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
            {errors.folderUrl && <span className="dsd-field-err-msg">{errors.folderUrl}</span>}
          </div>

          {errors.submit && <div className="dsd-error">{errors.submit}</div>}
        </div>

        <div className="dsd-modal-foot">
          <button className="dsd-btn dsd-btn--ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="dsd-btn dsd-btn--primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'ยืนยันส่งหลักฐาน'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row action menu ────────────────────────────────────────────
function RowMenu({ submission, isAdmin, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef();

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!isAdmin) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className="dsd-icon-btn" onClick={() => setOpen(v => !v)} title="ตัวเลือกเพิ่มเติม">
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="dsd-row-menu">
          <button
            className="dsd-row-menu-item dsd-row-menu-item--danger"
            onClick={() => { onDelete(submission.id); setOpen(false); }}
          >
            <X size={13} /> ลบรายการ
          </button>
        </div>
      )}
    </div>
  );
}

// ── DSD Main Page ──────────────────────────────────────────────
export function DSDPage({ user, isAdmin }) {
  const [submissions, setSubmissions] = useState([]);
  const [userWarehouse, setUserWarehouse] = useState(null);
  const [roleLoaded, setRoleLoaded]   = useState(false);
  const [modalOpen, setModalOpen]     = useState(false);
  const [search, setSearch]           = useState('');
  const [filterWh, setFilterWh]       = useState('All');
  const [filterSt, setFilterSt]       = useState('All');

  useEffect(() => {
    if (!user?.email) return;
    if (isAdmin || DEMO_MODE) { setRoleLoaded(true); return; }
    getDoc(doc(db, 'dsd_users', user.email))
      .then(d => { if (d.exists()) setUserWarehouse(d.data().warehouse || null); })
      .catch(() => {})
      .finally(() => setRoleLoaded(true));
  }, [user, isAdmin]);

  useEffect(() => {
    if (!user || DEMO_MODE) return;
    return onSnapshot(
      collection(db, 'dsd_submissions'),
      snap => setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err  => console.error('[DSD]', err.message),
    );
  }, [user]);

  const canSubmit = isAdmin || !!userWarehouse;

  const visible = useMemo(() => {
    if (isAdmin) return submissions;
    if (userWarehouse) return submissions.filter(s => s.warehouse === userWarehouse);
    return submissions;
  }, [submissions, isAdmin, userWarehouse]);

  const filtered = useMemo(() => visible.filter(s => {
    if (filterWh !== 'All' && s.warehouse !== filterWh) return false;
    if (filterSt !== 'All' && (s.status || 'pending') !== filterSt) return false;
    if (search) {
      const q = search.toLowerCase();
      return (s.batch_name || '').toLowerCase().includes(q)
          || (s.warehouse || '').toLowerCase().includes(q);
    }
    return true;
  }), [visible, filterWh, filterSt, search]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) =>
      (b.uploaded_at?.toMillis?.() ?? 0) - (a.uploaded_at?.toMillis?.() ?? 0)
    ),
  [filtered]);

  const handleSubmit = async ({ warehouse, training_date, batch_name, folder_url }) => {
    await addDoc(collection(db, 'dsd_submissions'), {
      warehouse,
      training_date:    new Date(training_date),
      batch_name,
      folder_url,
      status:           'pending',
      uploaded_by:      user.email,
      uploaded_by_name: user.displayName || '',
      uploaded_at:      serverTimestamp(),
    });
  };

  const handleStatusChange = async (id, newStatus) => {
    await updateDoc(doc(db, 'dsd_submissions', id), {
      status:            newStatus,
      status_updated_by: user.email,
      status_updated_at: serverTimestamp(),
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้หรือไม่?')) return;
    await deleteDoc(doc(db, 'dsd_submissions', id));
  };

  if (!roleLoaded) return <div className="status-bar loading">⟳ กำลังโหลดข้อมูลสิทธิ์...</div>;

  return (
    <div className="dsd-page">
      {/* ── Action bar ── */}
      <div className="dsd-bar">
        <div className="dsd-search-wrap">
          <Search size={14} className="dsd-search-icon" />
          <input
            className="dsd-search"
            placeholder="ค้นหาตามรุ่น หรือ คลัง..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="dsd-filter-group">
          <select className="dsd-filter-sel" value={filterWh} onChange={e => setFilterWh(e.target.value)}>
            <option value="All">ทุกคลัง (IYR/LKB/ANR)</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <select className="dsd-filter-sel" value={filterSt} onChange={e => setFilterSt(e.target.value)}>
            <option value="All">ทุกสถานะ</option>
            {Object.entries(DSD_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {canSubmit && (
          <button className="dsd-primary-btn" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> ส่งหลักฐานการอบรม
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="dsd-table-card">
        <table className="dsd-table">
          <thead>
            <tr>
              <th>วันที่อบรม</th>
              <th>คลัง</th>
              <th>รุ่น</th>
              <th>วันที่ Upload</th>
              <th>สถานะกรมพัฒน์ฯ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="dsd-table-empty">
                  {search || filterWh !== 'All' || filterSt !== 'All'
                    ? 'ไม่พบรายการที่ค้นหา'
                    : 'ยังไม่มีรายการ — กดส่งหลักฐานการอบรมเพื่อเพิ่มรายการแรก'}
                </td>
              </tr>
            ) : sorted.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="dsd-date-cell">
                    <span className="dsd-cal-icon">📅</span>
                    {fmtDate(s.training_date)}
                  </div>
                </td>
                <td>
                  <span className={`dsd-wh-pill dsd-wh-pill--${(s.warehouse || '').toLowerCase()}`}>
                    {s.warehouse || '–'}
                  </span>
                </td>
                <td>
                  <div className="dsd-batch-name">{s.batch_name || '–'}</div>
                  {s.uploaded_by && (
                    <div className="dsd-batch-by">By: {fmtUploader(s.uploaded_by)}</div>
                  )}
                </td>
                <td className="dsd-upload-date">{fmtDate(s.uploaded_at)}</td>
                <td>
                  <StatusBadge
                    status={s.status || 'pending'}
                    isAdmin={isAdmin}
                    onChangeStatus={st => handleStatusChange(s.id, st)}
                  />
                </td>
                <td>
                  <div className="dsd-actions-cell">
                    {s.folder_url && (
                      <a href={s.folder_url} target="_blank" rel="noreferrer"
                        className="dsd-icon-btn dsd-icon-btn--folder" title="เปิดโฟลเดอร์ Google Drive">
                        <Folder size={15} />
                      </a>
                    )}
                    <RowMenu submission={s} isAdmin={isAdmin} onDelete={handleDelete} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <SubmitModal
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          userWarehouse={userWarehouse}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
