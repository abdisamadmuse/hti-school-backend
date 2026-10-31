const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");
const { assertDepartmentAccess } = require("../../examMarks/services/manualMarkService");
const { calculateClassResults } = require("../services/resultCalculationService");

const plain = (record) => (record ? record.get({ plain: true }) : null);
const handleError = (res, error) => {
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ message: error.errors?.[0]?.message || error.message });
  }
  return res.status(error.status || 500).json({ message: error.message });
};

exports.calculateResults = async (req, res) => {
  try {
    const result = await calculateClassResults(req.body, req.user);
    res.status(200).json({
      message: "Class results calculated successfully",
      exam: result.exam,
      class: result.class,
      summary: {
        students: result.summaries.length,
        passed: result.summaries.filter((item) => item.overallStatus === "Pass").length,
        failed: result.summaries.filter((item) => item.overallStatus === "Fail").length,
        incomplete: result.summaries.filter((item) => item.overallStatus === "Incomplete").length,
      },
      data: result.summaries,
    });
  } catch (error) { handleError(res, error); }
};

exports.getClassResults = async (req, res) => {
  try {
    if (!req.query.examId) return res.status(400).json({ message: "examId is required" });
    const models = initializeModels();
    const selectedClass = await models.Class.findByPk(req.params.classId);
    if (!selectedClass) return res.status(404).json({ message: "Class not found" });
    assertDepartmentAccess(req.user, selectedClass.departmentId);
    const summaries = await models.ResultSummary.findAll({
      where: { examId: req.query.examId, classId: req.params.classId },
      order: [
        [sequelize.literal("classPosition IS NULL"), "ASC"],
        ["classPosition", "ASC"],
        ["studentId", "ASC"],
      ],
    });
    const studentIds = summaries.map((item) => item.studentId);
    const students = await models.Student.findAll({
      where: { id: { [Op.in]: studentIds } },
      attributes: ["id", "admissionNo", "fullName", "gender"],
    });
    const studentMap = new Map(students.map((item) => [item.id, plain(item)]));
    res.status(200).json({
      class: plain(selectedClass),
      count: summaries.length,
      data: summaries.map((item) => ({
        ...plain(item),
        student: studentMap.get(item.studentId) || null,
      })),
    });
  } catch (error) { handleError(res, error); }
};

exports.getStudentResults = async (req, res) => {
  try {
    const models = initializeModels();
    const student = await models.Student.findByPk(req.params.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    // Authenticated department heads are scoped by middleware on protected
    // result routes. This read-only endpoint is also used by the public student
    // profile, where no user is attached to the request.
    if (req.user) assertDepartmentAccess(req.user, student.departmentId);
    const summaryWhere = { studentId: student.id };
    if (req.query.examId) summaryWhere.examId = req.query.examId;
    const summaries = await models.ResultSummary.findAll({
      where: summaryWhere,
      order: [["createdAt", "DESC"]],
    });
    const examIds = summaries.map((item) => item.examId);
    const [exams, marks, subjects] = await Promise.all([
      models.Exam.findAll({ where: { id: { [Op.in]: examIds } } }),
      models.StudentMark.findAll({
        where: {
          studentId: student.id,
          ...(req.query.examId && { examId: req.query.examId }),
        },
        order: [["subjectId", "ASC"]],
      }),
      models.Subject.findAll(),
    ]);
    const examMap = new Map(exams.map((item) => [item.id, plain(item)]));
    const subjectMap = new Map(subjects.map((item) => [item.id, plain(item)]));
    const marksByExam = new Map();
    marks.forEach((mark) => {
      if (!marksByExam.has(mark.examId)) marksByExam.set(mark.examId, []);
      marksByExam.get(mark.examId).push({
        ...plain(mark),
        subject: subjectMap.get(mark.subjectId) || null,
      });
    });
    res.status(200).json({
      student: plain(student),
      count: summaries.length,
      data: summaries.map((item) => ({
        ...plain(item),
        exam: examMap.get(item.examId) || null,
        marks: marksByExam.get(item.examId) || [],
      })),
    });
  } catch (error) { handleError(res, error); }
};
