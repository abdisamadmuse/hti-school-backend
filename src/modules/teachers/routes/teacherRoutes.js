const express = require("express");

const {
  createTeacher,
  getTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
  getTeachersByDepartment,
} = require("../controllers/teacherController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Teachers
 *     description: Teacher management
 */

/**
 * @openapi
 * /api/teachers:
 *   post:
 *     tags:
 *       - Teachers
 *     summary: Create teacher
 */
router.post("/", createTeacher);

/**
 * @openapi
 * /api/teachers:
 *   get:
 *     tags:
 *       - Teachers
 *     summary: Get all teachers
 */
router.get("/", getTeachers);

/**
 * @openapi
 * /api/teachers/department/{departmentId}:
 *   get:
 *     tags:
 *       - Teachers
 *     summary: Get teachers by department
 */
router.get("/department/:departmentId", getTeachersByDepartment);

/**
 * @openapi
 * /api/teachers/{id}:
 *   get:
 *     tags:
 *       - Teachers
 *     summary: Get teacher by id
 */
router.get("/:id", getTeacherById);

/**
 * @openapi
 * /api/teachers/{id}:
 *   put:
 *     tags:
 *       - Teachers
 *     summary: Update teacher
 */
router.put("/:id", updateTeacher);

/**
 * @openapi
 * /api/teachers/{id}:
 *   delete:
 *     tags:
 *       - Teachers
 *     summary: Delete teacher
 */
router.delete("/:id", deleteTeacher);

module.exports = router;
