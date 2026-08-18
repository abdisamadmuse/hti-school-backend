const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");
const { assertDepartmentAccess } = require("../../examMarks/services/manualMarkService");

const plain = (record) => (record ? record.get({ plain: true }) : null);
const safeName = (value) => String(value || "report").replace(/[^a-zA-Z0-9_-]+/g, "_");
const requireExamId = (query) => {
  if (!query.examId) {
    const error = new Error("examId is required");
    error.status = 400;
    throw error;
  }
};
const handleError = (res, error) =>
  res.status(error.status || 500).json({ message: error.message });

const loadClassReport = async (examId, classId, user) => {
  const models = initializeModels();
  const [exam, selectedClass, configurations] = await Promise.all([
    models.Exam.findByPk(examId),
    models.Class.findByPk(classId),
    models.ExamSubject.findAll({ where: { examId, classId, isActive: true } }),
  ]);
  if (!exam || !selectedClass) {
    const error = new Error("Exam or class not found");
    error.status = 404;
    throw error;
  }
  assertDepartmentAccess(user, selectedClass.departmentId);
  const subjectIds = configurations.map((item) => item.subjectId);
  const [subjects, students, marks, summaries] = await Promise.all([
    models.Subject.findAll({ where: { id: { [Op.in]: subjectIds } } }),
    models.Student.findAll({
      where: { classId, academicYearId: exam.academicYearId, status: "Active", isActive: true },
      order: [["fullName", "ASC"]],
    }),
    models.StudentMark.findAll({ where: { examId, classId } }),
    models.ResultSummary.findAll({ where: { examId, classId } }),
  ]);
  if (!summaries.length) {
    const error = new Error("Class results have not been calculated");
    error.status = 409;
    throw error;
  }
  return {
    models,
    exam: plain(exam),
    selectedClass: plain(selectedClass),
    configurations: configurations.map(plain),
    subjects: subjects.map(plain),
    students: students.map(plain),
    marks: marks.map(plain),
    summaries: summaries.map(plain),
  };
};

exports.downloadClassResultExcel = async (req, res) => {
  try {
    requireExamId(req.query);
    const data = await loadClassReport(req.query.examId, req.params.classId, req.user);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "HTI School Management System";
    const sheet = workbook.addWorksheet("Class Results", { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });
    const subjectMap = new Map(data.subjects.map((item) => [item.id, item]));
    const columns = [
      { key: "position", header: "Position", width: 11 },
      { key: "admissionNo", header: "Admission No", width: 17 },
      { key: "studentName", header: "Student Name", width: 30 },
      ...data.configurations.map((item) => ({
        key: `subject_${item.subjectId}`,
        header: `${subjectMap.get(item.subjectId)?.name || item.subjectId} (${Number(item.totalMaxMarks)})`,
        width: 19,
      })),
      { key: "total", header: "Total", width: 12 },
      { key: "average", header: "Average %", width: 13 },
      { key: "grade", header: "Grade", width: 10 },
      { key: "status", header: "Status", width: 13 },
    ];
    sheet.columns = columns;
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.getCell(1, 1).value = `${data.exam.name} - ${data.selectedClass.name}`;
    sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    sheet.getCell(1, 1).alignment = { horizontal: "center" };
    sheet.mergeCells(2, 1, 2, columns.length);
    sheet.getCell(2, 1).value = `Generated ${new Date().toLocaleString()}`;
    sheet.getCell(2, 1).alignment = { horizontal: "center" };
    const header = sheet.getRow(4);
    columns.forEach((column, index) => {
      header.getCell(index + 1).value = column.header;
      sheet.getColumn(index + 1).width = column.width;
    });
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B9BD5" } };
    const markMap = new Map(data.marks.map((item) => [`${item.studentId}:${item.subjectId}`, item]));
    const summaryMap = new Map(data.summaries.map((item) => [item.studentId, item]));
    const rankedStudents = [...data.students].sort((left, right) => {
      const leftPosition = summaryMap.get(left.id)?.classPosition ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = summaryMap.get(right.id)?.classPosition ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition || left.fullName.localeCompare(right.fullName);
    });
    rankedStudents.forEach((student) => {
      const summary = summaryMap.get(student.id);
      const row = {
        position: summary?.classPosition || "-",
        admissionNo: student.admissionNo,
        studentName: student.fullName,
        total: summary?.totalMarksObtained ?? "",
        average: summary?.averagePercentage ?? "",
        grade: summary?.grade || "",
        status: summary?.overallStatus || "Not calculated",
      };
      data.configurations.forEach((item) => {
        const mark = markMap.get(`${student.id}:${item.subjectId}`);
        row[`subject_${item.subjectId}`] = !mark
          ? "Missing"
          : ["Absent", "Exempted"].includes(mark.resultStatus)
          ? mark.resultStatus
          : `${Number(mark.totalMark)} (${mark.grade || "-"})`;
      });
      sheet.addRow(row);
    });
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return;
      row.eachCell((cell) => {
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
        cell.alignment = { vertical: "middle", horizontal: rowNumber === 4 ? "center" : "left" };
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${safeName(data.exam.name)}_${safeName(data.selectedClass.name)}_results.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) { handleError(res, error); }
};

const pdfBuffer = (build) =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 45 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    build(document);
    document.end();
  });

exports.downloadStudentReportCard = async (req, res) => {
  try {
    requireExamId(req.query);
    const models = initializeModels();
    const [student, exam, summary, marks] = await Promise.all([
      models.Student.findByPk(req.params.studentId),
      models.Exam.findByPk(req.query.examId),
      models.ResultSummary.findOne({ where: { examId: req.query.examId, studentId: req.params.studentId } }),
      models.StudentMark.findAll({ where: { examId: req.query.examId, studentId: req.params.studentId } }),
    ]);
    if (!student || !exam) {
      const error = new Error("Student or exam not found");
      error.status = 404;
      throw error;
    }
    assertDepartmentAccess(req.user, student.departmentId);
    if (!summary) {
      const error = new Error("Student result has not been calculated");
      error.status = 409;
      throw error;
    }
    const subjectIds = marks.map((item) => item.subjectId);
    const subjects = await models.Subject.findAll({ where: { id: { [Op.in]: subjectIds } } });
    const subjectMap = new Map(subjects.map((item) => [item.id, item]));
    const buffer = await pdfBuffer((doc) => {
      doc.fontSize(18).font("Helvetica-Bold").text("HTI Student Result Report", { align: "center" });
      doc.moveDown(0.5).fontSize(12).font("Helvetica");
      doc.text(`Exam: ${exam.name}`);
      doc.text(`Student: ${student.fullName}`);
      doc.text(`Admission No: ${student.admissionNo}`);
      doc.moveDown();
      const widths = [190, 75, 75, 65, 75];
      const headers = ["Subject", "Theory", "Practical", "Total", "Grade"];
      const drawRow = (values, bold = false) => {
        if (doc.y > 735) doc.addPage();
        const y = doc.y;
        let x = 45;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        values.forEach((value, index) => {
          doc.rect(x, y, widths[index], 22).stroke("#A0A0A0");
          doc.text(String(value ?? "-"), x + 4, y + 6, { width: widths[index] - 8, height: 14 });
          x += widths[index];
        });
        doc.y = y + 22;
      };
      drawRow(headers, true);
      marks.forEach((mark) =>
        drawRow([
          subjectMap.get(mark.subjectId)?.name || mark.subjectId,
          mark.theoryMark,
          mark.practicalMark,
          ["Absent", "Exempted"].includes(mark.resultStatus) ? mark.resultStatus : mark.totalMark,
          mark.grade,
        ])
      );
      doc.moveDown().font("Helvetica-Bold").fontSize(11);
      doc.text(`Total: ${summary.totalMarksObtained} / ${summary.totalMaximumMarks}`);
      doc.text(`Average: ${summary.averagePercentage ?? "-"}%`);
      doc.text(`Overall Grade: ${summary.grade || "-"}`);
      doc.text(`Status: ${summary.overallStatus}`);
      doc.text(`Class Position: ${summary.classPosition || "-"}`);
      doc.moveDown(2).font("Helvetica").fontSize(8).text(`Generated ${new Date().toLocaleString()}`, { align: "right" });
    });
    const filename = `${safeName(student.admissionNo)}_${safeName(exam.name)}_report.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) { handleError(res, error); }
};

exports.getSubjectAnalysis = async (req, res) => {
  try {
    requireExamId(req.query);
    if (!req.query.classId) return res.status(400).json({ message: "classId is required" });
    const data = await loadClassReport(req.query.examId, req.query.classId, req.user);
    const configuration = data.configurations.find((item) => Number(item.subjectId) === Number(req.params.subjectId));
    if (!configuration) return res.status(404).json({ message: "Subject is not configured for this exam and class" });
    const marks = data.marks.filter((item) => Number(item.subjectId) === Number(req.params.subjectId));
    const numericMarks = marks.filter((item) => ["Pass", "Fail"].includes(item.resultStatus)).map((item) => Number(item.totalMark));
    const passed = marks.filter((item) => item.resultStatus === "Pass").length;
    const failed = marks.filter((item) => ["Fail", "Absent"].includes(item.resultStatus)).length;
    res.status(200).json({
      exam: data.exam,
      class: data.selectedClass,
      subject: data.subjects.find((item) => Number(item.id) === Number(req.params.subjectId)),
      analysis: {
        registered: data.students.length,
        marked: marks.length,
        missing: data.students.length - marks.length,
        passed,
        failed,
        absent: marks.filter((item) => item.resultStatus === "Absent").length,
        exempted: marks.filter((item) => item.resultStatus === "Exempted").length,
        passPercentage: passed + failed ? Number(((passed / (passed + failed)) * 100).toFixed(2)) : 0,
        highestMark: numericMarks.length ? Math.max(...numericMarks) : null,
        lowestMark: numericMarks.length ? Math.min(...numericMarks) : null,
        averageMark: numericMarks.length ? Number((numericMarks.reduce((sum, value) => sum + value, 0) / numericMarks.length).toFixed(2)) : null,
      },
    });
  } catch (error) { handleError(res, error); }
};

exports.getDepartmentAnalysis = async (req, res) => {
  try {
    requireExamId(req.query);
    assertDepartmentAccess(req.user, req.params.departmentId);
    const models = initializeModels();
    const exam = await models.Exam.findByPk(req.query.examId);
    if (!exam) return res.status(404).json({ message: "Exam not found" });
    const classes = await models.Class.findAll({
      where: {
        departmentId: req.params.departmentId,
        academicYearId: exam.academicYearId,
      },
    });
    const classIds = classes.map((item) => item.id);
    const summaries = await models.ResultSummary.findAll({
      where: { examId: req.query.examId, classId: { [Op.in]: classIds } },
    });
    const classMap = new Map(classes.map((item) => [item.id, plain(item)]));
    const byClass = classIds.map((classId) => {
      const rows = summaries.filter((item) => Number(item.classId) === Number(classId));
      const averages = rows.filter((item) => item.averagePercentage !== null).map((item) => Number(item.averagePercentage));
      return {
        class: classMap.get(classId),
        students: rows.length,
        passed: rows.filter((item) => item.overallStatus === "Pass").length,
        failed: rows.filter((item) => item.overallStatus === "Fail").length,
        incomplete: rows.filter((item) => item.overallStatus === "Incomplete").length,
        averagePercentage: averages.length ? Number((averages.reduce((sum, value) => sum + value, 0) / averages.length).toFixed(2)) : null,
      };
    });
    res.status(200).json({
      departmentId: Number(req.params.departmentId),
      exam: plain(exam),
      summary: {
        classes: classes.length,
        students: summaries.length,
        passed: summaries.filter((item) => item.overallStatus === "Pass").length,
        failed: summaries.filter((item) => item.overallStatus === "Fail").length,
        incomplete: summaries.filter((item) => item.overallStatus === "Incomplete").length,
      },
      classes: byClass,
    });
  } catch (error) { handleError(res, error); }
};
