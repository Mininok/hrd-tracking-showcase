Project Context: Visit IYR Analytics Dashboard

1. Project Overview

ระบบ Dashboard สำหรับวิเคราะห์ผลการเรียนรู้และความพึงพอใจของโครงการ Visit IYR Tour โดยเปลี่ยนจากระบบ Manual Google Sheets มาเป็น Real-time Dashboard

2. Tech Stack

Backend/Sync: Google Apps Script (GAS)

Database: Cloud Firestore (Project ID: visit-iyr-report)

Frontend: React.js, Tailwind CSS, Recharts, Lucide React

Authentication: (Planned) Google Workspace OAuth

3. Data Flow & Logic

Sync Process: Google Sheets -> GAS (every 15 mins) -> Firestore.

Idempotency: ใช้ MD5 Hash จาก Unique Fields (เช่น Email + Type + Timestamp) เพื่อสร้าง Document ID ป้องกันข้อมูลซ้ำ

Transformation:

แปลงคะแนนจากสตริง "9 / 10" เป็น score_value: 9 และ score_max: 10

Mapping Header จากคำถามยาวๆ เป็น snake_case (เช่น overall_vibe, expertise)

4. Firestore Schema

Collection: assessment

email_address (string)

score_value (number)

score_max (number)

type (string: Pre-test/Post-test)

_synced_at (timestamp)

Collection: satisfaction

department (string)

overall_vibe (number: 1-5)

expertise (number: 1-5)

_synced_at (timestamp)

5. Coding Standards & Rules

Frontend: ใช้ Functional Components และ Tailwind CSS สำหรับ Styling เท่านั้น

State Management: ใช้ React Hooks (useState, useEffect) ร่วมกับ Firestore onSnapshot สำหรับ Real-time data

Naming Convention: - JavaScript: camelCase

Database Fields: snake_case

UI/UX: เน้นความสะอาด (Clean UI), Ample whitespace, และ Mobile-responsive

6. Key Files

Code.gs: ตัวกลาง Sync ข้อมูลจาก Google Sheets ไป Firestore

Dashboard.jsx: คอมโพเนนต์หลักแสดงผลกราฟและการวิเคราะห์