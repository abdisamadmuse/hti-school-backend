const express = require("express");
const {
  createTeacherAssignment,
  getTeacherAssignments,
  getTeacherAssignmentById,
  updateTeacherAssignment,
  deleteTeacherAssignment,
} = require("../controllers/teacherAssignmentController");

const router = express.Router();

router.get("/", getTeacherAssignments);
router.get("/:id", getTeacherAssignmentById);
router.post("/", createTeacherAssignment);
router.put("/:id", updateTeacherAssignment);
router.delete("/:id", deleteTeacherAssignment);

module.exports = router;
