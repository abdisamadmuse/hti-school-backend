const express = require("express");

const { protect } = require("../../../middleware/authMiddleware");
const {
  getAssignedAttendanceClasses,
  getAssignedClassStudents,
} = require("../controllers/mobileAttendanceController");

const router = express.Router();

router.get("/attendance/classes", protect, getAssignedAttendanceClasses);
router.get(
  "/attendance/classes/:classId/students",
  protect,
  getAssignedClassStudents
);

module.exports = router;
