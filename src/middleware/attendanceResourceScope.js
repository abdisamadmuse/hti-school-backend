// Scope shared class/student lookup APIs too, so attendance accounts cannot
// bypass their roster restrictions by calling a generic directory endpoint.
const { Op } = require("sequelize");
const { initializeModels } = require("../config/mysql");
const { departmentIds, attendanceClassAllowed } = require("../modules/attendance/attendanceDomain");
module.exports = async (req, res, next) => {
  if (!["Teacher", "AttendanceTaker"].includes(req.user.role) || req.method !== "GET" || !/^\/(classes|students|departments)(\/|$)/.test(req.path)) return next();
  try {
    const M = initializeModels();
    if (req.path.startsWith("/departments")) {
      if (req.user.role !== "AttendanceTaker") return next();
      const rows = await M.Department.findAll({ where: { id: { [Op.in]: departmentIds(req.user) } } });
      const match = /^\/departments\/(\d+)$/.exec(req.path);
      if (["/departments", "/departments/"].includes(req.path)) return res.json(rows);
      const row = match && rows.find(r => Number(r.id) === Number(match[1]));
      return row ? res.json(row) : res.status(403).json({ message: "Department is outside your assignments" });
    }
    const assignments = req.user.role === "Teacher"
      ? req.user.teacherId ? await M.TeacherAssignment.findAll({ where: { teacherId: req.user.teacherId, isActive: true } }) : []
      : (await M.Class.findAll({ where: { isActive: true } })).filter(c => attendanceClassAllowed(req.user, c)).map(c => ({ classId: c.id, academicYearId: c.academicYearId }));
    const scopes = assignments.map(a => ({ classId: a.classId, academicYearId: a.academicYearId }));
    const classIds = [...new Set(scopes.map(s => s.classId))];
    const classes = await M.Class.findAll({ where: { id: { [Op.in]: classIds }, ...(req.query.departmentId ? { departmentId: Number(req.query.departmentId) } : {}) } });
    const visibleIds = new Set(classes.map(c => c.id));
    const visibleScopes = scopes.filter(s => visibleIds.has(s.classId));
    if (req.path.startsWith("/classes")) {
      if (req.path === "/classes" || req.path === "/classes/") return res.json(classes);
      const match = /^\/classes\/(\d+)$/.exec(req.path);
      const row = match && classes.find(c => c.id === Number(match[1]));
      return row ? res.json(row) : res.status(403).json({ message: "Class is outside your assignments" });
    }
    const byClass = /^\/students\/class\/(\d+)$/.exec(req.path);
    const byId = /^\/students\/(\d+)$/.exec(req.path);
    if (!byClass && !byId && !["/students", "/students/"].includes(req.path)) return res.status(403).json({ message: "Use the assigned attendance roster" });
    const requestedClass = Number(byClass?.[1] || req.query.classId || 0);
    if (requestedClass && !visibleIds.has(requestedClass)) return res.status(403).json({ message: "Class is outside your assignments" });
    const where = { [Op.or]: visibleScopes.length ? visibleScopes : [{ id: 0 }] };
    if (requestedClass) where.classId = requestedClass;
    if (byId) where.id = Number(byId[1]);
    if (req.query.academicYearId) where.academicYearId = Number(req.query.academicYearId);
    const students = await M.Student.findAll({ where, attributes: ["id", "fullName", "admissionNo", "gender", "classId", "academicYearId", "departmentId", "isActive"], order: [["fullName", "ASC"]] });
    if (byId) return students.length ? res.json({ data: students[0] }) : res.status(403).json({ message: "Student is outside your assignments" });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20)), page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: students.slice((page - 1) * limit, page * limit), total: students.length, page, limit });
  } catch (error) { res.status(500).json({ message: error.message }); }
};
