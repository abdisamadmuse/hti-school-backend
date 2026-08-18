const express = require("express");
const { protect, authorize } = require("../../../middleware/authMiddleware");
const upload = require("../middleware/legacyExcelUpload");
const controller = require("../controllers/legacyResultController");

const router = express.Router();
const managers = authorize("SuperAdmin", "ExamManager");
const publicAttempts = new Map();
const publicRateLimit = (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (publicAttempts.get(key) || []).filter((time) => now - time < 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ message: "Too many result lookup attempts; try again shortly" });
  recent.push(now);
  publicAttempts.set(key, recent);
  next();
};
router.get("/public", publicRateLimit, controller.getPublicResult);
router.post("/import/preview", protect, managers, upload, controller.previewImport);
router.post("/import/commit", protect, managers, controller.commitImport);
router.post("/batches/:batchId/publish", protect, managers, controller.publishBatch);
router.patch("/batches/:batchId/marks/:markId", protect, managers, controller.correctMark);
router.post("/students/merge", protect, managers, controller.mergeStudentKeys);
router.get("/batches", protect, managers, controller.listBatches);
router.get("/batches/:batchId", protect, managers, controller.getBatch);
module.exports = router;
