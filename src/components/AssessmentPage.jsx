import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Search, Plus, X, Loader2, Award,
  FileText, AlertTriangle, TrendingUp, Users, BookOpen,
  GraduationCap, BarChart3, ChevronUp, ChevronDown, Trash2, MoreVertical,
} from 'lucide-react';
import {
  collection, onSnapshot, writeBatch, doc, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { MOCK_ASSESSMENTS, MOCK_EMPLOYEES, MOCK_TRAINING_RECORDS } from '../mockData';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// ── Constants ─────────────────────────────────────────────────
const SCORE_MAX = 10;
const PASS_PCT  = 80;

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

function parseTestType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === '1' || s === 'pre' || s.startsWith('pre') || s.includes('pre')) return 'pre';
  if (s === '2' || s === 'post' || s.startsWith('post') || s.includes('post')) return 'post';
  return null;
}

// Parses "6 / 15", "6/15", or plain "6" → { score, max }
function parseScore(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  const slashMatch = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (slashMatch) {
    const score = parseFloat(slashMatch[1]);
    const max   = parseFloat(slashMatch[2]);
    return isFinite(score) && isFinite(max) && max > 0 ? { score, max } : null;
  }
  const n = parseFloat(s);
  return isFinite(n) ? { score: n, max: SCORE_MAX } : null;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { batch: `${y}-${m}`, date: d, isoDate: `${y}-${m}-${day}` };
}

function normalizeCourseName(name) {
  return (name || '').replace(/\s+\d+$/, '').trim();
}

function slugify(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.@]/g, '');
}

const fmtBatch = key => {
  if (!key) return '–';
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
};

const num   = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const avg   = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
const getScore = r => num(r.score_value ?? r.score);
const toMs = v => {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return 0;
};

// ── Row analysis ──────────────────────────────────────────────
function analyzeRows(rows) {
  const seen = {};
  rows.forEach(r => {
    const k = [r['Email Address']?.trim().toLowerCase(), r['Type']?.trim(), r['Course']?.trim(), r['Timestamp']?.trim()].join('|');
    seen[k] = (seen[k] || 0) + 1;
  });

  return rows.map(row => {
    const email  = row['Email Address']?.trim().toLowerCase();
    const score  = row['Score']?.trim();
    const type   = row['Type']?.trim();
    const course = row['Course']?.trim();
    const ts     = row['Timestamp']?.trim();
    const k      = [email, type, course, ts].join('|');

    if (seen[k] > 1) return { ...row, _status: 'duplicate', _reasons: ['ข้อมูลซ้ำในไฟล์'] };

    const reasons = [];
    if (!email)                           reasons.push('Email ว่างเปล่า');
    else if (!isValidEmail(email))        reasons.push('Email format ผิด');
    if (!score || !parseScore(score))      reasons.push('Score ไม่ถูกต้อง');
    if (type && !parseTestType(type))     reasons.push('Type ไม่รู้จัก (ใช้ pre/post หรือ ก่อนเรียน/หลังเรียน)');
    if (!course)                          reasons.push('Course ว่างเปล่า');
    if (!ts || !parseTimestamp(ts))       reasons.push('Timestamp ไม่ถูกต้อง');

    return reasons.length > 0
      ? { ...row, _status: 'failed',    _reasons: reasons }
      : { ...row, _status: 'success',   _reasons: [] };
  });
}

// ── Firestore helpers ─────────────────────────────────────────
async function loadCourseMap() {
  const snap = await getDocs(collection(db, 'courses'));
  const map = {};
  snap.docs.forEach(d => {
    const name = (d.data().name || '').toLowerCase().trim();
    if (name) map[name] = d.data().course_id || d.id;
  });
  return map;
}

// email → employee doc (for write-time denormalization)
async function loadEmployeeMap() {
  const snap = await getDocs(collection(db, 'employees'));
  const map = {};
  snap.docs.forEach(d => {
    const data  = d.data();
    const email = (data.email || '').toLowerCase().trim();
    if (email) map[email] = data;
  });
  return map;
}

function resolveCourseId(rawCourse, courseMap) {
  if (!rawCourse) return null;
  const norm = normalizeCourseName(rawCourse).toLowerCase().trim();
  if (courseMap[norm]) return courseMap[norm];
  const found = Object.keys(courseMap).find(k => norm.startsWith(k) || k.startsWith(norm));
  return found ? courseMap[found] : null;
}

async function saveToFirebase(validRows) {
  // Resolve both dimension tables at write time (Star Schema denormalization)
  const [courseMap, empMap] = await Promise.all([loadCourseMap(), loadEmployeeMap()]);
  for (let i = 0; i < validRows.length; i += 500) {
    const chunk = validRows.slice(i, i + 500);
    const batch = writeBatch(db);
    chunk.forEach(row => {
      const email       = row['Email Address']?.trim().toLowerCase() || '';
      const scoreParsed = parseScore(row['Score']?.trim());
      const scoreRaw    = scoreParsed?.score ?? 0;
      const scoreMax    = scoreParsed?.max   ?? SCORE_MAX;
      const testType    = parseTestType(row['Type']?.trim()) || 'post';
      const course      = row['Course']?.trim() || '';
      const ts          = parseTimestamp(row['Timestamp']?.trim());
      const courseId    = resolveCourseId(course, courseMap);
      const scorePct    = Math.round((scoreRaw / scoreMax) * 100);
      const emp         = empMap[email];

      const id = `csv_${slugify(email)}_${testType}_${slugify(course)}_${ts?.isoDate || 'na'}`;
      batch.set(doc(db, 'assessment', id), {
        // Core assessment
        email,
        score:           scoreRaw,
        score_value:     scoreRaw,
        score_max:       scoreMax,
        score_percent:   scorePct,
        is_passed:       scorePct >= PASS_PCT,
        test_type:       testType,
        type:            testType === 'pre' ? 1 : 2,
        // Course FK → dim_programs
        course,
        course_id:       courseId || null,
        course_linked:   !!courseId,
        // Denormalized employee fields — avoid re-join at read time
        emp_id:          emp?.emp_id     || null,
        name_en:         emp?.name_en    || null,
        name_th:         emp?.name_th    || null,
        nickname:        emp?.nickname   || null,
        department:      emp?.department || null,
        position:        emp?.position   || null,
        employee_linked: !!emp,
        // Meta
        batch:           ts?.batch || null,
        timestamp:       ts?.date  || null,
        _source:         'csv_upload',
        _synced_at:      serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

// ── Delete Confirm Dialog ─────────────────────────────────────
function DeleteConfirmDialog({ target, onConfirm, onCancel, deleting }) {
  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div className="tr-dialog-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }} onClick={onCancel}
          />
          <motion.div className="tr-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="tr-dialog-header">
              <span className="tr-dialog-title">ลบข้อมูล Assessment</span>
              <button className="tr-upload-close" onClick={onCancel} disabled={deleting}><X size={14}/></button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '8px 0 14px' }}>
              {target.email || target.displayName
                ? <>ยืนยันการลบข้อมูลของ <strong>{target.displayName || target.email}</strong> ในหลักสูตร <strong>{target.course}</strong></>
                : <>ยืนยันการลบข้อมูล<strong>ทั้งหมด</strong>ในหลักสูตร <strong>{target.course}</strong></>
              }
            </p>
            <div className="tr-dialog-stat" style={{ background: 'var(--red-dim)', marginBottom: 14 }}>
              <span className="tr-dialog-stat-num" style={{ color: 'var(--red)' }}>{target.ids.length}</span>
              <span className="tr-dialog-stat-lbl" style={{ color: 'var(--red)' }}>รายการที่จะถูกลบ</span>
            </div>
            <div className="tr-dialog-note" style={{ borderColor: 'var(--red)', background: 'var(--red-dim)' }}>
              <AlertTriangle size={13} style={{ color: 'var(--red)' }}/>
              <span style={{ color: 'var(--red)' }}>การลบไม่สามารถย้อนกลับได้</span>
            </div>
            <div className="tr-dialog-actions">
              <button className="tr-btn-secondary" onClick={onCancel} disabled={deleting}>ยกเลิก</button>
              <button
                className="tr-btn-primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={onConfirm}
                disabled={deleting}
              >
                {deleting
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> กำลังลบ...</>
                  : <><Trash2 size={14}/> ลบ {target.ids.length} รายการ</>}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────
function ConfirmDialog({ result, onConfirm, onCancel, saving }) {
  return (
    <AnimatePresence>
      {result && (
        <>
          <motion.div className="tr-dialog-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }} onClick={onCancel}
          />
          <motion.div className="tr-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="tr-dialog-header">
              <span className="tr-dialog-title">ยืนยันการนำเข้าข้อมูล Assessment</span>
              <button className="tr-upload-close" onClick={onCancel} disabled={saving}><X size={14}/></button>
            </div>
            <p className="tr-dialog-file">{result.fileName}</p>
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
            <div className="tr-dialog-note">
              <AlertTriangle size={13}/>
              <span>ข้อมูลที่มีอยู่แล้ว (email + type + course + วันที่ตรงกัน) จะถูก<strong>บันทึกทับ</strong></span>
            </div>
            {result.success === 0 && (
              <p className="tr-dialog-warn">ไม่มีแถวที่บันทึกได้ — กรุณาตรวจสอบไฟล์ CSV</p>
            )}
            <div className="tr-dialog-actions">
              <button className="tr-btn-secondary" onClick={onCancel} disabled={saving}>ยกเลิก</button>
              <button className="tr-btn-primary" onClick={onConfirm} disabled={result.success === 0 || saving}>
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

// ── Upload Banner ─────────────────────────────────────────────
function UploadBanner({ status, onClose }) {
  const isLoading = status?.loading;
  const isError   = !!status?.error;
  return (
    <motion.div
      className={`tr-upload-banner${isLoading ? ' loading' : isError ? ' error' : ' done'}`}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}
    >
      {isLoading && (
        <><Loader2 size={15} className="tr-banner-spin"/>
          <span className="tr-banner-text">กำลังประมวลผล <strong>{status.fileName}</strong>...</span></>
      )}
      {isError && (
        <><AlertTriangle size={15}/>
          <span className="tr-banner-text">{status.error}</span>
          <button className="tr-banner-close" onClick={onClose}><X size={13}/></button></>
      )}
      {!isLoading && !isError && status && (
        <><CheckCircle2 size={15}/>
          <span className="tr-banner-text">
            <strong>บันทึก {status.success} แถว</strong>
            {status.duplicates > 0 && <> · <span className="tr-banner-warn">ซ้ำ {status.duplicates} (ข้ามไป)</span></>}
            {status.failed     > 0 && <> · <span className="tr-banner-err">ผิด {status.failed} (ข้ามไป)</span></>}
          </span>
          <button className="tr-banner-close" onClick={onClose}><X size={13}/></button></>
      )}
    </motion.div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, iconBg, iconColor }) {
  return (
    <div className="ad-kpi-card">
      <div className="ad-kpi-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
      <div className="ad-kpi-body">
        <p className="ad-kpi-label">{label}</p>
        <p className="ad-kpi-value">{value}</p>
        {sub && <span className="ad-kpi-sub">{sub}</span>}
      </div>
    </div>
  );
}

// ── Type Badge ────────────────────────────────────────────────
function TypeBadge({ type }) {
  return (
    <span className={`ad-type-badge ad-type-badge--${type}`}>
      {type === 'pre' ? 'Pre-test' : 'Post-test'}
    </span>
  );
}

// ── Pass Badge ────────────────────────────────────────────────
function PassBadge({ passed }) {
  return (
    <span className={`ad-pass-badge ${passed ? 'pass' : 'fail'}`}>
      {passed ? '✓ ผ่าน' : '✗ ไม่ผ่าน'}
    </span>
  );
}

// ── Delta Badge ───────────────────────────────────────────────
function DeltaBadge({ delta }) {
  if (delta === null) return <span className="delta-badge zero">–</span>;
  if (delta > 0) return <span className="delta-badge pos">▲ +{delta.toFixed(1)}</span>;
  if (delta < 0) return <span className="delta-badge neg">▼ {delta.toFixed(1)}</span>;
  return <span className="delta-badge zero">= 0</span>;
}

// ── Helpers: group records by email, pick latest per type ─────
function buildEmpStats(courseRecords, employeeMap) {
  const byEmail = {};
  courseRecords.forEach(r => {
    const email = (r.email || '').toLowerCase();
    if (!byEmail[email]) byEmail[email] = { email, pre: [], post: [] };
    if (r.test_type === 'pre')  byEmail[email].pre.push(r);
    if (r.test_type === 'post') byEmail[email].post.push(r);
  });

  return Object.values(byEmail).map(emp => {
    const sortedPre  = [...emp.pre].sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
    const sortedPost = [...emp.post].sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
    const latestPre  = sortedPre[0]  || null;
    const latestPost = sortedPost[0] || null;
    const preScore   = latestPre  ? getScore(latestPre)  : null;
    const postScore  = latestPost ? getScore(latestPost) : null;
    const delta      = preScore !== null && postScore !== null ? postScore - preScore : null;
    const passed     = latestPost
      ? (latestPost.is_passed === true || (latestPost.score_percent ?? 0) >= PASS_PCT)
      : null;
    const anyRec      = latestPre || latestPost;
    const fallbackEmp = employeeMap[(emp.email || '').toLowerCase()];
    return {
      email:      emp.email,
      displayName: anyRec?.nickname || anyRec?.name_en || fallbackEmp?.nickname || fallbackEmp?.name_en || '',
      department:  anyRec?.department || fallbackEmp?.department || '',
      preScore, postScore, delta, passed,
      preMax:  latestPre  ? num(latestPre.score_max  || SCORE_MAX) : SCORE_MAX,
      postMax: latestPost ? num(latestPost.score_max || SCORE_MAX) : SCORE_MAX,
      preRounds:  sortedPre.length,
      postRounds: sortedPost.length,
      latestPre,  latestPost,
      allRecordIds: [...emp.pre, ...emp.post].map(r => r.id).filter(Boolean),
    };
  });
}

// ── Sort helper ───────────────────────────────────────────────
function useSortState(defaultKey, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const SortIcon = ({ col }) =>
    sortKey !== col
      ? <span style={{ opacity: 0.2 }}><ChevronUp size={11}/></span>
      : sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>;
  const sortFn = (a, b) => {
    let av = a[sortKey] ?? -999, bv = b[sortKey] ?? -999;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  };
  return { sortKey, sortDir, handleSort, SortIcon, sortFn };
}

// ── Course List View ──────────────────────────────────────────
function CourseListView({ records, employeeMap, batchFilter, onSelectCourse, isAdmin, onDelete }) {
  const [openMenuCourse, setOpenMenuCourse] = useState(null);
  const [menuPos,        setMenuPos]        = useState({ top: 0, right: 0 });
  const { handleSort, SortIcon, sortFn } = useSortState('course');

  useEffect(() => {
    if (!openMenuCourse) return;
    const close = () => setOpenMenuCourse(null);
    document.addEventListener('click', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [openMenuCourse]);

  const openKebab = (ev, courseKey) => {
    ev.stopPropagation();
    if (openMenuCourse === courseKey) { setOpenMenuCourse(null); return; }
    const rect = ev.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenuCourse(courseKey);
  };

  const batchRecs = batchFilter ? records.filter(r => r.batch === batchFilter) : records;

  const courseStats = useMemo(() => {
    const byKey = {};
    batchRecs.forEach(r => {
      const k = `${(r.email || '').toLowerCase()}|||${r.course || ''}`;
      if (!byKey[k]) byKey[k] = { email: r.email, course: r.course, pre: [], post: [] };
      if (r.test_type === 'pre')  byKey[k].pre.push(r);
      if (r.test_type === 'post') byKey[k].post.push(r);
    });

    const byCourse = {};
    Object.values(byKey).forEach(emp => {
      const courseKey = emp.course || '';
      const course    = courseKey || '(ไม่ระบุ)';
      if (!byCourse[courseKey]) byCourse[courseKey] = { course, courseKey, preScores: [], postScores: [], passedCount: 0, empSet: new Set() };
      byCourse[courseKey].empSet.add((emp.email || '').toLowerCase());
      const lPre  = [...emp.pre].sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))[0];
      const lPost = [...emp.post].sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))[0];
      // Use score_percent so different max scores (10/15/16) are normalised
      const pctOf = r => r.score_percent != null
        ? num(r.score_percent)
        : Math.round(num(r.score_value ?? r.score) / num(r.score_max || SCORE_MAX) * 100);
      if (lPre) byCourse[courseKey].preScores.push(pctOf(lPre));
      if (lPost) {
        byCourse[courseKey].postScores.push(pctOf(lPost));
        if (lPost.is_passed === true || (lPost.score_percent ?? 0) >= PASS_PCT) byCourse[courseKey].passedCount++;
      }
    });

    return Object.values(byCourse).map(c => ({
      course:    c.course,
      courseKey: c.courseKey,
      empCount:  c.empSet.size,
      preCount:  c.preScores.length,
      postCount: c.postScores.length,
      preAvg:    avg(c.preScores),
      postAvg:   avg(c.postScores),
      delta:     avg(c.preScores) !== null && avg(c.postScores) !== null ? avg(c.postScores) - avg(c.preScores) : null,
      passRate:  c.postScores.length > 0 ? Math.round(c.passedCount / c.postScores.length * 100) : null,
    }));
  }, [batchRecs]);

  const sorted = [...courseStats].sort(sortFn);

  return (
    <div className="ad-card">
      <div className="ad-card-head">
        <h3><BookOpen size={14}/>หลักสูตรทั้งหมด</h3>
        <span className="ad-card-count">{courseStats.length} หลักสูตร · คลิกเพื่อดูรายบุคคล</span>
      </div>
      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('course')}   className="ad-th-sort">หลักสูตร <SortIcon col="course"/></th>
              <th onClick={() => handleSort('empCount')} className="ad-th-sort ad-th-center">ผู้เข้าร่วม <SortIcon col="empCount"/></th>
              <th className="ad-th-center">Pre (คน)</th>
              <th onClick={() => handleSort('preAvg')}   className="ad-th-sort ad-th-center">Pre Avg% <SortIcon col="preAvg"/></th>
              <th className="ad-th-center">Post (คน)</th>
              <th onClick={() => handleSort('postAvg')}  className="ad-th-sort ad-th-center">Post Avg% <SortIcon col="postAvg"/></th>
              <th onClick={() => handleSort('delta')}    className="ad-th-sort ad-th-center">Δ <SortIcon col="delta"/></th>
              <th onClick={() => handleSort('passRate')} className="ad-th-sort ad-th-center">Pass Rate <SortIcon col="passRate"/></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.courseKey} className="ad-tr-clickable" onClick={() => onSelectCourse(row.courseKey)}>
                <td className="ad-td-course">{row.course}</td>
                <td className="ad-td-center">
                  <span className="ad-emp-chip"><Users size={11}/>{row.empCount} คน</span>
                </td>
                <td className="ad-td-center">
                  {row.preCount > 0 ? <span className="ad-count-chip">{row.preCount}</span> : '–'}
                </td>
                <td className="ad-td-center">
                  {row.preAvg !== null
                    ? <span className="ad-score-val">{row.preAvg.toFixed(1)}<span className="ad-score-max">%</span></span>
                    : '–'}
                </td>
                <td className="ad-td-center">
                  {row.postCount > 0 ? <span className="ad-count-chip blue">{row.postCount}</span> : '–'}
                </td>
                <td className="ad-td-center">
                  {row.postAvg !== null
                    ? <span className="ad-score-val">{row.postAvg.toFixed(1)}<span className="ad-score-max">%</span></span>
                    : '–'}
                </td>
                <td className="ad-td-center"><DeltaBadge delta={row.delta}/></td>
                <td className="ad-td-center">
                  {row.passRate !== null
                    ? <span className={`ad-pass-rate ${row.passRate >= 80 ? 'high' : row.passRate >= 60 ? 'mid' : 'low'}`}>
                        {row.passRate}%
                      </span>
                    : '–'}
                </td>
                <td className="ad-td-kebab" onClick={ev => ev.stopPropagation()}>
                  {isAdmin ? (
                    <div className="ad-kebab-wrap">
                      <button className="ad-kebab-btn" onClick={ev => openKebab(ev, row.courseKey)}>
                        <MoreVertical size={14}/>
                      </button>
                      {openMenuCourse === row.courseKey && (
                        <div className="ad-kebab-menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }} onClick={ev => ev.stopPropagation()}>
                          <button
                            className="ad-kebab-item danger"
                            onClick={() => {
                              setOpenMenuCourse(null);
                              const ids = records.filter(r => (r.course || '') === row.courseKey).map(r => r.id).filter(Boolean);
                              onDelete({ course: row.course, ids });
                            }}
                          >
                            <Trash2 size={13}/> ลบข้อมูลทั้งหมด
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>›</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Employee Drilldown View ────────────────────────────────────
function EmployeeView({ records, employeeMap, selectedCourse, batchFilter, onBack, isAdmin, onDelete }) {
  const [search,        setSearch]        = useState('');
  const [openMenuEmail, setOpenMenuEmail] = useState(null);
  const [menuPos,       setMenuPos]       = useState({ top: 0, right: 0 });
  const { handleSort, SortIcon, sortFn } = useSortState('displayName');

  useEffect(() => {
    if (!openMenuEmail) return;
    const close = () => setOpenMenuEmail(null);
    document.addEventListener('click', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [openMenuEmail]);

  const openKebab = (ev, email) => {
    ev.stopPropagation();
    if (openMenuEmail === email) { setOpenMenuEmail(null); return; }
    const rect = ev.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenuEmail(email);
  };

  const courseRecs = useMemo(() =>
    records.filter(r => (r.course || '') === selectedCourse && (!batchFilter || r.batch === batchFilter)),
  [records, selectedCourse, batchFilter]);

  const empStats = useMemo(() => buildEmpStats(courseRecs, employeeMap), [courseRecs, employeeMap]);

  const filtered = useMemo(() => {
    if (!search) return empStats;
    const q = search.toLowerCase();
    return empStats.filter(e =>
      e.email.includes(q) || e.displayName.toLowerCase().includes(q) || e.department.toLowerCase().includes(q)
    );
  }, [empStats, search]);

  const sorted = [...filtered].sort(sortFn);

  // Course-level KPIs
  const passedCount = empStats.filter(e => e.passed === true).length;
  const postCount   = empStats.filter(e => e.postScore !== null).length;
  const preCount    = empStats.filter(e => e.preScore  !== null).length;
  // Use score_percent from latest records for a fair average across different max scores
  const preAvgPct  = avg(empStats.filter(e => e.latestPre  !== null).map(e => num(e.latestPre?.score_percent)));
  const postAvgPct = avg(empStats.filter(e => e.latestPost !== null).map(e => num(e.latestPost?.score_percent)));
  const passRate    = postCount > 0 ? Math.round(passedCount / postCount * 100) : null;
  const improvedCnt = empStats.filter(e => e.delta !== null && e.delta > 0).length;

  return (
    <>
      {/* Drilldown header */}
      <div className="ad-drilldown-header">
        <button className="ad-back-btn" onClick={onBack}>← กลับ</button>
        <div className="ad-drilldown-title">
          <GraduationCap size={16} style={{ color: 'var(--accent)' }}/>
          <div>
            <p className="ad-drilldown-name">{selectedCourse || '(ไม่ระบุ)'}</p>
            <p className="ad-drilldown-sub">{empStats.length} คน{batchFilter ? ` · ${fmtBatch(batchFilter)}` : ''}</p>
          </div>
        </div>
      </div>

      {/* Mini KPIs */}
      <div className="ad-kpi-grid">
        <KpiCard icon={<Users size={18}/>}     iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="ผู้เข้าร่วม"   value={empStats.length} sub="คน"/>
        <KpiCard icon={<FileText size={18}/>}  iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="ทำ Pre-test"   value={preCount}  sub={preAvgPct  !== null ? `avg ${preAvgPct.toFixed(1)}%` : ''}/>
        <KpiCard icon={<BookOpen size={18}/>}  iconColor="#2563EB" iconBg="rgba(37,99,235,0.12)"  label="ทำ Post-test"  value={postCount} sub={postAvgPct !== null ? `avg ${postAvgPct.toFixed(1)}%` : ''}/>
        <KpiCard
          icon={<Award size={18}/>}
          iconColor={passRate !== null && passRate >= 70 ? '#059669' : '#EF4444'}
          iconBg={passRate    !== null && passRate >= 70 ? 'rgba(5,150,105,0.12)' : 'rgba(239,68,68,0.12)'}
          label="Pass Rate"
          value={passRate !== null ? `${passRate}%` : '–'}
          sub={`ดีขึ้น ${improvedCnt} คน`}
        />
      </div>

      {/* Search */}
      <div className="ad-filter-bar">
        <div className="tr-search-wrap">
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
          <input className="tr-search-input" placeholder="ค้นหาชื่อ / email / แผนก..." value={search} onChange={e => setSearch(e.target.value)}/>
          {search && <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }} onClick={() => setSearch('')}><X size={13}/></button>}
        </div>
      </div>

      {/* Employee table */}
      <div className="ad-card">
        <div className="ad-card-head">
          <h3><Users size={14}/>รายบุคคล — ผลล่าสุดต่อรอบ</h3>
          <span className="ad-card-count">{sorted.length} คน</span>
        </div>
        <div className="ad-table-wrap">
          {sorted.length === 0 ? (
            <div className="ad-table-empty">
              <Search size={20} style={{ opacity: 0.3, marginBottom: 6 }}/><p>ไม่พบข้อมูล</p>
            </div>
          ) : (
            <table className="ad-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('displayName')} className="ad-th-sort">ชื่อ / Email <SortIcon col="displayName"/></th>
                  <th onClick={() => handleSort('department')}  className="ad-th-sort">แผนก <SortIcon col="department"/></th>
                  <th onClick={() => handleSort('preScore')}    className="ad-th-sort ad-th-center">Pre (ล่าสุด) <SortIcon col="preScore"/></th>
                  <th onClick={() => handleSort('postScore')}   className="ad-th-sort ad-th-center">Post (ล่าสุด) <SortIcon col="postScore"/></th>
                  <th onClick={() => handleSort('delta')}       className="ad-th-sort ad-th-center">Δ <SortIcon col="delta"/></th>
                  <th className="ad-th-center">สถานะ</th>
                  <th className="ad-th-center">รอบ</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map(e => (
                  <tr key={e.email}>
                    <td>
                      <div className="ad-person-cell">
                        {e.displayName && <div className="ad-person-name">{e.displayName}</div>}
                        <div className="ad-person-email">{e.email}</div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{e.department || '–'}</td>
                    <td className="ad-td-center">
                      {e.preScore !== null
                        ? <span className="ad-score-val">{e.preScore}<span className="ad-score-max">/{e.preMax}</span></span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>–</span>}
                    </td>
                    <td className="ad-td-center">
                      {e.postScore !== null
                        ? <span className="ad-score-val">{e.postScore}<span className="ad-score-max">/{e.postMax}</span></span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>–</span>}
                    </td>
                    <td className="ad-td-center"><DeltaBadge delta={e.delta}/></td>
                    <td className="ad-td-center">
                      {e.passed !== null
                        ? <PassBadge passed={e.passed}/>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>รอ Post</span>}
                    </td>
                    <td className="ad-td-center">
                      <div className="ad-rounds-cell">
                        {e.preRounds  > 0 && <span className="ad-round-chip pre">Pre ×{e.preRounds}</span>}
                        {e.postRounds > 0 && <span className="ad-round-chip post">Post ×{e.postRounds}</span>}
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="ad-td-kebab">
                        <div className="ad-kebab-wrap">
                          <button className="ad-kebab-btn" onClick={ev => openKebab(ev, e.email)}>
                            <MoreVertical size={14}/>
                          </button>
                          {openMenuEmail === e.email && (
                            <div className="ad-kebab-menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }} onClick={ev => ev.stopPropagation()}>
                              <button
                                className="ad-kebab-item danger"
                                onClick={() => { setOpenMenuEmail(null); onDelete({ email: e.email, displayName: e.displayName, course: selectedCourse, ids: e.allRecordIds }); }}
                              >
                                <Trash2 size={13}/> ลบข้อมูล
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────
export function AssessmentPage({ isAdmin }) {
  const [records,          setRecords]          = useState([]);
  const [employees,        setEmployees]        = useState([]);
  const [trainingEmpMap,   setTrainingEmpMap]   = useState({});
  const [loading,          setLoading]          = useState(true);
  const [uploadStatus,   setUploadStatus]   = useState(null);
  const [pendingResult,  setPendingResult]  = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [batchFilter,    setBatchFilter]    = useState('');
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [deleteTarget,   setDeleteTarget]   = useState(null);
  const [deleting,       setDeleting]       = useState(false);
  const fileInputRef = useRef(null);
  const dismissTimer = useRef(null);

  // ── Real-time listeners ───────────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) { setRecords(MOCK_ASSESSMENTS); setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'assessment'),
      snap  => { setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      err   => { console.error('assessment:', err); setLoading(false); }
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (DEMO_MODE) { setEmployees(MOCK_EMPLOYEES); return; }
    const unsub = onSnapshot(
      collection(db, 'employees'),
      snap  => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err   => console.error('employees:', err)
    );
    return unsub;
  }, []);

  // One-time fetch of training_records to build employee map (primary source)
  useEffect(() => {
    if (DEMO_MODE) {
      const map = {};
      MOCK_TRAINING_RECORDS.forEach(t => {
        const email = (t.email || '').toLowerCase().trim();
        if (email && !map[email]) {
          map[email] = {
            name_en: t.name_en || null, name_th: t.name_th || null,
            nickname: t.nickname || null, department: t.department || null,
            position: t.position || null, emp_id: t.emp_id || null,
          };
        }
      });
      setTrainingEmpMap(map);
      return;
    }
    getDocs(collection(db, 'training_records')).then(snap => {
      const map = {};
      snap.docs.forEach(d => {
        const t     = d.data();
        const email = (t.email || '').toLowerCase().trim();
        if (email && !map[email]) {
          map[email] = {
            name_en:    t.name_en    || null,
            name_th:    t.name_th    || null,
            nickname:   t.nickname   || null,
            department: t.department || null,
            position:   t.position   || null,
            emp_id:     t.emp_id     || null,
          };
        }
      });
      setTrainingEmpMap(map);
    }).catch(err => console.error('training_records emp map:', err));
  }, []);

  // training_records takes priority over employees collection
  const employeeMap = useMemo(() => {
    const base = {};
    employees.forEach(e => { if (e.email) base[e.email.toLowerCase()] = e; });
    return { ...base, ...trainingEmpMap };
  }, [employees, trainingEmpMap]);

  // ── Global KPIs (all records, ignore batch filter) ────────
  const allPre  = useMemo(() => records.filter(r => r.test_type === 'pre'),  [records]);
  const allPost = useMemo(() => records.filter(r => r.test_type === 'post'), [records]);
  const uniqueCourses = useMemo(() => new Set(records.map(r => r.course).filter(Boolean)).size, [records]);
  const passedPost = allPost.filter(r => r.is_passed === true || (r.score_percent ?? 0) >= PASS_PCT).length;
  const globalPassRate = allPost.length > 0 ? Math.round(passedPost / allPost.length * 100) : null;
  const preAvgGlobal  = avg(allPre.map(getScore));
  const postAvgGlobal = avg(allPost.map(getScore));
  const avgDelta = preAvgGlobal !== null && postAvgGlobal !== null ? postAvgGlobal - preAvgGlobal : null;

  // ── Batch options ─────────────────────────────────────────
  const batches = useMemo(() => {
    const bs = new Set(records.map(r => r.batch).filter(Boolean));
    return [...bs].sort((a, b) => b.localeCompare(a));
  }, [records]);

  // ── File upload ───────────────────────────────────────────
  const handleFileChange = async e => {
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

  // ── Delete employee records ───────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget?.ids?.length) return;
    setDeleting(true);
    try {
      for (let i = 0; i < deleteTarget.ids.length; i += 500) {
        const chunk = deleteTarget.ids.slice(i, i + 500);
        const batch = writeBatch(db);
        chunk.forEach(id => batch.delete(doc(db, 'assessment', id)));
        await batch.commit();
      }
      setDeleteTarget(null);
    } catch (err) {
      console.error('delete failed:', err);
      setUploadStatus({ error: `ลบไม่สำเร็จ: ${err.message}` });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="ad-page">
      <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={handleFileChange}/>

      {/* Page header */}
      <div className="ad-page-header">
        <div>
          <h2 className="ad-page-title">Assessment Data</h2>
          {!loading && (
            <p className="ad-page-sub">
              {records.length} รายการ · {uniqueCourses} หลักสูตร · real-time
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Batch filter — always visible */}
          {!loading && batches.length > 0 && (
            <div className="tr-select-wrap">
              <BarChart3 size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <select className="tr-select" value={batchFilter} onChange={e => { setBatchFilter(e.target.value); setSelectedCourse(null); }}>
                <option value="">ทุก Batch</option>
                {batches.map(b => <option key={b} value={b}>{fmtBatch(b)}</option>)}
              </select>
            </div>
          )}
          {isAdmin && (
            <button className="tr-btn-primary" disabled={uploadStatus?.loading} onClick={() => fileInputRef.current?.click()}>
              {uploadStatus?.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> : <Plus size={14}/>}
              {uploadStatus?.loading ? 'กำลังบันทึก...' : 'นำเข้า CSV'}
            </button>
          )}
        </div>
      </div>

      {/* CSV hint */}
      {isAdmin && (
        <div className="ad-hint">
          <FileText size={13}/>
          <span>รูปแบบ CSV: <code>Timestamp, Email Address, Score, Type, Course</code> · Score: <code>6</code> หรือ <code>6 / 15</code> · Type: pre/post หรือ ก่อนเรียน/หลังเรียน</span>
        </div>
      )}

      {/* Upload banner */}
      <AnimatePresence>
        {uploadStatus && (
          <UploadBanner status={uploadStatus} onClose={() => { clearTimeout(dismissTimer.current); setUploadStatus(null); }}/>
        )}
      </AnimatePresence>

      {/* Loading */}
      {loading && (
        <div className="ad-loading">
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }}/>
          กำลังโหลดข้อมูล...
        </div>
      )}

      {/* Empty */}
      {!loading && records.length === 0 && (
        <motion.div className="tr-empty-state" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="tr-empty-icon"><GraduationCap size={36}/></div>
          <p className="tr-empty-title">ยังไม่มีข้อมูล Assessment</p>
          {isAdmin && <p className="tr-empty-sub">กด "นำเข้า CSV" เพื่อเพิ่มข้อมูล</p>}
        </motion.div>
      )}

      {/* Content */}
      {!loading && records.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Global KPIs — only on course list, not in drilldown */}
          {!selectedCourse && (
            <div className="ad-kpi-grid">
              <KpiCard icon={<BookOpen size={20}/>}  iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="หลักสูตร"      value={uniqueCourses}     sub="ทั้งหมด"/>
              <KpiCard icon={<FileText size={20}/>}  iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="Pre-test"      value={allPre.length}     sub="รายการ"/>
              <KpiCard icon={<BookOpen size={20}/>}  iconColor="#2563EB" iconBg="rgba(37,99,235,0.12)"  label="Post-test"     value={allPost.length}    sub="รายการ"/>
              <KpiCard
                icon={<Award size={20}/>}
                iconColor={globalPassRate !== null && globalPassRate >= PASS_PCT ? '#059669' : '#EF4444'}
                iconBg={globalPassRate    !== null && globalPassRate >= PASS_PCT ? 'rgba(5,150,105,0.12)' : 'rgba(239,68,68,0.12)'}
                label="Pass Rate (Post)"
                value={globalPassRate !== null ? `${globalPassRate}%` : '–'}
                sub={avgDelta !== null ? `Δ avg ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}` : ''}
              />
            </div>
          )}

          {/* Level 1: Course list */}
          {!selectedCourse && (
            <CourseListView
              records={records}
              employeeMap={employeeMap}
              batchFilter={batchFilter}
              onSelectCourse={course => setSelectedCourse(course)}
              isAdmin={isAdmin}
              onDelete={setDeleteTarget}
            />
          )}

          {/* Level 2: Employee drilldown */}
          {selectedCourse && (
            <EmployeeView
              records={records}
              employeeMap={employeeMap}
              selectedCourse={selectedCourse}
              batchFilter={batchFilter}
              onBack={() => setSelectedCourse(null)}
              isAdmin={isAdmin}
              onDelete={setDeleteTarget}
            />
          )}
        </motion.div>
      )}

      <ConfirmDialog result={pendingResult} onConfirm={handleConfirm} onCancel={handleCancel} saving={saving}/>
      <DeleteConfirmDialog
        target={deleteTarget}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
        deleting={deleting}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
