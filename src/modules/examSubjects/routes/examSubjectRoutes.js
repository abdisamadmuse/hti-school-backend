const express = require("express");
const {
  getExamSubjects,
  getExamSubjectById,
  createExamSubject,
  updateExamSubject,
  deleteExamSubject,
} = require("../controllers/examSubjectController");
const {
  protect,
  examManagerOnly,
} = require("../../../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/", getExamSubjects);
router.get("/:id", getExamSubjectById);
router.post("/", examManagerOnly, createExamSubject);
router.put("/:id", examManagerOnly, updateExamSubject);
router.delete("/:id", examManagerOnly, deleteExamSubject);

module.exports = router;
