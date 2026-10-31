const PDFDocument = require("pdfkit");
const path = require("path");
const logoPath = path.join(__dirname, "../../../assets/hti-logo.jpg");
const { initializeModels } = require("../../../config/mysql");
const { allowedDepartmentIds } = require("../../../middleware/portalAccessMiddleware");

exports.getClassStudentReport = async (req, res) => {
  try {
    const classId = Number(req.params.classId);
    if (!Number.isSafeInteger(classId) || classId < 1) return res.status(400).json({ message: "Select a valid class" });
    const models = initializeModels();
    const selectedClass = await models.Class.findByPk(classId);
    if (!selectedClass) return res.status(404).json({ message: "Class not found" });
    if (req.user.role === "HeadDepartment" && !allowedDepartmentIds(req.user).includes(Number(selectedClass.departmentId))) {
      return res.status(403).json({ message: "This class belongs to another department" });
    }
    const where = { classId };
    if (req.query.academicYearId) {
      const yearId = Number(req.query.academicYearId);
      if (!Number.isSafeInteger(yearId) || yearId < 1) return res.status(400).json({ message: "Invalid academic year" });
      where.academicYearId = yearId;
    }
    if (req.query.status) {
      if (!["Active", "Graduated", "Dropped", "Transferred", "Suspended"].includes(req.query.status)) return res.status(400).json({ message: "Invalid student status" });
      where.status = req.query.status;
    }
    if (req.user.role === "HeadDepartment") where.departmentId = selectedClass.departmentId;
    const [students, year] = await Promise.all([
      models.Student.findAll({ where, attributes: ["admissionNo", "fullName", "gender", "phone", "status"], order: [["fullName", "ASC"], ["id", "ASC"]], raw: true }),
      where.academicYearId ? models.AcademicYear.findByPk(where.academicYearId) : null,
    ]);
    const report = { className: selectedClass.name, academicYear: year?.name || "All academic years", status: where.status || "All statuses", generatedAt: new Date().toISOString(), students };
    res.setHeader("Cache-Control", "no-store");
    if (req.query.format !== "pdf") return res.json(report);

    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Student report - ${report.className}`, Author: "Hargeisa Technical Institute" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", () => { if (!res.headersSent) res.status(500).json({ message: "Unable to generate PDF" }); });
    doc.on("end", () => {
      if (res.headersSent) return;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="class-${classId}-students.pdf"`);
      res.send(Buffer.concat(chunks));
    });
    const columns = [{ title: "#", width: 28 }, { title: "Admission No", width: 92 }, { title: "Student name", width: 180 }, { title: "Gender", width: 55 }, { title: "Phone", width: 85 }, { title: "Status", width: 55 }];
    let y;
    const heading = () => {
      doc.rect(40, 36, 515, 4).fill("#17385f");
      doc.image(logoPath, 40, 52, { width: 72, height: 72 });
      doc.fillColor("#17385f").font("Helvetica-Bold").fontSize(19).text("HARGEISA", 127, 58, { width: 428 });
      doc.fontSize(16).text("TECHNICAL INSTITUTE", 127, 81, { width: 428 });
      doc.fillColor("#64748b").font("Helvetica").fontSize(9).text("SINCE 1952  |  STUDENT RECORDS", 127, 106, { width: 428 });
      doc.roundedRect(40, 142, 515, 57, 5).fill("#17385f");
      doc.fillColor("#cbd9eb").fontSize(8).text("CLASS STUDENT REPORT", 54, 153);
      doc.fillColor("white").font("Helvetica-Bold").fontSize(16).text(report.className, 54, 169, { width: 385, height: 24, ellipsis: true });
      doc.fontSize(20).text(String(students.length), 450, 151, { width: 90, align: "right" });
      doc.font("Helvetica").fontSize(8).text("STUDENTS", 450, 177, { width: 90, align: "right" });
      doc.fillColor("#64748b").fontSize(8).text("ACADEMIC YEAR", 40, 215).text("STATUS", 237, 215).text("GENERATED", 410, 215);
      doc.fillColor("#17385f").font("Helvetica-Bold").fontSize(10);
      doc.text(report.academicYear, 40, 229, { width: 187, height: 28, ellipsis: true });
      doc.text(report.status, 237, 229, { width: 163 });
      doc.text(report.generatedAt.slice(0, 10), 410, 229, { width: 145 });
      y = 272;
      doc.rect(40, y - 8, 515, 28).fill("#e9eff7");
      let x = 40;
      doc.fillColor("#17385f").font("Helvetica-Bold").fontSize(8);
      for (const column of columns) { doc.text(column.title, x + 5, y, { width: column.width - 10 }); x += column.width; }
      y += 25;
      doc.font("Helvetica").fontSize(9).fillColor("#26364b");
    };
    heading();
    students.forEach((student, index) => {
      const values = [String(index + 1), student.admissionNo, student.fullName, student.gender, student.phone, student.status].map((value) => String(value || "-"));
      const height = Math.max(30, ...values.map((value, i) => doc.heightOfString(value, { width: columns[i].width - 10 }) + 14));
      if (y + height > doc.page.height - 60) { doc.addPage(); heading(); }
      if (index % 2 === 0) doc.rect(40, y - 5, 515, height).fill("#f4f7fb");
      doc.fillColor("#26364b");
      let x = 40;
      values.forEach((value, i) => { doc.text(value, x + 5, y + 2, { width: columns[i].width - 10 }); x += columns[i].width; });
      y += height;
      doc.moveTo(40, y - 5).lineTo(555, y - 5).strokeColor("#dddddd").stroke();
    });
    if (!students.length) doc.text("No students match this class and the selected filters.", 40, y);
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(40, doc.page.height - 57).lineTo(555, doc.page.height - 57).strokeColor("#cbd5e1").stroke();
      doc.fillColor("#64748b").fontSize(8).text("HTI  /  Student records", 40, doc.page.height - 46, { width: 350 });
      doc.text(`Page ${i + 1} of ${pages.count}`, 440, doc.page.height - 46, { align: "right", width: 115 });
    }
    doc.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
