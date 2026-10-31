const ExcelJS = require("exceljs");
const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");

const CLASS_TEMPLATE_VERSION = "CLASS-1.2";
const SUBJECT_HEADER_ROW = 4;
const COMPONENT_HEADER_ROW = 5;
const FIRST_DATA_ROW = 6;

const plain = (record) => (record ? record.get({ plain: true }) : null);
const safeFilePart = (value) =>
  String(value || "marks")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const loadClassTemplateData = async ({ examId, classId, classSectionId }) => {
  if (!examId || !classId) {
    const error = new Error("examId and classId are required");
    error.status = 400;
    throw error;
  }
  const models = initializeModels();
  const [exam, selectedClass, configurations] = await Promise.all([
    models.Exam.findByPk(examId),
    models.Class.findByPk(classId),
    models.ExamSubject.findAll({
      where: { examId, classId, isActive: true },
      order: [["subjectId", "ASC"]],
    }),
  ]);
  if (!exam || !selectedClass) {
    const error = new Error("Exam or class not found");
    error.status = 404;
    throw error;
  }
  if (exam.status === "Closed") {
    const error = new Error("A class template cannot be generated for a closed exam");
    error.status = 409;
    throw error;
  }
  if (Number(selectedClass.academicYearId) !== Number(exam.academicYearId)) {
    const error = new Error("Class does not belong to the exam academic year");
    error.status = 400;
    throw error;
  }
  if (!configurations.length) {
    const error = new Error("No active subjects are configured for this exam and class");
    error.status = 404;
    throw error;
  }
  let section = null;
  if (classSectionId) {
    section = await models.ClassSection.findByPk(classSectionId);
    if (!section || Number(section.classId) !== Number(classId) || !section.isActive) {
      throw Object.assign(new Error("Section does not belong to this class or is inactive"), { status: 400 });
    }
  }
  const subjectIds = configurations.map((item) => item.subjectId);
  const [subjects, students, academicYear, term, department] = await Promise.all([
    models.Subject.findAll({ where: { id: { [Op.in]: subjectIds }, isActive: true } }),
    models.Student.findAll({
      where: {
        classId,
        ...(classSectionId ? { classSectionId } : {}),
        academicYearId: exam.academicYearId,
        status: "Active",
        isActive: true,
      },
      order: [["fullName", "ASC"]],
    }),
    models.AcademicYear.findByPk(exam.academicYearId),
    models.Term.findByPk(exam.termId),
    models.Department.findByPk(selectedClass.departmentId),
  ]);
  if (subjects.length !== configurations.length) {
    const error = new Error("One or more configured subjects are missing or inactive");
    error.status = 409;
    throw error;
  }
  if (!students.length) {
    const error = new Error("No active students were found in this class for the exam academic year");
    error.status = 404;
    throw error;
  }
  const subjectMap = new Map(subjects.map((item) => [item.id, plain(item)]));
  return {
    section: plain(section),
    exam: plain(exam),
    selectedClass: plain(selectedClass),
    configurations: configurations.map((item) => ({
      ...plain(item),
      subject: subjectMap.get(item.subjectId),
    })),
    students: students.map(plain),
    academicYear: plain(academicYear),
    term: plain(term),
    department: plain(department),
  };
};

const componentColumns = (configurations) => {
  let column = 4;
  return configurations.map((configuration) => {
    const columns = {};
    if (configuration.hasTheory) columns.theory = column++;
    if (configuration.hasPractical) columns.practical = column++;
    if (configuration.hasMonthlyAssessment) columns.monthly = column++;
    columns.total = column++;
    return { configuration, columns, first: Math.min(...Object.values(columns)), last: Math.max(...Object.values(columns)) };
  });
};

const border = {
  top: { style: "thin", color: { argb: "FFB4C6E7" } },
  left: { style: "thin", color: { argb: "FFB4C6E7" } },
  bottom: { style: "thin", color: { argb: "FFB4C6E7" } },
  right: { style: "thin", color: { argb: "FFB4C6E7" } },
};

const buildClassMarksWorkbook = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HTI School Management System";
  workbook.created = new Date();
  workbook.modified = new Date();
  const layout = componentColumns(data.configurations);
  const lastColumn = layout[layout.length - 1].last;
  const sheet = workbook.addWorksheet("Marks", {
    views: [{ state: "frozen", ySplit: COMPONENT_HEADER_ROW, xSplit: 3 }],
  });

  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell(1, 1).value = `${data.exam.name} - ${data.selectedClass.name} - All Subjects`;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  sheet.getRow(1).height = 28;
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = `${data.academicYear?.name || ""} | ${data.term?.name || ""} | ${data.department?.name || ""}`;
  sheet.getCell(2, 1).alignment = { horizontal: "center" };
  sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.getCell(3, 1).value = "Enter enabled component marks only. Do not modify student or subject headings.";
  sheet.getCell(3, 1).alignment = { horizontal: "center" };

  const identityHeaders = ["Student ID", "Admission No", "Student Name"];
  identityHeaders.forEach((header, index) => {
    const column = index + 1;
    sheet.mergeCells(SUBJECT_HEADER_ROW, column, COMPONENT_HEADER_ROW, column);
    const cell = sheet.getCell(SUBJECT_HEADER_ROW, column);
    cell.value = header;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B9BD5" } };
    cell.border = border;
  });
  sheet.getColumn(1).hidden = true;
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 30;

  layout.forEach(({ configuration, columns, first, last }) => {
    const subject = configuration.subject;
    sheet.mergeCells(SUBJECT_HEADER_ROW, first, SUBJECT_HEADER_ROW, last);
    const subjectCell = sheet.getCell(SUBJECT_HEADER_ROW, first);
    subjectCell.value = `${subject.code} - ${subject.name}`;
    subjectCell.font = { bold: true, color: { argb: "FF000000" } };
    subjectCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    subjectCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
    subjectCell.border = border;
    const labels = {
      theory: `Theory (Max ${Number(configuration.theoryMaxMarks)})`,
      practical: `Practical (Max ${Number(configuration.practicalMaxMarks)})`,
      monthly: `Monthly Assessment (Max ${Number(configuration.monthlyAssessmentMaxMarks)})`,
      total: `Total (Max ${Number(configuration.totalMaxMarks)})`,
    };
    Object.entries(columns).forEach(([key, column]) => {
      const cell = sheet.getCell(COMPONENT_HEADER_ROW, column);
      cell.value = labels[key];
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF70AD47" } };
      cell.border = border;
      sheet.getColumn(column).width = 16;
    });
  });
  sheet.getRow(SUBJECT_HEADER_ROW).height = 32;
  sheet.getRow(COMPONENT_HEADER_ROW).height = 34;
  sheet.autoFilter = { from: { row: COMPONENT_HEADER_ROW, column: 2 }, to: { row: COMPONENT_HEADER_ROW, column: lastColumn } };

  data.students.forEach((student, studentIndex) => {
    const rowNumber = FIRST_DATA_ROW + studentIndex;
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = student.id;
    row.getCell(2).value = student.admissionNo;
    row.getCell(3).value = student.fullName;
    [1, 2, 3].forEach((column) => {
      row.getCell(column).protection = { locked: true };
      row.getCell(column).border = border;
    });
    layout.forEach(({ configuration, columns }) => {
      const markColumns = [];
      if (columns.theory) markColumns.push(sheet.getColumn(columns.theory).letter);
      if (columns.practical) markColumns.push(sheet.getColumn(columns.practical).letter);
      if (columns.monthly) markColumns.push(sheet.getColumn(columns.monthly).letter);
      Object.entries(columns).forEach(([key, column]) => {
        const cell = row.getCell(column);
        cell.border = border;
        cell.protection = { locked: key === "total" };
        if (studentIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
      });
      if (columns.theory) {
        row.getCell(columns.theory).dataValidation = {
          type: "decimal", operator: "between", allowBlank: true, showErrorMessage: true,
          errorTitle: "Invalid theory mark", error: `Enter 0 to ${Number(configuration.theoryMaxMarks)}`,
          formulae: [0, Number(configuration.theoryMaxMarks)],
        };
        row.getCell(columns.theory).numFmt = "0.00";
      }
      if (columns.practical) {
        row.getCell(columns.practical).dataValidation = {
          type: "decimal", operator: "between", allowBlank: true, showErrorMessage: true,
          errorTitle: "Invalid practical mark", error: `Enter 0 to ${Number(configuration.practicalMaxMarks)}`,
          formulae: [0, Number(configuration.practicalMaxMarks)],
        };
        row.getCell(columns.practical).numFmt = "0.00";
      }
      if (columns.monthly) {
        row.getCell(columns.monthly).dataValidation = { type: "decimal", operator: "between", allowBlank: true, showErrorMessage: true, formulae: [0, Number(configuration.monthlyAssessmentMaxMarks)] };
        row.getCell(columns.monthly).numFmt = "0.00";
      }
      row.getCell(columns.total).value = {
        formula: `IF(COUNT(${markColumns.map((letter) => `${letter}${rowNumber}`).join(",")})=0,"",SUM(${markColumns.map((letter) => `${letter}${rowNumber}`).join(",")}))`,
      };
      row.getCell(columns.total).numFmt = "0.00";
    });
  });
  await sheet.protect("hti-class-exam-template", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
  });

  const info = workbook.addWorksheet("Template Information");
  info.columns = [{ width: 30 }, { width: 55 }];
  [
    ["Field", "Value"],
    ["Template Type", "All Subjects Class Marks"],
    ["Template Version", CLASS_TEMPLATE_VERSION],
    ["Exam ID", data.exam.id],
    ["Exam Name", data.exam.name],
    ["Academic Year ID", data.exam.academicYearId],
    ["Term ID", data.exam.termId],
    ["Class ID", data.selectedClass.id],
    ["Class Section ID", data.section?.id || ""],
    ["Class", data.selectedClass.name],
    ["Department ID", data.selectedClass.departmentId],
    ["Subject Count", data.configurations.length],
    ["Generated At", new Date().toISOString()],
  ].forEach((values) => info.addRow(values));
  info.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  info.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B9BD5" } };
  info.state = "veryHidden";

  const subjectInfo = workbook.addWorksheet("Subject Configuration");
  const subjectHeaders = [
    "Exam Subject ID", "Subject ID", "Subject Code", "Subject Name", "Has Theory",
    "Has Practical", "Theory Maximum", "Practical Maximum", "Total Maximum", "Pass Mark",
    "Theory Column", "Practical Column", "Total Column", "Has Monthly Assessment", "Monthly Assessment Maximum", "Monthly Assessment Column",
  ];
  subjectInfo.addRow(subjectHeaders);
  layout.forEach(({ configuration, columns }) => {
    subjectInfo.addRow([
      configuration.id, configuration.subjectId, configuration.subject.code,
      configuration.subject.name, Boolean(configuration.hasTheory), Boolean(configuration.hasPractical),
      Number(configuration.theoryMaxMarks), Number(configuration.practicalMaxMarks),
      Number(configuration.totalMaxMarks), Number(configuration.passMark),
      columns.theory || "", columns.practical || "", columns.total,
      Boolean(configuration.hasMonthlyAssessment), Number(configuration.monthlyAssessmentMaxMarks || 0), columns.monthly || "",
    ]);
  });
  subjectInfo.state = "veryHidden";

  const instructions = workbook.addWorksheet("Instructions");
  instructions.getColumn(1).width = 120;
  [
    "HTI All Subjects Class Marks Template",
    "1. Do not add, remove, rename or reorder students, subjects, columns or worksheets.",
    "2. Do not change Student ID, Admission No, Student Name or calculated Total cells.",
    "3. Enter every enabled enabled component mark within its displayed maximum.",
    "4. All imported workbook entries are treated as Present with no remarks.",
    "5. Record Absent or Exempted students through Manual Marks Entry.",
    "6. Save the completed workbook as .xlsx and return it to the Head of Exams.",
  ].forEach((value) => instructions.addRow([value]));
  instructions.getRow(1).font = { bold: true, size: 16 };
  return workbook;
};

exports.downloadClassMarksTemplate = async (req, res) => {
  try {
    const data = await loadClassTemplateData(req.query);
    const workbook = await buildClassMarksWorkbook(data);
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${safeFilePart(data.exam.name)}_${safeFilePart(data.selectedClass.name)}_all_subjects_marks_template.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports = {
  downloadClassMarksTemplate: exports.downloadClassMarksTemplate,
  CLASS_TEMPLATE_VERSION,
  SUBJECT_HEADER_ROW,
  COMPONENT_HEADER_ROW,
  FIRST_DATA_ROW,
  loadClassTemplateData,
  buildClassMarksWorkbook,
};
