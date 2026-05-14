// ── Portfolio Demo Data ───────────────────────────────────────
// Used when VITE_DEMO_MODE=true (portfolio build).
// Mirrors the Firestore schema exactly so all components work unmodified.

const d = (y, m, day) => new Date(y, m - 1, day);

// ── Employees ─────────────────────────────────────────────────
export const MOCK_EMPLOYEES = [
  { id: 'emp01', emp_id: 'FK001', email: 'alice.w@freshket.co',   name_th: 'อลิส วงศ์ดี',    name_en: 'Alice Wong',     nickname: 'Alice',  department: 'Technology',       position: 'Software Engineer' },
  { id: 'emp02', emp_id: 'FK002', email: 'bob.c@freshket.co',     name_th: 'บ็อบ เชน',        name_en: 'Bob Chen',       nickname: 'Bob',    department: 'Operations',       position: 'Operations Lead' },
  { id: 'emp03', emp_id: 'FK003', email: 'chanida.p@freshket.co', name_th: 'ชนิดา ปิยะ',     name_en: 'Chanida Piya',   nickname: 'Nida',   department: 'HR',               position: 'HR Manager' },
  { id: 'emp04', emp_id: 'FK004', email: 'daniel.k@freshket.co',  name_th: 'ดาเนียล แก้ว',   name_en: 'Daniel Kaew',    nickname: 'Dan',    department: 'Finance',          position: 'Finance Analyst' },
  { id: 'emp05', emp_id: 'FK005', email: 'emma.n@freshket.co',    name_th: 'เอมมา นิล',      name_en: 'Emma Nil',       nickname: 'Em',     department: 'Sales',            position: 'Sales Executive' },
  { id: 'emp06', emp_id: 'FK006', email: 'fahsai.t@freshket.co',  name_th: 'ฝ้าย ทอง',       name_en: 'Fahsai Thong',   nickname: 'Fahsai', department: 'Customer Success', position: 'CS Specialist' },
  { id: 'emp07', emp_id: 'FK007', email: 'george.m@freshket.co',  name_th: 'จอร์จ มี',       name_en: 'George Mi',      nickname: 'George', department: 'Technology',       position: 'Data Engineer' },
  { id: 'emp08', emp_id: 'FK008', email: 'hannah.b@freshket.co',  name_th: 'ฮันนาห์ บุญ',   name_en: 'Hannah Boon',    nickname: 'Hannah', department: 'Operations',       position: 'Logistics Coordinator' },
];

// ── Courses (dim_programs) ────────────────────────────────────
export const MOCK_COURSES = [
  { id: 'c1', course_id: 'PKE-01', name: 'Product Knowledge Essentials',      description: 'Core product knowledge for all staff',           category: 'Foundation', duration_hours: 8 },
  { id: 'c2', course_id: 'OEW-01', name: 'Operational Excellence Workshop',   description: 'Lean operations and process improvement',        category: 'Operations', duration_hours: 6 },
  { id: 'c3', course_id: 'LF-01',  name: 'Leadership Fundamentals',           description: 'Principles of effective team leadership',        category: 'Leadership', duration_hours: 12 },
  { id: 'c4', course_id: 'DDM-01', name: 'Data-Driven Decision Making',       description: 'Using data analytics for business decisions',    category: 'Analytics',  duration_hours: 8 },
  { id: 'c5', course_id: 'CSM-01', name: 'Customer Success Mastery',          description: 'Building exceptional customer relationships',    category: 'Customer',   duration_hours: 6 },
];

// ── Training Records ──────────────────────────────────────────
// Batch 2025-01 → Product Knowledge (all 8)
// Batch 2025-02 → Operational Excellence (all 8)
// Batch 2025-03 → Leadership Fundamentals (6 employees)
// Batch 2025-04 → Data-Driven Decision Making (6 employees)
// Batch 2025-05 → Customer Success Mastery (5 employees)
const TR_BASE = MOCK_EMPLOYEES.map(e => ({
  emp_id: e.emp_id, email: e.email,
  name_th: e.name_th, name_en: e.name_en, nickname: e.nickname,
  department: e.department, position: e.position,
}));

export const MOCK_TRAINING_RECORDS = [
  // Batch 2025-01 — Product Knowledge Essentials
  ...TR_BASE.map((e, i) => ({ id: `tr-pke-${i+1}`, ...e, course: 'Product Knowledge Essentials', training_date: '2025-01-15', batch: '2025-01', location: 'Bangkok HQ' })),
  // Batch 2025-02 — Operational Excellence Workshop
  ...TR_BASE.map((e, i) => ({ id: `tr-oew-${i+1}`, ...e, course: 'Operational Excellence Workshop', training_date: '2025-02-20', batch: '2025-02', location: 'Bangkok HQ' })),
  // Batch 2025-03 — Leadership Fundamentals (first 6 only)
  ...TR_BASE.slice(0, 6).map((e, i) => ({ id: `tr-lf-${i+1}`, ...e, course: 'Leadership Fundamentals', training_date: '2025-03-12', batch: '2025-03', location: 'Online' })),
  // Batch 2025-04 — Data-Driven Decision Making (first 6)
  ...TR_BASE.slice(0, 6).map((e, i) => ({ id: `tr-ddm-${i+1}`, ...e, course: 'Data-Driven Decision Making', training_date: '2025-04-08', batch: '2025-04', location: 'Online' })),
  // Batch 2025-05 — Customer Success Mastery (first 5)
  ...TR_BASE.slice(0, 5).map((e, i) => ({ id: `tr-csm-${i+1}`, ...e, course: 'Customer Success Mastery', training_date: '2025-05-06', batch: '2025-05', location: 'Bangkok HQ' })),
];

// ── Assessment Records ────────────────────────────────────────
// Helper: build a pre+post pair for one employee in one course
function asmPair(empIdx, courseSlug, courseName, scoreMax, preScore, postScore, batch, ts) {
  const emp   = MOCK_EMPLOYEES[empIdx];
  const email = emp.email;
  const prePct  = Math.round((preScore  / scoreMax) * 100);
  const postPct = Math.round((postScore / scoreMax) * 100);
  return [
    {
      id: `asmt-${courseSlug}-pre-${empIdx+1}`,
      email, course: courseName, test_type: 'pre',
      score: preScore, score_value: preScore, score_max: scoreMax,
      score_percent: prePct,
      is_passed: prePct >= 80,
      batch,
      timestamp: new Date(ts.getTime() - 7 * 24 * 60 * 60 * 1000), // 1 week before post
    },
    {
      id: `asmt-${courseSlug}-post-${empIdx+1}`,
      email, course: courseName, test_type: 'post',
      score: postScore, score_value: postScore, score_max: scoreMax,
      score_percent: postPct,
      is_passed: postPct >= 80,
      batch,
      timestamp: ts,
    },
  ];
}

// Product Knowledge Essentials — score_max=10, batch=2025-01
const PKE_SCORES = [[6,9],[5,8],[7,9],[6,8],[5,9],[6,8],[7,10],[6,9]];
const pkeTs = d(2025,1,15);

// Operational Excellence — score_max=10, batch=2025-02
const OEW_SCORES = [[5,8],[6,9],[5,8],[7,9],[6,8],[5,8],[6,9],[7,8]];
const oewTs = d(2025,2,20);

// Leadership Fundamentals — score_max=15, batch=2025-03, 6 employees
const LF_SCORES = [[9,13],[10,14],[8,12],[9,13],[10,13],[9,14]];
const lfTs = d(2025,3,12);

// Data-Driven Decision Making — score_max=15, batch=2025-04, 6 employees
const DDM_SCORES = [[8,12],[9,13],[9,12],[10,14],[8,11],[9,13]]; // Emma gets 11/15 = 73% (fail)
const ddmTs = d(2025,4,8);

// Customer Success Mastery — score_max=10, batch=2025-05, 5 employees
const CSM_SCORES = [[6,9],[7,9],[6,8],[5,8],[7,10]];
const csmTs = d(2025,5,6);

export const MOCK_ASSESSMENTS = [
  ...PKE_SCORES.flatMap(([pre,post], i) => asmPair(i, 'pke', 'Product Knowledge Essentials',    10, pre, post, '2025-01', pkeTs)),
  ...OEW_SCORES.flatMap(([pre,post], i) => asmPair(i, 'oew', 'Operational Excellence Workshop', 10, pre, post, '2025-02', oewTs)),
  ...LF_SCORES.flatMap( ([pre,post], i) => asmPair(i, 'lf',  'Leadership Fundamentals',         15, pre, post, '2025-03', lfTs)),
  ...DDM_SCORES.flatMap(([pre,post], i) => asmPair(i, 'ddm', 'Data-Driven Decision Making',     15, pre, post, '2025-04', ddmTs)),
  ...CSM_SCORES.flatMap(([pre,post], i) => asmPair(i, 'csm', 'Customer Success Mastery',        10, pre, post, '2025-05', csmTs)),
];

// ── Satisfaction Surveys ──────────────────────────────────────
const SAT_INSIGHTS = [
  'ได้เรียนรู้ process จากทีม Ops มากขึ้น เข้าใจ pain point ของเพื่อนร่วมงาน',
  'ชอบ format ที่ให้ทุก department มาเจอกัน ทำให้เห็นภาพรวมมากขึ้น',
  'ได้เทคนิค presentation ใหม่ที่ไม่เคยรู้มาก่อน',
  'เข้าใจ customer journey ดีขึ้นมาก ทำให้ support ได้ตรงจุดกว่าเดิม',
  'เรียนรู้วิธีใช้ data ในการตัดสินใจ แทนการใช้ feeling อย่างเดียว',
  'ได้ framework การ coach ทีมที่ structured มาก นำไปใช้ได้ทันที',
  'เนื้อหาเกี่ยวกับ product ทำให้ตอบ customer ได้ถูกต้องขึ้น',
  'วิทยากรอธิบายด้วยตัวอย่างจริงจาก business ทำให้เข้าใจง่ายมาก',
];
const SAT_CHANGES = [
  'อยากให้มี workshop แบบ hands-on มากกว่า lecture',
  'ควรมีเอกสาร summary ส่งหลัง training เพื่อ review ได้',
  'อยากให้จัดบ่อยขึ้น เช่น ทุก 2 เดือน',
  'เวลา break สั้นไปเล็กน้อย',
  'อยากให้มี follow-up session หลัง 1 เดือน',
  'อยากให้มี case study จาก Freshket โดยตรง',
  'ระยะเวลาแต่ละ session อยากให้สั้นลงสักครึ่งชั่วโมง',
  'อยากให้มี Q&A session เพิ่มเติม',
];

function satRecord(id, dept, scores, batch, insightIdx, changeIdx) {
  return {
    id,
    department: dept,
    expertise:            scores[0],
    overall_vibe:         scores[1],
    bite_sized_learning:  scores[2],
    confidence_boost:     scores[3],
    coordination_support: scores[4],
    operational_empathy:  scores[5],
    new_insight:        SAT_INSIGHTS[insightIdx % SAT_INSIGHTS.length],
    one_thing_to_change: SAT_CHANGES[changeIdx  % SAT_CHANGES.length],
    batch,
    timestamp: d(2025, parseInt(batch.split('-')[1]), 20),
  };
}

export const MOCK_SATISFACTION = [
  satRecord('sat01', 'Technology',       [5,5,4,4,4,5], '2025-01', 0, 0),
  satRecord('sat02', 'Operations',       [4,4,5,4,3,4], '2025-01', 1, 1),
  satRecord('sat03', 'HR',               [5,5,4,5,4,5], '2025-01', 2, 2),
  satRecord('sat04', 'Finance',          [4,4,4,4,4,4], '2025-01', 3, 3),
  satRecord('sat05', 'Sales',            [4,5,5,4,4,4], '2025-01', 4, 4),
  satRecord('sat06', 'Customer Success', [5,5,5,5,4,5], '2025-01', 5, 5),
  satRecord('sat07', 'Technology',       [4,4,4,3,4,4], '2025-02', 6, 6),
  satRecord('sat08', 'Operations',       [5,5,4,4,4,5], '2025-02', 7, 7),
  satRecord('sat09', 'HR',               [4,4,5,4,4,4], '2025-02', 0, 0),
  satRecord('sat10', 'Finance',          [5,5,4,5,4,5], '2025-02', 1, 1),
  satRecord('sat11', 'Sales',            [4,4,4,4,3,4], '2025-02', 2, 2),
  satRecord('sat12', 'Customer Success', [5,5,5,4,4,5], '2025-02', 3, 3),
  satRecord('sat13', 'Technology',       [5,4,5,4,5,5], '2025-03', 4, 4),
  satRecord('sat14', 'Operations',       [4,5,4,4,4,4], '2025-03', 5, 5),
  satRecord('sat15', 'HR',               [5,5,5,5,5,5], '2025-03', 6, 6),
  satRecord('sat16', 'Sales',            [4,4,4,3,4,4], '2025-04', 7, 7),
  satRecord('sat17', 'Customer Success', [5,5,5,5,4,5], '2025-04', 0, 0),
  satRecord('sat18', 'Technology',       [4,4,4,4,4,4], '2025-04', 1, 1),
  satRecord('sat19', 'Finance',          [5,5,4,4,4,5], '2025-05', 2, 2),
  satRecord('sat20', 'Operations',       [4,4,5,4,5,4], '2025-05', 3, 3),
];

// ── Townhall Satisfaction ─────────────────────────────────────
const TH_IMPRESSED = [
  'ชอบที่ CEO มาพูดคุยตรงๆ ทำให้รู้สึกว่าผู้บริหารใกล้ชิดทีม',
  'Format สดใหม่ มีกิจกรรม interactive ตลอด ไม่น่าเบื่อ',
  'การ update เรื่อง product roadmap ช่วยให้เข้าใจทิศทางบริษัทชัดขึ้น',
  'ประทับใจที่ทีมต่างๆ มาแชร์ผลงาน ทำให้เห็น cross-functional collaboration',
  'บรรยากาศดี ทุกคน engage ตลอดงาน',
  'การ Q&A แบบ anonymous ทำให้กล้าถามมากขึ้น',
  'อยากให้ทำแบบนี้ทุกไตรมาส เพราะได้ข้อมูลที่ไม่ได้รับในชีวิตประจำวัน',
];
const TH_IMPROVE = [
  'เพิ่ม breakout room ให้แต่ละทีมได้คุยกัน',
  'อยากให้มีช่วง networking meal ก่อนหรือหลังงาน',
  'ควรส่ง agenda ล่วงหน้ามากกว่านี้',
  'เพิ่มเวลา Q&A อีกสัก 15 นาที',
  'อยากให้ share recording หลังงาน',
  'ลอง hybrid format สำหรับทีมต่างจังหวัด',
];
const TH_DEPTS = ['Technology', 'Operations', 'HR', 'Finance', 'Sales', 'Customer Success', 'Marketing', 'Product'];
const TH_OVERALL  = [4,5,4,5,4,4,5,4,5,4,4,5,4,5,4,4,5,4,4,5,4,5,4,4,5];
const TH_ENGAGED  = [4,4,5,4,4,5,4,5,4,4,5,4,5,4,4,5,4,5,3,4,5,4,4,5,4];
const TH_CONTENT  = [4,5,4,5,4,4,5,4,5,4,4,5,4,5,4,4,5,4,5,4,4,5,4,4,5];

export const MOCK_TOWNHALL_SAT = Array.from({ length: 25 }, (_, i) => ({
  id: `th-sat-${i+1}`,
  _eventId:   'Townhall Q1',
  Activity:   'Townhall Q1',
  Department: TH_DEPTS[i % TH_DEPTS.length],
  'โดยรวมแล้วคุณพึงพอใจกับ Town Hall ครั้งนี้แค่ไหน?':               TH_OVERALL[i],
  'กิจกรรม/บรรยากาศวันนี้ทำให้คุณรู้สึกมีพลัง (Engaged) หรือไม่?':   TH_ENGAGED[i],
  'เนื้อหาที่นำมาแชร์ในวันนี้มีประโยชน์และชัดเจนสำหรับคุณมากน้อยเพียงใด?': TH_CONTENT[i],
  'Townhall ครั้งนี้มีอะไรที่คุณประทับใจ หรืออยากให้เราทำต่อไปอีก?':   TH_IMPRESSED[i % TH_IMPRESSED.length],
  'เพื่อให้การจัดงานดีขึ้นในครั้งหน้า คุณอยากเห็นสิ่งใดใน Townhall ครั้งถัดไป': TH_IMPROVE[i % TH_IMPROVE.length],
  timestamp: d(2025, 3, 28),
}));

export const MOCK_TOWNHALL_REG = Array.from({ length: 30 }, (_, i) => ({
  id:       `th-reg-${i+1}`,
  _eventId: 'Townhall Q1',
  Activity: 'Townhall Q1',
  Department: TH_DEPTS[i % TH_DEPTS.length],
  Name:     `Employee ${i + 1}`,
  timestamp: d(2025, 3, 20),
}));
