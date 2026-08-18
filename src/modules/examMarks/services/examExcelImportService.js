const ExcelJS = require("exceljs");
const { Op } = require("sequelize");
const {
  sequelize,
  initializeModels,
} = require("../../../config/mysql");

const TEMPLATE_VERSION = "1.0";
const HEADER_ROW = 5;
const VALID_STATUSES = ["Present", "Absent", "Exempted"];

const plain = (record) => (record ? record.get({ plain: true }) : null);
const text = (value) => String(value ?? "").trim();
const numericId = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

const readMetadata = (sheet) => {
  const metadata = {};
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const key = text(row.getCell(1).value);
    if (key) metadata[key] = row.getCell(2).value;
  });
  return metadata;
};

const readHeaders = (sheet) => {
  const headers = {};
  sheet.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, column) => {
    const value = text(cell.value);
    if (value === "Student ID") headers.studentId = column;
    else if (value === "Admission No") headers.admissionNo = column;
    else if (value === "Student Name") headers.studentName = column;
    else if (value.startsWith("Theory Mark")) headers.theoryMark = column;
    else if (value.startsWith("Practical Mark")) headers.practicalMark = column;
    else if (value.startsWith("Total")) headers.total = column;
    else if (value === "Mark Status") headers.markStatus = column;
    else if (value === "Remarks") headers.remarks = column;
  });
  return headers;
};

const rowValue = (row, column) => {
  if (!column) return null;
  const value = row.getCell(column).value;
  if (value && typeof value === "object") {
    if (value.result !== undefined) return value.result;
    if (value.text !== undefined) return value.text;
  }
  return value;
};

const changed = (oldValue, newValue) => {
  const normalize = (value) =>
    value === null || value === undefined || value === ""
      ? null
      : Number.isFinite(Number(value))
      ? Number(value)
      : String(value);
  return normalize(oldValue) !== normalize(newValue);
};

const parseWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    const invalidFile = new Error("The uploaded file is not a valid .xlsx workbook");
    invalidFile.status = 400;
    throw invalidFile;
  }
  const marksSheet = workbook.getWorksheet("Marks");
  const infoSheet = workbook.getWorksheet("Template Information");
  if (!marksSheet || !infoSheet) {
    const error = new Error(
      "Invalid template: Marks or Template Information sheet is missing"
    );
    error.status = 400;
    throw error;
  }
  return {
    marksSheet,
    metadata: readMetadata(infoSheet),
    headers: readHeaders(marksSheet),
  };
};

const validateTemplate = (metadata, headers) => {
  const errors = [];
  if (text(metadata["Template Version"]) !== TEMPLATE_VERSION) {
    errors.push(`Template Version must be ${TEMPLATE_VERSION}`);
  }
  ["Exam ID", "Class ID", "Subject ID"].forEach((field) => {
    if (!numericId(metadata[field])) errors.push(`${field} is missing or invalid`);
  });
  ["studentId", "admissionNo", "studentName", "markStatus", "remarks"].forEach(
    (field) => {
      if (!headers[field]) errors.push(`Required template column ${field} is missing`);
    }
  );
  return errors;
};

const loadContext = async (metadata) => {
  const models = initializeModels();
  const examId = numericId(metadata["Exam ID"]);
  const classId = numericId(metadata["Class ID"]);
  const subjectId = numericId(metadata["Subject ID"]);
  const [exam, examSubject] = await Promise.all([
    models.Exam.findByPk(examId),
    models.ExamSubject.findOne({
      where: { examId, classId, subjectId, isActive: true },
    }),
  ]);
  if (!exam) {
    const error = new Error("Exam from the template was not found");
    error.status = 404;
    throw error;
  }
  if (exam.status !== "Open") {
    const error = new Error("Marks can only be imported while the exam is Open");
    error.status = 409;
    throw error;
  }
  if (!examSubject) {
    const error = new Error(
      "The exam subject configuration from this template was not found or is inactive"
    );
    error.status = 404;
    throw error;
  }
  const students = await models.Student.findAll({
    where: {
      classId,
      academicYearId: exam.academicYearId,
      status: "Active",
      isActive: true,
    },
    order: [["fullName", "ASC"]],
  });
  const existingMarks = await models.StudentMark.findAll({
    where: {
      examId,
      classId,
      subjectId,
      studentId: { [Op.in]: students.map((student) => student.id) },
    },
  });
  return {
    models,
    exam: plain(exam),
    examSubject: plain(examSubject),
    students: students.map(plain),
    existingMarks: existingMarks.map(plain),
  };
};

const validateRows = ({ marksSheet, headers, context }) => {
  const errors = [];
  const rows = [];
  const seen = new Set();
  const studentMap = new Map(
    context.students.map((student) => [Number(student.id), student])
  );
  const existingMap = new Map(
    context.existingMarks.map((mark) => [Number(mark.studentId), mark])
  );
  const theoryEnabled = Boolean(context.examSubject.hasTheory);
  const practicalEnabled = Boolean(context.examSubject.hasPractical);
  const theoryMax = Number(context.examSubject.theoryMaxMarks);
  const practicalMax = Number(context.examSubject.practicalMaxMarks);
  const totalMax = Number(context.examSubject.totalMaxMarks);
  const passMark = Number(context.examSubject.passMark);

  if (theoryEnabled && !headers.theoryMark) {
    errors.push({ row: HEADER_ROW, message: "Theory Mark column is missing" });
  }
  if (!theoryEnabled && headers.theoryMark) {
    errors.push({ row: HEADER_ROW, message: "Unexpected Theory Mark column" });
  }
  if (practicalEnabled && !headers.practicalMark) {
    errors.push({ row: HEADER_ROW, message: "Practical Mark column is missing" });
  }
  if (!practicalEnabled && headers.practicalMark) {
    errors.push({ row: HEADER_ROW, message: "Unexpected Practical Mark column" });
  }

  for (let rowNumber = HEADER_ROW + 1; rowNumber <= marksSheet.rowCount; rowNumber += 1) {
    const excelRow = marksSheet.getRow(rowNumber);
    const rawStudentId = rowValue(excelRow, headers.studentId);
    const rawAdmissionNo = text(rowValue(excelRow, headers.admissionNo));
    const rawStudentName = text(rowValue(excelRow, headers.studentName));
    const isEmpty = !rawStudentId && !rawAdmissionNo && !rawStudentName;
    if (isEmpty) continue;

    const rowErrors = [];
    const studentId = numericId(rawStudentId);
    const student = studentMap.get(studentId);
    if (!student) rowErrors.push("Student does not belong to this class and academic year");
    if (seen.has(studentId)) rowErrors.push("Student appears more than once");
    if (studentId) seen.add(studentId);
    if (student && rawAdmissionNo !== text(student.admissionNo)) {
      rowErrors.push("Admission number does not match the student");
    }
    if (student && rawStudentName !== text(student.fullName)) {
      rowErrors.push("Student name does not match the system record");
    }

    const theoryMark = theoryEnabled
      ? numberOrNull(rowValue(excelRow, headers.theoryMark))
      : null;
    const practicalMark = practicalEnabled
      ? numberOrNull(rowValue(excelRow, headers.practicalMark))
      : null;
    const rawStatus = text(rowValue(excelRow, headers.markStatus));
    const markStatus = rawStatus || "Present";
    const remarks = text(rowValue(excelRow, headers.remarks));

    if (!VALID_STATUSES.includes(markStatus)) {
      rowErrors.push("Mark Status must be Present, Absent or Exempted");
    }
    if (markStatus === "Present") {
      if (theoryEnabled && theoryMark === null) rowErrors.push("Theory mark is required");
      if (practicalEnabled && practicalMark === null) rowErrors.push("Practical mark is required");
    } else if (theoryMark !== null || practicalMark !== null) {
      rowErrors.push(`${markStatus} students cannot have marks`);
    }
    if (Number.isNaN(theoryMark) || (theoryMark !== null && (theoryMark < 0 || theoryMark > theoryMax))) {
      rowErrors.push(`Theory mark must be between 0 and ${theoryMax}`);
    }
    if (
      Number.isNaN(practicalMark) ||
      (practicalMark !== null &&
        (practicalMark < 0 || practicalMark > practicalMax))
    ) {
      rowErrors.push(`Practical mark must be between 0 and ${practicalMax}`);
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
    const existing = existingMap.get(studentId);
    const hasChanges =
      !existing ||
      changed(existing.theoryMark, theoryMark) ||
      changed(existing.practicalMark, practicalMark) ||
      changed(existing.totalMark, totalMark) ||
      existing.resultStatus !== resultStatus ||
      text(existing.remarks) !== remarks;

    rowErrors.forEach((message) => errors.push({ row: rowNumber, message }));
    rows.push({
      rowNumber,
      studentId,
      admissionNo: rawAdmissionNo,
      studentName: rawStudentName,
      theoryMark,
      practicalMark,
      totalMark,
      percentage,
      resultStatus,
      remarks,
      action: !existing ? "Create" : hasChanges ? "Update" : "Unchanged",
      existing,
    });
  }

  context.students.forEach((student) => {
    if (!seen.has(Number(student.id))) {
      errors.push({
        row: null,
        studentId: student.id,
        admissionNo: student.admissionNo,
        message: "Student is missing from the Excel file",
      });
    }
  });

  return { rows, errors };
};

const inspectExcel = async (buffer) => {
  const parsed = await parseWorkbook(buffer);
  const templateErrors = validateTemplate(parsed.metadata, parsed.headers);
  if (templateErrors.length) {
    const error = new Error(templateErrors.join("; "));
    error.status = 400;
    throw error;
  }
  const context = await loadContext(parsed.metadata);
  const validation = validateRows({ ...parsed, context });
  return { ...validation, context, metadata: parsed.metadata };
};

const previewResponse = (inspection) => ({
  valid: inspection.errors.length === 0,
  exam: {
    id: inspection.context.exam.id,
    name: inspection.context.exam.name,
  },
  configuration: {
    classId: inspection.context.examSubject.classId,
    subjectId: inspection.context.examSubject.subjectId,
    theoryMaxMarks: Number(inspection.context.examSubject.theoryMaxMarks),
    practicalMaxMarks: Number(inspection.context.examSubject.practicalMaxMarks),
    totalMaxMarks: Number(inspection.context.examSubject.totalMaxMarks),
    passMark: Number(inspection.context.examSubject.passMark),
  },
  summary: {
    totalRows: inspection.rows.length,
    validRows:
      inspection.rows.length -
      new Set(
        inspection.errors
          .filter((error) => error.row && error.row > HEADER_ROW)
          .map((error) => error.row)
      ).size,
    create: inspection.rows.filter((row) => row.action === "Create").length,
    update: inspection.rows.filter((row) => row.action === "Update").length,
    unchanged: inspection.rows.filter((row) => row.action === "Unchanged").length,
    errors: inspection.errors.length,
  },
  rows: inspection.rows.map(({ existing, ...row }) => row),
  errors: inspection.errors,
});

const importExcel = async (inspection, fileName, userId) => {
  if (inspection.errors.length) {
    const error = new Error("The Excel file contains validation errors");
    error.status = 422;
    error.details = previewResponse(inspection);
    throw error;
  }
  const { models, exam, examSubject } = inspection.context;
  const changedRows = inspection.rows.filter((row) => row.action !== "Unchanged");
  await sequelize.transaction(async (transaction) => {
    for (const row of changedRows) {
      const values = {
        examId: exam.id,
        examSubjectId: examSubject.id,
        studentId: row.studentId,
        academicYearId: exam.academicYearId,
        termId: exam.termId,
        classId: examSubject.classId,
        subjectId: examSubject.subjectId,
        theoryMark: row.theoryMark,
        practicalMark: row.practicalMark,
        totalMark: row.totalMark,
        percentage: row.percentage,
        grade: null,
        resultStatus: row.resultStatus,
        remarks: row.remarks,
        entryMethod: "Excel",
        sourceFileName: fileName,
        enteredBy: row.existing?.enteredBy || userId,
        lastEditedBy: row.existing ? userId : null,
      };
      if (!row.existing) {
        await models.StudentMark.create(values, { transaction });
      } else {
        await models.MarkEditHistory.create(
          {
            studentMarkId: row.existing.id,
            studentId: row.studentId,
            examId: exam.id,
            subjectId: examSubject.subjectId,
            oldTheoryMark: row.existing.theoryMark,
            newTheoryMark: row.theoryMark,
            oldPracticalMark: row.existing.practicalMark,
            newPracticalMark: row.practicalMark,
            oldTotalMark: row.existing.totalMark,
            newTotalMark: row.totalMark,
            reason: "Excel re-import",
            editedBy: userId,
          },
          { transaction }
        );
        await models.StudentMark.update(values, {
          where: { id: row.existing.id },
          transaction,
        });
      }
    }
  });
  return {
    totalRows: inspection.rows.length,
    created: changedRows.filter((row) => row.action === "Create").length,
    updated: changedRows.filter((row) => row.action === "Update").length,
    unchanged: inspection.rows.filter((row) => row.action === "Unchanged").length,
  };
};

module.exports = {
  inspectExcel,
  previewResponse,
  importExcel,
};
