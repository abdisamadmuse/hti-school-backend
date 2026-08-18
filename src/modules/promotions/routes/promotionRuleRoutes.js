const express = require("express");
const {
  createPromotionRule,
  getPromotionRules,
  updatePromotionRule,
  deletePromotionRule,
} = require("../controllers/promotionRuleController");
const { protect, authorize, examManagerOnly } = require("../../../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.get("/", authorize("SuperAdmin", "ExamManager", "HeadDepartment"), getPromotionRules);
router.post("/", examManagerOnly, createPromotionRule);
router.put("/:id", examManagerOnly, updatePromotionRule);
router.delete("/:id", examManagerOnly, deletePromotionRule);

module.exports = router;
