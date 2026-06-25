const express = require("express");

const {
  createAttendance,
  bulkAttendance,
  getAttendance,
  getAttendanceByClass,
  getAttendanceByStudent,
  updateAttendance,
  deleteAttendance,
} = require("../controllers/attendanceController");

const router = express.Router();

router.post("/", createAttendance);
router.post("/bulk", bulkAttendance);
router.get("/", getAttendance);
router.get("/class/:classId", getAttendanceByClass);
router.get("/student/:studentId", getAttendanceByStudent);
router.put("/:id", updateAttendance);
router.delete("/:id", deleteAttendance);

module.exports = router;
