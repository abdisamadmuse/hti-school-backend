const express = require("express");
const {
  downloadMarksTemplate,
} = require("../controllers/examTemplateController");
const {
  downloadClassMarksTemplate,
} = require("../controllers/classMarksTemplateController");
const {
  previewExcelImport,
  confirmExcelImport,
} = require("../controllers/examExcelImportController");
const uploadExamExcel = require("../middleware/examExcelUpload");
const {
  previewClassMarksImport,
  confirmClassMarksImport,
} = require("../controllers/classMarksImportController");
const {
  getManualEntrySheet,
  saveManualMarks,
  getMarks,
  updateMark,
  getMarkHistory,
} = require("../controllers/manualMarkController");
const {
  protect,
  authorize,
} = require("../../../middleware/authMiddleware");

const router = express.Router();
const annualMarks = require("../controllers/annualMarksController");
router.get("/annual-template", protect, authorize("SuperAdmin", "ExamManager", "HeadDepartment"), annualMarks.download);
router.post("/annual-import/preview", protect, authorize("SuperAdmin", "ExamManager"), uploadExamExcel, annualMarks.preview);
router.post(["/annual-import/confirm", "/annual-import"], protect, authorize("SuperAdmin", "ExamManager"), uploadExamExcel, annualMarks.confirm);

router.get(
  "/template",
  protect,
  authorize("SuperAdmin", "ExamManager", "HeadDepartment"),
  downloadMarksTemplate
);
router.get(
  "/class-template",
  protect,
  authorize("SuperAdmin", "ExamManager", "HeadDepartment"),
  downloadClassMarksTemplate
);
router.post(
  "/class-import/preview",
  protect,
  authorize("SuperAdmin", "ExamManager"),
  uploadExamExcel,
  previewClassMarksImport
);
router.post(
  "/class-import/confirm",
  protect,
  authorize("SuperAdmin", "ExamManager"),
  uploadExamExcel,
  confirmClassMarksImport
);
router.post(
  "/import/preview",
  protect,
  authorize("SuperAdmin", "ExamManager"),
  uploadExamExcel,
  previewExcelImport
);
router.post(
  ["/import/confirm", "/import"],
  protect,
  authorize("SuperAdmin", "ExamManager"),
  uploadExamExcel,
  confirmExcelImport
);
router.get(
  "/entry-sheet",
  protect,
  authorize("SuperAdmin", "ExamManager", "HeadDepartment"),
  getManualEntrySheet
);
router.post(
  "/manual",
  protect,
  authorize("SuperAdmin", "ExamManager"),
  saveManualMarks
);
router.get(
  "/",
  protect,
  authorize("SuperAdmin", "ExamManager", "HeadDepartment"),
  getMarks
);
router.get(
  "/:id/history",
  protect,
  authorize("SuperAdmin", "ExamManager", "HeadDepartment"),
  getMarkHistory
);
router.put(
  "/:id",
  protect,
  authorize("SuperAdmin", "ExamManager"),
  updateMark
);

module.exports = router;
