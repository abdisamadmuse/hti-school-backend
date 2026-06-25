const express = require("express");

const {
  createSubject,
  getSubjects,
  getSubjectById,
  updateSubject,
  deleteSubject,
  getGeneralSubjects,
  getCoreSubjects,
} = require("../controllers/subjectController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Subjects
 *     description: Subject management
 */

/**
 * @openapi
 * /api/subjects:
 *   post:
 *     tags:
 *       - Subjects
 *     summary: Create subject
 */
router.post("/", createSubject);

/**
 * @openapi
 * /api/subjects:
 *   get:
 *     tags:
 *       - Subjects
 *     summary: Get all subjects
 */
router.get("/", getSubjects);

/**
 * @openapi
 * /api/subjects/general:
 *   get:
 *     tags:
 *       - Subjects
 *     summary: Get general subjects
 */
router.get("/general", getGeneralSubjects);

/**
 * @openapi
 * /api/subjects/core/{departmentId}:
 *   get:
 *     tags:
 *       - Subjects
 *     summary: Get core subjects for a department
 *     parameters:
 *       - name: departmentId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 */
router.get("/core/:departmentId", getCoreSubjects);

/**
 * @openapi
 * /api/subjects/{id}:
 *   get:
 *     tags:
 *       - Subjects
 *     summary: Get subject by id
 */
router.get("/:id", getSubjectById);

/**
 * @openapi
 * /api/subjects/{id}:
 *   put:
 *     tags:
 *       - Subjects
 *     summary: Update subject
 */
router.put("/:id", updateSubject);

/**
 * @openapi
 * /api/subjects/{id}:
 *   delete:
 *     tags:
 *       - Subjects
 *     summary: Delete subject
 */
router.delete("/:id", deleteSubject);

module.exports = router;
