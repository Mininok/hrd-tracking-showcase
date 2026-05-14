import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useMotionTemplate, useAnimationFrame } from 'framer-motion';
import { TrainingRecord } from './components/TrainingRecord';
import { CourseLibrary } from './components/CourseLibrary';
import { DSDPage } from './components/DSDPage';
import { AssessmentPage } from './components/AssessmentPage';
import {
  Award, Heart, TrendingUp, Users, Target,
  Quote, AlertTriangle, BarChart3,
  CheckCircle, FileText, ClipboardList,
  Edit3, Save, Calendar, Zap, BookOpen, BookMarked, Building2, GraduationCap
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { collection, onSnapshot, doc, setDoc, getDoc } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import {
  MOCK_ASSESSMENTS, MOCK_SATISFACTION, MOCK_EMPLOYEES,
  MOCK_TOWNHALL_SAT, MOCK_TOWNHALL_REG,
} from './mockData';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const ALLOWED_DOMAIN = 'freshket.co';
const ADMIN_EMAIL    = 'kanok.t@freshket.co';

// เพิ่ม event ID ใหม่ที่นี่เมื่อมี Townhall รอบถัดไป
const TOWNHALL_EVENTS = ['Townhall Q1'];

// ── Constants ────────────────────────────────────────────────
const PASS_THRESHOLD = 0.8;
const SCORE_MAX = 10;

// Filter useless open-text responses
const JUNK_PATTERN = /^[\s\-–—_.]*$|^(ไม่มี|ไม่ระบุ|blank|none|n\/a|-)$/i;
const isUsefulText = (v) => v && !JUNK_PATTERN.test(String(v).trim());

// Color class by 1–5 score value (traffic light: ≥4 green, ≥3 amber, <3 red)
const scoreClass = (v) => {
  if (!v || v <= 0) return 'cell-none';
  if (v >= 4.0) return 'cell-high';
  if (v >= 3.0) return 'cell-mid';
  return 'cell-low';
};

// Traffic light fill color for charts
const trafficColor = (v) => v >= 4 ? '#00ce7c' : v >= 3 ? '#D97706' : '#DC2626';

// Shared tooltip style (uses CSS vars — adapts to light/dark)
const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-primary)',
};

// ── Quote Cards ───────────────────────────────────────────────
function QuoteCards({ entries, icon, emptyText = 'ไม่มีข้อมูล' }) {
  if (!entries.length) return <p className="quote-empty">{emptyText}</p>;
  return (
    <div className="quote-card-list">
      {entries.map((e, i) => (
        <div key={i} className="quote-card">
          <span className="quote-card-icon">{icon}</span>
          <div className="quote-card-body">
            <p className="quote-card-text">"{e.text}"</p>
            {e.dept && <span className="quote-card-dept">{e.dept}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// All rating dimensions (1–5 numeric) — Linear palette
const SAT_TOPICS = [
  { key: 'expertise',            label: 'Expertise',              color: '#EC4899' },
  { key: 'overall_vibe',         label: 'Overall Vibe',           color: '#3DD68C' },
  { key: 'bite_sized_learning',  label: 'Bite-sized Learning',    color: '#52A8FF' },
  { key: 'confidence_boost',     label: 'Confidence Boost',       color: '#5E4FF6' },
  { key: 'coordination_support', label: 'Coordination & Support', color: '#F59E0B' },
  { key: 'operational_empathy',  label: 'Operational Empathy',    color: '#F05252' }
];

// Open-ended text only
const TEXT_FIELDS = [
  { key: 'new_insight',        label: 'New Insight',        icon: '💡' },
  { key: 'one_thing_to_change', label: 'One Thing to Change', icon: '🔧' }
];

// ── Townhall Firestore field keys ────────────────────────────
// ตรงกับ field names ใน Firestore ทุกตัวอักษร (จาก screenshot)
const TH = {
  overall:   'โดยรวมแล้วคุณพึงพอใจกับ Town Hall ครั้งนี้แค่ไหน?',
  engaged:   'กิจกรรม/บรรยากาศวันนี้ทำให้คุณรู้สึกมีพลัง (Engaged) หรือไม่?',
  content:   'เนื้อหาที่นำมาแชร์ในวันนี้มีประโยชน์และชัดเจนสำหรับคุณมากน้อยเพียงใด?',
  impressed: 'Townhall ครั้งนี้มีอะไรที่คุณประทับใจ หรืออยากให้เราทำต่อไปอีก?',
  improve:   'เพื่อให้การจัดงานดีขึ้นในครั้งหน้า คุณอยากเห็นสิ่งใดใน Townhall ครั้งถัดไป',
};

// ── Robust field finder ───────────────────────────────────────
// 1) exact match, 2) normalize whitespace, 3) contains keyword
const findField = (doc, targetKey) => {
  if (doc[targetKey] !== undefined) return doc[targetKey];
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const normTarget = norm(targetKey).toLowerCase();
  // exact after normalize
  const byNorm = Object.keys(doc).find(k => norm(k).toLowerCase() === normTarget);
  if (byNorm) return doc[byNorm];
  // partial: target เริ่มต้นตรงกัน (first 8 chars)
  const prefix = normTarget.slice(0, 8);
  const byPrefix = Object.keys(doc).find(k => norm(k).toLowerCase().startsWith(prefix));
  return byPrefix ? doc[byPrefix] : undefined;
};
const getThNum  = (doc, key) => num(findField(doc, key) ?? 0);
const getThText = (doc, key) => String(findField(doc, key) ?? '');

// ── Helpers ──────────────────────────────────────────────────
const toDate = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
  return null;
};

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

const getScore  = (e) => num(e.score_value ?? e.score);
const getType   = (e) => e.test_type === 'pre' || e.test_type === 'post' ? e.test_type : null;
const getBatch  = (e) => {
  if (e.batch && typeof e.batch === 'string') return e.batch;
  const d = toDate(e._synced_at);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
};

const fmtBatch = (key) => {
  const [y, m] = key.split('-');
  return new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
};



// ── Micro Components ─────────────────────────────────────────
const ScoreBar = ({ value, max = 5, color = '#3DD68C' }) => (
  <div className="score-bar-wrap">
    <div className="score-bar-fill" style={{ width: `${Math.round((value/max)*100)}%`, background: color }} />
  </div>
);

const StatusBadge = ({ passed }) => (
  <span className={`status-badge ${passed ? 'pass' : 'fail'}`}>
    {passed ? '✓ ผ่าน' : '✗ ไม่ผ่าน'}
  </span>
);

const DeltaBadge = ({ delta }) => {
  if (delta === null) return <span className="delta-badge zero">–</span>;
  if (delta > 0) return <span className="delta-badge pos">▲ +{delta.toFixed(1)}</span>;
  if (delta < 0) return <span className="delta-badge neg">▼ {delta.toFixed(1)}</span>;
  return <span className="delta-badge zero">= 0</span>;
};

const KpiCard = ({ icon, label, value, sub, theme = '', iconColor, iconBg }) => (
  <div className={`kpi-card ${theme}`}>
    <div className="kpi-icon-box" style={{
      background: iconBg || 'var(--surface-3)',
      color: iconColor || 'var(--accent)',
    }}>
      {icon}
    </div>
    <div className="kpi-content">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  </div>
);

const InsightCard = ({ type, icon, title, text }) => (
  <div className={`insight-card ${type}`}>
    <span className="insight-icon">{icon}</span>
    <div>
      <p className="insight-title">{title}</p>
      <p className="insight-text">{text}</p>
    </div>
  </div>
);

// ── Overview Tab ─────────────────────────────────────────────
function OverviewTab({ assessments, satisfaction, isLoading, error }) {
  const pre  = useMemo(() => assessments.filter(e => getType(e) === 'pre'),  [assessments]);
  const post = useMemo(() => assessments.filter(e => getType(e) === 'post'), [assessments]);

  const uniqParticipants = useMemo(() => new Set(assessments.map(e => e.email)).size, [assessments]);

  const preAvg  = useMemo(() => avg(pre.map(getScore)),  [pre]);
  const postAvg = useMemo(() => avg(post.map(getScore)), [post]);
  const delta   = preAvg !== null && postAvg !== null ? postAvg - preAvg : null;

  const passRate = useMemo(() => {
    if (!post.length) return null;
    const passed = post.filter(e => e.is_passed === true || (getScore(e) / SCORE_MAX) >= PASS_THRESHOLD).length;
    return Math.round((passed / post.length) * 100);
  }, [post]);

  const satAvg = useMemo(() => {
    const scores = satisfaction.map(e => num(e.overall_vibe)).filter(v => v > 0);
    return avg(scores);
  }, [satisfaction]);

  const opEmpathyAvg = useMemo(() => {
    const scores = satisfaction.map(e => num(e.operational_empathy)).filter(v => v > 0);
    return avg(scores);
  }, [satisfaction]);

  const topicAvgs = useMemo(() => SAT_TOPICS.map(t => {
    const vals = satisfaction.map(e => num(e[t.key])).filter(v => v > 0);
    return { ...t, avg: avg(vals) || 0 };
  }), [satisfaction]);

  const PRE_COLOR  = '#00ce7c';
  const POST_COLOR = '#2563EB';

  const chartData = [
    { name: 'Pre Test',  value: preAvg  ? +preAvg.toFixed(1)  : 0 },
    { name: 'Post Test', value: postAvg ? +postAvg.toFixed(1) : 0 }
  ];

  // HRD Insights
  const insights = useMemo(() => {
    const list = [];
    if (delta !== null && delta >= 1.5)
      list.push({ type: 'success', icon: <TrendingUp size={16} />, title: 'Learning Effectiveness สูง', text: `คะแนนเพิ่มขึ้น +${delta.toFixed(1)} คะแนน — แสดงว่า content เนื้อหา training มีประสิทธิภาพดีเยี่ยม` });
    else if (delta !== null && delta > 0)
      list.push({ type: 'info', icon: <TrendingUp size={16} />, title: 'มีพัฒนาการ', text: `คะแนนเพิ่มขึ้น +${delta.toFixed(1)} — ยังมีโอกาสพัฒนา content เพิ่มเติม` });

    if (passRate !== null && passRate >= 80)
      list.push({ type: 'success', icon: <Award size={16} />, title: `Pass Rate ${passRate}%`, text: `ผู้เข้าร่วม ${passRate}% ผ่านเกณฑ์ 70% — สะท้อนความพร้อมรับความรู้ที่สูง` });
    else if (passRate !== null && passRate < 60)
      list.push({ type: 'warn', icon: <AlertTriangle size={16} />, title: `Pass Rate ต่ำ (${passRate}%)`, text: `ควรทบทวน difficulty ของ assessment หรือเพิ่มรอบ practice ก่อน post test` });

    if (satAvg !== null && satAvg >= 4.0)
      list.push({ type: 'success', icon: <Heart size={16} />, title: 'ผู้เข้าร่วมพึงพอใจสูง', text: `Overall satisfaction ${satAvg.toFixed(1)}/5 — เกินเป้าหมาย 4.0 แสดงว่า training experience ตรงใจผู้เรียน` });

    if (list.length === 0)
      list.push({ type: 'info', icon: <BarChart3 size={16} />, title: 'รอข้อมูลเพิ่มเติม', text: `ข้อมูลยังไม่เพียงพอสำหรับการวิเคราะห์ insight — ลองเปลี่ยน batch filter` });
    return list;
  }, [delta, passRate, satAvg]);

  return (
    <>
      {error   && <div className="status-bar error">⚠ {error}</div>}
      {isLoading && <div className="status-bar loading">⟳ กำลังโหลดข้อมูล Firestore...</div>}

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard
          icon={<Award size={20} />}
          iconColor="#F59E0B" iconBg="rgba(245,158,11,0.12)"
          label="Overall Satisfaction"
          value={satAvg !== null ? satAvg.toFixed(2) : '–'}
          sub="/ 5.00"
        />
        <KpiCard
          icon={<Heart size={20} />}
          iconColor="#EF4444" iconBg="rgba(239,68,68,0.12)"
          label="Operational Empathy"
          value={opEmpathyAvg !== null ? `${Math.round((opEmpathyAvg/5)*100)}%` : '–'}
          sub={opEmpathyAvg !== null ? `เฉลี่ย ${opEmpathyAvg.toFixed(1)} / 5` : ''}
        />
        <KpiCard
          icon={<TrendingUp size={20} />}
          iconColor="#059669" iconBg="rgba(5,150,105,0.12)"
          label="Learning Impact"
          value={delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '–'}
          sub="Confidence &amp; Insight"
        />
        <KpiCard
          icon={<Users size={20} />}
          iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)"
          label="Total Participants"
          value={uniqParticipants}
          sub={`ประเมิน ${satisfaction.length} คน`}
        />
      </div>

      {/* Participation Funnel */}
      {pre.length > 0 && (() => {
        const uniqPre  = new Set(pre.map(e => e.email)).size;
        const uniqPost = new Set(post.map(e => e.email)).size;
        const sat      = satisfaction.length;
        const base     = uniqPre || 1;
        const steps = [
          { label: 'ทำ Pre-test (เข้าอบรม)', count: uniqPre,  pct: 100,                           color: '#00ce7c' },
          { label: 'ทำ Post-test',            count: uniqPost, pct: Math.round(uniqPost/base*100), color: '#2563EB' },
          { label: 'ตอบ Satisfaction',        count: sat,      pct: Math.round(sat/base*100),      color: '#F59E0B' },
        ];
        return (
          <div className="chart-card funnel-card">
            <div className="section-head">
              <div>
                <h2><Users size={15} />Participation Funnel</h2>
                <p>เปรียบเทียบจำนวนผู้เข้าร่วมในแต่ละขั้นตอน</p>
              </div>
            </div>
            <div className="funnel-steps">
              {steps.map(s => (
                <div key={s.label} className="funnel-step">
                  <div className="funnel-step-meta">
                    <span className="funnel-step-label">{s.label}</span>
                    <span className="funnel-step-count">{s.count} คน</span>
                    <span className="funnel-step-pct" style={{ color: s.color }}>{s.pct}%</span>
                  </div>
                  <div className="funnel-bar-track">
                    <div className="funnel-bar-fill" style={{ width: `${s.pct}%`, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* HRD Insights */}
      <div className="insight-banner">
        {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
      </div>

      {/* Pre/Post Chart */}
      <div className="chart-card">
        <div className="section-head">
          <div>
            <h2><TrendingUp size={15} />Learning Growth</h2>
            <p>คะแนนเฉลี่ยก่อน/หลัง training · Pre avg {preAvg ? preAvg.toFixed(1) : '–'} → Post avg {postAvg ? postAvg.toFixed(1) : '–'}</p>
          </div>
          <div className="chart-legend">
            <span><span className="legend-dot" style={{ background: PRE_COLOR, display:'inline-block', width:8, height:8, borderRadius:2, marginRight:4 }} /> Pre</span>
            <span><span className="legend-dot" style={{ background: POST_COLOR, display:'inline-block', width:8, height:8, borderRadius:2, marginRight:4 }} /> Post</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <YAxis domain={[0, SCORE_MAX]} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickCount={6} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={v => [`${v} / ${SCORE_MAX}`, 'คะแนนเฉลี่ย']}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={56} name="avg">
              {chartData.map(e => <Cell key={e.name} fill={e.name === 'Pre Test' ? PRE_COLOR : POST_COLOR} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Satisfaction pillars */}
      <div className="section">
        <div className="section-head">
          <div>
            <h2><Heart size={15} style={{ color: '#EC4899' }} />Satisfaction Breakdown</h2>
            <p>จาก {satisfaction.length} ใบตอบรับ</p>
          </div>
        </div>
        <div className="score-list">
          {topicAvgs.map(t => (
            <div key={t.key} className="score-row">
              <span className="score-label">{t.label}</span>
              <ScoreBar value={t.avg} color={t.color} />
              <span className="score-number">{t.avg ? t.avg.toFixed(1) : '–'}<span style={{ fontSize:'0.7rem', color:'#5C5C66', fontWeight:400 }}>/5</span></span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Assessment Tab ────────────────────────────────────────────
function AssessmentTab({ assessments, isLoading, error, employeeMap = {} }) {
  const [sortBy, setSortBy] = useState('delta');

  const pre  = useMemo(() => assessments.filter(e => getType(e) === 'pre'),  [assessments]);
  const post = useMemo(() => assessments.filter(e => getType(e) === 'post'), [assessments]);

  const pairs = useMemo(() => {
    const map = {};
    pre.forEach(e  => { map[e.email] = { email: e.email, pre: getScore(e),  preEntry: e  }; });
    post.forEach(e => {
      if (!map[e.email]) map[e.email] = { email: e.email };
      map[e.email].post    = getScore(e);
      map[e.email].passed  = e.is_passed === true || (getScore(e) / SCORE_MAX) >= PASS_THRESHOLD;
      map[e.email].postEntry = e;
    });
    return Object.values(map);
  }, [pre, post]);

  const passedCount   = useMemo(() => pairs.filter(p => p.passed).length, [pairs]);
  const improvedCount = useMemo(() => pairs.filter(p => p.pre !== undefined && p.post !== undefined && p.post > p.pre).length, [pairs]);
  const preAvg  = useMemo(() => avg(pre.map(getScore)),  [pre]);
  const postAvg = useMemo(() => avg(post.map(getScore)), [post]);

  const distData = useMemo(() => {
    const bands = [{ l:'0–3', mn:0, mx:3 }, { l:'4–5', mn:4, mx:5 }, { l:'6–7', mn:6, mx:7 }, { l:'8–10', mn:8, mx:10 }];
    return bands.map(b => ({
      label: b.l,
      Pre:  pre.filter(e  => { const s = getScore(e); return s >= b.mn && s <= b.mx; }).length,
      Post: post.filter(e => { const s = getScore(e); return s >= b.mn && s <= b.mx; }).length
    }));
  }, [pre, post]);

  const sorted = useMemo(() => [...pairs].sort((a, b) => {
    if (sortBy === 'delta') {
      const da = (a.pre !== undefined && a.post !== undefined) ? a.post - a.pre : -999;
      const db = (b.pre !== undefined && b.post !== undefined) ? b.post - b.pre : -999;
      return db - da;
    }
    if (sortBy === 'post') return (b.post ?? -1) - (a.post ?? -1);
    return (b.pre ?? -1) - (a.pre ?? -1);
  }), [pairs, sortBy]);

  return (
    <>
      {error   && <div className="status-bar error">⚠ {error}</div>}
      {isLoading && <div className="status-bar loading">⟳ กำลังโหลด...</div>}

      <div className="kpi-grid">
        <KpiCard icon={<FileText size={20} />}     iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)"  label="ทำ Pre Test"  value={pre.length}  sub="คน" />
        <KpiCard icon={<ClipboardList size={20} />} iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="ทำ Post Test" value={post.length} sub="คน" />
        <KpiCard icon={<CheckCircle size={20} />}
          iconColor={post.length > 0 && passedCount/post.length >= 0.7 ? '#059669' : '#EF4444'}
          iconBg={post.length > 0 && passedCount/post.length >= 0.7 ? 'rgba(5,150,105,0.12)' : 'rgba(239,68,68,0.12)'}
          label="Pass Rate"
          value={post.length ? `${Math.round((passedCount/post.length)*100)}%` : '–'}
          sub={`${passedCount} / ${post.length} คน`}
        />
        <KpiCard icon={<TrendingUp size={20} />}   iconColor="#059669" iconBg="rgba(5,150,105,0.12)"   label="คะแนนเพิ่มขึ้น"
          value={`${improvedCount} คน`}
          sub={`จาก ${pairs.filter(p => p.pre !== undefined && p.post !== undefined).length} คู่`}
        />
      </div>

      {/* Score avg compare */}
      <div className="kpi-grid" style={{ marginBottom: 24 }}>
        <KpiCard icon={<BarChart3 size={20} />} iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="Pre Test Avg" value={preAvg !== null ? preAvg.toFixed(1) : '–'} sub={`/ ${SCORE_MAX}`} />
        <KpiCard icon={<BarChart3 size={20} />} iconColor="#2563EB" iconBg="rgba(37,99,235,0.12)" label="Post Test Avg" value={postAvg !== null ? postAvg.toFixed(1) : '–'} sub={`/ ${SCORE_MAX}`} />
        <KpiCard icon={<TrendingUp size={20} />} iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)" label="Improvement" value={preAvg !== null && postAvg !== null ? `${postAvg-preAvg >= 0 ? '+' : ''}${(postAvg-preAvg).toFixed(1)}` : '–'} sub="คะแนนเฉลี่ย" />
      </div>

      {/* Distribution */}
      <div className="chart-card">
        <div className="section-head">
          <div>
            <h2><BarChart3 size={15} />Score Distribution</h2>
            <p>จำนวนผู้เข้าร่วมแบ่งตามช่วงคะแนน Pre vs Post</p>
          </div>
          <div className="chart-legend">
            <span><span className="legend-dot" style={{ background: '#3DD68C', display:'inline-block', width:8, height:8, borderRadius:2, marginRight:4 }} />Pre</span>
            <span><span className="legend-dot" style={{ background: '#52A8FF', display:'inline-block', width:8, height:8, borderRadius:2, marginRight:4 }} />Post</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={distData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v, n) => [`${v} คน`, n === 'Pre' ? 'Pre Test' : 'Post Test']}
            />
            <Bar dataKey="Pre"  radius={[4,4,0,0]} fill="#00ce7c" barSize={22} />
            <Bar dataKey="Post" radius={[4,4,0,0]} fill="#2563EB" barSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Individual Table */}
      <div className="section">
        <div className="section-head">
          <div>
            <h2><Users size={15} />Individual Progress</h2>
            <p>ติดตามความก้าวหน้ารายบุคคล {sorted.length} คน</p>
          </div>
          <div className="sort-wrap">
            <label className="sort-label">เรียงตาม</label>
            <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="delta">ความก้าวหน้ามากสุด</option>
              <option value="post">Post Test สูงสุด</option>
              <option value="pre">Pre Test สูงสุด</option>
            </select>
          </div>
        </div>
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อ / Email</th>
                <th>แผนก · ตำแหน่ง</th>
                <th>Pre Test</th>
                <th>Post Test</th>
                <th>Improvement</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0
                ? <tr><td colSpan={6} className="table-empty">ไม่มีข้อมูลในช่วงนี้</td></tr>
                : sorted.map(p => {
                    const d = p.pre !== undefined && p.post !== undefined ? p.post - p.pre : null;
                    const emp = employeeMap[(p.email || '').toLowerCase()];
                    const displayName = emp ? (emp.nickname || emp.name_en || '') : '';
                    return (
                      <tr key={p.email}>
                        <td className="email-cell">
                          {displayName && <div className="emp-name">{displayName}</div>}
                          <div className="emp-email">{p.email || '–'}</div>
                        </td>
                        <td className="emp-dept-cell">
                          {emp
                            ? <>
                                <div className="dept-name">{emp.department || '–'}</div>
                                <div className="dept-pos">{emp.position || ''}</div>
                              </>
                            : <span style={{ color: 'var(--text-muted)' }}>–</span>
                          }
                        </td>
                        <td>{p.pre !== undefined ? `${p.pre} / ${SCORE_MAX}` : <span style={{color:'var(--text-muted)'}}>–</span>}</td>
                        <td>{p.post !== undefined ? `${p.post} / ${SCORE_MAX}` : <span style={{color:'var(--text-muted)'}}>รอ</span>}</td>
                        <td><DeltaBadge delta={d} /></td>
                        <td>
                          {p.post !== undefined
                            ? <StatusBadge passed={p.passed} />
                            : <span className="delta-badge zero">รอ Post</span>
                          }
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Satisfaction Tab ──────────────────────────────────────────
const RADAR_LABELS = {
  expertise:            'Expertise',
  overall_vibe:         'Vibe',
  bite_sized_learning:  'Learning',
  confidence_boost:     'Confidence',
  coordination_support: 'Coordination',
  operational_empathy:  'Empathy',
};

function SatisfactionTab({ satisfaction, isLoading, error, isAdmin, currentBatch }) {
  const topicAvgs = useMemo(() => SAT_TOPICS.map(t => {
    const vals = satisfaction.map(e => num(e[t.key])).filter(v => v > 0);
    return { ...t, avg: avg(vals) || 0, count: vals.length };
  }), [satisfaction]);

  const overallSatisfaction = useMemo(() => {
    const values = satisfaction.map(e => num(e.overall_vibe)).filter(v => v > 0);
    return avg(values);
  }, [satisfaction]);

  const operationalEmpathyAvg = useMemo(() => {
    const values = satisfaction.map(e => num(e.operational_empathy)).filter(v => v > 0);
    return avg(values);
  }, [satisfaction]);

  const learningImpactAvg = useMemo(() => {
    const values = satisfaction.map(e => num(e.confidence_boost)).filter(v => v > 0);
    return avg(values);
  }, [satisfaction]);

  const totalSubmit = satisfaction.length;

  const radarData = useMemo(() =>
    topicAvgs.map(t => ({ subject: RADAR_LABELS[t.key] || t.label, value: +t.avg.toFixed(2), fullMark: 5 })),
    [topicAvgs]
  );

  const insightEntries = useMemo(() =>
    satisfaction
      .filter(e => isUsefulText(e.new_insight))
      .map(e => ({ text: String(e.new_insight).trim(), dept: e.department || '' })),
    [satisfaction]
  );

  const changeEntries = useMemo(() =>
    satisfaction
      .filter(e => isUsefulText(e.one_thing_to_change))
      .map(e => ({ text: String(e.one_thing_to_change).trim(), dept: e.department || '' })),
    [satisfaction]
  );

  return (
    <>
      {error     && <div className="status-bar error">⚠ {error}</div>}
      {isLoading && <div className="status-bar loading">⟳ กำลังโหลด...</div>}

      {/* ── KPI ── */}
      <div className="kpi-grid">
        <KpiCard
          icon={<Award size={20} />} iconColor="#F59E0B" iconBg="rgba(245,158,11,0.12)"
          label="Overall Satisfaction"
          value={overallSatisfaction !== null ? overallSatisfaction.toFixed(2) : '–'}
          sub="/ 5.00"
        />
        <KpiCard
          icon={<Heart size={20} />} iconColor="#EF4444" iconBg="rgba(239,68,68,0.12)"
          label="Operational Empathy"
          value={operationalEmpathyAvg !== null ? `${Math.round((operationalEmpathyAvg/5)*100)}%` : '–'}
          sub={operationalEmpathyAvg !== null ? `${operationalEmpathyAvg.toFixed(1)} / 5` : ''}
        />
        <KpiCard
          icon={<TrendingUp size={20} />} iconColor="#059669" iconBg="rgba(5,150,105,0.12)"
          label="Learning Impact"
          value={learningImpactAvg !== null ? learningImpactAvg.toFixed(2) : '–'}
          sub="Confidence & Insight"
        />
        <KpiCard
          icon={<Users size={20} />} iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)"
          label="Total Submit"
          value={totalSubmit}
          sub="responses"
        />
      </div>

      {/* ── Radar ── */}
      <div className="chart-card">
        <div className="section-head">
          <div><h2><Target size={15} />สมดุลความพึงพอใจ</h2><p>Radar · 6 มิติ</p></div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={radarData} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
            <PolarGrid stroke="var(--border-strong)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 500 }} />
            <PolarRadiusAxis domain={[0, 5]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke="#00ce7c" fill="#00ce7c" fillOpacity={0.15} strokeWidth={2} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`${v} / 5`, 'คะแนนเฉลี่ย']} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Quote Cards ── */}
      <div className="sat-bottom-grid">
        <div className="chart-card">
          <div className="section-head">
            <div><h2><Quote size={15} />สิ่งที่พนักงานประทับใจที่สุด</h2><p>{insightEntries.length} ความคิดเห็น</p></div>
          </div>
          <QuoteCards entries={insightEntries} icon={<Quote size={14} />} />
        </div>

        <div className="chart-card">
          <div className="section-head">
            <div><h2><AlertTriangle size={15} />สิ่งที่พนักงานอยากให้ปรับปรุง</h2><p>{changeEntries.length} รายการ</p></div>
          </div>
          <QuoteCards entries={changeEntries} icon={<AlertTriangle size={14} />} emptyText="ไม่มีข้อเสนอแนะ" />
        </div>
      </div>

      {/* ── Admin Note Panel ── */}
      {isAdmin && <AdminNotePanel batch={currentBatch} />}
    </>
  );
}

// ── Admin Note Panel ──────────────────────────────────────────
function AdminNotePanel({ batch }) {
  const [note, setNote]       = useState('');
  const [saved, setSaved]     = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);

  const docId = batch && batch !== 'All' ? batch : 'general';

  useEffect(() => {
    getDoc(doc(db, 'plan_notes', docId)).then(d => {
      if (d.exists()) { setSaved(d.data().text || ''); setNote(d.data().text || ''); }
      else { setSaved(''); setNote(''); }
    });
  }, [docId]);

  const handleSave = async () => {
    setSaving(true);
    await setDoc(doc(db, 'plan_notes', docId), { text: note, updated_at: new Date(), batch: docId });
    setSaved(note);
    setEditing(false);
    setSaving(false);
  };

  return (
    <div className="admin-note-panel">
      <div className="admin-note-header">
        <span className="admin-note-icon" style={{ display:'flex', alignItems:'center' }}><ClipboardList size={16} /></span>
        <span className="admin-note-title">สรุปแผนงานรุ่นถัดไป</span>
        <span className="admin-badge">Admin</span>
        {!editing && (
          <button className="admin-note-btn" onClick={() => setEditing(true)} style={{ display:'flex', alignItems:'center', gap:5 }}><Edit3 size={13} /> แก้ไข</button>
        )}
      </div>
      {editing ? (
        <div className="admin-note-edit">
          <textarea
            className="admin-note-textarea"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="เขียนแผนงานรุ่นถัดไป เช่น ปรับปรุงเรื่อง Logistics, เพิ่มเวลาดูหน้างาน..."
            rows={5}
          />
          <div className="admin-note-actions">
            <button className="admin-note-btn primary" onClick={handleSave} disabled={saving} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <Save size={13} />{saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="admin-note-btn" onClick={() => { setNote(saved); setEditing(false); }}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <p className="admin-note-body">
          {saved || <span style={{ opacity: 0.5 }}>ยังไม่มีแผนงาน — กดแก้ไขเพื่อเพิ่ม</span>}
        </p>
      )}
    </div>
  );
}

// ── Townhall Tab (HRD Manager View) ───────────────────────────
function TownhallTab({ rawData, registrations = [], isLoading, isAdmin }) {
  const [session, setSession] = useState('All');

  // ── sessions from Activity field ──
  const sessions = useMemo(() => {
    const acts = [...new Set(rawData.map(e => e.Activity).filter(Boolean))].sort();
    return ['All', ...acts];
  }, [rawData]);

  const filtered = useMemo(() =>
    session === 'All' ? rawData : rawData.filter(e => e.Activity === session),
  [rawData, session]);

  // ── registration count — match by Activity field (same as Satisfaction Activity)
  const regCount = useMemo(() => {
    if (session === 'All') return registrations.length;
    return registrations.filter(r => r.Activity === session).length;
  }, [registrations, session]);

  // ── core metrics ──
  const overallAvg  = useMemo(() => avg(filtered.map(e => getThNum(e, TH.overall)).filter(v => v > 0)),  [filtered]);
  const engagedAvg  = useMemo(() => avg(filtered.map(e => getThNum(e, TH.engaged)).filter(v => v > 0)),  [filtered]);
  const contentAvg  = useMemo(() => avg(filtered.map(e => getThNum(e, TH.content)).filter(v => v > 0)),  [filtered]);
  const totalResp   = filtered.length;
  const highEngPct  = useMemo(() => {
    const vals = filtered.map(e => getThNum(e, TH.engaged)).filter(v => v > 0);
    return vals.length ? Math.round(vals.filter(v => v >= 4).length / vals.length * 100) : null;
  }, [filtered]);

  // ── dept breakdown with all 3 scores ──
  const deptData = useMemo(() => {
    const map = {};
    filtered.forEach(e => {
      const dept = e.Department || 'ไม่ระบุ';
      if (!map[dept]) map[dept] = { dept, overall: [], engaged: [], content: [], n: 0 };
      map[dept].n++;
      const o  = getThNum(e, TH.overall);  if (o  > 0) map[dept].overall.push(o);
      const en = getThNum(e, TH.engaged);  if (en > 0) map[dept].engaged.push(en);
      const c  = getThNum(e, TH.content);  if (c  > 0) map[dept].content.push(c);
    });
    return Object.values(map).map(r => ({
      dept:     r.dept.length > 20 ? r.dept.slice(0, 20) + '…' : r.dept,
      fullDept: r.dept,
      overall:  r.overall.length ? +(avg(r.overall).toFixed(2)) : 0,
      engaged:  r.engaged.length ? +(avg(r.engaged).toFixed(2)) : 0,
      content:  r.content.length ? +(avg(r.content).toFixed(2)) : 0,
      n: r.n,
    })).sort((a, b) => b.overall - a.overall);
  }, [filtered]);

  // ── HRD auto-insights ──
  const hrdInsights = useMemo(() => {
    const list = [];
    if (overallAvg !== null && overallAvg >= 4.0)
      list.push({ type: 'success', icon: <Award size={15} />, title: `ความพึงพอใจโดยรวมสูง (${overallAvg.toFixed(1)}/5)`, text: 'Townhall ครั้งนี้ได้รับการตอบรับที่ดี ควรรักษาคุณภาพนี้ไว้' });
    else if (overallAvg !== null && overallAvg < 3.5)
      list.push({ type: 'warn', icon: <AlertTriangle size={15} />, title: `ความพึงพอใจต่ำกว่าเป้า (${overallAvg.toFixed(1)}/5)`, text: 'ควรทบทวน format และเนื้อหา — สำรวจ feedback เพิ่มเติม' });

    if (highEngPct !== null && highEngPct >= 70)
      list.push({ type: 'success', icon: <Zap size={15} />, title: `${highEngPct}% รู้สึก Engaged`, text: 'บรรยากาศและกิจกรรมในงานสร้าง engagement ได้ดี' });
    else if (highEngPct !== null && highEngPct < 50)
      list.push({ type: 'warn', icon: <Zap size={15} />, title: `Engagement ต่ำ (${highEngPct}% รู้สึกมีพลัง)`, text: 'แนะนำเพิ่ม interactive element เช่น Q&A, live poll, small group discussion' });

    if (contentAvg !== null && contentAvg >= 4.0)
      list.push({ type: 'success', icon: <BookOpen size={15} />, title: `เนื้อหาชัดเจนและมีประโยชน์ (${contentAvg.toFixed(1)}/5)`, text: 'ผู้เข้าร่วมเห็นว่าเนื้อหาเกี่ยวข้องและนำไปใช้ได้จริง' });
    else if (contentAvg !== null && contentAvg < 3.5)
      list.push({ type: 'warn', icon: <BookOpen size={15} />, title: `Content relevance ต้องปรับปรุง (${contentAvg.toFixed(1)}/5)`, text: 'ควรสำรวจ topic ที่พนักงานต้องการก่อนจัด และเพิ่มตัวอย่างที่ใช้งานได้จริง' });

    if (deptData.length > 1) {
      const lowest = deptData[deptData.length - 1];
      if (lowest.overall < 3.5 && lowest.n >= 2)
        list.push({ type: 'warn', icon: <Users size={15} />, title: `${lowest.fullDept} มีคะแนนต่ำสุด (${lowest.overall.toFixed(1)}/5)`, text: 'ควรนัดพบแผนกนี้เพื่อสอบถาม pain point เพิ่มเติม' });
    }

    if (list.length === 0 && totalResp > 0)
      list.push({ type: 'info', icon: <BarChart3 size={15} />, title: 'ภาพรวมอยู่ในเกณฑ์ดี', text: 'ยังไม่มี pattern ที่น่ากังวล — ติดตามต่อเนื่องในรุ่นถัดไป' });

    return list;
  }, [overallAvg, highEngPct, contentAvg, deptData, totalResp]);

  // ── quote data ──
  const impressedEntries = useMemo(() =>
    filtered
      .filter(e => isUsefulText(getThText(e, TH.impressed)))
      .map(e => ({ text: String(getThText(e, TH.impressed)).trim(), dept: e.Department || '' })),
  [filtered]);

  const improveEntries = useMemo(() =>
    filtered
      .filter(e => isUsefulText(getThText(e, TH.improve)))
      .map(e => ({ text: String(getThText(e, TH.improve)).trim(), dept: e.Department || '' })),
  [filtered]);

  if (!isLoading && rawData.length === 0)
    return (
      <div className="th-empty">
        <Calendar size={36} style={{ color: 'var(--text-muted)', marginBottom: 14 }} />
        <p>ยังไม่มีข้อมูล Townhall</p>
        <small>ข้อมูลจะปรากฏหลังจากพนักงานตอบแบบประเมิน</small>
      </div>
    );

  return (
    <>
      {isLoading && <div className="status-bar loading">⟳ กำลังโหลดข้อมูล Townhall...</div>}

      {/* ── Session Selector ── */}
      {sessions.length > 1 && (
        <div className="th-session-bar">
          {sessions.map(s => (
            <button key={s}
              className={`th-session-btn${session === s ? ' active' : ''}`}
              onClick={() => setSession(s)}
            >
              <Calendar size={12} />
              {s === 'All' ? 'ทุก Session' : s}
            </button>
          ))}
        </div>
      )}

      {/* ── Section A: Executive KPIs ── */}
      <div className="th-section-label">A · Executive Summary</div>
      <div className="kpi-grid">
        <KpiCard icon={<Users size={20} />}
          iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)"
          label="ผู้ร่วมประเมิน" value={totalResp} sub="responses" />
        <KpiCard icon={<Award size={20} />}
          iconColor={overallAvg >= 4 ? '#059669' : overallAvg >= 3 ? '#D97706' : '#DC2626'}
          iconBg={overallAvg >= 4 ? 'rgba(5,150,105,0.12)' : overallAvg >= 3 ? 'rgba(217,119,6,0.12)' : 'rgba(220,38,38,0.12)'}
          label="Overall Satisfaction"
          value={overallAvg ? overallAvg.toFixed(2) : '–'} sub="/ 5.00" />
        <KpiCard icon={<Zap size={20} />}
          iconColor={highEngPct >= 70 ? '#059669' : '#D97706'}
          iconBg={highEngPct >= 70 ? 'rgba(5,150,105,0.12)' : 'rgba(217,119,6,0.12)'}
          label="Engaged (≥ 4/5)"
          value={highEngPct !== null ? `${highEngPct}%` : '–'} sub="ของผู้ตอบทั้งหมด" />
        <KpiCard icon={<BookOpen size={20} />}
          iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)"
          label="Content Quality"
          value={contentAvg ? contentAvg.toFixed(2) : '–'} sub="/ 5.00" />
      </div>

      {/* ── Participation Cards ── */}
      {(() => {
        const responsePct = regCount > 0 ? Math.round(totalResp / regCount * 100) : null;
        const color = responsePct === null ? '#94A3B8'
          : responsePct >= 80 ? '#059669'
          : responsePct >= 50 ? '#D97706'
          : '#DC2626';
        return (
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <KpiCard
              icon={<ClipboardList size={20} />}
              iconColor="#00ce7c" iconBg="rgba(0,206,124,0.12)"
              label="ผู้ลงทะเบียน"
              value={regCount || '–'}
              sub="คน"
            />
            <KpiCard
              icon={<CheckCircle size={20} />}
              iconColor={color} iconBg={`${color}22`}
              label="ตอบแบบประเมิน"
              value={totalResp}
              sub={responsePct !== null ? `${responsePct}% ของผู้ลงทะเบียน` : 'คน'}
            />
          </div>
        );
      })()}

      {/* ── Section B: HRD Insights ── */}
      {hrdInsights.length > 0 && (
        <>
          <div className="th-section-label">B · HRD Insights</div>
          <div className="insight-banner" style={{ marginBottom: 24 }}>
            {hrdInsights.map((ins, i) => (
              <InsightCard key={i} type={ins.type} icon={ins.icon} title={ins.title} text={ins.text} />
            ))}
          </div>
        </>
      )}

      {/* ── Section C: Score Breakdown ── */}
      <div className="th-section-label">C · Score Breakdown</div>
      <div className="sat-mid-grid" style={{ marginBottom: 24 }}>
        {/* Score bars */}
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <div className="section-head">
            <div><h2><Target size={15} />คะแนนเฉลี่ยทั้ง 3 มิติ</h2><p>เต็ม 5 · {totalResp} คนตอบ</p></div>
          </div>
          <div className="score-list" style={{ boxShadow: 'none', border: 'none', padding: '8px 0 0' }}>
            {[
              { label: 'Overall Satisfaction', value: overallAvg, color: '#00ce7c' },
              { label: 'Engaged / บรรยากาศ',   value: engagedAvg, color: '#059669' },
              { label: 'Content Quality',      value: contentAvg, color: '#F59E0B' },
            ].map(t => (
              <div key={t.label} className="score-row">
                <span className="score-label">{t.label}</span>
                <ScoreBar value={t.value || 0} color={t.color} />
                <span className="score-number" style={{ color: trafficColor(t.value || 0) }}>
                  {t.value ? t.value.toFixed(1) : '–'}
                  <span style={{ fontSize:'0.68rem', color:'var(--text-muted)', fontWeight:400 }}>/5</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Score distribution donut-style (simple count cards) */}
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <div className="section-head">
            <div><h2><BarChart3 size={15} />การกระจายคะแนน Overall</h2><p>จำนวนคนแต่ละระดับ</p></div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={[5,4,3,2,1].map(score => ({
                score: `${score} ★`,
                count: filtered.filter(e => getThNum(e, TH.overall) === score).length,
                fill: trafficColor(score),
              }))}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="score" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`${v} คน`, 'จำนวน']} />
              <Bar dataKey="count" radius={[4,4,0,0]} barSize={32}>
                {[5,4,3,2,1].map(score => (
                  <Cell key={score} fill={trafficColor(score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Section D: Voice of Employees ── */}
      <div className="th-section-label">D · Voice of Employees</div>
      <div className="sat-bottom-grid">
        <div className="chart-card">
          <div className="section-head">
            <div>
              <h2><Quote size={15} />สิ่งที่ดี — Keep Doing</h2>
              <p>{impressedEntries.length} ความคิดเห็น</p>
            </div>
          </div>
          <QuoteCards entries={impressedEntries} icon={<Quote size={14} />} emptyText="ยังไม่มีความคิดเห็น" />
        </div>
        <div className="chart-card">
          <div className="section-head">
            <div>
              <h2><AlertTriangle size={15} />สิ่งที่ต้องปรับ — Action Items</h2>
              <p>{improveEntries.length} รายการ</p>
            </div>
          </div>
          <QuoteCards entries={improveEntries} icon={<AlertTriangle size={14} />} emptyText="ไม่มีข้อเสนอแนะ" />
        </div>
      </div>

      {/* ── Section F: HRD Action Plan (Admin) ── */}
      {isAdmin && (
        <>
          <div className="th-section-label">E · HRD Action Plan</div>
          <AdminNotePanel batch={`townhall-${session === 'All' ? 'all' : session.replace(/\s+/g, '-').toLowerCase()}`} />
        </>
      )}
    </>
  );
}

// ── Login Page ─────────────────────────────────────────────────
const FRESHKET_LOGO = 'https://firebasestorage.googleapis.com/v0/b/kanok-portfolio.firebasestorage.app/o/Logo%2FFRESHKET%20LOGO-01.png?alt=media&token=6469e6e5-e8ca-4bfe-ac3c-53c91e61c1d4';

function LoginGridPattern({ offsetX, offsetY }) {
  return (
    <svg style={{ width: '100%', height: '100%' }}>
      <defs>
        <motion.pattern
          id="login-grid-pattern"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
          x={offsetX}
          y={offsetY}
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="#64748b"
            strokeWidth="1"
          />
        </motion.pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#login-grid-pattern)" />
    </svg>
  );
}

function LoginPage({ onLogin, error }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(error || '');

  // Mouse-reveal grid (same concept as infinite grid)
  const mouseX      = useMotionValue(0);
  const mouseY      = useMotionValue(0);
  const gridOffsetX = useMotionValue(0);
  const gridOffsetY = useMotionValue(0);

  useAnimationFrame(() => {
    gridOffsetX.set((gridOffsetX.get() + 0.5) % 40);
    gridOffsetY.set((gridOffsetY.get() + 0.5) % 40);
  });

  const maskImage = useMotionTemplate`radial-gradient(300px circle at ${mouseX}px ${mouseY}px, black, transparent)`;

  const handleMouseMove = (e) => {
    const { left, top } = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  };

  const handleLogin = async () => {
    setLoading(true);
    setErr('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email  = result.user.email || '';
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await signOut(auth);
        setErr(`เฉพาะบัญชี @${ALLOWED_DOMAIN} เท่านั้น`);
      } else {
        onLogin(result.user);
      }
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        setErr(e.message);
      }
    }
    setLoading(false);
  };

  return (
    <div className="login-bg" onMouseMove={handleMouseMove}>
      {/* Static dim grid */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.05, zIndex: 0 }}>
        <LoginGridPattern offsetX={gridOffsetX} offsetY={gridOffsetY} />
      </div>

      {/* Mouse-revealed bright grid */}
      <motion.div
        style={{ position: 'absolute', inset: 0, opacity: 0.4, zIndex: 0, maskImage, WebkitMaskImage: maskImage }}
      >
        <LoginGridPattern offsetX={gridOffsetX} offsetY={gridOffsetY} />
      </motion.div>

      {/* Glow blobs */}
      <div className="login-glow-orange" aria-hidden="true" />
      <div className="login-glow-blue"   aria-hidden="true" />
      <div className="login-glow-green"  aria-hidden="true" />

      {/* Card */}
      <div className="login-card">
        <div className="login-logo">
          <img src={FRESHKET_LOGO} alt="Freshket" className="login-logo-img" />
        </div>
        <div className="login-app-name">HRD Tracking</div>
        <h1 className="login-title">HRD Tracking</h1>
        <p className="login-sub">HRD Dashboard · เข้าสู่ระบบด้วยบัญชี {ALLOWED_DOMAIN}</p>

        {err && <div className="login-error">{err}</div>}

        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.2 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.5z"/>
            <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8-6z"/>
            <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.2-5.6c-2 1.4-4.6 2.1-8 2.1-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z"/>
          </svg>
          {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย Google'}
        </button>

        <p className="login-footer">Powered by Freshket · IYR Program</p>
      </div>
    </div>
  );
}

// ── Placeholder Page ──────────────────────────────────────────
function UnderDevPage({ title, icon }) {
  return (
    <div className="under-dev-wrap">
      <div className="under-dev-icon">{icon}</div>
      <h2 className="under-dev-title">{title}</h2>
      <p className="under-dev-desc">อยู่ระหว่างพัฒนา</p>
      <span className="under-dev-badge">Coming Soon</span>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────
function App() {
  const [user, setUser]         = useState(undefined);
  const [assessments, setAssessments] = useState([]);
  const [satisfaction, setSatisfaction] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [townhallData, setTownhallData] = useState([]);
  const [townhallLoaded, setTownhallLoaded] = useState(false);
  const [activeSection, setActiveSection] = useState('visit-iyr'); // top-level nav
  const [activeTab, setActiveTab]         = useState('overview');  // sub-tabs within visit-iyr
  const [filters, setFilters] = useState({ batch: 'All' });
  const [loaded, setLoaded] = useState({ a: false, s: false });
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState('light');

  const isAdmin    = user?.email === ADMIN_EMAIL;
  const isTownhall = activeSection === 'townhall';
  const isVisitIYR = activeSection === 'visit-iyr';

  // Auth listener
  useEffect(() => {
    if (DEMO_MODE) {
      setUser({ email: 'demo@freshket.co', displayName: 'Portfolio Demo', photoURL: null });
      return;
    }
    return onAuthStateChanged(auth, u => {
      if (u && u.email?.endsWith(`@${ALLOWED_DOMAIN}`)) setUser(u);
      else { setUser(null); if (u) signOut(auth); }
    });
  }, []);

  // Firestore listeners — only when authenticated
  useEffect(() => {
    if (!user) return;
    if (DEMO_MODE) {
      setAssessments(MOCK_ASSESSMENTS);
      setSatisfaction(MOCK_SATISFACTION);
      setEmployees(MOCK_EMPLOYEES);
      setLoaded({ a: true, s: true });
      return;
    }
    const unsubA = onSnapshot(collection(db, 'assessment'),
      snap => { setAssessments(snap.docs.map(d => ({ id:d.id, ...d.data() }))); setLoaded(p => ({...p, a:true})); },
      err => setError(`Assessment: ${err.message}`)
    );
    const unsubS = onSnapshot(collection(db, 'satisfaction'),
      snap => { setSatisfaction(snap.docs.map(d => ({ id:d.id, ...d.data() }))); setLoaded(p => ({...p, s:true})); },
      err => setError(`Satisfaction: ${err.message}`)
    );
    const unsubE = onSnapshot(collection(db, 'employees'),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEmployees(docs);
      },
      err => console.error('[employees] error:', err.code, err.message)
    );
    return () => { unsubA(); unsubS(); unsubE(); };
  }, [user]);

  // Townhall listener — direct path using TOWNHALL_EVENTS (bypasses phantom document issue)
  useEffect(() => {
    if (!user) return;
    if (DEMO_MODE) {
      setTownhallData(MOCK_TOWNHALL_SAT);
      setRegistrations(MOCK_TOWNHALL_REG);
      setTownhallLoaded(true);
      return;
    }
    const unsubs = [];
    const satByEvent = {};
    const regByEvent = {};

    TOWNHALL_EVENTS.forEach(eventId => {
      const unsubSat = onSnapshot(
        collection(db, 'Townhall', eventId, 'Satisfaction'),
        snap => {
          satByEvent[eventId] = snap.docs.map(d => ({ id: d.id, _eventId: eventId, ...d.data() }));
          const all = Object.values(satByEvent).flat();
          setTownhallData(all);
          setTownhallLoaded(true);
        },
        err => { console.error('[Townhall/Satisfaction]', eventId, err.code); setTownhallLoaded(true); }
      );

      const unsubReg = onSnapshot(
        collection(db, 'Townhall', eventId, 'Registration'),
        snap => {
          regByEvent[eventId] = snap.docs.map(d => ({ id: d.id, _eventId: eventId, ...d.data() }));
          const all = Object.values(regByEvent).flat();
          setRegistrations(all);
        },
        err => console.error('[Townhall/Registration]', eventId, err.code)
      );

      unsubs.push(unsubSat, unsubReg);
    });

    return () => unsubs.forEach(fn => fn());
  }, [user]);

  // ── ALL hooks must be above early returns ──────────────────
  const batchOptions = useMemo(() => {
    const keys = new Set([...assessments, ...satisfaction].map(getBatch).filter(Boolean));
    return ['All', ...Array.from(keys).sort((a, b) => b.localeCompare(a))];
  }, [assessments, satisfaction]);

  const filteredA = useMemo(() =>
    assessments.filter(e => filters.batch === 'All' || getBatch(e) === filters.batch),
    [assessments, filters.batch]
  );

  const filteredS = useMemo(() =>
    satisfaction.filter(e => filters.batch === 'All' || getBatch(e) === filters.batch),
    [satisfaction, filters.batch]
  );

  const employeeMap = useMemo(() => {
    const map = {};
    employees.forEach(e => { if (e.email) map[e.email.toLowerCase()] = e; });
    return map;
  }, [employees]);

  const isLoading = !(loaded.a && loaded.s);

  // Early returns AFTER all hooks
  if (user === undefined) return (
    <div className="login-bg">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-glow-orange" aria-hidden="true" />
      <div className="login-glow-blue"   aria-hidden="true" />
      <div className="login-card">
        <div className="login-logo">
          <img src={FRESHKET_LOGO} alt="Freshket" className="login-logo-img" />
        </div>
        <p className="login-sub" style={{ marginBottom: 0 }}>กำลังโหลด...</p>
      </div>
    </div>
  );
  if (!user) return <LoginPage onLogin={setUser} />;

  const userName = user.displayName || user.email?.split('@')[0] || '';

  return (
    <div className="app-root">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">VI</div>
          <div>
            <div className="sidebar-brand-name">HRD Tracking</div>
            <div className="sidebar-brand-sub">Dashboard</div>
          </div>
        </div>


        {/* Nav */}
        <nav className="sidebar-nav">
          {/* Training Record */}
          <div className="sidebar-nav-label">RECORD</div>
          <button
            className={`sidebar-nav-item${activeSection === 'training-record' ? ' active' : ''}`}
            onClick={() => setActiveSection('training-record')}
          >
            <FileText size={16} /><span>Training Record</span>
          </button>

          {/* Management group */}
          <div className="sidebar-nav-label" style={{ marginTop: 16 }}>MANAGEMENT</div>
          <button
            className={`sidebar-nav-item sidebar-nav-item--sub${activeSection === 'course-library' ? ' active' : ''}`}
            onClick={() => setActiveSection('course-library')}
          >
            <BookMarked size={16} /><span>Course Library</span>
          </button>

          {/* Satisfaction group */}
          <div className="sidebar-nav-label" style={{ marginTop: 16 }}>SATISFACTION</div>
          <button
            className={`sidebar-nav-item sidebar-nav-item--sub${activeSection === 'training-class' ? ' active' : ''}`}
            onClick={() => setActiveSection('training-class')}
          >
            <BookOpen size={16} /><span>Training Class</span>
          </button>
          <button
            className={`sidebar-nav-item sidebar-nav-item--sub${activeSection === 'townhall' ? ' active' : ''}`}
            onClick={() => setActiveSection('townhall')}
          >
            <Calendar size={16} /><span>Townhall</span>
          </button>
          <button
            className={`sidebar-nav-item sidebar-nav-item--sub${activeSection === 'visit-iyr' ? ' active' : ''}`}
            onClick={() => { setActiveSection('visit-iyr'); setActiveTab('overview'); }}
          >
            <BarChart3 size={16} /><span>Visit IYR</span>
          </button>

          {/* Assessment group */}
          <div className="sidebar-nav-label" style={{ marginTop: 16 }}>ASSESSMENT</div>
          <button
            className={`sidebar-nav-item sidebar-nav-item--sub${activeSection === 'assessment-data' ? ' active' : ''}`}
            onClick={() => setActiveSection('assessment-data')}
          >
            <GraduationCap size={16} /><span>Assessment Data</span>
          </button>

          {/* DSD / Compliance group */}
          <div className="sidebar-nav-label" style={{ marginTop: 16 }}>COMPLIANCE</div>
          <button
            className={`sidebar-nav-item sidebar-nav-item--sub${activeSection === 'dsd' ? ' active' : ''}`}
            onClick={() => setActiveSection('dsd')}
          >
            <Building2 size={16} /><span>งาน DSD</span>
          </button>
        </nav>

        {/* Theme */}
        <div className="sidebar-theme">
          <button className={`sidebar-theme-btn${theme === 'light' ? ' active' : ''}`} onClick={() => { document.documentElement.removeAttribute('data-theme'); setTheme('light'); }}>
            ☀ Light
          </button>
          <button className={`sidebar-theme-btn${theme === 'dark' ? ' active' : ''}`} onClick={() => { document.documentElement.setAttribute('data-theme','dark'); setTheme('dark'); }}>
            ☾ Dark
          </button>
        </div>

        {/* User */}
        <div className="sidebar-user">
          <img src={user.photoURL || ''} alt="" referrerPolicy="no-referrer" className="sidebar-user-avatar" />
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{userName}</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          {isAdmin && <span className="admin-pill" style={{ marginLeft: 'auto' }}>Admin</span>}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="app-main">
        {/* Top bar */}
        <div className="app-header">
          <div className="app-header-left">
            <h1>{{
              'training-record':  'Training Record',
              'course-library':   'Course Library',
              'training-class':   'Training Class',
              'townhall':         'Townhall',
              'visit-iyr':        'Visit IYR',
              'assessment-data':  'Assessment Data',
              'dsd':              'ส่งเอกสารกรมพัฒนาฝีมือแรงงาน (DSD)',
            }[activeSection]}</h1>
            <p>{{
              'training-record':  'HRD Tracking · ประวัติการอบรม',
              'course-library':   'HRD Tracking · จัดการหลักสูตรทั้งหมด',
              'training-class':   'HRD Tracking · ความพึงพอใจ Training Class',
              'townhall':         'HRD Tracking · ผลประเมินความพึงพอใจ Townhall · Real-time',
              'visit-iyr':        'HRD Tracking · รายงานผลประเมินและความพึงพอใจแบบ Real-time',
              'assessment-data':  'HRD Tracking · ข้อมูลผลการประเมิน Pre/Post Test · Admin Upload CSV',
              'dsd':              'จัดการหลักฐานรูปภาพและใบลงชื่อเพื่อขอรับสิทธิ์ประโยชน์',
            }[activeSection]}</p>
          </div>
          <div className="header-right">
            <div className="header-badge">
              <div className="live-dot" />
              <span>Live · Firestore</span>
            </div>
            <button className="signout-btn" onClick={() => signOut(auth)} title="ออกจากระบบ"
              style={{ display:'flex', alignItems:'center', gap: 6, padding: '6px 12px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface)', fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              ↩ ออกจากระบบ
            </button>
          </div>
        </div>

        {/* Visit IYR: filters + sub-tabs */}
        {isVisitIYR && (
          <>
            <div className="filters-bar">
              <div className="filter-group">
                <label>Batch</label>
                <select value={filters.batch} onChange={e => setFilters(p => ({...p, batch: e.target.value}))}>
                  {batchOptions.map(k => <option key={k} value={k}>{k === 'All' ? 'ทุก Batch' : fmtBatch(k)}</option>)}
                </select>
              </div>
            </div>
            <div className="tab-bar">
              {[
                { id:'overview',     label:'Overview',     icon: <BarChart3 size={14} /> },
                { id:'assessment',   label:'Assessment',   icon: <FileText size={14} />  },
                { id:'satisfaction', label:'Satisfaction', icon: <Heart size={14} />     },
              ].map(t => (
                <button key={t.id} className={`tab-btn${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Section content */}
        {activeSection === 'training-record'  && <TrainingRecord />}
        {activeSection === 'course-library'   && <CourseLibrary />}
        {activeSection === 'training-class'   && <UnderDevPage title="Training Class Satisfaction" icon={<BookOpen size={40} />} />}
        {activeSection === 'assessment-data'  && <AssessmentPage isAdmin={isAdmin} />}
        {activeSection === 'dsd'              && <DSDPage user={user} isAdmin={isAdmin} />}
        {activeSection === 'townhall'        && <TownhallTab rawData={townhallData} registrations={registrations} isLoading={!townhallLoaded} isAdmin={isAdmin} />}
        {isVisitIYR && activeTab === 'overview'     && <OverviewTab     assessments={filteredA} satisfaction={filteredS} isLoading={isLoading} error={error} />}
        {isVisitIYR && activeTab === 'assessment'   && <AssessmentTab   assessments={filteredA} isLoading={isLoading} error={error} employeeMap={employeeMap} />}
        {isVisitIYR && activeTab === 'satisfaction' && <SatisfactionTab satisfaction={filteredS} isLoading={isLoading} error={error} isAdmin={isAdmin} currentBatch={filters.batch} />}
      </div>
    </div>
  );
}

export default App;


