const allowedDepartmentIds = (user) => [...new Set([user.departmentId, ...(Array.isArray(user.departmentIds) ? user.departmentIds : [])].map(Number).filter(Boolean))];
const valueId = (value) => Number(value?.id || value?._id || value);

const headDepartmentAccess = (req, res, next) => {
  if (req.user.role !== "HeadDepartment") return next();
  const departments = allowedDepartmentIds(req.user);
  if (!departments.length) return res.status(403).json({ message: "No department is assigned to this account" });

  const readable = /^\/(dashboard|academic-years|terms|programs|departments|students|teachers|classes|subjects|attendance|teacher-assignments|teacher-course-content|discipline|reports)(\/|$)/;
  if (!readable.test(req.path)) return res.status(403).json({ message: "This page is not available to Head of Department accounts" });
  if (req.method !== "GET") return res.status(403).json({ message: "Head of Department access is review-only" });

  req.query.departmentId = departments.length === 1 ? String(departments[0]) : req.query.departmentId;
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const permitted = (item) => {
      if (!item || typeof item !== "object") return true;
      if (req.path.startsWith("/departments")) return departments.includes(valueId(item.id || item._id));
      if (!("departmentId" in item)) return true;
      return departments.includes(valueId(item.departmentId));
    };
    if (Array.isArray(payload)) payload = payload.filter(permitted);
    else if (Array.isArray(payload?.data)) { payload.data = payload.data.filter(permitted); payload.count = payload.data.length; payload.total = payload.data.length; }
    else if (payload?.data && !permitted(payload.data)) return res.status(403).send({ message: "This record belongs to another department" });
    else if (payload && typeof payload === "object" && !permitted(payload)) { res.status(403); return originalJson({ message: "This record belongs to another department" }); }
    return originalJson(payload);
  };
  next();
};

const portalRoleAccess = (req, res, next) => {
  if (["SuperAdmin", "Director", "DeputyDirector", "StudentAffairs"].includes(req.user.role)) {
    if (req.path.startsWith("/users") && req.user.role !== "SuperAdmin") return res.status(403).json({ message: "Only SuperAdmin can manage users" });
    return next();
  }
  const attendanceResource = /^\/(academic-years|terms|departments|classes|students|attendance)(\/|$)/.test(req.path)
    || /^\/mobile\/attendance(\/|$)/.test(req.path);
  if (["AttendanceTaker", "Teacher"].includes(req.user.role) && (!attendanceResource || req.method !== "GET" && !req.path.startsWith("/attendance"))) return res.status(403).json({ message: "Attendance accounts can only access attendance resources" });
  return next();
};

module.exports = { headDepartmentAccess, portalRoleAccess, allowedDepartmentIds };
