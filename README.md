# Visit IYR Analytics Dashboard

JavaScript + React (Vite) dashboard wired to Firestore so you can monitor the Visit IYR program in real time. It listens to the `assessment` and `satisfaction` collections, surfaces KPI cards, the learning growth chart, and satisfaction breakdowns filtered by department or date range.

## Setup
1. Copy `.env.example` to `.env.local` and paste the Firebase project settings (keys/ids) that back the Visit IYR database. Use the same Firestore collections described in the PRD to keep the analytics accurate.
2. Install dependencies: `npm install`.
3. Start dev server: `npm run dev`.

## What it shows
- KPI cards for participants, avg. post-test score, and overall satisfaction (with Firestore listeners for real-time updates).
- Learning Growth Chart comparing averaged Pre-Test vs Post-Test results.
- Satisfaction Analysis cards for Expertise, Vibe, and Logistics — all filtered by the selected department and date range.

## Deployment
Build a production bundle with `npm run build` and deploy the generated `dist/` folder to your static host. Make sure the same Firebase project is available in production via environment variables.

## Notes
- Firestore must expose the `assessment` collection with `email_address`, numeric `score_value`, `type` (`Pre Test`/`Post Test`), and `timestamp`.
- The `satisfaction` collection needs at least `department`, `expertise`, `overall_vibe`, `logistics`, and `timestamp`.
- This dashboard is styled with #00ce7c, white surfaces, and pastel tags, keeping the palette aligned with the PRD.
