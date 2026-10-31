const { initializeModels } = require("../../../config/mysql");
const { Op } = require("sequelize");
const { allowedDepartmentIds } = require("../../../middleware/portalAccessMiddleware");
const id = (v, n) => {
  const x = Number(v);
  if (!Number.isInteger(x) || x < 1)
    throw Object.assign(new Error(`${n} is required`), { status: 400 });
  return x;
};
const fail = (res, e) =>
  res.status(e.status || 500).json({ message: e.message });
exports.list = async (req, res) => {
  try {
    const m = initializeModels(),
      where = { academicYearId: id(req.query.academicYearId, "academicYearId") };
    let scopedTeacherIds = null;
    if (req.user?.role === "HeadDepartment") {
      const teachers = await m.Teacher.findAll({ where: { departmentId: { [Op.in]: allowedDepartmentIds(req.user) } }, attributes: ["id"] });
      scopedTeacherIds = teachers.map((teacher) => teacher.id);
      where.teacherId = { [Op.in]: scopedTeacherIds };
    }
    if (req.query.teacherId) {
      const requestedTeacher = id(req.query.teacherId, "teacherId");
      if (scopedTeacherIds && !scopedTeacherIds.includes(requestedTeacher)) return res.status(403).json({ message: "Teacher belongs to another department" });
      where.teacherId = requestedTeacher;
    }
    const contents = await m.TeacherTermContent.findAll({
        where,
        order: [
          ["termId", "ASC"],
          ["courseTitle", "ASC"],
        ],
      }),
      schemes = await m.TeacherMonthlyScheme.findAll({
        where,
        order: [["month", "ASC"]],
      });
    const terms = await m.Term.findAll({
      where: { academicYearId: where.academicYearId },
    });
    const termMap = Object.fromEntries(
      terms.map((t) => [t.id, t.get({ plain: true })]),
    );
    res.json({
      courseContents: contents.map((r) => ({
        ...r.get({ plain: true }),
        term: termMap[r.termId],
      })),
      schemes: schemes.map((r) => ({
        ...r.get({ plain: true }),
        term: termMap[r.termId],
      })),
    });
  } catch (e) {
    fail(res, e);
  }
};
exports.createContent = async (req, res) => {
  try {
    const m = initializeModels(),
      teacherId = id(req.body.teacherId, "teacherId"),
      academicYearId = id(req.body.academicYearId, "academicYearId"),
      termId = id(req.body.termId, "termId"),
      courseTitle = String(req.body.courseTitle || "").trim(),
      chaptersTopics = String(req.body.chaptersTopics || "").trim();
    if (!courseTitle || !chaptersTopics)
      return res
        .status(400)
        .json({ message: "Course title and chapters/topics are required" });
    const row = await m.TeacherTermContent.create({
      teacherId,
      academicYearId,
      termId,
      courseTitle,
      chaptersTopics,
      documentUrl: req.file
        ? `/uploads/teacher-planning/${req.file.filename}`
        : null,
      originalFileName: req.file?.originalname || null,
    });
    res
      .status(201)
      .json({ message: "Term course content uploaded", data: row });
  } catch (e) {
    fail(res, e);
  }
};
exports.createScheme = async (req, res) => {
  try {
    const m = initializeModels(),
      termContentId = id(req.body.termContentId, "termContentId"),
      content = await m.TeacherTermContent.findByPk(termContentId);
    if (!content)
      return res.status(404).json({ message: "Term course content not found" });
    const month = id(req.body.month, "month");
    if (month > 12)
      return res
        .status(400)
        .json({ message: "month must be between 1 and 12" });
    const teachingPlan = String(req.body.teachingPlan || "").trim();
    if (!teachingPlan)
      return res
        .status(400)
        .json({ message: "Monthly teaching plan is required" });
    const row = await m.TeacherMonthlyScheme.create({
      teacherId: content.teacherId,
      academicYearId: content.academicYearId,
      termId: content.termId,
      termContentId,
      month,
      teachingPlan,
      documentUrl: req.file
        ? `/uploads/teacher-planning/${req.file.filename}`
        : null,
      originalFileName: req.file?.originalname || null,
    });
    res
      .status(201)
      .json({ message: "Monthly scheme of work uploaded", data: row });
  } catch (e) {
    fail(res, e);
  }
};
exports.deleteContent = async (req, res) => {
  try {
    const m = initializeModels(),
      row = await m.TeacherTermContent.findByPk(req.params.id);
    if (!row)
      return res.status(404).json({ message: "Course content not found" });
    await m.TeacherMonthlyScheme.destroy({ where: { termContentId: row.id } });
    await row.destroy();
    res.json({ message: "Course content deleted" });
  } catch (e) {
    fail(res, e);
  }
};
exports.deleteScheme = async (req, res) => {
  try {
    const m = initializeModels(),
      row = await m.TeacherMonthlyScheme.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: "Scheme not found" });
    await row.destroy();
    res.json({ message: "Scheme deleted" });
  } catch (e) {
    fail(res, e);
  }
};
