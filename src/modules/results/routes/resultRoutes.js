const express = require("express");
const {
  calculateResults,
  getClassResults,
  getStudentResults,
} = require("../controllers/resultController");
const { protect, authorize, examManagerOnly } = require("../../../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.post("/calculate", examManagerOnly, calculateResults);
router.get("/class/:classId", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), getClassResults);
router.get("/student/:studentId", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), getStudentResults);

module.exports = router;
