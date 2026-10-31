const express = require("express");
const {
  createExam,
  getExams,
  getExamById,
  updateExam,
  updateExamStatus,
  deleteExam,
} = require("../controllers/examController");
const {
  createExamSubject,
  getExamSubjects,
} = require("../../examSubjects/controllers/examSubjectController");
const {
  protect,
  examManagerOnly,
} = require("../../../middleware/authMiddleware");
const {
  publishExamResults,
  unpublishExamResults,
} = require("../../results/controllers/publicationController");

const router = express.Router();

router.use(protect);

router.get("/", getExams);
router.patch("/:examId/publish", examManagerOnly, publishExamResults);
router.patch("/:examId/unpublish", examManagerOnly, unpublishExamResults);
router.get("/:examId/subjects", getExamSubjects);
router.post("/:examId/subjects", examManagerOnly, createExamSubject);
router.get("/:examId/readiness", examManagerOnly, require("../controllers/examController").getReadiness);
router.get("/:id", getExamById);
router.post("/", examManagerOnly, createExam);
router.put("/:id", examManagerOnly, updateExam);
router.patch("/:id/status", examManagerOnly, updateExamStatus);
router.delete("/:id", examManagerOnly, deleteExam);

module.exports = router;
