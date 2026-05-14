# CLAUDE.md — Visit IYR Analytics Dashboard

## Role
You are a full-stack developer on this project. Read and apply all context below before responding.

---

## Project Overview
Real-time analytics dashboard for **Visit IYR Tour** — replaces manual Google Sheets with a live Firestore-powered dashboard.

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | React 18, Recharts, custom CSS (no Tailwind — pure CSS in `src/styles.css`) |
| Database | Cloud Firestore — Project ID: `visit-iyr-report` |
| Data sync | Google Apps Script (GAS) — Google Sheets → Firestore every 15 min |
| Build tool | Vite 5 + `@vitejs/plugin-react` |

## Data Flow
Google Sheets → GAS (MD5 hash dedup) → Firestore → React `onSnapshot` → UI

---

## Firestore Schema

### Collection: `assessment`
| Field | Type | Notes |
|---|---|---|
| `email_address` | string | unique per participant |
| `score_value` | number | parsed from "9 / 10" |
| `score_max` | number | usually 10 |
| `type` | double | original from sheet (1=pre, 2=post) — use `test_type` instead |
| `test_type` | string | `'pre'` or `'post'` — derived by GAS, use this for filtering |
| `score` | number | raw score from sheet (e.g. 10) |
| `score_value` | number | parsed score — use `score_value ?? score` |
| `score_max` | number | max score, default 10 |
| `score_percent` | number | 0–100 |
| `is_passed` | boolean | score_percent >= 70% |
| `batch` | string | `YYYY-MM` from form timestamp — added in GAS v2.3 |
| `timestamp` | timestamp | Google Forms submission time |
| `_synced_at` | timestamp | GAS sync time |
| quiz fields | string | all quiz answers as Thai snake_case keys |

**No `email_address` field — use `email` (normalized lowercase)**

### Collection: `satisfaction`
| Field | Type | Notes |
|---|---|---|
| `department` | string | respondent's department |
| `expertise` | number | rating 1–5 |
| `overall_vibe` | number | rating 1–5 |
| `bite_sized_learning` | number | rating 1–5 (underscore, not hyphen) |
| `confidence_boost` | number | rating 1–5 |
| `coordination_support` | number | rating 1–5 (no `&` in key) |
| `operational_empathy` | number | rating 1–5 |
| `new_insight` | string | open-ended text |
| `one_thing_to_change` | string | open-ended text / improvement suggestion |
| `timestamp` | timestamp | Google Forms submission time |
| `batch` | string | YYYY-MM derived by GAS |
| `_synced_at` | timestamp | GAS sync time |

**No email, no logistics field. No text in rating fields — all numeric.**

---

## Coding Standards
- **Components**: Functional only, React Hooks (`useState`, `useEffect`, `useMemo`)
- **Styling**: Plain CSS in `src/styles.css` — class names in `kebab-case`
- **JS naming**: `camelCase` for variables/functions, `PascalCase` for components
- **DB fields**: `snake_case`
- **Real-time data**: always use Firestore `onSnapshot`, never one-time `getDocs`
- **No unnecessary abstractions** — keep components flat unless reuse is obvious
- **No TypeScript** — plain JSX

## Key Files
| File | Purpose |
|---|---|
| `src/App.jsx` | Main dashboard component |
| `src/firebase.js` | Firestore init |
| `src/styles.css` | All styling |
| `src/main.jsx` | React entry point |
| `.env.local` | Firebase config (root level, not in `src/`) |
| `vite.config.js` | Vite + React plugin config |
| `context.md` | Project background (Thai) |

## Environment
- `.env.local` must be at **project root** (not inside `src/`) for Vite to read it
- All env vars prefixed with `VITE_` to expose to browser

## Known Issues / Decisions
- `src/.env.local` is a duplicate — source of truth is root `.env.local`
- `VITE_FIREBASE_APP_ID` format must be `1:SENDER_ID:web:HASH` (not raw hash)
- Firestore Security Rules: public read (`allow read: if true`), no write from client
