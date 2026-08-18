const express = require("express");
const controller = require("../controllers/classSectionController");

const router = express.Router();

router.post("/", controller.createClassSection);
router.get("/", controller.getClassSections);
router.get("/:id", controller.getClassSectionById);
router.put("/:id", controller.updateClassSection);
router.delete("/:id", controller.deleteClassSection);

module.exports = router;
