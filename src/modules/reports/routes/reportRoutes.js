const express = require("express");
const {
  downloadClassResultExcel,
  downloadStudentReportCard,
  getSubjectAnalysis,
  getDepartmentAnalysis,
} = require("../controllers/reportController");
const { protect, authorize } = require("../../../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.use(authorize("SuperAdmin", "Director", "DeputyDirector", "StudentAffairs", "ExamManager", "HeadDepartment"));
router.get("/class/:classId/excel", downloadClassResultExcel);
router.get("/student/:studentId/pdf", downloadStudentReportCard);
router.get("/subject/:subjectId/analysis", getSubjectAnalysis);
router.get("/department/:departmentId/analysis", getDepartmentAnalysis);

module.exports = router;
