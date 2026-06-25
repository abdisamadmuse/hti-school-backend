const express = require("express");

const {
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentsByClass,
  bulkUploadStudents,
} = require("../controllers/studentController");
const uploadStudentFiles = require("../middleware/studentUpload");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Students
 *     description: Student management
 */

/**
 * @openapi
 * /api/students:
 *   post:
 *     tags:
 *       - Students
 *     summary: Create student
 */
router.post("/", uploadStudentFiles, createStudent);

/**
 * @openapi
 * /api/students/bulk-upload:
 *   post:
 *     tags:
 *       - Students
 *     summary: Bulk upload students
 */
router.post("/bulk-upload", bulkUploadStudents);

/**
 * @openapi
 * /api/students:
 *   get:
 *     tags:
 *       - Students
 *     summary: Get all students
 */
router.get("/", getStudents);

/**
 * @openapi
 * /api/students/class/{classId}:
 *   get:
 *     tags:
 *       - Students
 *     summary: Get students by class
 */
router.get("/class/:classId", getStudentsByClass);

/**
 * @openapi
 * /api/students/{id}:
 *   get:
 *     tags:
 *       - Students
 *     summary: Get student by id
 */
router.get("/:id", getStudentById);

/**
 * @openapi
 * /api/students/{id}:
 *   put:
 *     tags:
 *       - Students
 *     summary: Update student
 */
router.put("/:id", uploadStudentFiles, updateStudent);

/**
 * @openapi
 * /api/students/{id}:
 *   delete:
 *     tags:
 *       - Students
 *     summary: Delete student
 */
router.delete("/:id", deleteStudent);

module.exports = router;
