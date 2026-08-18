const crypto = require("crypto");
const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const XLSX = require("xlsx");
const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");

const previews = new Map();
const TOKEN_TTL_SECONDS = 15 * 60;
const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (value) => {
  if (value && typeof value === "object") return String(value.result ?? value.text ?? "").trim();
  return String(value ?? "").trim();
};
const id = (value, field) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${field} is required and must be a positive integer`), { status: 400 });
  return parsed;
};
const referenceHeaders = new Set(["resultreference", "legacyreference", "legacyid", "studentreference", "reference"]);
const nameHeaders = new Set(["studentname", "name", "fullname", "studentfullname"]);
const endingHeaders = new Set(["total", "marksobtained", "grandtotal", "pass", "passfail", "result", "status", "grade", "average", "percentage"]);
const newLegacyStudentKey = () => `LST-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
const validLegacyStudentKey = (value) => /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(String(value || "").toUpperCase());
const comparableName = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nameSimilarity = (leftValue, rightValue) => {
  const left = comparableName(leftValue);
  const right = comparableName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
};

async function loadWorkbook(buffer, filename) {
  const workbook = new ExcelJS.Workbook();
  try {
    let workbookBuffer = buffer;
    if (/\.xls$/i.test(filename) && !/\.xlsx$/i.test(filename)) {
      const legacyWorkbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      workbookBuffer = XLSX.write(legacyWorkbook, { type: "buffer", bookType: "xlsx" });
    }
    await workbook.xlsx.load(workbookBuffer);
  } catch (_) {
    throw Object.assign(new Error("The uploaded file is not a valid Excel workbook"), { status: 400 });
  }
  const sheet = workbook.worksheets.find((item) => item.actualRowCount > 0);
  if (!sheet) throw Object.assign(new Error("The workbook contains no populated worksheet"), { status: 400 });
  return sheet;
}

function detectStructure(sheet) {
  const limit = Math.min(sheet.rowCount, 30);
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    let referenceColumn = null;
    let nameColumn = null;
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const heading = normalize(text(cell.value));
      if (!referenceColumn && referenceHeaders.has(heading)) referenceColumn = column;
      if (!nameColumn && nameHeaders.has(heading)) nameColumn = column;
    });
    if (!nameColumn) continue;
    const identityEnd = Math.max(referenceColumn || 0, nameColumn);
    const subjects = [];
    for (let column = identityEnd + 1; column <= row.cellCount; column += 1) {
      const heading = text(row.getCell(column).value);
      if (!heading) continue;
      if (endingHeaders.has(normalize(heading))) break;
      subjects.push({ excelHeading: heading, column });
    }
    if (subjects.length) return { headerRow: rowNumber, referenceColumn, nameColumn, subjects };
  }
  throw Object.assign(new Error("Could not detect the header row. Include Student Name, optional Result Reference, then the subject columns"), { status: 400 });
}

async function loadScope(input) {
  const models = initializeModels();
  const scope = {
    academicYearId: id(input.academicYearId, "academicYearId"), termId: id(input.termId, "termId"),
    examId: id(input.examId, "examId"), departmentId: id(input.departmentId, "departmentId"),
    classId: id(input.classId, "classId"), classSectionId: input.classSectionId ? id(input.classSectionId, "classSectionId") : null,
  };
  const ngStatus = input.ngStatus;
  if (!["Missing", "Absent"].includes(ngStatus)) throw Object.assign(new Error("ngStatus must be Missing or Absent"), { status: 400 });
  const [year, term, exam, department, selectedClass, section, configurations] = await Promise.all([
    models.AcademicYear.findByPk(scope.academicYearId), models.Term.findByPk(scope.termId), models.Exam.findByPk(scope.examId),
    models.Department.findByPk(scope.departmentId), models.Class.findByPk(scope.classId),
    scope.classSectionId ? models.ClassSection.findByPk(scope.classSectionId) : Promise.resolve(null),
    models.ExamSubject.findAll({ where: { examId: scope.examId, classId: scope.classId, departmentId: scope.departmentId, isActive: true } }),
  ]);
  if (!year || !term || !exam || !department || !selectedClass) throw Object.assign(new Error("One or more selected records were not found"), { status: 404 });
  if (Number(term.academicYearId) !== scope.academicYearId || Number(exam.academicYearId) !== scope.academicYearId || Number(exam.termId) !== scope.termId || Number(selectedClass.departmentId) !== scope.departmentId) {
    throw Object.assign(new Error("The selected academic year, term, exam, department and class do not belong together"), { status: 400 });
  }
  if (scope.classSectionId && (!section || Number(section.classId) !== scope.classId)) throw Object.assign(new Error("The selected section does not belong to this class"), { status: 400 });
  if (!configurations.length) throw Object.assign(new Error("No active exam subjects are configured for the selected class"), { status: 404 });
  return { models, scope, ngStatus, configurations };
}

async function buildPreview(buffer, filename, input, userId) {
  const context = await loadScope(input);
  const sheet = await loadWorkbook(buffer, filename);
  const structure = detectStructure(sheet);
  const subjectIds = context.configurations.map((item) => item.subjectId);
  const subjects = await context.models.Subject.findAll({ where: { id: { [Op.in]: subjectIds } } });
  const subjectById = new Map(subjects.map((item) => [Number(item.id), item.get({ plain: true })]));
  const configDetails = context.configurations.map((item) => ({ ...item.get({ plain: true }), subject: subjectById.get(Number(item.subjectId)) }));
  const keyToConfig = new Map();
  configDetails.forEach((item) => [item.subject?.name, item.subject?.code].forEach((value) => value && keyToConfig.set(normalize(value), item)));
  const detectedSubjects = structure.subjects.map((item) => ({ excelHeading: item.excelHeading, suggestedExamSubjectId: keyToConfig.get(normalize(item.excelHeading))?.id || null, examSubjectId: null }));
  const suggestedByHeading = new Map(detectedSubjects.map((item) => [item.excelHeading, item.suggestedExamSubjectId ? configDetails.find((config) => Number(config.id) === Number(item.suggestedExamSubjectId)) : null]));
  const priorBatches = await context.models.LegacyResultBatch.findAll({ where: {
    academicYearId: context.scope.academicYearId, classId: context.scope.classId,
    ...(context.scope.classSectionId ? { classSectionId: context.scope.classSectionId } : {}),
  }, attributes: ["id"] });
  const priorStudents = priorBatches.length ? await context.models.LegacyResultStudent.findAll({ where: {
    batchId: { [Op.in]: priorBatches.map((item) => item.id) }, legacyStudentKey: { [Op.ne]: null },
  } }) : [];
  const identityMap = new Map();
  priorStudents.forEach((student) => {
    if (!identityMap.has(student.legacyStudentKey)) identityMap.set(student.legacyStudentKey, { legacyStudentKey: student.legacyStudentKey, names: new Set() });
    identityMap.get(student.legacyStudentKey).names.add(student.originalStudentName);
  });
  const identities = [...identityMap.values()];
  const seen = new Set();
  const rows = [];
  const errors = [];
  let numericMarks = 0, ngValues = 0, invalidMarks = 0, duplicateRows = 0;
  for (let rowNumber = structure.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const legacyReference = structure.referenceColumn ? text(row.getCell(structure.referenceColumn).value).toUpperCase() : "";
    const studentName = text(row.getCell(structure.nameColumn).value);
    if (!legacyReference && !studentName) continue;
    const identityKey = `row:${legacyReference || normalize(studentName)}`;
    const duplicate = seen.has(identityKey);
    if (identityKey !== "row:") seen.add(identityKey);
    if (duplicate) duplicateRows += 1;
    const rowErrors = [];
    if (legacyReference && !validLegacyStudentKey(legacyReference)) rowErrors.push("Result Reference must be 3-40 letters, numbers, hyphens or underscores");
    const marks = structure.subjects.map((subject) => {
      const rawValue = text(row.getCell(subject.column).value);
      if (!rawValue) return { excelHeading: subject.excelHeading, rawValue, mark: null, markStatus: "Missing" };
      if (normalize(rawValue) === "ng") { ngValues += 1; return { excelHeading: subject.excelHeading, rawValue, mark: null, markStatus: context.ngStatus }; }
      if (normalize(rawValue) === "ch") return { excelHeading: subject.excelHeading, rawValue, mark: null, markStatus: "Cheated" };
      const mark = Number(rawValue);
      if (!Number.isFinite(mark) || mark < 0) { invalidMarks += 1; rowErrors.push(`Invalid mark for ${subject.excelHeading}`); return { excelHeading: subject.excelHeading, rawValue, mark: null, markStatus: "Missing", invalid: true }; }
      const suggested = suggestedByHeading.get(subject.excelHeading);
      if (suggested && mark > Number(suggested.totalMaxMarks)) { invalidMarks += 1; rowErrors.push(`${subject.excelHeading} mark exceeds maximum ${Number(suggested.totalMaxMarks)}`); }
      numericMarks += 1;
      return { excelHeading: subject.excelHeading, rawValue, mark, markStatus: "Present" };
    });
    const valuesAfterSubjects = [];
    for (let column = structure.subjects.at(-1).column + 1; column <= row.cellCount; column += 1) valuesAfterSubjects.push(text(row.getCell(column).value));
    const possibleMatches = identities.map((identity) => {
      const scoredNames = [...identity.names].map((name) => ({ name, score: nameSimilarity(studentName, name) })).sort((a, b) => b.score - a.score);
      return { legacyStudentKey: identity.legacyStudentKey, studentName: scoredNames[0]?.name || "", similarity: Number((scoredNames[0]?.score || 0).toFixed(3)) };
    }).filter((candidate) => candidate.similarity >= 0.55).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
    const suggestedLegacyStudentKey = legacyReference || (possibleMatches[0]?.similarity === 1 ? possibleMatches[0].legacyStudentKey : null);
    rows.push({ row: rowNumber, admissionNo: "", legacyReference, studentName, matchedStudent: null,
      suggestedLegacyStudentKey, possibleMatches,
      nameMismatch: false, duplicate, errors: rowErrors, marks,
      importedTotal: Number.isFinite(Number(valuesAfterSubjects[0])) ? Number(valuesAfterSubjects[0]) : null, importedResult: valuesAfterSubjects[1] || null });
    rowErrors.forEach((message) => errors.push({ row: rowNumber, message }));
  }
  const existingBatch = await context.models.LegacyResultBatch.findOne({ where: { ...context.scope, status: { [Op.in]: ["Draft", "Validated"] } } });
  let existingMarks = 0;
  if (existingBatch) {
    const existingStudents = await context.models.LegacyResultStudent.findAll({ where: { batchId: existingBatch.id }, attributes: ["id"] });
    if (existingStudents.length) existingMarks = await context.models.LegacyResultMark.count({ where: { legacyResultStudentId: { [Op.in]: existingStudents.map((item) => item.id) } } });
  }
  const payload = { filename, worksheet: sheet.name, structure, rows, scope: context.scope, ngStatus: context.ngStatus, configDetails, userId: Number(userId), createdAt: Date.now() };
  const nonce = crypto.randomUUID();
  previews.set(nonce, payload);
  const importToken = jwt.sign({ purpose: "legacy-import", nonce, userId: Number(userId) }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  return { importToken, worksheet: sheet.name, headerRow: structure.headerRow, detectedSubjects, students: rows.map(({ marks, importedTotal, importedResult, ...row }) => ({
      ...row,
      matchedStudent: { id: 0, admissionNo: row.legacyReference, fullName: row.studentName },
      nameMismatch: false,
    })), errors,
    summary: { matchedStudents: rows.length, unmatchedStudents: 0,
      mappedSubjects: detectedSubjects.filter((item) => item.suggestedExamSubjectId).length, unmappedSubjects: detectedSubjects.filter((item) => !item.suggestedExamSubjectId).length,
      numericMarks, ngValues, existingMarks, duplicateRows, invalidMarks } };
}

function consumePreview(token, userId) {
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch (_) { throw Object.assign(new Error("Import preview has expired or is invalid; preview the workbook again"), { status: 401 }); }
  if (decoded.purpose !== "legacy-import" || Number(decoded.userId) !== Number(userId)) throw Object.assign(new Error("Import token does not belong to this user"), { status: 403 });
  const preview = previews.get(decoded.nonce);
  if (!preview) throw Object.assign(new Error("Import preview is no longer available; preview the workbook again"), { status: 410 });
  return { preview, nonce: decoded.nonce };
}

async function commit(input, userId) {
  const { preview, nonce } = consumePreview(input.importToken, userId);
  if (input.ngStatus !== preview.ngStatus) throw Object.assign(new Error("ngStatus changed after preview; preview the workbook again"), { status: 400 });
  const mappings = Array.isArray(input.subjectMappings) ? input.subjectMappings : [];
  const studentMappings = new Map((Array.isArray(input.studentMappings) ? input.studentMappings : []).map((item) => [Number(item.row), item.legacyStudentKey ? text(item.legacyStudentKey).toUpperCase() : null]));
  if (studentMappings.size !== (Array.isArray(input.studentMappings) ? input.studentMappings.length : 0)) throw Object.assign(new Error("A student row can only be mapped once"), { status: 400 });
  const headingSet = new Set(preview.structure.subjects.map((item) => item.excelHeading));
  if (mappings.length !== headingSet.size || mappings.some((item) => !headingSet.has(item.excelHeading) || !Number.isInteger(Number(item.examSubjectId)))) throw Object.assign(new Error("Every detected subject must have a valid mapping"), { status: 422 });
  if (new Set(mappings.map((item) => Number(item.examSubjectId))).size !== mappings.length) throw Object.assign(new Error("A configured exam subject cannot be mapped more than once"), { status: 422 });
  const configMap = new Map(preview.configDetails.map((item) => [Number(item.id), item]));
  if (mappings.some((item) => !configMap.has(Number(item.examSubjectId)))) throw Object.assign(new Error("A subject mapping is outside the selected exam and class"), { status: 422 });
  const fatalRows = preview.rows.filter((row) => row.duplicate || row.errors.length);
  const maximumErrors = [];
  mappings.forEach((mapping) => preview.rows.forEach((row) => { const mark = row.marks.find((item) => item.excelHeading === mapping.excelHeading); const config = configMap.get(Number(mapping.examSubjectId)); if (mark?.mark != null && mark.mark > Number(config.totalMaxMarks)) maximumErrors.push({ row: row.row, message: `${mapping.excelHeading} mark exceeds maximum ${Number(config.totalMaxMarks)}` }); }));
  if (fatalRows.length || maximumErrors.length) throw Object.assign(new Error("The legacy workbook contains validation errors"), { status: 422, details: { errors: maximumErrors } });
  const models = initializeModels();
  const result = await sequelize.transaction(async (transaction) => {
    const prior = await models.LegacyResultBatch.findOne({ where: { ...preview.scope, status: { [Op.in]: ["Draft", "Validated"] } }, transaction });
    if (prior && !input.updateExisting) throw Object.assign(new Error("A draft legacy batch already exists for this class and term"), { status: 409 });
    const identityBatches = await models.LegacyResultBatch.findAll({ where: {
      academicYearId: preview.scope.academicYearId, classId: preview.scope.classId,
      ...(preview.scope.classSectionId ? { classSectionId: preview.scope.classSectionId } : {}),
    }, attributes: ["id"], transaction });
    const identityStudents = identityBatches.length ? await models.LegacyResultStudent.findAll({
      where: { batchId: { [Op.in]: identityBatches.map((item) => item.id) } }, transaction,
    }) : [];
    const byName = new Map();
    for (const existing of identityStudents) {
      const nameKey = normalize(existing.originalStudentName);
      let stableKey = (nameKey ? byName.get(nameKey) : null) || existing.legacyStudentKey || newLegacyStudentKey();
      if (existing.legacyStudentKey !== stableKey) {
        await existing.update({ legacyStudentKey: stableKey }, { transaction });
      }
      if (nameKey) {
        if (!byName.has(nameKey)) byName.set(nameKey, stableKey);
        else if (byName.get(nameKey) !== stableKey) byName.set(nameKey, null);
      }
    }
    if (prior) {
      const oldStudents = await models.LegacyResultStudent.findAll({ where: { batchId: prior.id }, attributes: ["id"], transaction });
      const oldSubjects = await models.LegacyResultSubject.findAll({ where: { batchId: prior.id }, attributes: ["id"], transaction });
      if (oldStudents.length) await models.LegacyResultMark.destroy({ where: { legacyResultStudentId: { [Op.in]: oldStudents.map((item) => item.id) } }, transaction });
      await models.LegacyResultStudent.destroy({ where: { batchId: prior.id }, transaction });
      await models.LegacyResultSubject.destroy({ where: { batchId: prior.id }, transaction });
      await prior.destroy({ transaction });
    }
    const batch = await models.LegacyResultBatch.create({ ...preview.scope, sourceFilename: preview.filename, worksheetName: preview.worksheet, ngStatus: preview.ngStatus, status: "Validated", createdBy: Number(userId) }, { transaction });
    const subjectRows = new Map();
    for (let index = 0; index < mappings.length; index += 1) { const mapping = mappings[index]; const created = await models.LegacyResultSubject.create({ batchId: batch.id, excelHeading: mapping.excelHeading, examSubjectId: Number(mapping.examSubjectId), displayOrder: index }, { transaction }); subjectRows.set(mapping.excelHeading, created); }
    let marksCreated = 0, missingEntries = 0, absentEntries = 0;
    for (const row of preview.rows) {
      const nameKey = normalize(row.studentName);
      const suppliedStableKey = studentMappings.has(row.row) ? studentMappings.get(row.row) : (row.legacyReference || null);
      if (suppliedStableKey && !validLegacyStudentKey(suppliedStableKey)) throw Object.assign(new Error(`Invalid legacy result reference on row ${row.row}`), { status: 422 });
      const stableKey = suppliedStableKey ||
        (nameKey && byName.get(nameKey)) || newLegacyStudentKey();
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, stableKey);
      const student = await models.LegacyResultStudent.create({ batchId: batch.id, studentId: null, legacyStudentKey: stableKey, admissionNo: null, originalStudentName: row.studentName, importedTotal: row.importedTotal, importedResult: row.importedResult }, { transaction });
      for (const mark of row.marks) { if (mark.markStatus === "Missing") missingEntries += 1; if (mark.markStatus === "Absent") absentEntries += 1; await models.LegacyResultMark.create({ legacyResultStudentId: student.id, legacyResultSubjectId: subjectRows.get(mark.excelHeading).id, mark: mark.mark, markStatus: mark.markStatus, rawValue: mark.rawValue || null }, { transaction }); marksCreated += 1; }
    }
    return { batchId: batch.id, status: batch.status, message: "Legacy results imported successfully", studentsProcessed: preview.rows.length, marksCreated, marksUpdated: 0, missingEntries, absentEntries, skippedEntries: 0, failedEntries: 0 };
  });
  previews.delete(nonce);
  return result;
}

async function publish(batchId, userId) {
  const models = initializeModels();
  return sequelize.transaction(async (transaction) => {
    const batch = await models.LegacyResultBatch.findByPk(id(batchId, "batchId"), { transaction, lock: transaction.LOCK.UPDATE });
    if (!batch) throw Object.assign(new Error("Legacy result batch was not found"), { status: 404 });
    if (batch.status !== "Validated") throw Object.assign(new Error("Only a validated legacy result batch can be published"), { status: 409 });
    await models.LegacyResultBatch.update({ status: "Archived" }, { where: { academicYearId: batch.academicYearId, termId: batch.termId, classId: batch.classId, classSectionId: batch.classSectionId, status: "Published", id: { [Op.ne]: batch.id } }, transaction });
    const publishedAt = new Date();
    await batch.update({ status: "Published", publishedBy: Number(userId), publishedAt }, { transaction });
    return { batchId: batch.id, status: "Published", publishedAt: publishedAt.toISOString(), message: "Legacy results published successfully" };
  });
}

async function correctMark(batchIdValue, markIdValue, input, userId) {
  const models = initializeModels();
  const batchId = id(batchIdValue, "batchId");
  const markId = id(markIdValue, "markId");
  const reason = text(input.reason);
  if (reason.length < 3) throw Object.assign(new Error("A correction reason of at least 3 characters is required"), { status: 400 });
  const markStatus = input.markStatus || "Present";
  if (!["Present", "Missing", "Absent", "Cheated"].includes(markStatus)) throw Object.assign(new Error("markStatus must be Present, Missing, Absent or Cheated"), { status: 400 });
  let newMark = null;
  if (markStatus === "Present") {
    newMark = Number(input.mark);
    if (!Number.isFinite(newMark) || newMark < 0) throw Object.assign(new Error("mark must be a number of zero or greater"), { status: 400 });
  }
  return sequelize.transaction(async (transaction) => {
    const batch = await models.LegacyResultBatch.findByPk(batchId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!batch) throw Object.assign(new Error("Legacy result batch was not found"), { status: 404 });
    if (!["Validated", "Published"].includes(batch.status)) throw Object.assign(new Error("Only validated or published results can be corrected"), { status: 409 });
    const mark = await models.LegacyResultMark.findByPk(markId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!mark) throw Object.assign(new Error("Legacy result mark was not found"), { status: 404 });
    const [student, legacySubject] = await Promise.all([
      models.LegacyResultStudent.findOne({ where: { id: mark.legacyResultStudentId, batchId }, transaction }),
      models.LegacyResultSubject.findOne({ where: { id: mark.legacyResultSubjectId, batchId }, transaction }),
    ]);
    if (!student || !legacySubject) throw Object.assign(new Error("The selected mark does not belong to this batch"), { status: 404 });
    const examSubject = await models.ExamSubject.findByPk(legacySubject.examSubjectId, { transaction });
    if (newMark !== null && (!examSubject || newMark > Number(examSubject.totalMaxMarks))) {
      throw Object.assign(new Error(`mark cannot exceed the subject maximum of ${Number(examSubject?.totalMaxMarks || 0)}`), { status: 400 });
    }
    const oldMark = mark.mark === null ? null : Number(mark.mark);
    const oldStatus = mark.markStatus;
    await models.LegacyResultMarkEdit.create({ legacyResultMarkId: mark.id, oldMark, newMark,
      oldStatus, newStatus: markStatus, reason, editedBy: Number(userId) }, { transaction });
    await mark.update({ mark: newMark, markStatus, rawValue: newMark === null ? markStatus : String(newMark) }, { transaction });
    if (student.importedTotal !== null) {
      const correctedTotal = Number(student.importedTotal) - Number(oldMark || 0) + Number(newMark || 0);
      await student.update({ importedTotal: Math.max(0, correctedTotal) }, { transaction });
    }
    return { message: "Legacy result mark corrected successfully", batchId, mark: {
      id: mark.id, mark: newMark, markStatus, previousMark: oldMark, previousStatus: oldStatus,
    }, student: { id: student.id, resultReference: lookupReference(student), total: student.importedTotal === null ? null : Number(student.importedTotal) } };
  });
}

async function mergeStudentKeys(input, userId) {
  const sourceKey = text(input.sourceKey).toUpperCase();
  const targetKey = text(input.targetKey).toUpperCase();
  const reason = text(input.reason);
  if (!validLegacyStudentKey(sourceKey) || !validLegacyStudentKey(targetKey) || sourceKey === targetKey) {
    throw Object.assign(new Error("Two different valid legacy student references are required"), { status: 400 });
  }
  if (reason.length < 3) throw Object.assign(new Error("A merge reason of at least 3 characters is required"), { status: 400 });
  const models = initializeModels();
  return sequelize.transaction(async (transaction) => {
    const [sourceRows, targetRows] = await Promise.all([
      models.LegacyResultStudent.findAll({ where: { legacyStudentKey: sourceKey }, transaction, lock: transaction.LOCK.UPDATE }),
      models.LegacyResultStudent.findAll({ where: { legacyStudentKey: targetKey }, transaction, lock: transaction.LOCK.UPDATE }),
    ]);
    if (!sourceRows.length || !targetRows.length) throw Object.assign(new Error("One or both legacy student references were not found"), { status: 404 });
    const batchIds = [...new Set([...sourceRows, ...targetRows].map((row) => row.batchId))];
    const batches = await models.LegacyResultBatch.findAll({ where: { id: { [Op.in]: batchIds } }, transaction });
    const scopes = new Set(batches.map((batch) => `${batch.academicYearId}:${batch.classId}:${batch.classSectionId || "all"}`));
    if (scopes.size !== 1) throw Object.assign(new Error("References can only be merged within the same academic year, class and section"), { status: 409 });
    const sourceBatchIds = new Set(sourceRows.map((row) => Number(row.batchId)));
    if (targetRows.some((row) => sourceBatchIds.has(Number(row.batchId)))) throw Object.assign(new Error("Both references occur in the same batch and cannot be merged automatically"), { status: 409 });
    await models.LegacyResultStudent.update({ legacyStudentKey: targetKey }, { where: { legacyStudentKey: sourceKey }, transaction });
    await models.LegacyStudentMerge.create({ sourceKey, targetKey, reason, rowsMoved: sourceRows.length, mergedBy: Number(userId) }, { transaction });
    return { message: "Legacy student references merged successfully", sourceKey, targetKey, rowsMoved: sourceRows.length };
  });
}

const lookupReference = (student) => student.legacyStudentKey || student.admissionNo || `LEGACY-${student.batchId}-${student.id}`;

async function ensureStableKeys(batch, models) {
  const relatedBatches = await models.LegacyResultBatch.findAll({ where: {
    academicYearId: batch.academicYearId, classId: batch.classId,
    ...(batch.classSectionId ? { classSectionId: batch.classSectionId } : {}),
  }, attributes: ["id"] });
  const batchIds = relatedBatches.map((item) => item.id);
  if (!batchIds.length) return;
  const students = await models.LegacyResultStudent.findAll({ where: { batchId: { [Op.in]: batchIds } }, order: [["batchId", "ASC"], ["id", "ASC"]] });
  const nameCountsByBatch = new Map();
  students.forEach((student) => {
    const name = normalize(student.originalStudentName);
    const key = `${student.batchId}:${name}`;
    if (name) nameCountsByBatch.set(key, (nameCountsByBatch.get(key) || 0) + 1);
  });
  const ambiguousNames = new Set([...nameCountsByBatch].filter(([, count]) => count > 1).map(([key]) => key.split(":").slice(1).join(":")));
  const nameKeys = new Map();
  for (const student of students) {
    const name = normalize(student.originalStudentName);
    let stableKey = (name && !ambiguousNames.has(name) ? nameKeys.get(name) : null) || student.legacyStudentKey || newLegacyStudentKey();
    if (student.legacyStudentKey !== stableKey) await student.update({ legacyStudentKey: stableKey });
    if (name && !ambiguousNames.has(name)) nameKeys.set(name, stableKey);
  }
}

async function batchDetails(batchId, publishedOnly = false) {
  const models = initializeModels();
  const batch = await models.LegacyResultBatch.findOne({ where: {
    id: id(batchId, "batchId"), ...(publishedOnly ? { status: "Published" } : {}),
  }});
  if (!batch) throw Object.assign(new Error("Legacy result batch was not found"), { status: 404 });
  await ensureStableKeys(batch, models);
  const [studentRows, subjectRows] = await Promise.all([
    models.LegacyResultStudent.findAll({ where: { batchId: batch.id }, order: [["originalStudentName", "ASC"]] }),
    models.LegacyResultSubject.findAll({ where: { batchId: batch.id }, order: [["displayOrder", "ASC"]] }),
  ]);
  const subjectIds = subjectRows.map((item) => item.examSubjectId);
  const examSubjects = await models.ExamSubject.findAll({ where: { id: { [Op.in]: subjectIds } } });
  const regularSubjectIds = examSubjects.map((item) => item.subjectId);
  const regularSubjects = await models.Subject.findAll({ where: { id: { [Op.in]: regularSubjectIds } } });
  const examSubjectMap = new Map(examSubjects.map((item) => [Number(item.id), item]));
  const subjectMap = new Map(regularSubjects.map((item) => [Number(item.id), item.get({ plain: true })]));
  const legacySubjectMap = new Map(subjectRows.map((item) => {
    const examSubject = examSubjectMap.get(Number(item.examSubjectId));
    return [Number(item.id), { id: item.id, excelHeading: item.excelHeading, displayOrder: item.displayOrder,
      examSubjectId: item.examSubjectId, subject: subjectMap.get(Number(examSubject?.subjectId)) || null }];
  }));
  const studentIds = studentRows.map((item) => item.id);
  const marks = studentIds.length ? await models.LegacyResultMark.findAll({ where: { legacyResultStudentId: { [Op.in]: studentIds } } }) : [];
  const marksByStudent = new Map();
  marks.forEach((mark) => {
    if (!marksByStudent.has(Number(mark.legacyResultStudentId))) marksByStudent.set(Number(mark.legacyResultStudentId), []);
    marksByStudent.get(Number(mark.legacyResultStudentId)).push({
      id: mark.id, mark: mark.mark === null ? null : Number(mark.mark), markStatus: mark.markStatus,
      rawValue: mark.rawValue, subject: legacySubjectMap.get(Number(mark.legacyResultSubjectId)),
    });
  });
  return { batch: batch.get({ plain: true }), subjects: [...legacySubjectMap.values()], students: studentRows.map((student) => ({
    id: student.id, registeredStudentId: student.studentId, legacyStudentKey: student.legacyStudentKey, admissionNo: student.admissionNo,
    resultReference: lookupReference(student), studentName: student.originalStudentName,
    total: student.importedTotal === null ? null : Number(student.importedTotal), result: student.importedResult,
    marks: (marksByStudent.get(Number(student.id)) || []).sort((a, b) => a.subject.displayOrder - b.subject.displayOrder),
  })) };
}

async function listBatches(filters = {}) {
  const models = initializeModels();
  const where = {};
  ["academicYearId", "termId", "examId", "departmentId", "classId", "classSectionId"].forEach((field) => {
    if (filters[field] !== undefined && filters[field] !== "") where[field] = id(filters[field], field);
  });
  if (filters.status) where.status = filters.status;
  const batches = await models.LegacyResultBatch.findAll({ where, order: [["createdAt", "DESC"]] });
  return { count: batches.length, data: batches.map((item) => item.get({ plain: true })) };
}

async function publicResult(query) {
  const reference = text(query.reference || query.admissionNo);
  if (!reference) throw Object.assign(new Error("reference or admissionNo is required"), { status: 400 });
  const models = initializeModels();
  let resultStudent = null;
  let batchId = null;
  const publishedForLookup = await models.LegacyResultBatch.findAll({ where: {
    status: "Published",
    ...(query.academicYearId ? { academicYearId: id(query.academicYearId, "academicYearId") } : {}),
    ...(query.termId ? { termId: id(query.termId, "termId") } : {}),
  }, attributes: ["id"] });
  const publishedLookupIds = publishedForLookup.map((item) => item.id);
  const referenceMatch = /^LEGACY-(\d+)-(\d+)$/i.exec(reference);
  if (referenceMatch) {
    batchId = Number(referenceMatch[1]);
    resultStudent = await models.LegacyResultStudent.findOne({ where: { id: Number(referenceMatch[2]), batchId } });
  } else if (validLegacyStudentKey(reference) && publishedLookupIds.length) {
    resultStudent = await models.LegacyResultStudent.findOne({ where: {
      legacyStudentKey: reference.toUpperCase(), batchId: { [Op.in]: publishedLookupIds },
    }, order: [["createdAt", "DESC"]] });
    batchId = resultStudent?.batchId;
  } else {
    if (publishedLookupIds.length) resultStudent = await models.LegacyResultStudent.findOne({ where: { admissionNo: reference, batchId: { [Op.in]: publishedLookupIds } }, order: [["createdAt", "DESC"]] });
    batchId = resultStudent?.batchId;
  }
  if (!resultStudent || !batchId) throw Object.assign(new Error("No published legacy result was found for that reference"), { status: 404 });
  const details = await batchDetails(batchId, true);
  const student = details.students.find((item) => Number(item.id) === Number(resultStudent.id));
  if (!student) throw Object.assign(new Error("No published legacy result was found for that reference"), { status: 404 });
  const batch = details.batch;
  const relatedBatches = await models.LegacyResultBatch.findAll({ where: {
    status: "Published", academicYearId: batch.academicYearId, classId: batch.classId,
    departmentId: batch.departmentId,
  }, order: [["termId", "ASC"], ["publishedAt", "DESC"]] });
  const termResults = [];
  const usedTerms = new Set();
  for (const relatedBatch of relatedBatches) {
    if (usedTerms.has(Number(relatedBatch.termId))) continue;
    const relatedDetails = await batchDetails(relatedBatch.id, true);
    const relatedStudent = relatedDetails.students.find((candidate) =>
      (student.legacyStudentKey && candidate.legacyStudentKey === student.legacyStudentKey) ||
      (student.registeredStudentId && Number(candidate.registeredStudentId) === Number(student.registeredStudentId)) ||
      (student.admissionNo && normalize(candidate.admissionNo) === normalize(student.admissionNo)) ||
      (!student.registeredStudentId && !student.admissionNo && normalize(candidate.studentName) === normalize(student.studentName)),
    );
    if (!relatedStudent) continue;
    const relatedTerm = await models.Term.findByPk(relatedBatch.termId, { attributes: ["name"] });
    usedTerms.add(Number(relatedBatch.termId));
    termResults.push({
      batchId: relatedBatch.id, termId: relatedBatch.termId,
      termName: relatedTerm?.name || `Term ${relatedBatch.termId}`,
      publishedAt: relatedBatch.publishedAt, student: relatedStudent,
      subjects: relatedDetails.subjects,
    });
  }
  const [term, academicYear, department, selectedClass] = await Promise.all([
    models.Term.findByPk(batch.termId, { attributes: ["name"] }),
    models.AcademicYear.findByPk(batch.academicYearId, { attributes: ["name"] }),
    models.Department.findByPk(batch.departmentId, { attributes: ["name"] }),
    models.Class.findByPk(batch.classId, { attributes: ["name"] }),
  ]);
  return { batch: {
    id: batch.id, academicYearId: batch.academicYearId, termId: batch.termId,
    examId: batch.examId, classId: batch.classId, classSectionId: batch.classSectionId,
    status: batch.status, publishedAt: batch.publishedAt, termName: term?.name || `Term ${batch.termId}`,
  }, student, subjects: details.subjects, termResults, profile: {
    studentName: student.studentName, resultReference: student.resultReference,
    admissionNo: student.admissionNo, academicYear: academicYear?.name || null,
    department: department?.name || null, className: selectedClass?.name || null,
  } };
}

module.exports = { buildPreview, commit, publish, correctMark, mergeStudentKeys, listBatches, batchDetails, publicResult };
