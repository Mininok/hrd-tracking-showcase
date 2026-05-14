import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Users, Search,
  MapPin, BookOpen, Plus, X, Loader2, Award, Building2,
  AlertCircle, AlertTriangle, Calendar, User, Mail,
} from 'lucide-react';
import {
  collection, onSnapshot, writeBatch, doc, serverTimestamp, getDocs, query, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { MOCK_TRAINING_RECORDS, MOCK_ASSESSMENTS } from '../mockData';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Button } from './ui/button';
import {
  Pagination, PaginationContent, PaginationEllipsis,
  PaginationItem, PaginationLink,
} from './ui/pagination';
import { usePagination } from './hooks/use-pagination';

const ITEMS_PER_PAGE = 20;

// ── CSV helpers ───────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim()); return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map((line, idx) => {
    const vals = parseCSVLine(line).map(v => v.replace(/^"|"$/g, '').trim());
    const obj = { _row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  }).filter(r => Object.entries(r).some(([k, v]) => k !== '_row' && v !== ''));
  return { headers, rows };
}

const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function analyzeRows(rows) {
  // duplicate = same emp_id + course + start_date in the same file
  const keyCount = {};
  rows.forEach(r => {
    const k = `${r['Emp.ID']?.trim()}|${r['Course']?.trim()}|${r['Start Date']?.trim()}`;
    keyCount[k] = (keyCount[k] || 0) + 1;
  });
  return rows.map(row => {
    const empId = row['Emp.ID']?.trim(), email = row['Email Address']?.trim();
    const k = `${empId}|${row['Course']?.trim()}|${row['Start Date']?.trim()}`;
    if (empId && keyCount[k] > 1)
      return { ...row, _status: 'duplicate', _reasons: [`ข้อมูลซ้ำในไฟล์ (${empId})`] };
    const reasons = [];
    if (!empId)                    reasons.push('Emp.ID ว่างเปล่า');
    if (!email)                    reasons.push('Email ว่างเปล่า');
    else if (!isValidEmail(email)) reasons.push('Email format ผิด');
    return reasons.length > 0
      ? { ...row, _status: 'failed',  _reasons: reasons }
      : { ...row, _status: 'success', _reasons: [] };
  });
}

function slugify(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// แปลง M/D/YYYY → D เดือน YYYY (ภาษาไทย)
const THAI_MONTHS     = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const THAI_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function formatDate(str) {
  if (!str) return '–';
  const parts = str.split('/');
  if (parts.length < 3) return str;
  const m = parseInt(parts[0]), d = parseInt(parts[1]), y = parts[2]?.split(' ')[0];
  if (!m || !d || !y || m > 12) return str;
  return `${d} ${THAI_MONTHS[m - 1]} ${y}`;
}

// ตัดเลข session ท้ายออก เช่น "Competitive Landscape & Restaurant 101" → "Competitive Landscape & Restaurant"
function normalizeCourseName(name) {
  return (name || '').replace(/\s+\d+$/, '').trim();
}

// แยก year/month จาก training_date (M/D/YYYY)
function parseDateParts(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length < 3) return null;
  const m = parseInt(parts[0]), d = parseInt(parts[1]), y = parts[2]?.split(' ')[0];
  if (!m || !d || !y || m > 12) return null;
  return { year: y, month: m };
}

function rowToRecord(row) {
  const ts = row['Timestamp']?.trim() || '';
  return {
    emp_id:        row['Emp.ID']?.trim()            || '',
    email:         row['Email Address']?.trim()      || '',
    course:        row['Course']?.trim()             || '',
    title:         row['Title']?.trim()              || '',
    name_th:       row['Name-Surname (TH)']?.trim()  || '',
    name_en:       row['Name-Surname (Eng)']?.trim() || '',
    nickname:      row['Nick name']?.trim()           || '',
    department:    row['Department']?.trim()         || '',
    rank:          row['Rank']?.trim()               || '',
    position:      row['Position']?.trim()           || '',
    location:      row['Location']?.trim()           || '',
    start_date:    row['Start Date']?.trim()         || '',
    status:        row['Status']?.trim()             || '',
    training_date: ts ? ts.trim().split(/\s+/)[0] : '',
  };
}

// Build course name → course_id map from dim_programs (courses collection)
async function loadCourseMap() {
  const snap = await getDocs(collection(db, 'courses'));
  const map = {};
  snap.docs.forEach(d => {
    const name = (d.data().name || '').toLowerCase().trim();
    if (name) map[name] = d.data().course_id || d.id;
  });
  return map;
}

// Match raw course string to course_id FK (normalize + fuzzy prefix)
function resolveCourseId(rawCourse, courseMap) {
  if (!rawCourse) return null;
  const norm = normalizeCourseName(rawCourse).toLowerCase().trim();
  if (courseMap[norm]) return courseMap[norm];
  // partial match — course in CSV may have session number suffix
  const found = Object.keys(courseMap).find(k => norm.startsWith(k) || k.startsWith(norm));
  return found ? courseMap[found] : null;
}

async function saveToFirebase(validRows) {
  const courseMap = await loadCourseMap();
  const LIMIT = 500;
  for (let i = 0; i < validRows.length; i += LIMIT) {
    const chunk = validRows.slice(i, i + LIMIT);
    const batch = writeBatch(db);
    chunk.forEach(row => {
      const r = rowToRecord(row);
      const courseId = resolveCourseId(r.course, courseMap);
      const id = `${r.emp_id}_${slugify(r.course)}_${r.start_date.replace(/[/\s]/g, '-')}`;
      batch.set(doc(db, 'training_records', id), {
        ...r,
        // Star Schema FK — links to courses collection
        course_id:     courseId || null,
        course_linked: !!courseId,
        _synced_at:    serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

// ── Confirm dialog ────────────────────────────────────────────
function ConfirmDialog({ result, onConfirm, onCancel, saving }) {
  return (
    <AnimatePresence>
      {result && (
        <>
          {/* Backdrop */}
          <motion.div
            className="tr-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onCancel}
          />
          {/* Dialog */}
          <motion.div
            className="tr-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="tr-dialog-header">
              <span className="tr-dialog-title">ยืนยันการนำเข้าข้อมูล</span>
              <button className="tr-upload-close" onClick={onCancel} disabled={saving}>
                <X size={14}/>
              </button>
            </div>

            <p className="tr-dialog-file">{result.fileName}</p>

            {/* Stats */}
            <div className="tr-dialog-stats">
              <div className="tr-dialog-stat" style={{ background: 'var(--green-dim)' }}>
                <span className="tr-dialog-stat-num" style={{ color: 'var(--green)' }}>{result.success}</span>
                <span className="tr-dialog-stat-lbl" style={{ color: 'var(--green)' }}>บันทึกได้</span>
              </div>
              <div className="tr-dialog-stat" style={{ background: 'var(--amber-dim)' }}>
                <span className="tr-dialog-stat-num" style={{ color: 'var(--amber)' }}>{result.duplicates}</span>
                <span className="tr-dialog-stat-lbl" style={{ color: 'var(--amber)' }}>ซ้ำในไฟล์</span>
              </div>
              <div className="tr-dialog-stat" style={{ background: 'var(--red-dim)' }}>
                <span className="tr-dialog-stat-num" style={{ color: 'var(--red)' }}>{result.failed}</span>
                <span className="tr-dialog-stat-lbl" style={{ color: 'var(--red)' }}>ข้อมูลผิด</span>
              </div>
            </div>

            {/* Overwrite note */}
            <div className="tr-dialog-note">
              <AlertTriangle size={13}/>
              <span>ข้อมูลที่มีอยู่แล้วใน Firebase จะถูก<strong>บันทึกทับ</strong>ด้วยข้อมูลใหม่</span>
            </div>

            {result.success === 0 && (
              <p className="tr-dialog-warn">ไม่มีแถวที่บันทึกได้ — กรุณาตรวจสอบไฟล์ CSV</p>
            )}

            <div className="tr-dialog-actions">
              <button className="tr-btn-secondary" onClick={onCancel} disabled={saving}>
                ยกเลิก
              </button>
              <button className="tr-btn-primary" onClick={onConfirm}
                disabled={result.success === 0 || saving}>
                {saving
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> กำลังบันทึก...</>
                  : <><CheckCircle2 size={14}/> บันทึก {result.success} แถว</>}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Upload status banner ──────────────────────────────────────
function UploadBanner({ status, onClose }) {
  const isLoading = status?.loading;
  const isError   = !!status?.error;

  return (
    <motion.div
      className={`tr-upload-banner${isLoading ? ' loading' : isError ? ' error' : ' done'}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
    >
      {isLoading && (
        <>
          <Loader2 size={15} className="tr-banner-spin"/>
          <span className="tr-banner-text">กำลังประมวลผล <strong>{status.fileName}</strong>...</span>
        </>
      )}
      {isError && (
        <>
          <AlertTriangle size={15}/>
          <span className="tr-banner-text">{status.error}</span>
          <button className="tr-banner-close" onClick={onClose}><X size={13}/></button>
        </>
      )}
      {!isLoading && !isError && status && (
        <>
          <CheckCircle2 size={15}/>
          <span className="tr-banner-text">
            <strong>บันทึก {status.success} แถว</strong>
            {status.duplicates > 0 && <> · <span className="tr-banner-warn">ซ้ำ {status.duplicates} แถว (ข้ามไป)</span></>}
            {status.failed     > 0 && <> · <span className="tr-banner-err">ข้อมูลผิด {status.failed} แถว (ข้ามไป)</span></>}
          </span>
          <button className="tr-banner-close" onClick={onClose}><X size={13}/></button>
        </>
      )}
    </motion.div>
  );
}

// ── Cell sub-components ───────────────────────────────────────
function EmpCell({ rec }) {
  return (
    <div className="tr-emp-cell">
      <span className="tr-emp-name-en">{rec.name_en || '–'}</span>
      {rec.name_th && <span className="tr-emp-name-th">{rec.name_th}</span>}
      <div className="tr-emp-badges">
        {rec.emp_id   && <span className="tr-emp-id">{rec.emp_id}</span>}
        {rec.nickname && <span className="tr-emp-nick">({rec.nickname})</span>}
      </div>
    </div>
  );
}

function PosCell({ rec }) {
  return (
    <div className="tr-pos-cell">
      <span className="tr-pos-name">{rec.position || '–'}</span>
      {rec.rank       && <span className="tr-rank-badge">{rec.rank}</span>}
      {rec.department && <span className="tr-pos-dept">{rec.department}</span>}
    </div>
  );
}

// ── Employee Detail Panel ─────────────────────────────────────
function EmployeeDetailPanel({ record, allRecords, onClose }) {
  const [tab, setTab] = useState('info');
  const [assessments,      setAssessments]      = useState([]);
  const [assessmentLoading, setAssessmentLoading] = useState(true);

  // Fetch assessment records for this employee by email
  useEffect(() => {
    if (!record.email) { setAssessmentLoading(false); return; }
    if (DEMO_MODE) {
      const email = record.email.toLowerCase();
      setAssessments(MOCK_ASSESSMENTS.filter(a => a.email === email));
      setAssessmentLoading(false);
      return;
    }
    const q = query(collection(db, 'assessment'), where('email', '==', record.email.toLowerCase()));
    getDocs(q)
      .then(snap => setAssessments(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(err => console.error('assessment fetch:', err))
      .finally(() => setAssessmentLoading(false));
  }, [record.email]);

  // Build assessment map: normalized_course → { pre, preMax, post, postMax } using latest per type
  const assessmentMap = useMemo(() => {
    const normCourse = s => (s || '').toLowerCase().replace(/\s+\d+$/, '').trim();
    const tsOf = v => {
      if (!v) return 0;
      if (typeof v.toDate === 'function') return v.toDate().getTime();
      if (v instanceof Date) return v.getTime();
      return 0;
    };
    const byCourse = {};
    assessments.forEach(r => {
      const c = normCourse(r.course);
      if (!c) return;
      if (!byCourse[c]) byCourse[c] = { pre: [], post: [] };
      const type = r.test_type || 'post';
      if (type === 'pre')  byCourse[c].pre.push(r);
      if (type === 'post') byCourse[c].post.push(r);
    });
    const result = {};
    Object.entries(byCourse).forEach(([c, { pre, post }]) => {
      const lPre  = [...pre].sort((a, b) => tsOf(b.timestamp) - tsOf(a.timestamp))[0];
      const lPost = [...post].sort((a, b) => tsOf(b.timestamp) - tsOf(a.timestamp))[0];
      result[c] = {
        pre:     lPre  ? Number(lPre.score_value  ?? lPre.score  ?? 0) : null,
        preMax:  lPre  ? Number(lPre.score_max  || 10) : 10,
        post:    lPost ? Number(lPost.score_value ?? lPost.score ?? 0) : null,
        postMax: lPost ? Number(lPost.score_max || 10) : 10,
      };
    });
    return result;
  }, [assessments]);

  // Lookup: find assessment for a training course name (normalized fuzzy match)
  const findAssessment = (courseName) => {
    if (!courseName) return null;
    const norm = s => (s || '').toLowerCase().replace(/\s+\d+$/, '').trim();
    const n = norm(courseName);
    if (assessmentMap[n]) return assessmentMap[n];
    const key = Object.keys(assessmentMap).find(k => n.startsWith(k) || k.startsWith(n));
    return key ? assessmentMap[key] : null;
  };

  const trainings = useMemo(() => {
    const parseMs = (s) => {
      const p = parseDateParts(s);
      return p ? parseInt(p.year) * 12 + p.month : 0;
    };
    return allRecords
      .filter(r => r.emp_id && r.emp_id === record.emp_id)
      .sort((a, b) => parseMs(b.training_date) - parseMs(a.training_date));
  }, [allRecords, record.emp_id]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const val = (v) => v || '–';

  const handleDownload = () => {
    const lines = [
      `Training Record — ${record.name_en || record.emp_id}`,
      '='.repeat(40),
      `รหัสพนักงาน : ${val(record.emp_id)}`,
      `ชื่อ (EN)    : ${val(record.name_en)}`,
      `ชื่อ (TH)    : ${val(record.name_th)}`,
      `ชื่อเล่น    : ${val(record.nickname)}`,
      `ตำแหน่ง     : ${val(record.position)}`,
      `ระดับ        : ${val(record.rank)}`,
      `แผนก         : ${val(record.department)}`,
      `สถานที่      : ${val(record.location)}`,
      `อีเมล        : ${val(record.email)}`,
      `วันที่เริ่มงาน: ${formatDate(record.start_date)}`,
      `สถานะ        : ${val(record.status)}`,
      '',
      `ประวัติการอบรม (${trainings.length} รายการ):`,
      ...trainings.map((t, i) =>
        `${i + 1}. ${val(t.course)} — ${formatDate(t.training_date)} — ${val(t.location)}`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${record.emp_id || 'employee'}_${(record.name_en || 'data').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="emp-panel-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* Sliding panel */}
      <motion.div
        className="emp-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      >
        {/* ── Header ── */}
        <div className="emp-panel-header">
          <div className="emp-panel-avatar">
            <User size={38} strokeWidth={1.5} />
          </div>
          <div className="emp-panel-identity">
            <h2 className="emp-panel-name">{val(record.name_en)}</h2>
            {(record.name_th || record.nickname) && (
              <p className="emp-panel-subname">
                {record.name_th}
                {record.nickname ? ` (${record.nickname})` : ''}
              </p>
            )}
            <div className="emp-panel-badges">
              {record.emp_id && <span className="emp-id-badge">ID: {record.emp_id}</span>}
              {record.rank   && <span className="emp-rank-badge">{record.rank}</span>}
            </div>
          </div>
          <button className="emp-panel-close" onClick={onClose}><X size={15} /></button>
        </div>

        {/* ── Tabs ── */}
        <div className="emp-panel-tabs">
          <button className={`emp-panel-tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>
            <Building2 size={13} /> ข้อมูลพนักงาน
          </button>
          <button className={`emp-panel-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            <BookOpen size={13} /> ประวัติการอบรม
            {trainings.length > 0 && <span className="emp-tab-count">{trainings.length}</span>}
          </button>
        </div>

        {/* ── Body ── */}
        <div className="emp-panel-body">
          {tab === 'info' && (
            <>
              <div className="emp-info-card">
                <h3 className="emp-info-card-title">ข้อมูลทั่วไป</h3>
                <div className="emp-info-grid">
                  <div className="emp-info-field">
                    <span className="emp-info-label"><Award size={11} /> ตำแหน่ง</span>
                    <span className="emp-info-value">{val(record.position)}</span>
                  </div>
                  <div className="emp-info-field">
                    <span className="emp-info-label"><Building2 size={11} /> แผนก</span>
                    <span className="emp-info-value">{val(record.department)}</span>
                  </div>
                  <div className="emp-info-field">
                    <span className="emp-info-label"><MapPin size={11} /> สถานที่ปฏิบัติงาน</span>
                    <span className="emp-info-value">{val(record.location)}</span>
                  </div>
                  <div className="emp-info-field">
                    <span className="emp-info-label"><Calendar size={11} /> วันที่เริ่มงาน</span>
                    <span className="emp-info-value">{formatDate(record.start_date)}</span>
                  </div>
                </div>
              </div>

              <div className="emp-info-card">
                <h3 className="emp-info-card-title">ข้อมูลการติดต่อ</h3>
                <div className="emp-contact-item">
                  <div className="emp-contact-icon"><Mail size={15} /></div>
                  <div>
                    <span className="emp-info-label">อีเมลบริษัท</span>
                    <span className="emp-info-value">{val(record.email)}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'history' && (
            <div className="emp-info-card">
              <h3 className="emp-info-card-title">ประวัติการอบรม ({trainings.length} รายการ)</h3>
              {trainings.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0', margin: 0 }}>
                  ไม่มีประวัติการอบรม
                </p>
              ) : (
                <div className="emp-history-list">
                  {trainings.map((t, i) => {
                    const asmnt = findAssessment(t.course);
                    const delta = asmnt && asmnt.pre !== null && asmnt.post !== null ? asmnt.post - asmnt.pre : null;
                    const hasScores = asmnt && (asmnt.pre !== null || asmnt.post !== null);
                    return (
                      <div key={t.id || i} className="emp-history-item">
                        <div className="emp-history-dot" />
                        <div className="emp-history-content">
                          <div className="emp-history-row">
                            <div className="emp-history-left">
                              <p className="emp-history-course">{val(t.course)}</p>
                              <div className="emp-history-meta">
                                <span>{formatDate(t.training_date)}</span>
                                {t.location && (
                                  <span className={`tr-loc-badge${t.location?.toUpperCase() === 'HQ' ? ' hq' : ''}`}>
                                    {t.location}
                                  </span>
                                )}
                              </div>
                            </div>
                            {hasScores && (
                              <div className="emp-history-scores">
                                {asmnt.pre !== null && (
                                  <span className="emp-score-chip pre">Pre <strong>{asmnt.pre}/{asmnt.preMax}</strong></span>
                                )}
                                {asmnt.post !== null && (
                                  <span className="emp-score-chip post">Post <strong>{asmnt.post}/{asmnt.postMax}</strong></span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="emp-panel-footer">
          <button className="emp-btn-secondary" onClick={handleDownload}>
            ดาวน์โหลดข้อมูล
          </button>
          <button className="emp-btn-primary" disabled title="Coming soon">
            แก้ไขข้อมูล
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ── Pagination control ────────────────────────────────────────
function TrainingPagination({ currentPage, totalPages, onPageChange }) {
  const { pages, showLeftEllipsis, showRightEllipsis } = usePagination({
    currentPage,
    totalPages,
    paginationItemsToDisplay: 7,
  });

  return (
    <div style={{ marginTop: 16 }}>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="outline"
              size="icon"
              onClick={() => onPageChange(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
            >
              ←
            </Button>
          </PaginationItem>

          {showLeftEllipsis && (
            <>
              <PaginationItem>
                <PaginationLink onClick={() => onPageChange(1)}>1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            </>
          )}

          {pages.map(page => (
            <PaginationItem key={page}>
              <PaginationLink
                onClick={() => onPageChange(page)}
                isActive={currentPage === page}
              >
                {page}
              </PaginationLink>
            </PaginationItem>
          ))}

          {showRightEllipsis && (
            <>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink onClick={() => onPageChange(totalPages)}>
                  {totalPages}
                </PaginationLink>
              </PaginationItem>
            </>
          )}

          <PaginationItem>
            <Button
              variant="outline"
              size="icon"
              onClick={() => onPageChange(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
            >
              →
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export function TrainingRecord() {
  const [records,        setRecords]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [uploadStatus,   setUploadStatus]   = useState(null);
  const [pendingResult,  setPendingResult]  = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [search,         setSearch]         = useState('');
  const [courseFilter,   setCourseFilter]   = useState('');
  const [yearFilter,     setYearFilter]     = useState('');
  const [monthFilter,    setMonthFilter]    = useState('');
  const [deptFilter,     setDeptFilter]     = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [currentPage,    setCurrentPage]    = useState(1);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const fileInputRef = useRef(null);
  const dismissTimer = useRef(null);

  // ── Firebase real-time sync ───────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) { setRecords(MOCK_TRAINING_RECORDS); setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'training_records'),
      snap  => { setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      error => { console.error('training_records:', error); setLoading(false); }
    );
    return unsub;
  }, []);

  // ── Step 1: parse file → show confirm dialog ──────────────
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    clearTimeout(dismissTimer.current);
    setUploadStatus({ loading: true, fileName: file.name });

    const text = await file.text().catch(() => null);
    if (!text) { setUploadStatus({ error: 'ไม่สามารถอ่านไฟล์ได้' }); return; }

    const parsed = parseCSV(text);
    if (!parsed) { setUploadStatus({ error: 'ไฟล์ไม่ถูกต้อง หรือไม่มีข้อมูล' }); return; }

    const analyzed = analyzeRows(parsed.rows);
    setUploadStatus(null);
    setPendingResult({
      fileName:   file.name,
      success:    analyzed.filter(r => r._status === 'success').length,
      duplicates: analyzed.filter(r => r._status === 'duplicate').length,
      failed:     analyzed.filter(r => r._status === 'failed').length,
      validRows:  analyzed.filter(r => r._status === 'success'),
    });
  };

  // ── Step 2: user confirms → save ─────────────────────────
  const handleConfirm = async () => {
    if (!pendingResult?.validRows?.length) return;
    setSaving(true);
    try {
      await saveToFirebase(pendingResult.validRows);
      const result = { success: pendingResult.success, duplicates: pendingResult.duplicates, failed: pendingResult.failed };
      setPendingResult(null);
      setUploadStatus(result);
      dismissTimer.current = setTimeout(() => setUploadStatus(null), 9000);
    } catch (err) {
      setPendingResult(null);
      setUploadStatus({ error: `บันทึกไม่สำเร็จ: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => { if (!saving) setPendingResult(null); };

  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  // ── KPI calculations ──────────────────────────────────────
  const kpi = useMemo(() => {
    const uniqueEmps    = new Set(records.map(r => r.emp_id)).size;
    const uniqueCourses = new Set(records.map(r => normalizeCourseName(r.course))).size;
    const deptCount = {};
    records.forEach(r => { if (r.department) deptCount[r.department] = (deptCount[r.department] || 0) + 1; });
    const topDept = Object.entries(deptCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '–';
    return { uniqueEmps, uniqueCourses, topDept };
  }, [records]);

  // ── Filter options ────────────────────────────────────────
  // normalize course names (strip trailing session number)
  const courses = useMemo(() =>
    [...new Set(records.map(r => normalizeCourseName(r.course)).filter(Boolean))].sort(),
  [records]);

  // years from training_date
  const years = useMemo(() => {
    const ys = new Set();
    records.forEach(r => { const p = parseDateParts(r.training_date); if (p) ys.add(p.year); });
    return [...ys].sort().reverse();
  }, [records]);

  // months available for selected year (or all months if no year selected)
  const months = useMemo(() => {
    const ms = new Set();
    records.forEach(r => {
      const p = parseDateParts(r.training_date);
      if (!p) return;
      if (yearFilter && p.year !== yearFilter) return;
      ms.add(p.month);
    });
    return [...ms].sort((a, b) => a - b);
  }, [records, yearFilter]);

  const departments = useMemo(() =>
    [...new Set(records.map(r => r.department).filter(Boolean))].sort(), [records]);
  const locations = useMemo(() =>
    [...new Set(records.map(r => r.location).filter(Boolean))].sort(), [records]);

  // ── Filtered records ──────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter(r => {
      const matchSearch = !q ||
        r.name_en?.toLowerCase().includes(q) ||
        r.name_th?.includes(q) ||
        r.emp_id?.includes(q) ||
        r.nickname?.toLowerCase().includes(q) ||
        r.course?.toLowerCase().includes(q);
      const matchCourse = !courseFilter   || normalizeCourseName(r.course) === courseFilter;
      const matchDept   = !deptFilter     || r.department === deptFilter;
      const matchLoc    = !locationFilter || r.location   === locationFilter;
      const dp = parseDateParts(r.training_date);
      const matchYear   = !yearFilter  || dp?.year  === yearFilter;
      const matchMonth  = !monthFilter || dp?.month === parseInt(monthFilter);
      return matchSearch && matchCourse && matchDept && matchLoc && matchYear && matchMonth;
    });
  }, [records, search, courseFilter, yearFilter, monthFilter, deptFilter, locationFilter]);

  // Reset to page 1 whenever filters or search change
  useEffect(() => { setCurrentPage(1); }, [search, courseFilter, yearFilter, monthFilter, deptFilter, locationFilter]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated  = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const KPI_CARDS = [
    { icon: <Users size={22}/>,    label: 'พนักงานที่ผ่านการอบรม', value: kpi.uniqueEmps,    unit: 'คน',    iconBg: 'var(--surface-3)',        iconColor: 'var(--text-secondary)' },
    { icon: <BookOpen size={22}/>, label: 'หลักสูตรที่เปิดสอน',     value: kpi.uniqueCourses, unit: 'คอร์ส', iconBg: 'rgba(37,99,235,0.10)',    iconColor: 'var(--blue)' },
    { icon: <Award size={22}/>,    label: 'แผนกที่มาอบรมมากสุด',    value: kpi.topDept,       unit: '',      iconBg: 'rgba(217,119,6,0.10)',    iconColor: 'var(--amber)' },
  ];

  return (
    <div className="tr-page">

      {/* ── Hidden file input ─────────────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        hidden
        onChange={handleFileChange}
      />

      {/* ── Page header ───────────────────────────────────── */}
      <div className="tr-page-header">
        <div>
          <h2 className="tr-page-title">Training Record</h2>
          {!loading && records.length > 0 && (
            <p className="tr-page-sub">{records.length} รายการ · real-time</p>
          )}
        </div>
        <button
          className="tr-btn-primary"
          disabled={uploadStatus?.loading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadStatus?.loading
            ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/>
            : <Plus size={14}/>
          }
          {uploadStatus?.loading ? 'กำลังบันทึก...' : 'เพิ่มข้อมูล'}
        </button>
      </div>

      {/* ── Upload result banner ───────────────────────────── */}
      <AnimatePresence>
        {uploadStatus && (
          <UploadBanner
            status={uploadStatus}
            onClose={() => { clearTimeout(dismissTimer.current); setUploadStatus(null); }}
          />
        )}
      </AnimatePresence>

      {/* ── Loading ───────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }}/>
          กำลังโหลดข้อมูล...
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────── */}
      {!loading && records.length === 0 && (
        <motion.div className="tr-empty-state" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="tr-empty-icon"><BookOpen size={36}/></div>
          <p className="tr-empty-title">ยังไม่มีข้อมูลการอบรม</p>
          <p className="tr-empty-sub">กด "เพิ่มข้อมูล" เพื่อนำเข้าไฟล์ CSV</p>
        </motion.div>
      )}

      {/* ── Dashboard ─────────────────────────────────────── */}
      {!loading && records.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* KPI cards */}
          <div className="tr-kpi-grid">
            {KPI_CARDS.map((c, i) => (
              <motion.div key={c.label} className="tr-kpi-card"
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: i * 0.06 }}>
                <div className="tr-kpi-icon" style={{ background: c.iconBg, color: c.iconColor }}>
                  {c.icon}
                </div>
                <div className="tr-kpi-body">
                  <p className="tr-kpi-label">{c.label}</p>
                  <p className="tr-kpi-value">
                    {c.value}
                    {c.unit && <span className="tr-kpi-unit">{c.unit}</span>}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Search + filters */}
          <div className="tr-filters-card">
            <div className="tr-search-wrap">
              <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <input
                className="tr-search-input"
                placeholder="ค้นหาชื่อพนักงาน (TH/EN) หรือรหัสพนักงาน..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}
                  onClick={() => setSearch('')}><X size={13}/></button>
              )}
            </div>
            <div className="tr-select-wrap">
              <BookOpen size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <select className="tr-select" value={courseFilter} onChange={e => setCourseFilter(e.target.value)}>
                <option value="">ทุกหลักสูตร</option>
                {courses.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="tr-select-wrap">
              <Calendar size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <select className="tr-select" value={yearFilter} onChange={e => { setYearFilter(e.target.value); setMonthFilter(''); }}>
                <option value="">ทุกปี</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="tr-select-wrap">
              <Calendar size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: yearFilter ? 1 : 0.45 }}/>
              <select className="tr-select" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                <option value="">ทุกเดือน</option>
                {months.map(m => <option key={m} value={m}>{THAI_MONTHS_FULL[m - 1]}</option>)}
              </select>
            </div>
            <div className="tr-select-wrap">
              <Building2 size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <select className="tr-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="">ทุกแผนก</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="tr-select-wrap">
              <MapPin size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <select className="tr-select" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
                <option value="">ทุกสถานที่</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="tr-table-card">
            {filtered.length === 0 ? (
              <div style={{ padding: '52px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Search size={22} style={{ marginBottom: 8, opacity: 0.35 }}/>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>ไม่พบข้อมูลที่ตรงกับการค้นหา</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead style={{ minWidth: 220 }}>ข้อมูลพนักงาน</TableHead>
                    <TableHead style={{ minWidth: 200 }}>ตำแหน่ง / ระดับ</TableHead>
                    <TableHead style={{ minWidth: 160 }}>หลักสูตร</TableHead>
                    <TableHead>สถานที่</TableHead>
                    <TableHead>วันที่อบรม</TableHead>
                    <TableHead>วันที่เริ่มงาน</TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((rec, i) => (
                    <TableRow key={rec.id} index={i} style={{ cursor: 'pointer' }} onClick={() => setSelectedRecord(rec)}>
                      <TableCell><EmpCell rec={rec}/></TableCell>
                      <TableCell><PosCell rec={rec}/></TableCell>
                      <TableCell>
                        <span className="tr-course-cell">
                          <span className="tr-course-dot"/>
                          {rec.course || '–'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`tr-loc-badge${rec.location?.toUpperCase() === 'HQ' ? ' hq' : ''}`}>
                          {rec.location || '–'}
                        </span>
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{formatDate(rec.training_date)}</TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{formatDate(rec.start_date)}</TableCell>
                      <TableCell>
                        <span className={`tr-status-badge${rec.status?.toLowerCase() === 'active' ? ' active' : ''}`}>
                          {rec.status?.toUpperCase() || '–'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <TrainingPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </motion.div>
      )}

      {/* ── Confirm dialog (portal-like, fixed overlay) ─── */}
      <ConfirmDialog
        result={pendingResult}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        saving={saving}
      />

      {/* ── Employee detail panel ─── */}
      <AnimatePresence>
        {selectedRecord && (
          <EmployeeDetailPanel
            key={selectedRecord.id}
            record={selectedRecord}
            allRecords={records}
            onClose={() => setSelectedRecord(null)}
          />
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
