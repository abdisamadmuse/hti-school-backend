const router = require("express").Router();
const controller = require("../controllers/termPlanningController");
const upload = require("../middleware/planningDocumentUpload");
router.get("/", controller.list);
router.post("/course-content", upload, controller.createContent);
router.post("/schemes", upload, controller.createScheme);
router.delete("/course-content/:id", controller.deleteContent);
router.delete("/schemes/:id", controller.deleteScheme);
module.exports = router;
