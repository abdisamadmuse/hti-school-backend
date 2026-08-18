const { Op } = require("sequelize");
const {
  sequelize,
  initializeModels,
} = require("../../../config/mysql");

const VALID_MARK_STATUSES = ["Present", "Absent", "Exempted"];

const plain = (record) => (record ? record.get({ plain: true }) : null);
const optionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};
const text = (value) => String(value ?? "").trim();

const allowedDepartmentIds = (user) => {
  if (user.role !== "HeadDepartment") return null;
  return [
    ...(Array.isArray(user.departmentIds) ? user.departmentIds : []),
    user.departmentId,
  ]
    .filter(Boolean)
    .map(Number);
};

const assertDepartmentAccess = (user, departmentId) => {
  const allowed = allowedDepartmentIds(user);
  if (allowed && !allowed.includes(Number(departmentId))) {
    const error = new Error("You cannot access marks outside your department");
    error.status = 403;
    throw error;
  }
};

const loadEntryContext = async ({ examId, classId, subjectId }, user) => {
  if (!examId || !classId || !subjectId) {
    const error = new Error("examId, classId and subjectId are required");
    error.status = 400;
    throw error;
  }
  const models = initializeModels();
  const [exam, examSubject] = await Promise.all([
    models.Exam.findByPk(examId),
    models.ExamSubject.findOne({
      where: { examId, classId, subjectId, isActive: true },
    }),
  ]);
  if (!exam) {
    const error = new Error("Exam not found");
    error.status = 404;
    throw error;
  }
  if (!examSubject) {
    const error = new Error(
      "Subject is not configured for the selected exam and class"
    );
    error.status = 404;
    throw error;
  }
  assertDepartmentAccess(user, examSubject.departmentId);

  const [selectedClass, subject, students, existingMarks] = await Promise.all([
    models.Class.findByPk(classId),
    models.Subject.findByPk(subjectId),
    models.Student.findAll({
      where: {
        classId,
        academicYearId: exam.academicYearId,
        status: "Active",
        isActive: true,
      },
      order: [["fullName", "ASC"]],
    }),
    models.StudentMark.findAll({
      where: { examId, classId, subjectId },
    }),
  ]);

  return {
    models,
    exam: plain(exam),
    examSubject: plain(examSubject),
    selectedClass: plain(selectedClass),
    subject: plain(subject),
    students: students.map(plain),
    existingMarks: existingMarks.map(plain),
  };
};

const calculateMark = (input, examSubject) => {
  const errors = [];
  const theoryEnabled = Boolean(examSubject.hasTheory);
  const practicalEnabled = Boolean(examSubject.hasPractical);
  const theoryMax = Number(examSubject.theoryMaxMarks);
  const practicalMax = Number(examSubject.practicalMaxMarks);
  const totalMax = Number(examSubject.totalMaxMarks);
  const passMark = Number(examSubject.passMark);
  const theoryMark = theoryEnabled ? optionalNumber(input.theoryMark) : null;
  const practicalMark = practicalEnabled
    ? optionalNumber(input.practicalMark)
    : null;
  const markStatus = text(input.markStatus) || "Present";

  if (!VALID_MARK_STATUSES.includes(markStatus)) {
    errors.push("markStatus must be Present, Absent or Exempted");
  }
  if (markStatus === "Present") {
    if (theoryEnabled && theoryMark === null) errors.push("theoryMark is required");
    if (practicalEnabled && practicalMark === null) {
      errors.push("practicalMark is required");
    }
  } else if (theoryMark !== null || practicalMark !== null) {
    errors.push(`${markStatus} students cannot have marks`);
  }
  if (
    Number.isNaN(theoryMark) ||
    (theoryMark !== null && (theoryMark < 0 || theoryMark > theoryMax))
  ) {
    errors.push(`theoryMark must be between 0 and ${theoryMax}`);
  }
  if (
    Number.isNaN(practicalMark) ||
    (practicalMark !== null &&
      (practicalMark < 0 || practicalMark > practicalMax))
  ) {
    errors.push(`practicalMark must be between 0 and ${practicalMax}`);
  }

  const totalMark =
    markStatus === "Present"
      ? Number(theoryMark || 0) + Number(practicalMark || 0)
      : null;
  const percentage =
    totalMark === null ? null : Number(((totalMark / totalMax) * 100).toFixed(2));
  const resultStatus =
    markStatus === "Present"
      ? totalMark >= passMark
        ? "Pass"
        : "Fail"
      : markStatus;

  return {
    errors,
    values: {
      theoryMark,
      practicalMark,
      totalMark,
      percentage,
      grade: null,
      resultStatus,
      remarks: text(input.remarks),
    },
  };
};

const valueChanged = (left, right) => {
  const normalized = (value) =>
    value === undefined || value === null || value === ""
      ? null
      : Number.isFinite(Number(value))
      ? Number(value)
      : String(value);
  return normalized(left) !== normalized(right);
};

const markChanged = (existing, values) =>
  !existing ||
  valueChanged(existing.theoryMark, values.theoryMark) ||
  valueChanged(existing.practicalMark, values.practicalMark) ||
  valueChanged(existing.totalMark, values.totalMark) ||
  existing.resultStatus !== values.resultStatus ||
  text(existing.remarks) !== values.remarks;

const validateEntries = (entries, context) => {
  if (!Array.isArray(entries) || !entries.length) {
    const error = new Error("marks must be a non-empty array");
    error.status = 400;
    throw error;
  }
  const students = new Map(
    context.students.map((student) => [Number(student.id), student])
  );
  const existing = new Map(
    context.existingMarks.map((mark) => [Number(mark.studentId), mark])
  );
  const seen = new Set();
  const errors = [];
  const rows = entries.map((entry, index) => {
    const studentId = Number(entry.studentId);
    const student = students.get(studentId);
    const rowErrors = [];
    if (!Number.isInteger(studentId) || !student) {
      rowErrors.push("Student does not belong to this class and academic year");
    }
    if (seen.has(studentId)) rowErrors.push("Student appears more than once");
    seen.add(studentId);
    const calculation = calculateMark(entry, context.examSubject);
    rowErrors.push(...calculation.errors);
    rowErrors.forEach((message) =>
      errors.push({ index, studentId: entry.studentId, message })
    );
    const current = existing.get(studentId);
    return {
      studentId,
      student,
      current,
      reason: text(entry.reason) || "Manual correction",
      values: calculation.values,
      action: !current
        ? "Create"
        : markChanged(current, calculation.values)
        ? "Update"
        : "Unchanged",
    };
  });
  return { rows, errors };
};

const saveEntries = async (context, validated, userId) => {
  if (context.exam.status !== "Open") {
    const error = new Error("Marks can only be entered while the exam is Open");
    error.status = 409;
    throw error;
  }
  if (validated.errors.length) {
    const error = new Error("One or more marks are invalid");
    error.status = 422;
    error.details = validated.errors;
    throw error;
  }

  const changedRows = validated.rows.filter(
    (row) => row.action !== "Unchanged"
  );
  await sequelize.transaction(async (transaction) => {
    for (const row of changedRows) {
      const markValues = {
        examId: context.exam.id,
        examSubjectId: context.examSubject.id,
        studentId: row.studentId,
        academicYearId: context.exam.academicYearId,
        termId: context.exam.termId,
        classId: context.examSubject.classId,
        subjectId: context.examSubject.subjectId,
        ...row.values,
        entryMethod: "Manual",
        sourceFileName: null,
        enteredBy: row.current?.enteredBy || userId,
        lastEditedBy: row.current ? userId : null,
      };
      if (!row.current) {
        await context.models.StudentMark.create(markValues, { transaction });
      } else {
        await context.models.MarkEditHistory.create(
          {
            studentMarkId: row.current.id,
            studentId: row.studentId,
            examId: context.exam.id,
            subjectId: context.examSubject.subjectId,
            oldTheoryMark: row.current.theoryMark,
            newTheoryMark: row.values.theoryMark,
            oldPracticalMark: row.current.practicalMark,
            newPracticalMark: row.values.practicalMark,
            oldTotalMark: row.current.totalMark,
            newTotalMark: row.values.totalMark,
            reason: row.reason,
            editedBy: userId,
          },
          { transaction }
        );
        await context.models.StudentMark.update(markValues, {
          where: { id: row.current.id },
          transaction,
        });
      }
    }
  });

  return {
    total: validated.rows.length,
    created: changedRows.filter((row) => row.action === "Create").length,
    updated: changedRows.filter((row) => row.action === "Update").length,
    unchanged: validated.rows.filter((row) => row.action === "Unchanged").length,
  };
};

module.exports = {
  allowedDepartmentIds,
  assertDepartmentAccess,
  loadEntryContext,
  validateEntries,
  saveEntries,
};
