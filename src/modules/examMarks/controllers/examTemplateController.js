const ExcelJS = require("exceljs");
const Exam = require("../../exams/models/Exam");
const ExamSubject = require("../../examSubjects/models/ExamSubject");
const Class = require("../../classes/models/Class");
const Subject = require("../../subjects/models/Subject");
const AcademicYear = require("../../academicYears/models/AcademicYear");
const Term = require("../../terms/models/Term");
const Department = require("../../departments/models/Department");
const Student = require("../../students/models/Student");

const TEMPLATE_VERSION = "1.1";

const safeFilePart = (value) =>
  String(value || "marks")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const requireQueryIds = (query) => {
  const required = ["examId", "classId", "subjectId"];
  const missing = required.filter((field) => !query[field]);
  if (missing.length) {
    const error = new Error(`${missing.join(", ")} required`);
    error.status = 400;
    throw error;
  }
};

const loadTemplateData = async ({ examId, classId, subjectId }) => {
  const examSubject = await ExamSubject.findOne({
    examId,
    classId,
    subjectId,
    isActive: true,
  });
  if (!examSubject) {
    const error = new Error(
      "The selected subject is not configured for this exam and class"
    );
    error.status = 404;
    throw error;
  }

  const [exam, selectedClass, subject] = await Promise.all([
    Exam.findById(examId),
    Class.findById(classId),
    Subject.findById(subjectId),
  ]);
  if (!exam || !selectedClass || !subject) {
    const error = new Error("Exam, class or subject not found");
    error.status = 404;
    throw error;
  }
  if (exam.status === "Closed") {
    const error = new Error("A template cannot be generated for a closed exam");
    error.status = 409;
    throw error;
  }

  const [academicYear, term, department, students] = await Promise.all([
    AcademicYear.findById(exam.academicYearId),
    Term.findById(exam.termId),
    Department.findById(selectedClass.departmentId),
    Student.find({
      classId,
      academicYearId: exam.academicYearId,
      status: "Active",
      isActive: true,
    }).sort({ fullName: 1 }),
  ]);

  if (!students.length) {
    const error = new Error(
      "No active students were found in this class for the exam academic year"
    );
    error.status = 404;
    throw error;
  }

  return {
    examSubject,
    exam,
    selectedClass,
    subject,
    academicYear,
    term,
    department,
    students,
  };
};

const addTitle = (sheet, title, lastColumn) => {
  sheet.mergeCells(1, 1, 1, lastColumn);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
  sheet.getRow(1).height = 28;
};

const styleHeader = (row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { horizontal: "center", vertical: "middle" };
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF5B9BD5" },
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
};

const buildWorkbook = async (data) => {
  const {
    examSubject,
    exam,
    selectedClass,
    subject,
    academicYear,
    term,
    department,
    students,
  } = data;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HTI School Management System";
  workbook.created = new Date();
  workbook.modified = new Date();

  const marksSheet = workbook.addWorksheet("Marks", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 3 }],
  });
  const columns = [
    { header: "Student ID", key: "studentId", width: 12, hidden: true },
    { header: "Admission No", key: "admissionNo", width: 18 },
    { header: "Student Name", key: "studentName", width: 32 },
  ];
  if (examSubject.hasTheory) {
    columns.push({
      header: `Theory Mark (Max ${examSubject.theoryMaxMarks})`,
      key: "theoryMark",
      width: 22,
      markMax: Number(examSubject.theoryMaxMarks),
    });
  }
  if (examSubject.hasPractical) {
    columns.push({
      header: `Practical Mark (Max ${examSubject.practicalMaxMarks})`,
      key: "practicalMark",
      width: 24,
      markMax: Number(examSubject.practicalMaxMarks),
    });
  }
  if (examSubject.hasMonthlyAssessment) columns.push({
    header: `Monthly Assessment (Max ${examSubject.monthlyAssessmentMaxMarks})`,
    key: "monthlyAssessmentMark", width: 30, markMax: Number(examSubject.monthlyAssessmentMaxMarks),
  });
  columns.push(
    { header: `Total (Max ${examSubject.totalMaxMarks})`, key: "total", width: 19 },
    { header: "Mark Status", key: "markStatus", width: 18 },
    { header: "Remarks", key: "remarks", width: 30 }
  );
  marksSheet.columns = columns;

  addTitle(
    marksSheet,
    `${exam.name} - ${selectedClass.name} - ${subject.name}`,
    columns.length
  );
  marksSheet.mergeCells(2, 1, 2, columns.length);
  marksSheet.getCell(2, 1).value =
    `${academicYear?.name || ""} | ${term?.name || ""} | ${department?.name || ""}`;
  marksSheet.getCell(2, 1).alignment = { horizontal: "center" };
  marksSheet.getCell(2, 1).font = { italic: true };
  marksSheet.mergeCells(3, 1, 3, columns.length);
  marksSheet.getCell(3, 1).value =
    "Enter marks only in the unlocked mark, status and remarks columns.";
  marksSheet.getCell(3, 1).alignment = { horizontal: "center" };

  const headerRowNumber = 5;
  const headerRow = marksSheet.getRow(headerRowNumber);
  columns.forEach((column, index) => {
    headerRow.getCell(index + 1).value = column.header;
    marksSheet.getColumn(index + 1).width = column.width;
    marksSheet.getColumn(index + 1).hidden = Boolean(column.hidden);
  });
  styleHeader(headerRow);
  marksSheet.autoFilter = {
    from: { row: headerRowNumber, column: 2 },
    to: { row: headerRowNumber, column: columns.length },
  };

  const totalColumn = columns.findIndex((column) => column.key === "total") + 1;
  const editableKeys = new Set([
    "theoryMark",
    "practicalMark",
    "monthlyAssessmentMark",
    "markStatus",
    "remarks",
  ]);

  students.forEach((student, studentIndex) => {
    const rowNumber = headerRowNumber + studentIndex + 1;
    const row = marksSheet.getRow(rowNumber);
    columns.forEach((column, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      if (column.key === "studentId") cell.value = student._id;
      if (column.key === "admissionNo") cell.value = student.admissionNo;
      if (column.key === "studentName") cell.value = student.fullName;
      if (column.key === "total") {
        const markColumns = columns
          .map((item, index) => ({ ...item, index: index + 1 }))
          .filter((item) => ["theoryMark", "practicalMark", "monthlyAssessmentMark"].includes(item.key))
          .map((item) => marksSheet.getColumn(item.index).letter);
        cell.value = {
          formula: `IF(COUNT(${markColumns
            .map((letter) => `${letter}${rowNumber}`)
            .join(",")})=0,"",SUM(${markColumns
            .map((letter) => `${letter}${rowNumber}`)
            .join(",")}))`,
        };
        cell.numFmt = "0.00";
      }
      cell.protection = { locked: !editableKeys.has(column.key) };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9E2F3" } },
        left: { style: "thin", color: { argb: "FFD9E2F3" } },
        bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
        right: { style: "thin", color: { argb: "FFD9E2F3" } },
      };
      if (studentIndex % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F6FA" },
        };
      }
      if (column.markMax !== undefined) {
        cell.dataValidation = {
          type: "decimal",
          operator: "between",
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: "Invalid mark",
          error: `Enter a number between 0 and ${column.markMax}`,
          formulae: [0, column.markMax],
        };
        cell.numFmt = "0.00";
      }
      if (column.key === "markStatus") {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: "Invalid status",
          error: "Select Present, Absent or Exempted",
          formulae: ['"Present,Absent,Exempted"'],
        };
      }
    });
  });
  marksSheet.getColumn(totalColumn).numFmt = "0.00";
  await marksSheet.protect("hti-exam-template", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
  });

  const infoSheet = workbook.addWorksheet("Template Information");
  infoSheet.columns = [
    { key: "field", width: 28 },
    { key: "value", width: 48 },
  ];
  const metadata = [
    ["Template Version", TEMPLATE_VERSION],
    ["Exam ID", exam._id],
    ["Exam Name", exam.name],
    ["Academic Year ID", exam.academicYearId],
    ["Academic Year", academicYear?.name || ""],
    ["Term ID", exam.termId],
    ["Term", term?.name || ""],
    ["Class ID", selectedClass._id],
    ["Class", selectedClass.name],
    ["Department ID", selectedClass.departmentId],
    ["Department", department?.name || ""],
    ["Subject ID", subject._id],
    ["Subject", subject.name],
    ["Has Theory", Boolean(examSubject.hasTheory)],
    ["Has Practical", Boolean(examSubject.hasPractical)],
    ["Has Monthly Assessment", Boolean(examSubject.hasMonthlyAssessment)],
    ["Monthly Assessment Maximum", Number(examSubject.monthlyAssessmentMaxMarks || 0)],
    ["Theory Maximum", Number(examSubject.theoryMaxMarks)],
    ["Practical Maximum", Number(examSubject.practicalMaxMarks)],
    ["Total Maximum", Number(examSubject.totalMaxMarks)],
    ["Pass Mark", Number(examSubject.passMark)],
    ["Generated At", new Date().toISOString()],
  ];
  infoSheet.addRow(["Field", "Value"]);
  metadata.forEach((item) => infoSheet.addRow(item));
  styleHeader(infoSheet.getRow(1));
  infoSheet.getColumn(1).font = { bold: true };
  infoSheet.state = "veryHidden";

  const instructions = workbook.addWorksheet("Instructions");
  instructions.getColumn(1).width = 110;
  instructions.addRow(["HTI Exam Marks Template Instructions"]);
  instructions.addRow([
    "1. Do not add, remove, rename or reorder columns and worksheets.",
  ]);
  instructions.addRow([
    "2. Do not change Student ID, Admission No, Student Name or Total.",
  ]);
  instructions.addRow([
    "3. Enter marks within the maximum displayed in each column heading.",
  ]);
  instructions.addRow([
    "4. Choose Absent or Exempted in Mark Status when applicable; otherwise choose Present.",
  ]);
  instructions.addRow([
    "5. Save the completed file as .xlsx and return it to the Exam Manager.",
  ]);
  instructions.getRow(1).font = { bold: true, size: 16 };

  return workbook;
};

exports.downloadMarksTemplate = async (req, res) => {
  try {
    requireQueryIds(req.query);
    const data = await loadTemplateData(req.query);
    const workbook = await buildWorkbook(data);
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = [
      safeFilePart(data.exam.name),
      safeFilePart(data.selectedClass.name),
      safeFilePart(data.subject.name),
      "marks_template.xlsx",
    ].join("_");

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", buffer.length);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports.buildWorkbook = buildWorkbook;
