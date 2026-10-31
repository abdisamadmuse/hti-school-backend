const express = require("express");
const {
  calculateResults,
  getClassResults,
  getStudentResults,
} = require("../controllers/resultController");
const { protect, authorize, examManagerOnly } = require("../../../middleware/authMiddleware");

const router = express.Router();

// The student profile is currently available without an authenticated frontend
// session, so its read-only academic summary must be available on the same basis.
router.get("/student/:studentId", getStudentResults);

router.use(protect);
router.post("/calculate", examManagerOnly, calculateResults);
router.get("/class/:classId", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), getClassResults);

module.exports = router;
