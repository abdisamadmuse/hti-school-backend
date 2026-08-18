const express = require("express");
const {
  previewPromotions,
  processStudentPromotions,
  getPromotionHistory,
  correctStudentPromotion,
} = require("../controllers/promotionController");
const { protect, authorize, examManagerOnly } = require("../../../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.post("/preview", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), previewPromotions);
router.post("/process", examManagerOnly, processStudentPromotions);
router.get("/", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), getPromotionHistory);
router.put("/:id/correct", examManagerOnly, correctStudentPromotion);

module.exports = router;
