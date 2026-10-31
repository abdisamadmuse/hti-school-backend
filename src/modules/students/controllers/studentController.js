const Student = require("../models/Student");
const ClassSection = require("../../classSections/models/ClassSection");
const { Op, QueryTypes } = require("sequelize");
const { initializeModels, sequelize } = require("../../../config/mysql");
const ExcelJS = require("exceljs");

const positiveInteger = (value, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    const error = new Error(`Value must be an integer between 1 and ${maximum}`);
    error.status = 400;
    throw error;
  }
  return parsed;
};

const document = (row) => row ? { ...row.get({ plain: true }), _id: row.id } : null;

const populateStudentRows = async (rows, models) => {
  const relationFields = {
    academicYearId: models.AcademicYear,
    programId: models.Program,
    departmentId: models.Department,
    classId: models.Class,
    classSectionId: models.ClassSection,
  };
  const maps = {};
  await Promise.all(Object.entries(relationFields).map(async ([field, model]) => {
    const ids = [...new Set(rows.map((row) => Number(row[field])).filter((value) => Number.isInteger(value) && value > 0))];
    const related = ids.length ? await model.findAll({ where: { id: { [Op.in]: ids } } }) : [];
    maps[field] = new Map(related.map((item) => [Number(item.id), document(item)]));
  }));
  return rows.map((row) => {
    const value = document(row);
    for (const field of Object.keys(relationFields)) value[field] = maps[field].get(Number(row[field])) || null;
    return value;
  });
};

const validateClassSection = async (data, currentStudent = null) => {
  if (
    currentStudent &&
    data.classId !== undefined &&
    String(data.classId) !== String(currentStudent.classId) &&
    data.classSectionId === undefined
  ) {
    data.classSectionId = null;
    return;
  }

  if (data.classSectionId === undefined || data.classSectionId === null || data.classSectionId === "") {
    return;
  }

  const section = await ClassSection.findById(data.classSectionId);
  const classId = data.classId || currentStudent?.classId;
  if (!section || String(section.classId) !== String(classId)) {
    const error = new Error("Class section does not belong to the selected class");
    error.status = 400;
    throw error;
  }
};

const buildFileUrl = (req, file) =>
  `${req.protocol}://${req.get("host")}/uploads/students/${file.destination
    .split(/[\\/]/)
    .pop()}/${file.filename}`;

const addUploadedFileUrls = (req) => {
  if (!req.files) {
    return;
  }

  const fileFields = {
    photo: "photoUrl",
    notaryDocument: "notaryDocumentUrl",
    certificateDocument: "certificateDocumentUrl",
  };

  Object.entries(fileFields).forEach(([fileField, bodyField]) => {
    const file = req.files[fileField]?.[0];

    if (file) {
      req.body[bodyField] = buildFileUrl(req, file);
    }
  });
};

// Create Student
exports.createStudent = async (req, res) => {
  try {
    addUploadedFileUrls(req);
    await validateClassSection(req.body);

    const student = await Student.create(req.body);

    res.status(201).json({
      message: "Student created successfully",
      data: student,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get All Students
exports.getStudents = async (req, res) => {
  try {
    const models = initializeModels();
    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const where = {};
    for (const field of ["academicYearId", "programId", "departmentId", "classId", "classSectionId"]) {
      if (req.query[field] !== undefined && req.query[field] !== "") where[field] = positiveInteger(req.query[field]);
    }
    for (const field of ["gender", "status"]) if (req.query[field]) where[field] = req.query[field];
    if (req.query.isActive !== undefined) {
      if (!['true', 'false'].includes(String(req.query.isActive).toLowerCase())) {
        const error = new Error("isActive must be true or false");
        error.status = 400;
        throw error;
      }
      where.isActive = String(req.query.isActive).toLowerCase() === "true";
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      const match = { [Op.like]: `%${search}%` };
      where[Op.or] = ["fullName", "admissionNo", "phone", "parentName", "parentPhone"].map((field) => ({ [field]: match }));
    }
    const result = await models.Student.findAndCountAll({
      where,
      limit,
      offset: (page - 1) * limit,
      order: [["createdAt", "DESC"]],
    });
    const students = await populateStudentRows(result.rows, models);
    const [active, female] = await Promise.all([
      models.Student.count({ where: { [Op.and]: [where, { status: "Active" }] } }),
      models.Student.count({ where: { [Op.and]: [where, { gender: "Female" }] } }),
    ]);

    res.status(200).json({
      count: students.length,
      total: result.count,
      summary: { active, female },
      page,
      limit,
      totalPages: Math.ceil(result.count / limit),
      data: students,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get Student By Id
exports.getStudentById = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate("academicYearId")
      .populate("programId")
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId");

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    res.status(200).json({
      data: student,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Student
exports.updateStudent = async (req, res) => {
  try {
    addUploadedFileUrls(req);
    const currentStudent = await Student.findById(req.params.id);

    if (!currentStudent) {
      return res.status(404).json({ message: "Student not found" });
    }

    await validateClassSection(req.body, currentStudent);

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("academicYearId")
      .populate("programId")
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId");

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    res.status(200).json({
      message: "Student updated successfully",
      data: student,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Delete Student
exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    res.status(200).json({
      message: "Student deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Students By Class
exports.getStudentsByClass = async (req, res) => {
  try {
    const filters = {
      classId: req.params.classId,
      isActive: true,
    };
    if (req.query.classSectionId) filters.classSectionId = req.query.classSectionId;

    const students = await Student.find(filters)
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId")
      .sort({ fullName: 1 });

    res.status(200).json({
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Bulk Upload Students
exports.downloadBulkTemplate = async (req, res) => {
  try {
    const models = initializeModels();
    const classId = positiveInteger(req.query.classId);
    const departmentId = positiveInteger(req.query.departmentId);
    const selectedClass = await models.Class.findByPk(classId);
    if (!selectedClass || Number(selectedClass.departmentId) !== departmentId) return res.status(400).json({ message: "Class does not belong to the selected department" });
    const [department, program, year, sections] = await Promise.all([models.Department.findByPk(departmentId), models.Program.findByPk(selectedClass.programId), models.AcademicYear.findByPk(selectedClass.academicYearId), models.ClassSection.findAll({ where: { classId, isActive: true } })]);
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Students");
    sheet.columns = [
      { header: "fullName", key: "fullName", width: 30 }, { header: "gender", key: "gender", width: 14 }, { header: "dateOfBirth", key: "dateOfBirth", width: 16 }, { header: "phone", key: "phone", width: 18 }, { header: "address", key: "address", width: 24 }, { header: "parentName", key: "parentName", width: 28 }, { header: "parentPhone", key: "parentPhone", width: 18 }, { header: "parentRelationship", key: "parentRelationship", width: 20 }, { header: "department", key: "department", width: 28 }, { header: "class", key: "class", width: 18 }, { header: "status", key: "status", width: 14 }, { header: "isActive", key: "isActive", width: 12 }, { header: "section", key: "section", width: 18 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B55C4" } }; sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = "A1:M1";
    for (let row = 2; row <= 501; row++) {
      sheet.getCell(`B${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"Male,Female"'] };
      sheet.getCell(`H${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Father,Mother,Guardian,Other"'] };
      sheet.getCell(`I${row}`).value = department?.name || ""; sheet.getCell(`J${row}`).value = selectedClass.name; sheet.getCell(`K${row}`).value = "Active"; sheet.getCell(`L${row}`).value = true;
      sheet.getCell(`K${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"Active,Graduated,Dropped,Transferred,Suspended"'] };
      sheet.getCell(`L${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"TRUE,FALSE"'] };
      if (sections.length) sheet.getCell(`M${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${sections.map((item) => item.name).join(",")}"`] };
    }
    const info = workbook.addWorksheet("Class Information"); info.addRows([["Field", "Value"], ["Class ID", classId], ["Class", selectedClass.name], ["Department ID", departmentId], ["Department", department?.name || ""], ["Program ID", selectedClass.programId], ["Program", program?.name || ""], ["Academic Year ID", selectedClass.academicYearId], ["Academic Year", year?.name || ""]]); info.getRow(1).font = { bold: true }; info.state = "veryHidden";
    const buffer = await workbook.xlsx.writeBuffer(); res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); res.setHeader("Content-Disposition", `attachment; filename="${String(selectedClass.name).replace(/[^a-z0-9_-]/gi, "_")}_students_template.xlsx"`); res.send(buffer);
  } catch (error) { res.status(error.status || 500).json({ message: error.message }); }
};

const insertStudentsWithGeneratedAdmissionNumbers = async (rows) => {
  let allocationDiagnostics = null;
  const inserted = await sequelize.transaction(async (transaction) => {
    const models = initializeModels();
    const allocationLock = await models.AcademicYear.findOne({
      attributes: ["id"],
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!allocationLock) {
      const error = new Error("No academic year exists for admission number allocation");
      error.status = 409;
      throw error;
    }

    const [lastAdmission] = await sequelize.query(
      "SELECT MAX(CAST(SUBSTRING(`admissionNo`, 5) AS UNSIGNED)) AS lastNumber FROM `students` WHERE `admissionNo` REGEXP '^HTI-[0-9]+$'",
      { type: QueryTypes.SELECT, transaction }
    );
    const observedMaximum = Number(lastAdmission?.lastNumber || 0);
    let firstNumber = observedMaximum + 1;
    let admissionNumbers;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      admissionNumbers = rows.map((_, index) => `HTI-${String(firstNumber + index).padStart(4, "0")}`);
      const conflicts = await models.Student.findAll({
        attributes: ["admissionNo"],
        where: { admissionNo: { [Op.in]: admissionNumbers } },
        transaction,
      });
      if (!conflicts.length) {
        allocationDiagnostics = {
          observedMaximum,
          selectedFirstNumber: firstNumber,
          batchSize: rows.length,
          conflictChecks: attempt + 1,
        };
        break;
      }

      const conflictingNumbers = conflicts
        .map((student) => String(student.admissionNo).match(/^HTI-(\d+)$/i))
        .filter(Boolean)
        .map((match) => Number(match[1]));
      firstNumber = Math.max(firstNumber + 1, ...conflictingNumbers.map((number) => number + 1));
      if (attempt === 99) {
        const error = new Error("Could not find an unused admission number range; retry the upload");
        error.status = 409;
        throw error;
      }
    }

    rows.forEach((item, index) => { item.admissionNo = admissionNumbers[index]; });
    return models.Student.bulkCreate(rows, { transaction });
  });

  return { inserted, allocationDiagnostics };
};

exports.bulkUploadStudents = async (req, res) => {
  let allocationDiagnostics = null;
  res.setHeader("X-Student-Upload-Allocator", "max-scan-conflict-guard-v1");
  try {
    if (req.file) {
      const models = initializeModels(); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(req.file.buffer); const sheet = workbook.getWorksheet("Students"); const info = workbook.getWorksheet("Class Information");
      if (!sheet || !info) return res.status(422).json({ message: "Invalid student template" });
      const metadata = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(info.getCell(index + 2, 1).value), info.getCell(index + 2, 2).value]));
      const classId = Number(metadata["Class ID"]), departmentId = Number(metadata["Department ID"]), selectedClass = await models.Class.findByPk(classId);
      if (!selectedClass || Number(selectedClass.departmentId) !== departmentId) return res.status(422).json({ message: "Template class information is invalid" });
      const sections = await models.ClassSection.findAll({ where: { classId } }); const sectionMap = new Map(sections.map((item) => [String(item.name).trim().toLowerCase(), item.id])); const rows = []; const errors = [];
      const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); const headers = {}; sheet.getRow(1).eachCell((cell, column) => { headers[normalizeHeader(cell.text)] = column; });
      const requiredHeaders = ["fullname", "gender", "parentname", "parentphone"]; const missingHeaders = requiredHeaders.filter((header) => !headers[header]); if (missingHeaders.length) return res.status(422).json({ message: `Missing required columns: ${missingHeaders.join(", ")}` });
      const cell = (row, name) => headers[name] ? String(row.getCell(headers[name]).text || "").trim() : "";
      sheet.eachRow((row, rowNumber) => { if (rowNumber === 1) return; const fullName = cell(row, "fullname"), gender = cell(row, "gender"); if (!fullName && !gender) return; const dateOfBirth = cell(row, "dateofbirth"), phone = cell(row, "phone"), address = cell(row, "address"), parentName = cell(row, "parentname"), parentPhone = cell(row, "parentphone"), relationship = cell(row, "parentrelationship"), section = cell(row, "section"), departmentName = cell(row, "department"), className = cell(row, "class"), status = cell(row, "status") || "Active", activeText = cell(row, "isactive") || "TRUE"; const rowErrors = []; if (!fullName) rowErrors.push("fullName is required"); if (!["Male", "Female"].includes(gender)) rowErrors.push("gender must be Male or Female"); if (!parentName) rowErrors.push("parentName is required"); if (!parentPhone) rowErrors.push("parentPhone is required"); if (departmentName && departmentName.toLowerCase() !== String(metadata.Department || "").toLowerCase()) rowErrors.push("department does not match the template"); if (className && className.toLowerCase() !== String(metadata.Class || "").toLowerCase()) rowErrors.push("class does not match the template"); if (!["Active", "Graduated", "Dropped", "Transferred", "Suspended"].includes(status)) rowErrors.push("status is invalid"); const classSectionId = section ? sectionMap.get(section.toLowerCase()) : null; if (section && !classSectionId) rowErrors.push("section is not valid for this class"); if (rowErrors.length) errors.push(`Row ${rowNumber}: ${rowErrors.join(", ")}`); else rows.push({ fullName, gender, dateOfBirth: dateOfBirth || null, phone: phone || null, address: address || null, parentName, parentPhone, parentRelationship: ["Father", "Mother", "Guardian", "Other"].includes(relationship) ? relationship : "Guardian", academicYearId: selectedClass.academicYearId, programId: selectedClass.programId, departmentId, classId, classSectionId, status, isActive: !["false", "0", "no"].includes(activeText.toLowerCase()) }); });
      if (errors.length) return res.status(422).json({ message: "Student file contains validation errors", errors }); if (!rows.length) return res.status(400).json({ message: "No student rows were found" });
      const { inserted, allocationDiagnostics: allocation } = await insertStudentsWithGeneratedAdmissionNumbers(rows);
      allocationDiagnostics = allocation;
      return res.status(201).json({ message: "Students uploaded successfully", count: inserted.length, data: inserted });
    }
    const students = req.body.students;

    if (!students || !Array.isArray(students)) {
      return res.status(400).json({
        message: "Students must be an array",
      });
    }

    if (!students.length) return res.status(400).json({ message: "No student rows were provided" });
    const studentErrors = [];
    students.forEach((student, index) => {
      if (!String(student?.parentName || "").trim()) studentErrors.push(`Row ${index + 1}: parentName is required (JSON key: parentName)`);
      if (!String(student?.parentPhone || "").trim()) studentErrors.push(`Row ${index + 1}: parentPhone is required (JSON key: parentPhone)`);
    });
    if (studentErrors.length) {
      return res.status(422).json({ message: "Student data is missing required parent information", errors: studentErrors });
    }
    const { inserted: insertedStudents, allocationDiagnostics: allocation } = await insertStudentsWithGeneratedAdmissionNumbers(students);
    allocationDiagnostics = allocation;

    res.status(201).json({
      message: "Students uploaded successfully",
      count: insertedStudents.length,
      data: insertedStudents,
    });
  } catch (error) {
    // Sequelize's top-level message is often only "Validation error". Return
    // individual field/constraint messages so the spreadsheet can be fixed.
    const validationErrors = Array.isArray(error.errors)
      ? error.errors.map((item) => {
        const field = item.path || item.validatorKey || "record";
        const admissionNumber = field === "admissionNo" && item.value
          ? ` (${item.value})`
          : "";
        return `${field}${admissionNumber}: ${item.message || item.type || error.message}`;
      })
      : [];
    const duplicateErrors = error.fields && typeof error.fields === "object"
      ? Object.keys(error.fields).map((field) => `${field}: value already exists`)
      : [];
    const errors = validationErrors.length ? validationErrors : duplicateErrors;
    const isValidation = error.name === "SequelizeValidationError"
      || error.name === "SequelizeUniqueConstraintError"
      || error.name === "SequelizeForeignKeyConstraintError"
      || error.name === "SequelizeBulkRecordError";
    console.error("Student bulk upload failed:", error);
    res.status(isValidation ? 422 : error.status || 500).json({
      message: errors.length ? "Student upload validation failed" : error.message,
      ...(errors.length ? { errors } : {}),
      ...(allocationDiagnostics ? { allocation: allocationDiagnostics } : {}),
    });
  }
};
