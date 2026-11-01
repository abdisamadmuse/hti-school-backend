const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");
const service = require("../src/modules/dashboard/dashboardService");

test("dashboard filters validate dates, sessions and Saturday weeks; restrict department reviewers", () => {
  const user = { role: "SuperAdmin" };
  const result = service.filtersFor(user, { date: "2026-10-31", academicYearId: "2" });
  assert.equal(result.weekStart, "2026-10-31");
  assert.equal(result.filters.academicYearId, 2);
  assert.equal(service.filtersFor(user, { date: "2026-11-04" }).weekStart, "2026-10-31");
  for (const query of [{ date: "2026-02-30" }, { session: "all" }, { trendSession: "bad" }, { academicYearId: "x" }, { departmentId: "0" }, { weekStart: "2026-11-01" }]) assert.throws(() => service.filtersFor(user, query), { status: 400 });
  for (const role of ["AttendanceTaker", "Teacher", "ExamManager"]) assert.throws(() => service.filtersFor({ role }, {}), { status: 403 });
  const head = { role: "HeadDepartment", departmentIds: '[5,6]' };
  assert.deepEqual(service.filtersFor(head, {}).filters.departmentId[Op.in], [5, 6]);
  assert.equal(service.filtersFor(head, { departmentId: "6" }).filters.departmentId, 6);
  assert.throws(() => service.filtersFor(head, { departmentId: "7" }), { status: 403 });
  assert.throws(() => service.filtersFor({ role: "HeadDepartment" }, {}), { status: 403 });
});

test("dashboard student counts reconcile across programs, gender, departments and classes", () => {
  const result = service.studentSummary([
    { programId: 1, departmentId: 5, classId: 10, gender: "Male", count: "12" },
    { programId: 1, departmentId: 5, classId: 10, gender: "Female", count: "8" },
    { programId: 2, departmentId: 6, classId: 11, gender: "Female", count: "5" },
    { programId: 99, departmentId: 6, classId: 11, gender: "Male", count: "2" },
  ], [{ id: 1, name: "Vocational" }, { id: 2, name: "Secondary" }], [{ id: 5, name: "ICT" }, { id: 6, name: "Business" }, { id: 7, name: "Empty" }], [{ id: 10, name: "Form 1", departmentId: 5 }, { id: 11, name: "Form 2", departmentId: 6 }]);
  assert.equal(result.students.total, 27);
  assert.deepEqual(result.students.vocational, { total: 20, male: 12, female: 8 });
  assert.equal(result.students.secondary.total, 5);
  assert.equal(result.students.other.total, 2);
  assert.equal(result.students.male + result.students.female, 27);
  assert.equal(result.departments.reduce((n, d) => n + d.total, 0), 27);
  assert.equal(result.departments[0].classes[0].total, 20);
  assert.equal(result.departments[2].total, 0);
});

test("attendance denominator includes Permission and Late; dates and sessions stay separate", () => {
  const rows = [
    { date: "2026-10-31", session: "BeforeBreak", status: "Present", count: "8" },
    { date: "2026-10-31", session: "BeforeBreak", status: "Permission", count: "1" },
    { date: "2026-10-31", session: "BeforeBreak", status: "Late", count: "1" },
    { date: "2026-10-31", session: "AfterBreak", status: "Absent", count: "100" },
  ];
  const result = service.attendanceSummary(rows, "2026-10-31", "BeforeBreak");
  assert.equal(result.recorded, 10);
  assert.equal(result.presentPercentage, 80);
  assert.equal(result.counts.Absent, 0);
  const empty = service.attendanceSummary(rows, "2026-11-01", "BeforeBreak");
  assert.equal(empty.presentPercentage, null);
  assert.equal(empty.hasData, false);
  assert.equal(empty.counts.Absent, 0);
});

test("Free is recorded and counted in the legend but excluded from the attendance rate", () => {
  const rows = [{ date: "2026-10-31", session: "BeforeBreak", status: "Present", count: 8 }, { date: "2026-10-31", session: "BeforeBreak", status: "Absent", count: 2 }, { date: "2026-10-31", session: "BeforeBreak", status: "Free", count: 10 }];
  const result = service.attendanceSummary(rows, "2026-10-31", "BeforeBreak");
  assert.equal(result.recorded, 20);
  assert.equal(result.eligible, 10);
  assert.equal(result.counts.Free, 10);
  assert.equal(result.presentPercentage, 80);
  assert.equal(result.percentages.Free, 50);
  const freeOnly = service.attendanceSummary(rows.slice(2), "2026-10-31", "BeforeBreak");
  assert.equal(freeOnly.hasData, true);
  assert.equal(freeOnly.presentPercentage, null);
});
