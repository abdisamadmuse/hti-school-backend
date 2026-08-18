const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");
const { assertDepartmentAccess } = require("../../examMarks/services/manualMarkService");

const plain = (record) => (record ? record.get({ plain: true }) : null);
const decisions = ["Promoted", "Repeated", "Graduated", "Held"];

const loadPromotionContext = async ({ examId, ruleId }, user) => {
  if (!examId || !ruleId) {
    const error = new Error("examId and ruleId are required");
    error.status = 400;
    throw error;
  }
  const models = initializeModels();
  const [exam, rule] = await Promise.all([
    models.Exam.findByPk(examId),
    models.PromotionRule.findByPk(ruleId),
  ]);
  if (!exam || !rule) {
    const error = new Error("Exam or promotion rule not found");
    error.status = 404;
    throw error;
  }
  if (!rule.isActive) {
    const error = new Error("Promotion rule is inactive");
    error.status = 409;
    throw error;
  }
  if (exam.status !== "Published" || !exam.resultsPublished) {
    const error = new Error("Student promotion requires published exam results");
    error.status = 409;
    throw error;
  }
  if (Number(exam.academicYearId) !== Number(rule.sourceAcademicYearId)) {
    const error = new Error("Exam and promotion rule use different source academic years");
    error.status = 400;
    throw error;
  }
  assertDepartmentAccess(user, rule.departmentId);
  const summaries = await models.ResultSummary.findAll({
    where: { examId, classId: rule.fromClassId },
    order: [["classPosition", "ASC"]],
  });
  if (!summaries.length) {
    const error = new Error("No calculated results found for the promotion class");
    error.status = 409;
    throw error;
  }
  const studentIds = summaries.map((item) => item.studentId);
  const [students, existingPromotions] = await Promise.all([
    models.Student.findAll({ where: { id: { [Op.in]: studentIds } } }),
    models.StudentPromotion.findAll({
      where: { studentId: { [Op.in]: studentIds }, toAcademicYearId: rule.destinationAcademicYearId },
    }),
  ]);
  const studentMap = new Map(students.map((item) => [item.id, plain(item)]));
  if (students.length !== studentIds.length) {
    const error = new Error("One or more students from the result summary no longer exist");
    error.status = 409;
    throw error;
  }
  const promotionMap = new Map(existingPromotions.map((item) => [item.studentId, plain(item)]));
  return {
    models,
    exam: plain(exam),
    rule: plain(rule),
    summaries: summaries.map(plain),
    studentMap,
    promotionMap,
  };
};

const recommendedDecision = (summary, rule) => {
  if (summary.overallStatus === "Incomplete" || summary.averagePercentage === null) return "Held";
  const eligible =
    Number(summary.averagePercentage) >= Number(rule.minimumAverage) &&
    Number(summary.subjectsFailed) <= Number(rule.maximumFailedSubjects);
  if (!eligible) return "Repeated";
  return rule.isFinalClass ? "Graduated" : "Promoted";
};

const buildPreview = (context) =>
  context.summaries.map((summary) => {
    const recommendation = recommendedDecision(summary, context.rule);
    const reasons = [];
    if (summary.overallStatus === "Incomplete") reasons.push("Result is incomplete");
    if (summary.averagePercentage !== null && Number(summary.averagePercentage) < Number(context.rule.minimumAverage)) {
      reasons.push(`Average is below ${Number(context.rule.minimumAverage)}%`);
    }
    if (Number(summary.subjectsFailed) > Number(context.rule.maximumFailedSubjects)) {
      reasons.push(`Failed subjects exceed ${context.rule.maximumFailedSubjects}`);
    }
    if (!reasons.length) reasons.push(context.rule.isFinalClass ? "Graduation requirements met" : "Promotion requirements met");
    return {
      student: context.studentMap.get(summary.studentId) || null,
      resultSummaryId: summary.id,
      averagePercentage: summary.averagePercentage,
      failedSubjects: summary.subjectsFailed,
      overallStatus: summary.overallStatus,
      recommendation,
      recommendationReason: reasons.join("; "),
      alreadyProcessed: context.promotionMap.get(summary.studentId) || null,
    };
  });

const actualClassForDecision = (decision, rule) => {
  if (decision === "Promoted") return rule.toClassId;
  if (decision === "Repeated") return rule.repeatClassId;
  return null;
};

const processPromotions = async (context, overrides, userId) => {
  const preview = buildPreview(context);
  const overrideMap = new Map(
    (Array.isArray(overrides) ? overrides : []).map((item) => [Number(item.studentId), item])
  );
  const unknownOverrides = [...overrideMap.keys()].filter(
    (studentId) => !preview.some((item) => Number(item.student?.id) === studentId)
  );
  if (unknownOverrides.length) {
    const error = new Error(`Override contains students outside this result set: ${unknownOverrides.join(", ")}`);
    error.status = 400;
    throw error;
  }
  const errors = [];
  const rows = preview.map((item) => {
    const override = overrideMap.get(Number(item.student.id));
    const decision = override?.decision || item.recommendation;
    const reason = String(override?.reason || item.recommendationReason).trim();
    if (item.alreadyProcessed) errors.push({ studentId: item.student.id, message: "Student has already been processed for the destination academic year" });
    if (!decisions.includes(decision)) errors.push({ studentId: item.student.id, message: `Invalid decision ${decision}` });
    if (decision !== item.recommendation && !String(override?.reason || "").trim()) {
      errors.push({ studentId: item.student.id, message: "A reason is required when overriding the recommendation" });
    }
    if (decision === "Promoted" && context.rule.isFinalClass) errors.push({ studentId: item.student.id, message: "A final-class student cannot be marked Promoted" });
    if (decision === "Graduated" && !context.rule.isFinalClass) errors.push({ studentId: item.student.id, message: "Only final-class students can graduate" });
    if (decision === "Repeated" && !context.rule.repeatClassId) errors.push({ studentId: item.student.id, message: "Repeat class is not configured" });
    if (decision === "Promoted" && !context.rule.toClassId) errors.push({ studentId: item.student.id, message: "Destination class is not configured" });
    if (
      decision !== "Held" &&
      (Number(item.student.academicYearId) !== Number(context.rule.sourceAcademicYearId) ||
        Number(item.student.classId) !== Number(context.rule.fromClassId))
    ) {
      errors.push({ studentId: item.student.id, message: "Student is no longer in the source academic year and class" });
    }
    return { ...item, decision, reason, toClassId: actualClassForDecision(decision, context.rule) };
  });
  if (errors.length) {
    const error = new Error("Promotion processing contains validation errors");
    error.status = 422;
    error.details = errors;
    throw error;
  }

  await sequelize.transaction(async (transaction) => {
    for (const row of rows) {
      await context.models.StudentPromotion.create(
        {
          studentId: row.student.id,
          examId: context.exam.id,
          resultSummaryId: row.resultSummaryId,
          fromAcademicYearId: context.rule.sourceAcademicYearId,
          toAcademicYearId: context.rule.destinationAcademicYearId,
          fromClassId: context.rule.fromClassId,
          toClassId: row.toClassId,
          averagePercentage: row.averagePercentage,
          failedSubjects: row.failedSubjects,
          decision: row.decision,
          reason: row.reason,
          processedBy: userId,
          processedAt: new Date(),
        },
        { transaction }
      );
      if (row.decision === "Promoted" || row.decision === "Repeated") {
        await context.models.Student.update(
          {
            academicYearId: context.rule.destinationAcademicYearId,
            classId: row.toClassId,
            status: "Active",
            isActive: true,
          },
          { where: { id: row.student.id }, transaction }
        );
      } else if (row.decision === "Graduated") {
        await context.models.Student.update(
          { status: "Graduated", isActive: true },
          { where: { id: row.student.id }, transaction }
        );
      }
    }
  });
  return {
    total: rows.length,
    promoted: rows.filter((item) => item.decision === "Promoted").length,
    repeated: rows.filter((item) => item.decision === "Repeated").length,
    graduated: rows.filter((item) => item.decision === "Graduated").length,
    held: rows.filter((item) => item.decision === "Held").length,
  };
};

const correctPromotion = async (promotionId, input, user) => {
  const models = initializeModels();
  const promotion = await models.StudentPromotion.findByPk(promotionId);
  if (!promotion) {
    const error = new Error("Student promotion not found");
    error.status = 404;
    throw error;
  }
  const decision = String(input.decision || "").trim();
  const reason = String(input.reason || "").trim();
  if (!decisions.includes(decision) || !reason) {
    const error = new Error("A valid decision and correction reason are required");
    error.status = 400;
    throw error;
  }
  const rule = await models.PromotionRule.findOne({
    where: {
      sourceAcademicYearId: promotion.fromAcademicYearId,
      destinationAcademicYearId: promotion.toAcademicYearId,
      fromClassId: promotion.fromClassId,
    },
  });
  if (!rule) {
    const error = new Error("The promotion rule used for this record no longer exists");
    error.status = 409;
    throw error;
  }
  assertDepartmentAccess(user, rule.departmentId);
  if (decision === "Promoted" && rule.isFinalClass) {
    const error = new Error("A final-class student cannot be marked Promoted");
    error.status = 400;
    throw error;
  }
  if (decision === "Graduated" && !rule.isFinalClass) {
    const error = new Error("Only final-class students can graduate");
    error.status = 400;
    throw error;
  }
  const laterPromotion = await models.StudentPromotion.findOne({
    where: {
      studentId: promotion.studentId,
      processedAt: { [Op.gt]: promotion.processedAt },
    },
  });
  if (laterPromotion) {
    const error = new Error("This promotion cannot be corrected after a later promotion has been processed");
    error.status = 409;
    throw error;
  }
  const newToClassId = actualClassForDecision(decision, plain(rule));
  await sequelize.transaction(async (transaction) => {
    await models.PromotionCorrection.create(
      {
        promotionId: promotion.id,
        oldDecision: promotion.decision,
        newDecision: decision,
        oldToClassId: promotion.toClassId,
        newToClassId,
        reason,
        correctedBy: user.id || user._id,
        correctedAt: new Date(),
      },
      { transaction }
    );
    await promotion.update(
      { decision, toClassId: newToClassId },
      { transaction }
    );
    const studentValues =
      decision === "Promoted" || decision === "Repeated"
        ? {
            academicYearId: rule.destinationAcademicYearId,
            classId: newToClassId,
            status: "Active",
            isActive: true,
          }
        : decision === "Graduated"
        ? {
            academicYearId: rule.sourceAcademicYearId,
            classId: rule.fromClassId,
            status: "Graduated",
            isActive: true,
          }
        : {
            academicYearId: rule.sourceAcademicYearId,
            classId: rule.fromClassId,
            status: "Active",
            isActive: true,
          };
    await models.Student.update(studentValues, {
      where: { id: promotion.studentId },
      transaction,
    });
  });
  return promotion;
};

module.exports = { loadPromotionContext, buildPreview, processPromotions, correctPromotion };
