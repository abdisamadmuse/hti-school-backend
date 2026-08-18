const { Op } = require("sequelize");
const { initializeModels } = require("../../../config/mysql");
const {
  allowedDepartmentIds,
  assertDepartmentAccess,
  loadEntryContext,
  validateEntries,
  saveEntries,
} = require("../services/manualMarkService");

const plain = (record) => (record ? record.get({ plain: true }) : null);

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      message: "Marks already exist for this student, exam and subject",
    });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({
      message: error.errors?.[0]?.message || error.message,
    });
  }
  return res.status(error.status || 500).json({
    message: error.message,
    ...(error.details && { errors: error.details }),
  });
};

exports.getManualEntrySheet = async (req, res) => {
  try {
    const context = await loadEntryContext(req.query, req.user);
    const marks = new Map(
      context.existingMarks.map((mark) => [Number(mark.studentId), mark])
    );
    res.status(200).json({
      exam: context.exam,
      class: context.selectedClass,
      subject: context.subject,
      configuration: context.examSubject,
      count: context.students.length,
      students: context.students.map((student) => ({
        ...student,
        mark: marks.get(Number(student.id)) || null,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.saveManualMarks = async (req, res) => {
  try {
    const context = await loadEntryContext(req.body, req.user);
    const validated = validateEntries(req.body.marks, context);
    const summary = await saveEntries(context, validated, req.user._id);
    res.status(200).json({
      message: "Marks saved successfully",
      summary,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getMarks = async (req, res) => {
  try {
    const models = initializeModels();
    const where = {};
    ["examId", "classId", "subjectId", "studentId", "resultStatus"].forEach(
      (field) => {
        if (req.query[field] !== undefined && req.query[field] !== "") {
          where[field] = req.query[field];
        }
      }
    );

    const departments = allowedDepartmentIds(req.user);
    if (departments) {
      const classes = await models.Class.findAll({
        where: { departmentId: { [Op.in]: departments } },
        attributes: ["id"],
      });
      const classIds = classes.map((item) => item.id);
      if (req.query.classId && !classIds.includes(Number(req.query.classId))) {
        return res.status(403).json({
          message: "You cannot access marks outside your department",
        });
      }
      where.classId = req.query.classId || { [Op.in]: classIds };
    }

    const marks = await models.StudentMark.findAll({
      where,
      order: [["updatedAt", "DESC"]],
    });
    const studentIds = [...new Set(marks.map((mark) => mark.studentId))];
    const subjectIds = [...new Set(marks.map((mark) => mark.subjectId))];
    const [students, subjects] = await Promise.all([
      models.Student.findAll({ where: { id: { [Op.in]: studentIds } } }),
      models.Subject.findAll({ where: { id: { [Op.in]: subjectIds } } }),
    ]);
    const studentMap = new Map(students.map((item) => [item.id, plain(item)]));
    const subjectMap = new Map(subjects.map((item) => [item.id, plain(item)]));

    res.status(200).json({
      count: marks.length,
      data: marks.map((mark) => ({
        ...plain(mark),
        student: studentMap.get(mark.studentId) || null,
        subject: subjectMap.get(mark.subjectId) || null,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updateMark = async (req, res) => {
  try {
    const models = initializeModels();
    const current = await models.StudentMark.findByPk(req.params.id);
    if (!current) {
      return res.status(404).json({ message: "Student mark not found" });
    }
    const currentMark = plain(current);
    const context = await loadEntryContext(
      {
        examId: currentMark.examId,
        classId: currentMark.classId,
        subjectId: currentMark.subjectId,
      },
      req.user
    );
    const validated = validateEntries(
      [
        {
          theoryMark: currentMark.theoryMark,
          practicalMark: currentMark.practicalMark,
          markStatus: ["Absent", "Exempted"].includes(currentMark.resultStatus)
            ? currentMark.resultStatus
            : "Present",
          remarks: currentMark.remarks,
          ...req.body,
          studentId: currentMark.studentId,
        },
      ],
      context
    );
    const summary = await saveEntries(context, validated, req.user._id);
    const updated = await models.StudentMark.findByPk(req.params.id);
    res.status(200).json({
      message:
        summary.updated > 0 ? "Mark updated successfully" : "No mark changes detected",
      data: plain(updated),
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getMarkHistory = async (req, res) => {
  try {
    const models = initializeModels();
    const mark = await models.StudentMark.findByPk(req.params.id);
    if (!mark) {
      return res.status(404).json({ message: "Student mark not found" });
    }
    const configuration = await models.ExamSubject.findByPk(mark.examSubjectId);
    if (!configuration) {
      return res.status(404).json({
        message: "Exam subject configuration not found",
      });
    }
    assertDepartmentAccess(req.user, configuration.departmentId);
    const history = await models.MarkEditHistory.findAll({
      where: { studentMarkId: mark.id },
      order: [["createdAt", "DESC"]],
    });
    const editorIds = [...new Set(history.map((item) => item.editedBy))];
    const editors = await models.User.findAll({
      where: { id: { [Op.in]: editorIds } },
      attributes: ["id", "fullName", "role"],
    });
    const editorMap = new Map(editors.map((item) => [item.id, plain(item)]));

    res.status(200).json({
      mark: plain(mark),
      count: history.length,
      data: history.map((item) => ({
        ...plain(item),
        editor: editorMap.get(item.editedBy) || null,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};
