const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");
const { allowedDepartmentIds, assertDepartmentAccess } = require("../../examMarks/services/manualMarkService");
const {
  loadPromotionContext,
  buildPreview,
  processPromotions,
  correctPromotion,
} = require("../services/promotionService");

const plain = (record) => (record ? record.get({ plain: true }) : null);
const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") return res.status(409).json({ message: "One or more students have already been processed for this destination academic year" });
  if (error.name === "SequelizeValidationError") return res.status(400).json({ message: error.errors?.[0]?.message || error.message });
  return res.status(error.status || 500).json({ message: error.message, ...(error.details && { errors: error.details }) });
};

exports.previewPromotions = async (req, res) => {
  try {
    const context = await loadPromotionContext(req.body, req.user);
    const rows = buildPreview(context);
    res.status(200).json({
      exam: context.exam,
      rule: context.rule,
      summary: {
        total: rows.length,
        promoted: rows.filter((item) => item.recommendation === "Promoted").length,
        repeated: rows.filter((item) => item.recommendation === "Repeated").length,
        graduated: rows.filter((item) => item.recommendation === "Graduated").length,
        held: rows.filter((item) => item.recommendation === "Held").length,
        alreadyProcessed: rows.filter((item) => item.alreadyProcessed).length,
      },
      data: rows,
    });
  } catch (error) { handleError(res, error); }
};

exports.processStudentPromotions = async (req, res) => {
  try {
    const context = await loadPromotionContext(req.body, req.user);
    const summary = await processPromotions(context, req.body.decisions, req.user._id);
    res.status(201).json({ message: "Student promotions processed successfully", summary });
  } catch (error) { handleError(res, error); }
};

exports.getPromotionHistory = async (req, res) => {
  try {
    const models = initializeModels();
    const where = {};
    ["studentId", "examId", "fromAcademicYearId", "toAcademicYearId", "fromClassId", "decision"].forEach((field) => {
      if (req.query[field] !== undefined && req.query[field] !== "") where[field] = req.query[field];
    });
    const departments = allowedDepartmentIds(req.user);
    if (departments) {
      const classes = await models.Class.findAll({ where: { departmentId: { [Op.in]: departments } }, attributes: ["id"] });
      where.fromClassId = { [Op.in]: classes.map((item) => item.id) };
    }
    const promotions = await models.StudentPromotion.findAll({ where, order: [["processedAt", "DESC"]] });
    const studentIds = [...new Set(promotions.map((item) => item.studentId))];
    const promotionIds = promotions.map((item) => item.id);
    const [students, corrections] = await Promise.all([
      models.Student.findAll({ where: { id: { [Op.in]: studentIds } }, attributes: ["id", "admissionNo", "fullName", "status"] }),
      models.PromotionCorrection.findAll({ where: { promotionId: { [Op.in]: promotionIds } }, order: [["correctedAt", "ASC"]] }),
    ]);
    const studentMap = new Map(students.map((item) => [item.id, plain(item)]));
    const correctionsMap = new Map();
    corrections.forEach((item) => {
      if (!correctionsMap.has(item.promotionId)) correctionsMap.set(item.promotionId, []);
      correctionsMap.get(item.promotionId).push(plain(item));
    });
    res.status(200).json({
      count: promotions.length,
      data: promotions.map((item) => ({
        ...plain(item),
        student: studentMap.get(item.studentId) || null,
        corrections: correctionsMap.get(item.id) || [],
      })),
    });
  } catch (error) { handleError(res, error); }
};

exports.correctStudentPromotion = async (req, res) => {
  try {
    const promotion = await correctPromotion(req.params.id, req.body, req.user);
    res.status(200).json({ message: "Student promotion corrected successfully", data: plain(promotion) });
  } catch (error) { handleError(res, error); }
};
