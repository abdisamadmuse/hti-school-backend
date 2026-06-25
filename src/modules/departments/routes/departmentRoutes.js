const express = require("express");

const {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
} = require("../controllers/departmentController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Departments
 *     description: Department management
 */

/**
 * @openapi
 * /api/departments:
 *   post:
 *     tags:
 *       - Departments
 *     summary: Create department
 *     responses:
 *       201:
 *         description: Created
 */
router.post("/", createDepartment);

/**
 * @openapi
 * /api/departments:
 *   get:
 *     tags:
 *       - Departments
 *     summary: Get all departments
 *     responses:
 *       200:
 *         description: List
 */
router.get("/", getDepartments);

/**
 * @openapi
 * /api/departments/{id}:
 *   get:
 *     tags:
 *       - Departments
 *     summary: Get department by id
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Department
 */
router.get("/:id", getDepartmentById);

/**
 * @openapi
 * /api/departments/{id}:
 *   put:
 *     tags:
 *       - Departments
 *     summary: Update department
 */
router.put("/:id", updateDepartment);

/**
 * @openapi
 * /api/departments/{id}:
 *   delete:
 *     tags:
 *       - Departments
 *     summary: Delete department
 */
router.delete("/:id", deleteDepartment);

module.exports = router;
