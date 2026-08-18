const express = require("express");
const {
  createGradingScale,
  getGradingScales,
  updateGradingScale,
  deleteGradingScale,
} = require("../controllers/gradingScaleController");
const { protect, authorize, examManagerOnly } = require("../../../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.get("/", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), getGradingScales);
router.post("/", examManagerOnly, createGradingScale);
router.put("/:id", examManagerOnly, updateGradingScale);
router.delete("/:id", examManagerOnly, deleteGradingScale);

module.exports = router;
