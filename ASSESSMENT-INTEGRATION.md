# Assessment defaults and exam workflow

## Deployment and backfill

Back up the database and test deployment on a copy first. No migration has been run by this change. From `backend`, run `npm run migrate:assessment` against the intended database, then start the updated backend. The script uses the existing `.env`; never paste its contents into logs or documentation. Startup also applies this same idempotent column upgrade before the existing schema sync. The standalone upgrade handles existing tables; regular startup creates missing tables on a fresh database.

The migration only adds columns, never drops/replaces records or calls `sync({alter:true})` / `sync({force:true})`. MySQL DDL implicitly commits; a failed run can be safely retried. Roll back application code while retaining the added columns rather than dropping scores/audits. Back up new assessment data before any eventual column removal.

Existing subjects receive nullable `theoryMaxMarks`, `practicalMaxMarks`, `monthlyAssessmentMaxMarks`, and `passMark`, plus `hasMonthlyAssessment=false`. There is **no inferred allocation**. An administrator must explicitly set complete defaults using `PUT /api/subjects/:id`. Unrelated edits to legacy subjects remain possible before allocation. New subject creation requires complete enabled maxima and pass mark. General subjects always enable theory and disable practical; Core subjects enable both. Monthly assessment defaults to false. Numeric strings are accepted, but blanks, booleans, arrays, non-finite and negative numbers cannot be used as enabled maxima/scores. Pass mark is an absolute mark, not a percentage. Fields retain the existing `DECIMAL(8,2)` storage convention.

Existing exam-subject snapshots receive `hasMonthlyAssessment=false` and `monthlyAssessmentMaxMarks=0`. Student marks and audit monthly fields are nullable. Existing theory/practical allocations, totals, result summaries, dates and publications are unchanged by migration. Changing subject defaults never updates snapshots. Existing legacy-result and temporary-annual import systems remain separate and unchanged.

Preparing an exam for a legacy subject without defaults requires explicit maxima/pass mark overrides. Editing an existing Draft configuration merges omitted fields from its snapshot, not from newly changed subject defaults. Theory/practical flags retain the selected subject's flags on creation and the snapshot's flags on updates; monthly enablement can be overridden independently. A disabled monthly maximum may be retained for later review, but never contributes to total maximum.

## API integration

Use the existing `Authorization: Bearer <token>` header and JSON content type. Exam writes, manual marks, Excel imports, readiness, calculation and publication retain `SuperAdmin`/`ExamManager` authorization. No teacher or AttendanceTaker exam permission has been added. Existing global portal/department restrictions remain authoritative: in particular, the current global middleware blocks HeadDepartment accounts from exam resources even where a route's local role list includes them. Teacher assignments do not grant exam-mark entry in this codebase.

Example subject request (replace identifiers with actual records):

```http
POST /api/subjects
Content-Type: application/json

{"name":"Science","code":"SCI","subjectType":"Core","departmentId":4,"theoryMaxMarks":60,"practicalMaxMarks":30,"hasMonthlyAssessment":true,"monthlyAssessmentMaxMarks":30,"passMark":60,"isActive":true}
```

Success is HTTP 201 with the existing `{ "message": "Subject created successfully", "data": <subject> }` envelope. `data` includes the supplied fields, enforced `hasTheory=true`/`hasPractical=true`, IDs and timestamps. Sequelize decimal fields may be serialized as strings. `PUT /api/subjects/3` accepts the same default fields as partial updates merged with the existing subject. A General subject uses `departmentId:null`, positive theory maximum and `practicalMaxMarks:0`.

### 1. Create Exam

```http
POST /api/exams
Content-Type: application/json

{"academicYearId":7,"termId":8,"name":"Term exam","examType":"Final","startDate":"2026-10-20","endDate":"2026-10-25"}
```

HTTP 201: `{ "message": "Exam created successfully", "data": <exam> }`. The server always creates `status:"Draft"`, `resultsPublished:false`. Exam types remain `ContinuousAssessment`, `Midterm`, `Final`, `Supplementary`, `Other`.

### 2. Prepare Subjects and Open

```http
POST /api/exams/1/subjects
Content-Type: application/json

{"classId":2,"subjectId":3}
```

HTTP 201: `{ "message": "Exam subject configured successfully", "data": <configuration> }`. The example above snapshots theory 60, practical 30, monthly 30, total 120, pass mark 60. Existing populated exam/class/subject/department references remain populated in responses. Use `GET /api/exams/1/subjects` to review `{ "count": 1, "data": [...] }`.

Equivalent standalone creation remains `POST /api/exam-subjects` with `examId` in the body. Override maxima/pass mark in either create request. For a Draft snapshot with ID 9:

```http
PUT /api/exam-subjects/9
Content-Type: application/json

{"hasMonthlyAssessment":false}
```

HTTP 200: `{ "message": "Exam subject updated successfully", "data": <configuration> }`. Its total becomes 90; its stored monthly maximum can remain 30. Re-enable using `{"hasMonthlyAssessment":true,"monthlyAssessmentMaxMarks":30}`. Updates/deletions outside Draft return 409.

```http
PATCH /api/exams/1/status
Content-Type: application/json

{"status":"Open"}
```

HTTP 200: `{ "message": "Exam status changed to Open", "data": <exam> }`. Opening Draft requires at least one valid active configuration. No second workflow status is persisted.

### 3. Enter Marks

`GET /api/exam-marks/entry-sheet?examId=1&classId=2&subjectId=3` retains `{exam,class,subject,configuration,count,students}`. Configuration now includes monthly enablement/maximum; each student's `mark` includes `monthlyAssessmentMark`. `GET /api/exam-marks?examId=1&classId=2` retains `{count,data}` and adds `configuration` beside each mark's existing `student` and `subject`.

With monthly enabled:

```http
POST /api/exam-marks/manual
Content-Type: application/json

{"examId":1,"classId":2,"subjectId":3,"marks":[{"studentId":5,"theoryMark":30,"practicalMark":15,"monthlyAssessmentMark":15,"markStatus":"Present"}]}
```

For a new row, exact HTTP 200 response:

```json
{"message":"Marks saved successfully","summary":{"total":1,"created":1,"updated":0,"unchanged":0}}
```

The stored total is 60/120 = 50%, Pass at pass mark 60. `monthlyAssessmentMark:0` is valid; omission/null/blank is invalid when enabled. With monthly disabled, omit it or send null; any supplied numeric score (including zero) is rejected with HTTP 422. Example response:

```json
{"message":"One or more marks are invalid","errors":[{"index":0,"studentId":5,"message":"monthlyAssessmentMark cannot be supplied when hasMonthlyAssessment is disabled"}]}
```

For Absent/Exempted, send `{"studentId":5,"markStatus":"Absent"}` with all numeric marks omitted/null. Numeric marks on disabled components are also rejected. Old clients that omit monthly fields continue to work for monthly-disabled snapshots. A manual request saves one subject; no class-wide manual endpoint existed, so class-wide entry remains Excel or separate subject requests.

Correct an existing mark using `PUT /api/exam-marks/44` with `{"monthlyAssessmentMark":18,"reason":"Verified consolidated term score"}`. Omitted component fields retain current values. The HTTP 200 envelope remains `{message,data}`. Audit entries at `GET /api/exam-marks/44/history` now include `oldMonthlyAssessmentMark` and `newMonthlyAssessmentMark` alongside existing theory/practical/total/reason/editor fields. Existing default reasons remain `Manual correction`, `Excel re-import`, and `All subjects Excel re-import`. No monthly averaging, summing, or per-month records have been introduced.

### 4. Review, Calculate, Publish

Call `POST /api/results/calculate` with `{"examId":1,"classId":2}` for each class. Its existing response contains `message`, `exam`, `class`, count `summary`, and student summaries in `data`. Enabled maxima drive percentages; grading scales, two-decimal percentages, competition ranking, absence failure and exemption denominator policies remain intact. Invalid Present components yield an incomplete result. Published exams must be unpublished before recalculation/correction.

New minimal check: `GET /api/exams/1/readiness`, available to the existing exam-manager roles while Open. A successful example response is exactly:

```json
{"data":{"examId":1,"status":"Open","readyToPublish":true,"classes":1,"errors":[]}}
```

The same endpoint returns HTTP 200 with `readyToPublish:false` and class/student/subject errors for missing or invalid marks, inconsistent stored totals, incomplete/missing summaries, or summaries older than mark/configuration updates. Outside Open it returns 409. Existing entry sheets provide Draft preparation data. Publication uses the same checks. A mark correction changes `updatedAt`, so summaries must be recalculated using the existing timestamp-based stale-result mechanism.

Explicitly confirm publication in the frontend, then call `PATCH /api/exams/1/publish` (no body required). For a single class, HTTP 200 is exactly:

```json
{"message":"Exam results published successfully","summary":{"examId":1,"classes":1}}
```

Problems return HTTP 422 with `{message,errors}`. Generic status changes cannot publish or bypass the dedicated unpublish action. Use `PATCH /api/exams/1/unpublish` before corrections, then save, recalculate and explicitly publish again.

## Excel changes

- Single-subject template version is `1.1`. `Monthly Assessment (Max N)` appears after Practical (or Theory if Practical is disabled) and before Total, only when enabled. It is unlocked with decimal range validation. Total's formula includes it; blank input remains blank/missing, never zero.
- Single-subject hidden metadata adds `Has Theory`, `Has Practical`, `Has Monthly Assessment`, `Monthly Assessment Maximum`. Existing maxima/total/pass mark are checked against the live snapshot; component headings are checked too.
- Class template version is `CLASS-1.2`. Each enabled subject block gains `Monthly Assessment (Max N)` before Total. Hidden `Subject Configuration` appends columns 14–16: `Has Monthly Assessment`, `Monthly Assessment Maximum`, `Monthly Assessment Column`. Existing columns 1–13 retain their meaning. Column positions, flags, maxima, totals, names, codes and identities are validated.
- Old `1.0` / `CLASS-1.1` workbooks remain accepted for compatible monthly-disabled configurations. Download a new workbook if configuration/layout changes. Student identifiers, hidden metadata sheets, worksheet protections and locked totals remain in use.
- Paths are unchanged: `GET /api/exam-marks/template?examId=1&classId=2&subjectId=3`, `GET /api/exam-marks/class-template?examId=1&classId=2`; multipart field `file` at `POST /api/exam-marks/import/preview`, `/import/confirm`, `/class-import/preview`, `/class-import/confirm`. Confirmation reparses and revalidates the uploaded file with the same functions as preview; it does not trust a prior preview response. Invalid files cause no writes. Valid writes and correction audits use one transaction per workbook.
- Class workbooks retain their existing Present-only convention; use manual entry for Absent/Exempted. Preview rows/configuration expose monthly values. Single preview/confirmation envelopes remain unchanged; added monthly fields are additive.
- Student PDF reports now include a Monthly Assessment column; class summaries and reports consume updated stored totals.

## Modified files and verification

`config/mysql.js`, `config/assessmentMigration.js`, `config/db.js`, and `scripts/migrateAssessment.js` define and upgrade assessment fields. Subject/exam-subject controllers validate defaults and snapshots. `examMarks/services/assessment.js` supplies shared component validation/calculation; manual/Excel services and controllers carry scores and audit fields. Both template controllers include monthly columns/metadata. Result calculation/publication services validate completeness; exam controllers/routes provide readiness and lifecycle guards. The report controller displays the new component. `package.json` adds test/migration commands; `tests/assessment.test.js` covers the new behavior.

Run `npm test` in `backend`. Final result: **21 tests passed, zero failures**; syntax checks parsed all **107 JavaScript files** in `src` and `tests`. Tests use generated/read ExcelJS workbooks and mocked persistence/transactions: defaults, snapshots, legacy compatibility, score validation, correction audit fields, import rejection/rollback behavior, percentages/grades/ranking, stale publication blocking, auth/role/department gates, decimal totals, and migration idempotency. These are not live MySQL rollback, migration or HTTP end-to-end tests. No frontend was changed, no database migration was executed, and no real report rendering or production concurrency/load test was performed. The existing timestamp stale mechanism and existing transaction/concurrency architecture are retained; this change does not introduce a new locking protocol for simultaneous saves/configuration edits/publication. Test deployment on a database copy and review an actual exported PDF before production rollout.
