const { calculateMark } = require("../../examMarks/services/assessment");
const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");

const validatePublication = async (examId) => {
  const models = initializeModels();
  const exam = await models.Exam.findByPk(examId);
  if (!exam) {
    const error = new Error("Exam not found");
    error.status = 404;
    throw error;
  }
  if (exam.status !== "Open") {
    const error = new Error("Only an Open exam can be published");
    error.status = 409;
    throw error;
  }
  const configurations = await models.ExamSubject.findAll({
    where: { examId, isActive: true },
  });
  if (!configurations.length) {
    const error = new Error("Exam has no active subject configurations");
    error.status = 409;
    throw error;
  }
  const classIds = [...new Set(configurations.map((item) => item.classId))];
  const errors = [];
  for (const classId of classIds) {
    const [students, summaries, latestMark, classConfigurations] = await Promise.all([
      models.Student.findAll({
        where: {
          classId,
          academicYearId: exam.academicYearId,
          status: "Active",
          isActive: true,
        },
        attributes: ["id", "admissionNo", "fullName"],
      }),
      models.ResultSummary.findAll({ where: { examId, classId } }),
      models.StudentMark.findOne({
        where: { examId, classId },
        order: [["updatedAt", "DESC"]],
      }),
      models.ExamSubject.findAll({ where: { examId, classId, isActive: true } }),
    ]);
    if (!students.length) errors.push({ classId, message: "Class has no active students" });
    const summaryMap = new Map(summaries.map((item) => [item.studentId, item]));
    const latestConfigurationTime = classConfigurations.reduce(
      (latest, item) =>
        !latest || new Date(item.updatedAt) > latest ? new Date(item.updatedAt) : latest,
      null
    );
    const latestInputTime = [latestMark?.updatedAt, latestConfigurationTime]
      .filter(Boolean)
      .map((value) => new Date(value))
      .sort((left, right) => right - left)[0];

    const marks = await models.StudentMark.findAll({ where: { examId, classId } });
    const markMap = new Map(marks.map((mark) => [mark.studentId + ":" + mark.subjectId, mark]));
    students.forEach((student) => {
      for (const config of classConfigurations) {
        const mark = markMap.get(student.id + ":" + config.subjectId);
        if (!mark || mark.resultStatus === "Missing") {
          errors.push({ classId, studentId: student.id, subjectId: config.subjectId, message: "Mark is missing" });
          continue;
        }
        const status = ["Absent", "Exempted"].includes(mark.resultStatus) ? mark.resultStatus : "Present";
        const record = mark.get ? mark.get({ plain: true }) : mark;
        const checked = calculateMark({ ...record, markStatus: status }, config);
        checked.errors.forEach((message) => errors.push({ classId, studentId: student.id, subjectId: config.subjectId, message }));
        if (!checked.errors.length && status === "Present" && Number(mark.totalMark) !== checked.values.totalMark) errors.push({ classId, studentId: student.id, subjectId: config.subjectId, message: "Stored total differs from enabled component scores; correct marks and recalculate" });
      }
      const summary = summaryMap.get(student.id);
      if (!summary) {
        errors.push({ classId, studentId: student.id, admissionNo: student.admissionNo, message: "Result has not been calculated" });
      } else if (summary.overallStatus === "Incomplete" || summary.subjectsMissing > 0) {
        errors.push({ classId, studentId: student.id, admissionNo: student.admissionNo, message: "Result is incomplete" });
      } else if (latestInputTime && new Date(summary.calculatedAt) < latestInputTime) {
        errors.push({ classId, studentId: student.id, admissionNo: student.admissionNo, message: "Result must be recalculated after the latest mark or configuration change" });
      }
    });
  }
  return { models, exam, classIds, errors };
};

const publishExam = async (examId) => {
  const validation = await validatePublication(examId);
  if (validation.errors.length) {
    const error = new Error("Exam cannot be published until all result problems are resolved");
    error.status = 422;
    error.details = validation.errors;
    throw error;
  }
  await sequelize.transaction(async (transaction) => {
    await validation.models.Exam.update(
      { status: "Published", resultsPublished: true },
      { where: { id: examId }, transaction }
    );
  });
  return { examId: Number(examId), classes: validation.classIds.length };
};

const unpublishExam = async (examId) => {
  const models = initializeModels();
  const exam = await models.Exam.findByPk(examId);
  if (!exam) {
    const error = new Error("Exam not found");
    error.status = 404;
    throw error;
  }
  if (exam.status !== "Published") {
    const error = new Error("Only a Published exam can be unpublished");
    error.status = 409;
    throw error;
  }
  await exam.update({ status: "Open", resultsPublished: false });
  return exam;
};

module.exports = { validatePublication, publishExam, unpublishExam };
