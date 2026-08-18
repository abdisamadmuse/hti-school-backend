const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");

const SEVERITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES = ["Open", "Resolved"];
const text = (value) => String(value ?? "").trim();
const id = (value, field) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${field} must be a positive integer`), { status: 400 });
  return parsed;
};
const queryDate = (value, field) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error(`${field} must be a valid date`), { status: 400 });
  return parsed;
};
const fail = (res, error) => res.status(error.status || 500).json({ message: error.message });
const plain = (row) => row && row.get({ plain: true });

const allowedDepartmentIds = (user) => {
  if (user.role !== "HeadDepartment") return null;
  return [...new Set([user.departmentId, ...(Array.isArray(user.departmentIds) ? user.departmentIds : [])]
    .map(Number).filter((value) => Number.isInteger(value) && value > 0))];
};

const assertAccess = (user, departmentId) => {
  const allowed = allowedDepartmentIds(user);
  if (allowed && !allowed.includes(Number(departmentId))) {
    throw Object.assign(new Error("You do not have access to this department's discipline records"), { status: 403 });
  }
};

const recordResponse = async (record, models) => {
  const value = plain(record);
  const [student, academicYear, selectedClass, department, reporter, resolver] = await Promise.all([
    models.Student.findByPk(record.studentId), models.AcademicYear.findByPk(record.academicYearId),
    models.Class.findByPk(record.classId), models.Department.findByPk(record.departmentId),
    models.User.findByPk(record.reportedBy, { attributes: { exclude: ["password"] } }),
    record.resolvedBy ? models.User.findByPk(record.resolvedBy, { attributes: { exclude: ["password"] } }) : null,
  ]);
  return { ...value, student: plain(student), academicYear: plain(academicYear), class: plain(selectedClass), department: plain(department), reportedByUser: plain(reporter), resolvedByUser: plain(resolver) };
};

const validateEditable = (input, partial = false) => {
  const output = {};
  for (const field of ["category", "description", "actionTaken", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) output[field] = text(input[field]) || null;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "incidentDate")) {
    const date = new Date(input.incidentDate);
    if (Number.isNaN(date.getTime())) throw Object.assign(new Error("incidentDate must be a valid date"), { status: 400 });
    output.incidentDate = date;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "severity")) {
    const severity = input.severity || "Medium";
    if (!SEVERITIES.includes(severity)) throw Object.assign(new Error(`severity must be one of: ${SEVERITIES.join(", ")}`), { status: 400 });
    output.severity = severity;
  }
  if (!partial && (!output.category || !output.description)) throw Object.assign(new Error("category and description are required"), { status: 400 });
  if (Object.prototype.hasOwnProperty.call(output, "category") && !output.category) throw Object.assign(new Error("category cannot be empty"), { status: 400 });
  if (Object.prototype.hasOwnProperty.call(output, "description") && !output.description) throw Object.assign(new Error("description cannot be empty"), { status: 400 });
  return output;
};

exports.create = async (req, res) => {
  try {
    const models = initializeModels();
    const student = await models.Student.findByPk(id(req.body.studentId, "studentId"));
    if (!student) throw Object.assign(new Error("Student not found"), { status: 404 });
    assertAccess(req.user, student.departmentId);
    const record = await models.DisciplineRecord.create({
      ...validateEditable(req.body), studentId: student.id, academicYearId: student.academicYearId,
      classId: student.classId, departmentId: student.departmentId, reportedBy: Number(req.user._id), status: "Open",
    });
    res.status(201).json({ message: "Discipline record created successfully", data: await recordResponse(record, models) });
  } catch (error) { fail(res, error); }
};

exports.list = async (req, res) => {
  try {
    const models = initializeModels();
    const where = {};
    for (const field of ["studentId", "academicYearId", "classId", "departmentId"]) if (req.query[field]) where[field] = id(req.query[field], field);
    if (req.query.severity) {
      if (!SEVERITIES.includes(req.query.severity)) throw Object.assign(new Error(`severity must be one of: ${SEVERITIES.join(", ")}`), { status: 400 });
      where.severity = req.query.severity;
    }
    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) throw Object.assign(new Error(`status must be one of: ${STATUSES.join(", ")}`), { status: 400 });
      where.status = req.query.status;
    }
    if (req.query.category) where.category = req.query.category;
    if (req.query.dateFrom || req.query.dateTo) {
      where.incidentDate = {};
      if (req.query.dateFrom) where.incidentDate[Op.gte] = queryDate(req.query.dateFrom, "dateFrom");
      if (req.query.dateTo) where.incidentDate[Op.lte] = queryDate(req.query.dateTo, "dateTo");
    }
    const allowed = allowedDepartmentIds(req.user);
    if (allowed) where.departmentId = where.departmentId ? (allowed.includes(where.departmentId) ? where.departmentId : -1) : { [Op.in]: allowed };
    const records = await models.DisciplineRecord.findAll({ where, order: [["incidentDate", "DESC"], ["createdAt", "DESC"]] });
    res.json({ count: records.length, data: await Promise.all(records.map((record) => recordResponse(record, models))) });
  } catch (error) { fail(res, error); }
};

exports.getOne = async (req, res) => {
  try {
    const models = initializeModels();
    const record = await models.DisciplineRecord.findByPk(id(req.params.id, "id"));
    if (!record) throw Object.assign(new Error("Discipline record not found"), { status: 404 });
    assertAccess(req.user, record.departmentId);
    res.json({ data: await recordResponse(record, models) });
  } catch (error) { fail(res, error); }
};

exports.update = async (req, res) => {
  try {
    const models = initializeModels();
    const record = await models.DisciplineRecord.findByPk(id(req.params.id, "id"));
    if (!record) throw Object.assign(new Error("Discipline record not found"), { status: 404 });
    assertAccess(req.user, record.departmentId);
    const changes = validateEditable(req.body, true);
    if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
      if (!STATUSES.includes(req.body.status)) throw Object.assign(new Error(`status must be one of: ${STATUSES.join(", ")}`), { status: 400 });
      changes.status = req.body.status;
      changes.resolvedBy = req.body.status === "Resolved" ? Number(req.user._id) : null;
      changes.resolvedAt = req.body.status === "Resolved" ? new Date() : null;
    }
    if (!Object.keys(changes).length) throw Object.assign(new Error("No editable discipline fields were supplied"), { status: 400 });
    await record.update(changes);
    res.json({ message: "Discipline record updated successfully", data: await recordResponse(record, models) });
  } catch (error) { fail(res, error); }
};

exports.remove = async (req, res) => {
  try {
    const models = initializeModels();
    const record = await models.DisciplineRecord.findByPk(id(req.params.id, "id"));
    if (!record) throw Object.assign(new Error("Discipline record not found"), { status: 404 });
    assertAccess(req.user, record.departmentId);
    await record.destroy();
    res.json({ message: "Discipline record deleted successfully" });
  } catch (error) { fail(res, error); }
};
