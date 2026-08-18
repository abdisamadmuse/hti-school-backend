const ExcelJS = require("exceljs");
const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");
const {
  CLASS_TEMPLATE_VERSION,
  SUBJECT_HEADER_ROW,
  COMPONENT_HEADER_ROW,
  FIRST_DATA_ROW,
} = require("../controllers/classMarksTemplateController");

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
const booleanValue = (value) => value === true || value === 1 || text(value).toLowerCase() === "true";
const rowValue = (row, column) => {
  if (!column) return null;
  const value = row.getCell(column).value;
  if (value && typeof value === "object") {
    if (value.result !== undefined) return value.result;
    if (value.text !== undefined) return value.text;
  }
  return value;
};
const changed = (left, right) => {
  const normalize = (value) =>
    value === null || value === undefined || value === ""
      ? null
      : Number.isFinite(Number(value))
      ? Number(value)
      : String(value);
  return normalize(left) !== normalize(right);
};

const readKeyValueSheet = (sheet) => {
  const values = {};
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const key = text(row.getCell(1).value);
    if (key) values[key] = row.getCell(2).value;
  });
  return values;
};

const readSubjectConfiguration = (sheet) => {
  const expectedHeaders = [
    "Exam Subject ID", "Subject ID", "Subject Code", "Subject Name", "Has Theory",
    "Has Practical", "Theory Maximum", "Practical Maximum", "Total Maximum", "Pass Mark",
    "Theory Column", "Practical Column", "Total Column",
  ];
  const actualHeaders = expectedHeaders.map((_, index) => text(sheet.getRow(1).getCell(index + 1).value));
  if (actualHeaders.some((value, index) => value !== expectedHeaders[index])) {
    const error = new Error("Invalid template: Subject Configuration columns were modified");
    error.status = 400;
    throw error;
  }
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (!row.getCell(1).value) continue;
    rows.push({
      examSubjectId: numericId(row.getCell(1).value),
      subjectId: numericId(row.getCell(2).value),
      subjectCode: text(row.getCell(3).value),
      subjectName: text(row.getCell(4).value),
      hasTheory: booleanValue(row.getCell(5).value),
      hasPractical: booleanValue(row.getCell(6).value),
      theoryMaxMarks: Number(row.getCell(7).value),
      practicalMaxMarks: Number(row.getCell(8).value),
      totalMaxMarks: Number(row.getCell(9).value),
      passMark: Number(row.getCell(10).value),
      columns: {
        theory: numericId(row.getCell(11).value),
        practical: numericId(row.getCell(12).value),
        total: numericId(row.getCell(13).value),
      },
    });
  }
  return rows;
};

const parseClassWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (loadError) {
    const error = new Error("The uploaded file is not a valid .xlsx workbook");
    error.status = 400;
    throw error;
  }
  const marksSheet = workbook.getWorksheet("Marks");
  const informationSheet = workbook.getWorksheet("Template Information");
  const subjectsSheet = workbook.getWorksheet("Subject Configuration");
  if (!marksSheet || !informationSheet || !subjectsSheet) {
    const error = new Error("Invalid class template: required workbook sheets are missing");
    error.status = 400;
    throw error;
  }
  return {
    marksSheet,
    metadata: readKeyValueSheet(informationSheet),
    templateSubjects: readSubjectConfiguration(subjectsSheet),
  };
};

const validateMetadata = (metadata, templateSubjects) => {
  const errors = [];
  if (text(metadata["Template Type"]) !== "All Subjects Class Marks") errors.push("Template Type is invalid");
  if (text(metadata["Template Version"]) !== CLASS_TEMPLATE_VERSION) errors.push(`Template Version must be ${CLASS_TEMPLATE_VERSION}`);
  if (!numericId(metadata["Exam ID"])) errors.push("Exam ID is missing or invalid");
  if (!numericId(metadata["Class ID"])) errors.push("Class ID is missing or invalid");
  if (Number(metadata["Subject Count"]) !== templateSubjects.length) errors.push("Subject Count does not match the workbook configuration");
  if (!templateSubjects.length) errors.push("The workbook contains no subject configurations");
  if (errors.length) {
    const error = new Error(errors.join("; "));
    error.status = 400;
    throw error;
  }
};

const loadClassImportContext = async (metadata) => {
  const models = initializeModels();
  const examId = numericId(metadata["Exam ID"]);
  const classId = numericId(metadata["Class ID"]);
  const [exam, selectedClass, configurations] = await Promise.all([
    models.Exam.findByPk(examId),
    models.Class.findByPk(classId),
    models.ExamSubject.findAll({
      where: { examId, classId, isActive: true },
      order: [["subjectId", "ASC"]],
    }),
  ]);
  if (!exam || !selectedClass) {
    const error = new Error("Exam or class from the template was not found");
    error.status = 404;
    throw error;
  }
  if (exam.status !== "Open") {
    const error = new Error("Class marks can only be imported while the exam is Open");
    error.status = 409;
    throw error;
  }
  if (!configurations.length) {
    const error = new Error("No active subjects are configured for this exam and class");
    error.status = 404;
    throw error;
  }
  const subjectIds = configurations.map((item) => item.subjectId);
  const [subjects, students, existingMarks] = await Promise.all([
    models.Subject.findAll({ where: { id: { [Op.in]: subjectIds }, isActive: true } }),
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
      where: { examId, classId, subjectId: { [Op.in]: subjectIds } },
    }),
  ]);
  const subjectMap = new Map(subjects.map((item) => [item.id, plain(item)]));
  return {
    models,
    exam: plain(exam),
    selectedClass: plain(selectedClass),
    configurations: configurations.map((item) => ({ ...plain(item), subject: subjectMap.get(item.subjectId) })),
    students: students.map(plain),
    existingMarks: existingMarks.map(plain),
  };
};

const validateSubjectLayout = (marksSheet, templateSubjects, context) => {
  const errors = [];
  const databaseMap = new Map(context.configurations.map((item) => [item.id, item]));
  const seenConfigurations = new Set();
  const usedColumns = new Set([1, 2, 3]);
  let expectedColumn = 4;
  templateSubjects.forEach((template, templateIndex) => {
    const database = databaseMap.get(template.examSubjectId);
    const subjectContext = {
      subjectId: template.subjectId,
      subjectCode: template.subjectCode,
      subject: template.subjectName,
    };
    const add = (message, row = SUBJECT_HEADER_ROW, column = null) => errors.push({ row, column, ...subjectContext, message });
    if (!database || Number(database.subjectId) !== Number(template.subjectId)) {
      add("Subject configuration is missing, inactive or changed");
      return;
    }
    if (context.configurations[templateIndex]?.id !== template.examSubjectId) {
      add("Subject order was changed");
    }
    if (seenConfigurations.has(template.examSubjectId)) add("Subject configuration appears more than once");
    seenConfigurations.add(template.examSubjectId);
    if (!database.subject) add("Configured subject is missing or inactive");
    else if (database.subject.code !== template.subjectCode || database.subject.name !== template.subjectName) add("Subject code or name was changed");
    const comparisons = [
      [Boolean(database.hasTheory), template.hasTheory, "Theory configuration changed"],
      [Boolean(database.hasPractical), template.hasPractical, "Practical configuration changed"],
      [Number(database.theoryMaxMarks), template.theoryMaxMarks, "Theory maximum changed"],
      [Number(database.practicalMaxMarks), template.practicalMaxMarks, "Practical maximum changed"],
      [Number(database.totalMaxMarks), template.totalMaxMarks, "Total maximum changed"],
      [Number(database.passMark), template.passMark, "Pass mark changed"],
    ];
    comparisons.forEach(([left, right, message]) => { if (left !== right) add(message); });
    if (template.hasTheory && !template.columns.theory) add("Theory column is missing");
    if (!template.hasTheory && template.columns.theory) add("Unexpected theory column");
    if (template.hasPractical && !template.columns.practical) add("Practical column is missing");
    if (!template.hasPractical && template.columns.practical) add("Unexpected practical column");
    if (!template.columns.total) add("total column is missing");
    const expectedColumns = {};
    if (database.hasTheory) expectedColumns.theory = expectedColumn++;
    if (database.hasPractical) expectedColumns.practical = expectedColumn++;
    expectedColumns.total = expectedColumn++;
    Object.entries(expectedColumns).forEach(([key, column]) => {
      if (template.columns[key] !== column) add(`${key} column was moved`, COMPONENT_HEADER_ROW, template.columns[key]);
    });
    Object.entries(template.columns).forEach(([key, column]) => {
      if (!column) return;
      if (column <= 3 || usedColumns.has(column)) add(`Column ${column} is duplicated or invalid`, COMPONENT_HEADER_ROW, column);
      usedColumns.add(column);
      const expected =
        key === "theory" ? `Theory (Max ${Number(database.theoryMaxMarks)})` :
        key === "practical" ? `Practical (Max ${Number(database.practicalMaxMarks)})` :
        `Total (Max ${Number(database.totalMaxMarks)})`;
      if (text(marksSheet.getRow(COMPONENT_HEADER_ROW).getCell(column).value) !== expected) add(`${key} column heading was changed`, COMPONENT_HEADER_ROW, column);
    });
    const firstColumn = Math.min(...Object.values(template.columns).filter(Boolean));
    const expectedSubjectHeader = `${template.subjectCode} - ${template.subjectName}`;
    if (text(marksSheet.getRow(SUBJECT_HEADER_ROW).getCell(firstColumn).value) !== expectedSubjectHeader) add("Subject heading was changed", SUBJECT_HEADER_ROW, firstColumn);
  });
  context.configurations.forEach((item) => {
    if (!seenConfigurations.has(item.id)) {
      errors.push({ row: SUBJECT_HEADER_ROW, subjectId: item.subjectId, subjectCode: item.subject?.code, subject: item.subject?.name, message: "Configured subject is missing from the workbook" });
    }
  });
  const identityHeaders = ["Student ID", "Admission No", "Student Name"];
  identityHeaders.forEach((header, index) => {
    if (text(marksSheet.getRow(SUBJECT_HEADER_ROW).getCell(index + 1).value) !== header) errors.push({ row: SUBJECT_HEADER_ROW, column: index + 1, message: `${header} column was changed` });
  });
  for (let column = 4; column <= marksSheet.columnCount; column += 1) {
    if (
      !usedColumns.has(column) &&
      (text(marksSheet.getRow(SUBJECT_HEADER_ROW).getCell(column).value) ||
        text(marksSheet.getRow(COMPONENT_HEADER_ROW).getCell(column).value))
    ) {
      errors.push({ row: COMPONENT_HEADER_ROW, column, message: "Unexpected subject column was added" });
    }
  }
  return errors;
};

const validateClassRows = (marksSheet, templateSubjects, context) => {
  const errors = [];
  const rows = [];
  const seenStudents = new Set();
  const studentMap = new Map(context.students.map((item) => [item.id, item]));
  const configurationMap = new Map(context.configurations.map((item) => [item.id, item]));
  const existingMap = new Map(context.existingMarks.map((item) => [`${item.studentId}:${item.subjectId}`, item]));
  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= marksSheet.rowCount; rowNumber += 1) {
    const excelRow = marksSheet.getRow(rowNumber);
    const studentId = numericId(rowValue(excelRow, 1));
    const admissionNo = text(rowValue(excelRow, 2));
    const studentName = text(rowValue(excelRow, 3));
    if (!studentId && !admissionNo && !studentName) continue;
    const student = studentMap.get(studentId);
    const studentErrors = [];
    if (!student) studentErrors.push("Student does not belong to this class and academic year");
    if (seenStudents.has(studentId)) studentErrors.push("Student appears more than once");
    if (studentId) seenStudents.add(studentId);
    if (student && admissionNo !== text(student.admissionNo)) studentErrors.push("Admission number does not match the student");
    if (student && studentName !== text(student.fullName)) studentErrors.push("Student name does not match the system record");
    studentErrors.forEach((message) => errors.push({ row: rowNumber, studentId, admissionNo, studentName, message }));

    templateSubjects.forEach((template) => {
      const configuration = configurationMap.get(template.examSubjectId);
      if (!configuration) return;
      const subject = configuration.subject || {};
      const errorContext = {
        row: rowNumber,
        studentId,
        admissionNo,
        studentName,
        subjectId: configuration.subjectId,
        subjectCode: subject.code,
        subject: subject.name,
      };
      const theoryMark = configuration.hasTheory ? numberOrNull(rowValue(excelRow, template.columns.theory)) : null;
      const practicalMark = configuration.hasPractical ? numberOrNull(rowValue(excelRow, template.columns.practical)) : null;
      const markStatus = "Present";
      const remarks = "";
      const cellErrors = [];
      if (configuration.hasTheory && theoryMark === null) cellErrors.push("Theory mark is required");
      if (configuration.hasPractical && practicalMark === null) cellErrors.push("Practical mark is required");
      if (Number.isNaN(theoryMark) || (theoryMark !== null && (theoryMark < 0 || theoryMark > Number(configuration.theoryMaxMarks)))) cellErrors.push(`Theory mark must be between 0 and ${Number(configuration.theoryMaxMarks)}`);
      if (Number.isNaN(practicalMark) || (practicalMark !== null && (practicalMark < 0 || practicalMark > Number(configuration.practicalMaxMarks)))) cellErrors.push(`Practical mark must be between 0 and ${Number(configuration.practicalMaxMarks)}`);
      cellErrors.forEach((message) => errors.push({ ...errorContext, message }));
      const totalMark = Number(theoryMark || 0) + Number(practicalMark || 0);
      const percentage = totalMark === null ? null : Number(((totalMark / Number(configuration.totalMaxMarks)) * 100).toFixed(2));
      const resultStatus = totalMark >= Number(configuration.passMark) ? "Pass" : "Fail";
      const existing = existingMap.get(`${studentId}:${configuration.subjectId}`);
      const hasChanges =
        !existing || changed(existing.theoryMark, theoryMark) || changed(existing.practicalMark, practicalMark) ||
        changed(existing.totalMark, totalMark) || existing.resultStatus !== resultStatus || text(existing.remarks) !== remarks;
      rows.push({
        rowNumber,
        studentId,
        admissionNo,
        studentName,
        examSubjectId: configuration.id,
        subjectId: configuration.subjectId,
        subjectCode: subject.code,
        subjectName: subject.name,
        theoryMark,
        practicalMark,
        totalMark,
        percentage,
        resultStatus,
        remarks,
        action: !existing ? "Create" : hasChanges ? "Update" : "Unchanged",
        existing,
      });
    });
  }
  context.students.forEach((student) => {
    if (!seenStudents.has(student.id)) errors.push({ row: null, studentId: student.id, admissionNo: student.admissionNo, studentName: student.fullName, message: "Student is missing from the Excel file" });
  });
  return { rows, errors };
};

const inspectClassMarksWorkbook = async (buffer) => {
  const parsed = await parseClassWorkbook(buffer);
  validateMetadata(parsed.metadata, parsed.templateSubjects);
  const context = await loadClassImportContext(parsed.metadata);
  const layoutErrors = validateSubjectLayout(parsed.marksSheet, parsed.templateSubjects, context);
  const rowValidation = validateClassRows(parsed.marksSheet, parsed.templateSubjects, context);
  return {
    ...parsed,
    context,
    rows: rowValidation.rows,
    errors: [...layoutErrors, ...rowValidation.errors],
  };
};

const classPreviewResponse = (inspection) => ({
  valid: inspection.errors.length === 0,
  exam: { id: inspection.context.exam.id, name: inspection.context.exam.name },
  class: {
    id: inspection.context.selectedClass.id,
    name: inspection.context.selectedClass.name,
    departmentId: inspection.context.selectedClass.departmentId,
  },
  subjects: inspection.context.configurations.map((item) => ({
    examSubjectId: item.id,
    subjectId: item.subjectId,
    code: item.subject?.code,
    name: item.subject?.name,
    hasTheory: Boolean(item.hasTheory),
    hasPractical: Boolean(item.hasPractical),
    theoryMaxMarks: Number(item.theoryMaxMarks),
    practicalMaxMarks: Number(item.practicalMaxMarks),
    totalMaxMarks: Number(item.totalMaxMarks),
    passMark: Number(item.passMark),
  })),
  summary: {
    students: inspection.context.students.length,
    subjects: inspection.context.configurations.length,
    totalMarkCells: inspection.rows.length,
    create: inspection.rows.filter((item) => item.action === "Create").length,
    update: inspection.rows.filter((item) => item.action === "Update").length,
    unchanged: inspection.rows.filter((item) => item.action === "Unchanged").length,
    errors: inspection.errors.length,
  },
  rows: inspection.rows.map(({ existing, ...item }) => item),
  errors: inspection.errors,
});

const importClassMarksWorkbook = async (inspection, fileName, userId) => {
  if (inspection.errors.length) {
    const error = new Error("The class marks workbook contains validation errors");
    error.status = 422;
    error.details = classPreviewResponse(inspection);
    throw error;
  }
  const changedRows = inspection.rows.filter((item) => item.action !== "Unchanged");
  const { models, exam, selectedClass } = inspection.context;
  await sequelize.transaction(async (transaction) => {
    for (const row of changedRows) {
      const values = {
        examId: exam.id,
        examSubjectId: row.examSubjectId,
        studentId: row.studentId,
        academicYearId: exam.academicYearId,
        termId: exam.termId,
        classId: selectedClass.id,
        subjectId: row.subjectId,
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
            subjectId: row.subjectId,
            oldTheoryMark: row.existing.theoryMark,
            newTheoryMark: row.theoryMark,
            oldPracticalMark: row.existing.practicalMark,
            newPracticalMark: row.practicalMark,
            oldTotalMark: row.existing.totalMark,
            newTotalMark: row.totalMark,
            reason: "All subjects Excel re-import",
            editedBy: userId,
          },
          { transaction }
        );
        await models.StudentMark.update(values, { where: { id: row.existing.id }, transaction });
      }
    }
  });
  return {
    students: inspection.context.students.length,
    subjects: inspection.context.configurations.length,
    totalMarkCells: inspection.rows.length,
    created: changedRows.filter((item) => item.action === "Create").length,
    updated: changedRows.filter((item) => item.action === "Update").length,
    unchanged: inspection.rows.filter((item) => item.action === "Unchanged").length,
  };
};

module.exports = {
  inspectClassMarksWorkbook,
  classPreviewResponse,
  importClassMarksWorkbook,
};
