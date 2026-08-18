const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");
const { allowedDepartmentIds } = require("../../examMarks/services/manualMarkService");

const plain = (record) => (record ? record.get({ plain: true }) : null);
const booleanValue = (value) => value === true || value === 1 || String(value).toLowerCase() === "true";

const validateRule = async (data) => {
  const models = initializeModels();
  const required = ["sourceAcademicYearId", "destinationAcademicYearId", "fromClassId", "repeatClassId"];
  const missing = required.filter((field) => !data[field]);
  if (missing.length) {
    const error = new Error(`${missing.join(", ")} required`);
    error.status = 400;
    throw error;
  }
  const isFinalClass = booleanValue(data.isFinalClass);
  if (!isFinalClass && !data.toClassId) {
    const error = new Error("toClassId is required for a non-final class");
    error.status = 400;
    throw error;
  }
  if (!isFinalClass && Number(data.toClassId) === Number(data.repeatClassId)) {
    const error = new Error("Promotion and repeat classes must be different");
    error.status = 400;
    throw error;
  }
  if (Number(data.sourceAcademicYearId) === Number(data.destinationAcademicYearId)) {
    const error = new Error("Destination academic year must differ from the source academic year");
    error.status = 400;
    throw error;
  }
  const [sourceYear, destinationYear, fromClass, toClass, repeatClass] = await Promise.all([
    models.AcademicYear.findByPk(data.sourceAcademicYearId),
    models.AcademicYear.findByPk(data.destinationAcademicYearId),
    models.Class.findByPk(data.fromClassId),
    data.toClassId ? models.Class.findByPk(data.toClassId) : null,
    models.Class.findByPk(data.repeatClassId),
  ]);
  if (!sourceYear || !destinationYear || !fromClass || !repeatClass || (!isFinalClass && !toClass)) {
    const error = new Error("One or more academic year or class references are invalid");
    error.status = 400;
    throw error;
  }
  if (Number(fromClass.academicYearId) !== Number(sourceYear.id)) {
    const error = new Error("Source class does not belong to the source academic year");
    error.status = 400;
    throw error;
  }
  for (const destinationClass of [toClass, repeatClass].filter(Boolean)) {
    if (Number(destinationClass.academicYearId) !== Number(destinationYear.id)) {
      const error = new Error("Destination and repeat classes must belong to the destination academic year");
      error.status = 400;
      throw error;
    }
    if (
      Number(destinationClass.programId) !== Number(fromClass.programId) ||
      Number(destinationClass.departmentId) !== Number(fromClass.departmentId)
    ) {
      const error = new Error("Promotion classes must use the same program and department");
      error.status = 400;
      throw error;
    }
  }
  const minimumAverage = Number(data.minimumAverage);
  const maximumFailedSubjects = Number(data.maximumFailedSubjects);
  if (!Number.isFinite(minimumAverage) || minimumAverage < 0 || minimumAverage > 100) {
    const error = new Error("minimumAverage must be between 0 and 100");
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(maximumFailedSubjects) || maximumFailedSubjects < 0) {
    const error = new Error("maximumFailedSubjects must be a non-negative integer");
    error.status = 400;
    throw error;
  }
  return {
    ...data,
    programId: fromClass.programId,
    departmentId: fromClass.departmentId,
    toClassId: isFinalClass ? null : data.toClassId,
    minimumAverage,
    maximumFailedSubjects,
    isFinalClass,
  };
};

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") return res.status(409).json({ message: "A promotion rule already exists for these classes and academic years" });
  if (error.name === "SequelizeValidationError") return res.status(400).json({ message: error.errors?.[0]?.message || error.message });
  return res.status(error.status || 500).json({ message: error.message });
};

exports.createPromotionRule = async (req, res) => {
  try {
    const models = initializeModels();
    const rule = await models.PromotionRule.create(await validateRule(req.body));
    res.status(201).json({ message: "Promotion rule created successfully", data: plain(rule) });
  } catch (error) { handleError(res, error); }
};

exports.getPromotionRules = async (req, res) => {
  try {
    const models = initializeModels();
    const where = {};
    ["sourceAcademicYearId", "destinationAcademicYearId", "fromClassId", "departmentId", "isActive"].forEach((field) => {
      if (req.query[field] !== undefined && req.query[field] !== "") where[field] = field === "isActive" ? req.query[field] === "true" : req.query[field];
    });
    const departments = allowedDepartmentIds(req.user);
    if (departments) where.departmentId = { [Op.in]: departments };
    const rules = await models.PromotionRule.findAll({ where, order: [["createdAt", "DESC"]] });
    res.status(200).json({ count: rules.length, data: rules.map(plain) });
  } catch (error) { handleError(res, error); }
};

exports.updatePromotionRule = async (req, res) => {
  try {
    const models = initializeModels();
    const current = await models.PromotionRule.findByPk(req.params.id);
    if (!current) return res.status(404).json({ message: "Promotion rule not found" });
    const payload = { ...plain(current), ...req.body };
    delete payload.id;
    await current.update(await validateRule(payload));
    res.status(200).json({ message: "Promotion rule updated successfully", data: plain(current) });
  } catch (error) { handleError(res, error); }
};

exports.deletePromotionRule = async (req, res) => {
  try {
    const models = initializeModels();
    const current = await models.PromotionRule.findByPk(req.params.id);
    if (!current) return res.status(404).json({ message: "Promotion rule not found" });
    await current.destroy();
    res.status(200).json({ message: "Promotion rule deleted successfully" });
  } catch (error) { handleError(res, error); }
};
