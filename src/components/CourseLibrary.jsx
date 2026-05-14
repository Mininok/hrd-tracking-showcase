import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, X, ExternalLink, Clock,
  FileText, BookOpen, Loader2, AlertTriangle, BookMarked,
  ChevronDown, MoreVertical, Pencil, Trash2,
} from 'lucide-react';
import {
  collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import { MOCK_COURSES } from '../mockData';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const PRESET_CATEGORIES = ['Soft Skill', 'Hard Skill'];

const SWAL_BASE = {
  customClass: {
    popup:         'cl-swal-popup',
    title:         'cl-swal-title',
    htmlContainer: 'cl-swal-html',
    confirmButton: 'cl-swal-confirm',
    cancelButton:  'cl-swal-cancel',
  },
  buttonsStyling: false,
  showCancelButton: true,
  reverseButtons: true,
  cancelButtonText: 'ยกเลิก',
};

// ── Helpers ──────────────────────────────────────────────────
function nextCourseId(courses) {
  let max = 0;
  courses.forEach(c => {
    const m = String(c.course_id || '').match(/FKT-C(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1]));
  });
  return `FKT-C${String(max + 1).padStart(3, '0')}`;
}

const TRAINING_TYPES = ['Internal', 'External'];

const EMPTY_FORM = {
  course_id: '', name: '', category: '', hours: '',
  training_type: '', trainer: '',
  has_cost: false, cost_amount: '',
  material_url: '', assessment_url: '',
  remark: '',
};

// ── Category Combobox ─────────────────────────────────────────
function CategoryCombobox({ value, onChange, existingCategories }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const allOptions = useMemo(() => {
    const extra = existingCategories.filter(
      c => !PRESET_CATEGORIES.map(p => p.toUpperCase()).includes(c.toUpperCase())
    );
    return [...PRESET_CATEGORIES, ...extra];
  }, [existingCategories]);

  const filtered = useMemo(() =>
    value.trim()
      ? allOptions.filter(o => o.toLowerCase().includes(value.toLowerCase()))
      : allOptions,
    [allOptions, value]
  );

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="cl-combobox" ref={ref}>
      <div className="cl-combobox-wrap">
        <input
          className="cl-input cl-combobox-input"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="เลือก หรือ พิมพ์หมวดหมู่"
          autoComplete="off"
        />
        <button type="button" className="cl-combobox-arrow" tabIndex={-1} onClick={() => setOpen(o => !o)}>
          <ChevronDown size={14} style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="cl-combobox-dropdown">
          {filtered.map(opt => (
            <button
              key={opt} type="button"
              className={`cl-combobox-option${value === opt ? ' active' : ''}`}
              onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Kebab Menu ────────────────────────────────────────────────
function KebabMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="km-wrap" ref={ref}>
      <button
        className="km-btn"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title="ตัวเลือก"
      >
        <MoreVertical size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="km-dropdown"
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
          >
            <button className="km-item" onClick={() => { onEdit(); setOpen(false); }}>
              <Pencil size={13} /> แก้ไข
            </button>
            <button className="km-item km-item--danger" onClick={() => { onDelete(); setOpen(false); }}>
              <Trash2 size={13} /> ลบ
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────
function CourseModal({ onClose, onSave, existingCourses, saving, editData }) {
  const isEdit = !!editData;

  const [form, setForm] = useState(() => isEdit
    ? {
        course_id:      editData.course_id || '',
        name:           editData.name || '',
        category:       editData.category || '',
        hours:          editData.hours != null ? String(editData.hours) : '',
        training_type:  editData.training_type || '',
        trainer:        editData.trainer || '',
        has_cost:       editData.has_cost ?? false,
        cost_amount:    editData.cost_amount != null ? String(editData.cost_amount) : '',
        material_url:   editData.material_url || '',
        assessment_url: editData.assessment_url || '',
        remark:         editData.remark || '',
      }
    : { ...EMPTY_FORM, course_id: nextCourseId(existingCourses) }
  );
  const [errors, setErrors] = useState({});

  const categories = useMemo(() =>
    [...new Set(existingCourses.map(c => c.category).filter(Boolean))].sort(),
    [existingCourses]
  );

  const set = (field) => (e) => {
    setForm(p => ({ ...p, [field]: e.target.value }));
    setErrors(p => ({ ...p, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.course_id.trim()) e.course_id = 'กรุณากรอกรหัสหลักสูตร';
    if (!form.name.trim())      e.name      = 'กรุณากรอกชื่อหลักสูตร';
    if (!isEdit) {
      const dup = existingCourses.find(c => c.course_id === form.course_id.trim());
      if (dup) e.course_id = `รหัส ${form.course_id.trim()} มีอยู่แล้ว`;
    }
    return e;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(form);
  };

  return (
    <>
      <motion.div
        className="cl-modal-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />
      <div className="cl-modal-positioner">
        <motion.div
          className="cl-modal"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="cl-modal-header">
            <div className="cl-modal-header-icon"><BookMarked size={18} /></div>
            <div>
              <h2 className="cl-modal-title">{isEdit ? 'แก้ไขหลักสูตร' : 'สร้างหลักสูตรใหม่'}</h2>
              <p className="cl-modal-sub">{isEdit ? `แก้ไขข้อมูล ${editData.course_id}` : 'เพิ่มหลักสูตรเข้าสู่ระบบ Course Library'}</p>
            </div>
            <button className="cl-modal-close" onClick={onClose} disabled={saving}><X size={15} /></button>
          </div>

          <form className="cl-form" onSubmit={handleSubmit}>
            {/* Row 1: ID + Name */}
            <div className="cl-form-row">
              <div className="cl-form-field" style={{ flex: '0 0 130px' }}>
                <label className="cl-label">รหัสหลักสูตร <span>*</span></label>
                <input
                  className={`cl-input${errors.course_id ? ' cl-input--err' : ''}${isEdit ? ' cl-input--readonly' : ''}`}
                  value={form.course_id}
                  onChange={isEdit ? undefined : set('course_id')}
                  readOnly={isEdit}
                  placeholder="FKT-C001"
                />
                {errors.course_id && <span className="cl-field-err">{errors.course_id}</span>}
              </div>
              <div className="cl-form-field" style={{ flex: 1 }}>
                <label className="cl-label">ชื่อหลักสูตร <span>*</span></label>
                <input
                  className={`cl-input${errors.name ? ' cl-input--err' : ''}`}
                  value={form.name}
                  onChange={set('name')}
                  placeholder="ชื่อหลักสูตร"
                />
                {errors.name && <span className="cl-field-err">{errors.name}</span>}
              </div>
            </div>

            {/* Row 2: Category + Hours */}
            <div className="cl-form-row">
              <div className="cl-form-field" style={{ flex: 1 }}>
                <label className="cl-label">หมวดหมู่</label>
                <CategoryCombobox
                  value={form.category}
                  onChange={v => { setForm(p => ({ ...p, category: v })); setErrors(p => ({ ...p, category: '' })); }}
                  existingCategories={categories}
                />
              </div>
              <div className="cl-form-field" style={{ flex: '0 0 130px' }}>
                <label className="cl-label">จำนวนชั่วโมง</label>
                <input
                  className="cl-input"
                  type="number" min="0" step="0.5"
                  value={form.hours}
                  onChange={set('hours')}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Row 3: Training Type + Trainer */}
            <div className="cl-form-row">
              <div className="cl-form-field" style={{ flex: '0 0 160px' }}>
                <label className="cl-label">ประเภทการอบรม</label>
                <select className="cl-input" value={form.training_type} onChange={set('training_type')}>
                  <option value="">-- เลือกประเภท --</option>
                  {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="cl-form-field" style={{ flex: 1 }}>
                <label className="cl-label">ชื่อวิทยากร / Trainer</label>
                <input
                  className="cl-input"
                  value={form.trainer}
                  onChange={set('trainer')}
                  placeholder="เช่น อ.สมชาย / John Doe"
                />
              </div>
            </div>

            {/* Row 4: Cost toggle + amount */}
            <div className="cl-form-field">
              <label className="cl-label">ค่าใช้จ่าย</label>
              <div className="cl-cost-row">
                <label className="cl-toggle-wrap">
                  <input
                    type="checkbox"
                    className="cl-toggle-input"
                    checked={form.has_cost}
                    onChange={e => setForm(p => ({ ...p, has_cost: e.target.checked, cost_amount: e.target.checked ? p.cost_amount : '' }))}
                  />
                  <span className={`cl-toggle-track${form.has_cost ? ' on' : ''}`}>
                    <span className="cl-toggle-thumb" />
                  </span>
                  <span className="cl-toggle-label">{form.has_cost ? 'มีค่าใช้จ่าย' : 'ไม่มีค่าใช้จ่าย (ฟรี)'}</span>
                </label>
                {form.has_cost && (
                  <div className="cl-cost-amount-wrap">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="cl-input cl-cost-input"
                      value={form.cost_amount}
                      onChange={set('cost_amount')}
                      placeholder="0"
                    />
                    <span className="cl-cost-unit">บาท</span>
                  </div>
                )}
              </div>
            </div>

            {/* Material URL */}
            <div className="cl-form-field">
              <label className="cl-label">Material URL</label>
              <input className="cl-input" value={form.material_url} onChange={set('material_url')} placeholder="https://drive.google.com/..." />
            </div>

            {/* Assessment URL */}
            <div className="cl-form-field">
              <label className="cl-label">Assessment URL</label>
              <input className="cl-input" value={form.assessment_url} onChange={set('assessment_url')} placeholder="https://forms.gle/..." />
            </div>

            {/* Remark */}
            <div className="cl-form-field">
              <label className="cl-label">หมายเหตุ / ข้อมูลเพิ่มเติม</label>
              <textarea
                className="cl-input cl-textarea"
                value={form.remark}
                onChange={set('remark')}
                placeholder="เช่น เงื่อนไขการเข้าร่วม, กลุ่มเป้าหมาย, รายละเอียดอื่นๆ..."
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="cl-form-actions">
              <button type="button" className="cl-action-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
              <button type="submit" className="cl-action-primary" disabled={saving}>
                {saving
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> กำลังบันทึก...</>
                  : isEdit
                    ? <><Pencil size={14} /> บันทึกการแก้ไข</>
                    : <><Plus size={14} /> สร้างหลักสูตร</>
                }
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────
export function CourseLibrary() {
  const [courses,   setCourses]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // course object being edited
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState('');

  useEffect(() => {
    if (DEMO_MODE) { setCourses(MOCK_COURSES); setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'courses'),
      snap => { setCourses(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      err  => { console.error('[courses]', err); setLoading(false); }
    );
    return unsub;
  }, []);

  const categories = useMemo(() =>
    [...new Set(courses.map(c => c.category).filter(Boolean))].sort(),
    [courses]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return courses
      .filter(c => {
        const matchQ   = !q || c.course_id?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q);
        const matchCat = !catFilter || c.category === catFilter;
        return matchQ && matchCat;
      })
      .sort((a, b) => String(a.course_id || '').localeCompare(String(b.course_id || '')));
  }, [courses, search, catFilter]);

  // ── Create ──────────────────────────────────────────────────
  const handleCreate = async (form) => {
    setSaving(true); setSaveErr('');
    try {
      const courseId = form.course_id.trim();
      await setDoc(doc(db, 'courses', courseId), {
        course_id:      courseId,
        name:           form.name.trim(),
        category:       form.category.trim() || null,
        hours:          form.hours !== '' ? parseFloat(form.hours) : null,
        training_type:  form.training_type || null,
        trainer:        form.trainer.trim() || null,
        has_cost:       form.has_cost,
        cost_amount:    form.has_cost && form.cost_amount !== '' ? parseFloat(form.cost_amount) : null,
        material_url:   form.material_url.trim() || null,
        assessment_url: form.assessment_url.trim() || null,
        remark:         form.remark.trim() || null,
        created_at:     serverTimestamp(),
        _synced_at:     serverTimestamp(),
      });
      setShowModal(false);
    } catch (err) {
      setSaveErr(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Edit ────────────────────────────────────────────────────
  const handleEdit = async (form) => {
    const result = await Swal.fire({
      ...SWAL_BASE,
      icon: 'question',
      title: 'ยืนยันการแก้ไข?',
      html: `บันทึกการเปลี่ยนแปลงข้อมูลหลักสูตร<br/><strong>${form.course_id}</strong>`,
      confirmButtonText: 'ยืนยัน แก้ไข',
    });
    if (!result.isConfirmed) return;

    setSaving(true); setSaveErr('');
    try {
      const courseId = form.course_id.trim();
      await updateDoc(doc(db, 'courses', courseId), {
        name:           form.name.trim(),
        category:       form.category.trim() || null,
        hours:          form.hours !== '' ? parseFloat(form.hours) : null,
        training_type:  form.training_type || null,
        trainer:        form.trainer.trim() || null,
        has_cost:       form.has_cost,
        cost_amount:    form.has_cost && form.cost_amount !== '' ? parseFloat(form.cost_amount) : null,
        material_url:   form.material_url.trim() || null,
        assessment_url: form.assessment_url.trim() || null,
        remark:         form.remark.trim() || null,
        _synced_at:     serverTimestamp(),
      });
      setEditTarget(null);
      await Swal.fire({
        ...SWAL_BASE,
        showCancelButton: false,
        icon: 'success',
        title: 'แก้ไขสำเร็จ',
        text: `อัปเดตข้อมูล ${courseId} เรียบร้อยแล้ว`,
        confirmButtonText: 'ตกลง',
        timer: 1800,
        timerProgressBar: true,
      });
    } catch (err) {
      setSaveErr(`แก้ไขไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────
  const handleDelete = async (course) => {
    const result = await Swal.fire({
      ...SWAL_BASE,
      icon: 'warning',
      title: 'ยืนยันการลบ?',
      html: `ลบหลักสูตร <strong>${course.course_id}</strong><br/><span style="font-size:0.85rem;color:#666">${course.name}</span><br/><br/>การลบไม่สามารถย้อนกลับได้`,
      confirmButtonText: 'ลบออก',
      customClass: {
        ...SWAL_BASE.customClass,
        confirmButton: 'cl-swal-confirm cl-swal-confirm--danger',
      },
    });
    if (!result.isConfirmed) return;

    try {
      await deleteDoc(doc(db, 'courses', course.course_id));
      await Swal.fire({
        ...SWAL_BASE,
        showCancelButton: false,
        icon: 'success',
        title: 'ลบสำเร็จ',
        text: `ลบหลักสูตร ${course.course_id} เรียบร้อยแล้ว`,
        confirmButtonText: 'ตกลง',
        timer: 1600,
        timerProgressBar: true,
      });
    } catch (err) {
      setSaveErr(`ลบไม่สำเร็จ: ${err.message}`);
    }
  };

  return (
    <div className="cl-page">

      {/* Page header */}
      <div className="cl-page-header">
        <div>
          <h2 className="cl-page-title">Management: Course Library</h2>
          <p className="cl-page-sub">บริหารจัดการข้อมูลหลักสูตรทั้งหมดของ Freshket</p>
        </div>
        <button className="cl-btn-create" onClick={() => { setShowModal(true); setSaveErr(''); }}>
          <BookMarked size={15} /> สร้างหลักสูตรใหม่
        </button>
      </div>

      {saveErr && <div className="cl-save-err"><AlertTriangle size={14} />{saveErr}</div>}

      {/* Filters */}
      <div className="cl-filters">
        <div className="cl-search-wrap">
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            className="cl-search-input"
            placeholder="ค้นหารหัส หรือ ชื่อหลักสูตร..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="cl-search-clear" onClick={() => setSearch('')}><X size={12} /></button>}
        </div>
        <div className="cl-select-wrap">
          <select className="cl-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">หมวดหมู่ทั้งหมด</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="cl-loading">
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
          กำลังโหลดข้อมูล...
        </div>
      )}

      {/* Empty state */}
      {!loading && courses.length === 0 && (
        <motion.div className="cl-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <BookOpen size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p>ยังไม่มีหลักสูตรในระบบ</p>
          <small>กด "สร้างหลักสูตรใหม่" เพื่อเพิ่มหลักสูตรแรก</small>
        </motion.div>
      )}

      {/* Table */}
      {!loading && courses.length > 0 && (
        <motion.div className="cl-table-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}>
          <table className="cl-table">
            <thead>
              <tr>
                <th>รหัสหลักสูตร</th>
                <th>ชื่อหลักสูตร / หมวดหมู่</th>
                <th>ประเภท</th>
                <th>วิทยากร</th>
                <th>จำนวนชั่วโมง</th>
                <th>ค่าใช้จ่าย</th>
                <th>MATERIAL</th>
                <th>ASSESSMENT</th>
                <th style={{ width: 48 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="cl-table-empty">
                    <Search size={20} style={{ opacity: 0.3, display: 'block', margin: '0 auto 6px' }} />
                    ไม่พบหลักสูตรที่ตรงกับการค้นหา
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id} className="cl-table-row">
                    <td><span className="cl-course-id">{c.course_id || '–'}</span></td>
                    <td>
                      <p className="cl-course-name">{c.name || '–'}</p>
                      {c.category && <p className="cl-course-cat">{c.category}</p>}
                    </td>
                    <td>
                      {c.training_type
                        ? <span className={`cl-type-badge cl-type-badge--${c.training_type.toLowerCase()}`}>{c.training_type}</span>
                        : <span className="cl-dash">–</span>
                      }
                    </td>
                    <td>
                      <span className="cl-trainer-cell">{c.trainer || <span className="cl-dash">–</span>}</span>
                    </td>
                    <td>
                      {c.hours != null
                        ? <span className="cl-hours"><Clock size={13} /> {c.hours} ชม.</span>
                        : <span className="cl-dash">–</span>
                      }
                    </td>
                    <td>
                      {c.has_cost
                        ? <span className="cl-cost-badge">
                            {c.cost_amount != null
                              ? `฿${c.cost_amount.toLocaleString()}`
                              : 'มีค่าใช้จ่าย'}
                          </span>
                        : <span className="cl-free-badge">ฟรี</span>
                      }
                    </td>
                    <td>
                      {c.material_url
                        ? <a className="cl-link cl-link--green" href={c.material_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                            <FileText size={13} /> View <ExternalLink size={11} />
                          </a>
                        : <span className="cl-dash">–</span>
                      }
                    </td>
                    <td>
                      {c.assessment_url
                        ? <a className="cl-link cl-link--amber" href={c.assessment_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                            <BookOpen size={13} /> Take <ExternalLink size={11} />
                          </a>
                        : <span className="cl-dash">–</span>
                      }
                    </td>
                    <td>
                      <KebabMenu
                        onEdit={() => { setSaveErr(''); setEditTarget(c); }}
                        onDelete={() => handleDelete(c)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {filtered.length > 0 && (
            <div className="cl-table-footer">{filtered.length} หลักสูตร{catFilter || search ? ' (กรอง)' : ''}</div>
          )}
        </motion.div>
      )}

      {/* Create modal */}
      <AnimatePresence>
        {showModal && (
          <CourseModal
            key="course-modal-create"
            onClose={() => setShowModal(false)}
            onSave={handleCreate}
            existingCourses={courses}
            saving={saving}
          />
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editTarget && (
          <CourseModal
            key={`course-modal-edit-${editTarget.id}`}
            onClose={() => setEditTarget(null)}
            onSave={handleEdit}
            existingCourses={courses}
            saving={saving}
            editData={editTarget}
          />
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
