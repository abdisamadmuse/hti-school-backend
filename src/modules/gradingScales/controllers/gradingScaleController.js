const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");

const plain = (record) => (record ? record.get({ plain: true }) : null);

const validatePayload = async (data, currentId = null) => {
  const models = initializeModels();
  const programId = Number(data.programId);
  const minimum = Number(data.minimumPercentage);
  const maximum = Number(data.maximumPercentage);
  if (!Number.isInteger(programId) || programId <= 0) {
    const error = new Error("programId is required");
    error.status = 400;
    throw error;
  }
  if (![minimum, maximum].every(Number.isFinite) || minimum < 0 || maximum > 100 || minimum > maximum) {
    const error = new Error("Percentage range must be between 0 and 100, with minimum not exceeding maximum");
    error.status = 400;
    throw error;
  }
  if (!String(data.name || "").trim() || !String(data.grade || "").trim()) {
    const error = new Error("name and grade are required");
    error.status = 400;
    throw error;
  }
  if (!(await models.Program.findByPk(programId))) {
    const error = new Error("Program not found");
    error.status = 400;
    throw error;
  }
  const overlapping = await models.GradingScale.findOne({
    where: {
      programId,
      isActive: true,
      minimumPercentage: { [Op.lte]: maximum },
      maximumPercentage: { [Op.gte]: minimum },
      ...(currentId && { id: { [Op.ne]: currentId } }),
    },
  });
  if (overlapping) {
    const error = new Error(`Percentage range overlaps with grade ${overlapping.grade}`);
    error.status = 409;
    throw error;
  }
};

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ message: "This grade already exists for the selected program" });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ message: error.errors?.[0]?.message || error.message });
  }
  return res.status(error.status || 500).json({ message: error.message });
};

exports.createGradingScale = async (req, res) => {
  try {
    await validatePayload(req.body);
    const models = initializeModels();
    const scale = await models.GradingScale.create(req.body);
    res.status(201).json({ message: "Grading scale created successfully", data: plain(scale) });
  } catch (error) { handleError(res, error); }
};

exports.getGradingScales = async (req, res) => {
  try {
    const models = initializeModels();
    const where = {};
    if (req.query.programId) where.programId = req.query.programId;
    if (req.query.isActive !== undefined) where.isActive = req.query.isActive === "true";
    const rows = await models.GradingScale.findAll({
      where,
      order: [["programId", "ASC"], ["minimumPercentage", "DESC"]],
    });
    res.status(200).json({ count: rows.length, data: rows.map(plain) });
  } catch (error) { handleError(res, error); }
};

exports.updateGradingScale = async (req, res) => {
  try {
    const models = initializeModels();
    const current = await models.GradingScale.findByPk(req.params.id);
    if (!current) return res.status(404).json({ message: "Grading scale not found" });
    const payload = { ...plain(current), ...req.body };
    delete payload.id;
    await validatePayload(payload, current.id);
    await current.update(req.body);
    res.status(200).json({ message: "Grading scale updated successfully", data: plain(current) });
  } catch (error) { handleError(res, error); }
};

exports.deleteGradingScale = async (req, res) => {
  try {
    const models = initializeModels();
    const current = await models.GradingScale.findByPk(req.params.id);
    if (!current) return res.status(404).json({ message: "Grading scale not found" });
    await current.destroy();
    res.status(200).json({ message: "Grading scale deleted successfully" });
  } catch (error) { handleError(res, error); }
};
