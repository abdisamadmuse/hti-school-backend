const crypto = require("crypto");
const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const XLSX = require("xlsx");
const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");

const previews = new Map();
const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (value) => value && typeof value === "object" ? String(value.result ?? value.text ?? "").trim() : String(value ?? "").trim();
const validReference = (value) => /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(String(value || "").toUpperCase());
const numberOrNull = (value) => value === "" || value == null ? null : Number(value);
const numericId = (value, field) => { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${field} must be a positive integer`), { status: 400 }); return parsed; };
const passMarkValue = (value, fallback = 50) => {
  const parsed = value === "" || value == null ? Number(fallback) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw Object.assign(new Error("passMark must be between 0 and 100"), { status: 400 });
  return parsed;
};
const batchPlain = (batch) => {
  const value = batch.get({ plain: true });
  return { ...value, passMark: Number(value.passMark) };
};

async function workbookSheet(buffer, filename) {
  const workbook = new ExcelJS.Workbook();
  try {
    let input = buffer;
    if (/\.xls$/i.test(filename) && !/\.xlsx$/i.test(filename)) {
      const legacy = XLSX.read(buffer, { type: "buffer", cellDates: true });
      input = XLSX.write(legacy, { type: "buffer", bookType: "xlsx" });
    }
    await workbook.xlsx.load(input);
  } catch (_) { throw Object.assign(new Error("The uploaded file is not a valid Excel workbook"), { status: 400 }); }
  const sheet = workbook.worksheets.find((item) => item.actualRowCount > 0);
  if (!sheet) throw Object.assign(new Error("The workbook contains no populated worksheet"), { status: 400 });
  return sheet;
}

function structure(sheet) {
  const aliases = {
    reference: new Set(["no", "id", "studentid", "serial", "serialno", "reference", "resultreference"]),
    name: new Set(["name", "studentname", "fullname"]),
    totalOne: new Set(["totalfirstterm", "firsttermtotal", "term1total", "termonetotal", "totaltermone", "totalterm1"]),
    totalTwo: new Set(["totalsecondterm", "secondtermtotal", "term2total", "termtwototal", "totaltermtwo", "totalterm2"]),
  };
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const columns = {};
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const key = normalize(text(cell.value));
      for (const [field, values] of Object.entries(aliases)) if (!columns[field] && values.has(key)) columns[field] = column;
    });
    if (!columns.reference || !columns.name) continue;
    const headings = (from, to, term) => {
      const result = [];
      for (let column = from; column <= to; column += 1) {
        const heading = text(row.getCell(column).value);
        if (heading) result.push({ term, heading, column, displayOrder: result.length });
      }
      return result;
    };
    let termOne;
    let termTwo;
    if (columns.totalOne && columns.totalTwo && columns.totalOne < columns.totalTwo) {
      termOne = headings(Math.max(columns.reference, columns.name) + 1, columns.totalOne - 1, "TermOne");
      termTwo = headings(columns.totalOne + 1, columns.totalTwo - 1, "TermTwo");
    } else {
      let termOneStart = null;
      let termTwoStart = null;
      for (let groupRow = Math.max(1, rowNumber - 5); groupRow < rowNumber; groupRow += 1) {
        sheet.getRow(groupRow).eachCell({ includeEmpty: false }, (cell, column) => {
          const label = normalize(text(cell.value));
          if (["termone", "term1", "firstterm"].includes(label)) termOneStart = column;
          if (["termtwo", "term2", "secondterm"].includes(label)) termTwoStart = column;
        });
      }
      const firstSubject = Math.max(columns.reference, columns.name) + 1;
      const secondStart = Number(termTwoStart);
      if (!termOneStart || !secondStart || secondStart <= firstSubject) continue;
      termOne = headings(firstSubject, secondStart - 1, "TermOne");
      termTwo = headings(secondStart, row.cellCount, "TermTwo");
    }
    if (termOne.length && termTwo.length) return { headerRow: rowNumber, columns, termOne, termTwo };
  }
  throw Object.assign(new Error("Could not detect No, Name, and the Term One / Term Two subject groups"), { status: 400 });
}

function parseMark(value, ngStatus) {
  const rawValue = text(value);
  if (!rawValue) return { rawValue, mark: null, markStatus: "Missing" };
  const normalized = normalize(rawValue);
  if (normalized === "ng") return { rawValue, mark: null, markStatus: ngStatus };
  if (["ch", "cheated"].includes(normalized)) return { rawValue, mark: null, markStatus: "Cheated" };
  if (["abs", "absent"].includes(normalized)) return { rawValue, mark: null, markStatus: "Absent" };
  const mark = Number(rawValue);
  if (!Number.isFinite(mark) || mark < 0 || mark > 100) return { rawValue, mark: null, markStatus: "Missing", error: "Mark must be 0-100, NG, CH, Absent or blank" };
  return { rawValue, mark, markStatus: "Present" };
}

async function preview(buffer, filename, input, userId) {
  const academicYear = text(input.academicYear), departmentName = text(input.departmentName), className = text(input.className), sectionName = text(input.sectionName);
  if (!academicYear || !departmentName || !className) throw Object.assign(new Error("academicYear, departmentName and className are required"), { status: 400 });
  const ngStatus = input.ngStatus || "Missing";
  const passMark = passMarkValue(input.passMark);
  if (!["Missing", "Absent"].includes(ngStatus)) throw Object.assign(new Error("ngStatus must be Missing or Absent"), { status: 400 });
  const sheet = await workbookSheet(buffer, filename);
  const layout = structure(sheet);
  const rows = [], errors = [], seen = new Set();
  let numericMarks = 0, ngValues = 0;
  for (let rowNumber = layout.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const studentReference = text(row.getCell(layout.columns.reference).value).toUpperCase();
    const studentName = text(row.getCell(layout.columns.name).value);
    if (!studentReference && !studentName) continue;
    const rowErrors = [];
    if (!validReference(studentReference)) rowErrors.push("Student No must be a unique 3-40 character reference");
    if (!studentName) rowErrors.push("Student name is required");
    if (seen.has(studentReference)) rowErrors.push("Student reference is duplicated");
    if (studentReference) seen.add(studentReference);
    const readMarks = (subjects) => subjects.map((subject) => {
      const mark = parseMark(row.getCell(subject.column).value, ngStatus);
      if (mark.mark != null) numericMarks += 1;
      if (normalize(mark.rawValue) === "ng") ngValues += 1;
      if (mark.error) rowErrors.push(`${subject.heading}: ${mark.error}`);
      return { heading: subject.heading, term: subject.term, ...mark };
    });
    const termOneMarks = readMarks(layout.termOne), termTwoMarks = readMarks(layout.termTwo);
    const calculatedOne = termOneMarks.reduce((sum, mark) => sum + Number(mark.mark || 0), 0);
    const calculatedTwo = termTwoMarks.reduce((sum, mark) => sum + Number(mark.mark || 0), 0);
    const suppliedOne = layout.columns.totalOne ? numberOrNull(text(row.getCell(layout.columns.totalOne).value)) : null;
    const suppliedTwo = layout.columns.totalTwo ? numberOrNull(text(row.getCell(layout.columns.totalTwo).value)) : null;
    if (suppliedOne !== null && (!Number.isFinite(suppliedOne) || suppliedOne !== calculatedOne)) rowErrors.push(`Total First Term should be ${calculatedOne}`);
    if (suppliedTwo !== null && (!Number.isFinite(suppliedTwo) || suppliedTwo !== calculatedTwo)) rowErrors.push(`Total Second Term should be ${calculatedTwo}`);
    rowErrors.forEach((message) => errors.push({ row: rowNumber, message }));
    rows.push({ row: rowNumber, studentReference, studentName, termOneTotal: calculatedOne, termTwoTotal: calculatedTwo, marks: [...termOneMarks, ...termTwoMarks], errors: rowErrors });
  }
  if (!rows.length) throw Object.assign(new Error("No student rows were detected"), { status: 400 });
  const nonce = crypto.randomUUID();
  previews.set(nonce, { academicYear, departmentName, className, sectionName: sectionName || null, ngStatus, passMark, filename, worksheetName: sheet.name, layout, rows, errors });
  const importToken = jwt.sign({ purpose: "temporary-annual-import", nonce, userId: Number(userId) }, process.env.JWT_SECRET, { expiresIn: 15 * 60 });
  return { importToken, worksheet: sheet.name, headerRow: layout.headerRow, academicYear, departmentName, className, sectionName: sectionName || null, passMark,
    subjects: { termOne: layout.termOne.map(({ heading }) => heading), termTwo: layout.termTwo.map(({ heading }) => heading) },
    students: rows, errors,
    summary: { students: rows.length, termOneSubjects: layout.termOne.length, termTwoSubjects: layout.termTwo.length, numericMarks, ngValues, invalidRows: rows.filter((row) => row.errors.length).length } };
}

function tokenPreview(token, userId) {
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch (_) { throw Object.assign(new Error("Import preview expired; preview the workbook again"), { status: 401 }); }
  if (decoded.purpose !== "temporary-annual-import" || Number(decoded.userId) !== Number(userId)) throw Object.assign(new Error("Import token does not belong to this user"), { status: 403 });
  const value = previews.get(decoded.nonce);
  if (!value) throw Object.assign(new Error("Import preview is no longer available"), { status: 410 });
  return { value, nonce: decoded.nonce };
}

async function commit(input, userId) {
  const { value, nonce } = tokenPreview(input.importToken, userId);
  if (value.errors.length) throw Object.assign(new Error("The workbook contains validation errors"), { status: 422, details: { errors: value.errors } });
  const models = initializeModels();
  const result = await sequelize.transaction(async (transaction) => {
    const prior = await models.TemporaryAnnualBatch.findOne({ where: { academicYear: value.academicYear, departmentName: value.departmentName, className: value.className, sectionName: value.sectionName, status: { [Op.in]: ["Validated", "Published"] } }, transaction });
    if (prior && !input.replaceExisting) throw Object.assign(new Error("A temporary annual result already exists for this scope"), { status: 409 });
    if (prior) await prior.update({ status: "Archived" }, { transaction });
    const batch = await models.TemporaryAnnualBatch.create({ academicYear: value.academicYear, departmentName: value.departmentName, className: value.className,
      sectionName: value.sectionName, sourceFilename: value.filename, worksheetName: value.worksheetName, ngStatus: value.ngStatus, passMark: value.passMark, status: "Validated", createdBy: Number(userId) }, { transaction });
    const subjectMap = new Map();
    for (const subject of [...value.layout.termOne, ...value.layout.termTwo]) {
      const created = await models.TemporaryAnnualSubject.create({ batchId: batch.id, term: subject.term, heading: subject.heading, displayOrder: subject.displayOrder, maximumMark: 100 }, { transaction });
      subjectMap.set(`${subject.term}:${subject.heading}`, created);
    }
    let marksCreated = 0;
    for (const row of value.rows) {
      const student = await models.TemporaryAnnualStudent.create({ batchId: batch.id, studentReference: row.studentReference, studentName: row.studentName, termOneTotal: row.termOneTotal, termTwoTotal: row.termTwoTotal }, { transaction });
      for (const mark of row.marks) { await models.TemporaryAnnualMark.create({ studentResultId: student.id, subjectId: subjectMap.get(`${mark.term}:${mark.heading}`).id, mark: mark.mark, markStatus: mark.markStatus, rawValue: mark.rawValue || null }, { transaction }); marksCreated += 1; }
    }
    return { batchId: batch.id, status: batch.status, passMark: Number(batch.passMark), studentsProcessed: value.rows.length, marksCreated, message: "Temporary annual results imported successfully" };
  });
  previews.delete(nonce);
  return result;
}

async function publish(batchId, userId) {
  const models = initializeModels();
  return sequelize.transaction(async (transaction) => {
    const batch = await models.TemporaryAnnualBatch.findByPk(numericId(batchId, "batchId"), { transaction, lock: transaction.LOCK.UPDATE });
    if (!batch) throw Object.assign(new Error("Temporary annual result batch was not found"), { status: 404 });
    if (batch.status !== "Validated") throw Object.assign(new Error("Only a validated batch can be published"), { status: 409 });
    await models.TemporaryAnnualBatch.update({ status: "Archived" }, { where: { academicYear: batch.academicYear, departmentName: batch.departmentName, className: batch.className,
      sectionName: batch.sectionName, status: "Published", id: { [Op.ne]: batch.id } }, transaction });
    const publishedAt = new Date();
    await batch.update({ status: "Published", publishedBy: Number(userId), publishedAt }, { transaction });
    return { batchId: batch.id, status: batch.status, passMark: Number(batch.passMark), publishedAt, message: "Temporary annual results published successfully" };
  });
}

async function details(batchId, publishedOnly = false) {
  const models = initializeModels();
  const batch = await models.TemporaryAnnualBatch.findOne({ where: { id: numericId(batchId, "batchId"), ...(publishedOnly ? { status: "Published" } : {}) } });
  if (!batch) throw Object.assign(new Error("Temporary annual result batch was not found"), { status: 404 });
  const [subjects, students] = await Promise.all([
    models.TemporaryAnnualSubject.findAll({ where: { batchId: batch.id }, order: [["term", "ASC"], ["displayOrder", "ASC"]] }),
    models.TemporaryAnnualStudent.findAll({ where: { batchId: batch.id }, order: [["studentName", "ASC"]] }),
  ]);
  const marks = students.length ? await models.TemporaryAnnualMark.findAll({ where: { studentResultId: { [Op.in]: students.map((item) => item.id) } } }) : [];
  const subjectMap = new Map(subjects.map((item) => [Number(item.id), item.get({ plain: true })]));
  const marksByStudent = new Map();
  marks.forEach((mark) => { if (!marksByStudent.has(Number(mark.studentResultId))) marksByStudent.set(Number(mark.studentResultId), []); marksByStudent.get(Number(mark.studentResultId)).push({ id: mark.id, subject: subjectMap.get(Number(mark.subjectId)), mark: mark.mark === null ? null : Number(mark.mark), markStatus: mark.markStatus, rawValue: mark.rawValue }); });
  return { batch: batchPlain(batch), subjects: subjects.map((item) => item.get({ plain: true })), students: students.map((student) => ({ ...student.get({ plain: true }), termOneTotal: Number(student.termOneTotal), termTwoTotal: Number(student.termTwoTotal), marks: marksByStudent.get(Number(student.id)) || [] })) };
}

async function list() { const models = initializeModels(); const rows = await models.TemporaryAnnualBatch.findAll({ order: [["createdAt", "DESC"]] }); return { count: rows.length, data: rows.map(batchPlain) }; }
async function updateNames(batchId, input) {
  const hasDepartmentName = Object.prototype.hasOwnProperty.call(input || {}, "departmentName");
  const hasClassName = Object.prototype.hasOwnProperty.call(input || {}, "className");
  const hasPassMark = Object.prototype.hasOwnProperty.call(input || {}, "passMark");
  if (!hasDepartmentName && !hasClassName && !hasPassMark) {
    throw Object.assign(new Error("departmentName, className or passMark is required"), { status: 400 });
  }
  const changes = {};
  if (hasDepartmentName) changes.departmentName = text(input.departmentName);
  if (hasClassName) changes.className = text(input.className);
  if (hasPassMark) changes.passMark = passMarkValue(input.passMark);
  for (const [field, value] of Object.entries(changes).filter(([field]) => field !== "passMark")) {
    if (!value) throw Object.assign(new Error(`${field} cannot be empty`), { status: 400 });
    if (value.length > 255) throw Object.assign(new Error(`${field} cannot exceed 255 characters`), { status: 400 });
  }

  const models = initializeModels();
  return sequelize.transaction(async (transaction) => {
    const batch = await models.TemporaryAnnualBatch.findByPk(numericId(batchId, "batchId"), { transaction, lock: transaction.LOCK.UPDATE });
    if (!batch) throw Object.assign(new Error("Temporary annual result batch was not found"), { status: 404 });
    const next = { departmentName: changes.departmentName || batch.departmentName, className: changes.className || batch.className };
    if (batch.status !== "Archived") {
      const duplicate = await models.TemporaryAnnualBatch.findOne({
        where: {
          academicYear: batch.academicYear,
          departmentName: next.departmentName,
          className: next.className,
          sectionName: batch.sectionName,
          status: { [Op.in]: ["Validated", "Published"] },
          id: { [Op.ne]: batch.id },
        },
        transaction,
      });
      if (duplicate) throw Object.assign(new Error("Another active annual result batch already uses these names"), { status: 409 });
    }
    await batch.update(changes, { transaction });
    return { message: "Annual result batch updated successfully", batch: batchPlain(batch) };
  });
}
async function deleteBatch(batchId) {
  const models = initializeModels();
  return sequelize.transaction(async (transaction) => {
    const batch = await models.TemporaryAnnualBatch.findByPk(numericId(batchId, "batchId"), { transaction, lock: transaction.LOCK.UPDATE });
    if (!batch) throw Object.assign(new Error("Temporary annual result batch was not found"), { status: 404 });
    const students = await models.TemporaryAnnualStudent.findAll({ where: { batchId: batch.id }, attributes: ["id"], transaction });
    const studentIds = students.map((student) => student.id);
    const marksDeleted = studentIds.length
      ? await models.TemporaryAnnualMark.destroy({ where: { studentResultId: { [Op.in]: studentIds } }, transaction })
      : 0;
    const studentsDeleted = await models.TemporaryAnnualStudent.destroy({ where: { batchId: batch.id }, transaction });
    const subjectsDeleted = await models.TemporaryAnnualSubject.destroy({ where: { batchId: batch.id }, transaction });
    const deletedBatch = batchPlain(batch);
    await batch.destroy({ transaction });
    return {
      message: "Temporary annual result batch deleted permanently",
      batch: deletedBatch,
      deleted: { students: studentsDeleted, subjects: subjectsDeleted, marks: marksDeleted },
    };
  });
}
async function correctMark(batchId, markId, input) {
  const models = initializeModels();
  return sequelize.transaction(async (transaction) => {
    const mark = await models.TemporaryAnnualMark.findByPk(numericId(markId, "markId"), { transaction, lock: transaction.LOCK.UPDATE });
    if (!mark) throw Object.assign(new Error("Annual mark was not found"), { status: 404 });
    const student = await models.TemporaryAnnualStudent.findOne({ where: { id: mark.studentResultId, batchId: numericId(batchId, "batchId") }, transaction, lock: transaction.LOCK.UPDATE });
    if (!student) throw Object.assign(new Error("Mark does not belong to this annual batch"), { status: 404 });
    const status = ["Present", "Missing", "Absent", "Cheated"].includes(input.markStatus) ? input.markStatus : "Present";
    const value = status === "Present" ? numberOrNull(input.mark) : null;
    if (status === "Present" && (value === null || !Number.isFinite(value) || value < 0 || value > 100)) throw Object.assign(new Error("Mark must be between 0 and 100"), { status: 400 });
    await mark.update({ mark: value, markStatus: status, rawValue: status === "Present" ? String(value) : status === "Cheated" ? "CH" : status }, { transaction });
    const subjects = await models.TemporaryAnnualSubject.findAll({ where: { batchId: student.batchId }, transaction });
    const subjectTerms = new Map(subjects.map((subject) => [Number(subject.id), subject.term]));
    const marks = await models.TemporaryAnnualMark.findAll({ where: { studentResultId: student.id }, transaction });
    let termOneTotal = 0; let termTwoTotal = 0;
    marks.forEach((item) => { if (item.mark !== null && item.markStatus === "Present") { if (subjectTerms.get(Number(item.subjectId)) === "TermOne") termOneTotal += Number(item.mark); else termTwoTotal += Number(item.mark); } });
    await student.update({ termOneTotal, termTwoTotal }, { transaction });
    return { message: "Annual mark updated successfully", markId: mark.id, termOneTotal, termTwoTotal };
  });
}
async function publicResult(reference) {
  const models = initializeModels();
  const batches = await models.TemporaryAnnualBatch.findAll({ where: { status: "Published" }, attributes: ["id"], order: [["publishedAt", "DESC"]] });
  const student = batches.length ? await models.TemporaryAnnualStudent.findOne({ where: { studentReference: text(reference).toUpperCase(), batchId: { [Op.in]: batches.map((item) => item.id) } }, order: [["createdAt", "DESC"]] }) : null;
  if (!student) throw Object.assign(new Error("No published temporary annual result was found"), { status: 404 });
  const data = await details(student.batchId, true);
  return { batch: data.batch, subjects: data.subjects, student: data.students.find((item) => Number(item.id) === Number(student.id)) };
}

module.exports = { preview, commit, publish, details, list, updateNames, deleteBatch, publicResult, correctMark };
