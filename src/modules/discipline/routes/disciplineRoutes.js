const express = require("express");
const controller = require("../controllers/disciplineController");
const { protect, authorize } = require("../../../middleware/authMiddleware");

const router = express.Router();
router.use(protect, authorize("SuperAdmin", "Director", "DeputyDirector", "HeadDepartment", "ExamManager"));
router.post("/", controller.create);
router.get("/", controller.list);
router.get("/student/:studentId", (req, _res, next) => { req.query.studentId = req.params.studentId; next(); }, controller.list);
router.get("/:id", controller.getOne);
router.put("/:id", controller.update);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
