const express = require("express");

const {
  createAcademicYear,
  getAcademicYears,
  getAcademicYearById,
  updateAcademicYear,
  deleteAcademicYear,
  activateAcademicYear,
} = require("../controllers/academicYearController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: AcademicYears
 *     description: Academic year management
 */

/**
 * @openapi
 * /api/academic-years:
 *   post:
 *     tags:
 *       - AcademicYears
 *     summary: Create academic year
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               isActive:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Created academic year
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AcademicYear'
 */
router.post("/", createAcademicYear);

/**
 * @openapi
 * /api/academic-years:
 *   get:
 *     tags:
 *       - AcademicYears
 *     summary: Get all academic years
 *     responses:
 *       200:
 *         description: List of academic years
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AcademicYear'
 */
router.get("/", getAcademicYears);

/**
 * @openapi
 * /api/academic-years/{id}:
 *   get:
 *     tags:
 *       - AcademicYears
 *     summary: Get academic year by id
 */
router.get("/:id", getAcademicYearById);

/**
 * @openapi
 * /api/academic-years/{id}:
 *   put:
 *     tags:
 *       - AcademicYears
 *     summary: Update academic year
 */
router.put("/:id", updateAcademicYear);

/**
 * @openapi
 * /api/academic-years/{id}:
 *   delete:
 *     tags:
 *       - AcademicYears
 *     summary: Delete academic year
 */
router.delete("/:id", deleteAcademicYear);

/**
 * @openapi
 * /api/academic-years/{id}/activate:
 *   patch:
 *     tags:
 *       - AcademicYears
 *     summary: Activate academic year
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Activated academic year
 */
router.patch('/:id/activate', activateAcademicYear);

module.exports = router; 