const express = require("express");

const {
  createAttendance,
  bulkAttendance,
  getAttendance,
  getAttendanceByClass,
  getAttendanceByStudent,
  updateAttendance,
  deleteAttendance,
  getAttendanceAssignments,
  getAttendanceRoster,
  markSubjectAttendance,
} = require("../controllers/attendanceController");

const router = express.Router();
router.use(require("../attendanceRoutesV2"));

router.get("/assignments", getAttendanceAssignments);
router.get("/roster", getAttendanceRoster);
router.post("/mark", markSubjectAttendance);
router.post("/", createAttendance);
router.post("/bulk", bulkAttendance);
router.get("/", getAttendance);
router.get("/class/:classId", getAttendanceByClass);
router.get("/student/:studentId", getAttendanceByStudent);
router.put("/:id", updateAttendance);
router.delete("/:id", deleteAttendance);

module.exports = router;
