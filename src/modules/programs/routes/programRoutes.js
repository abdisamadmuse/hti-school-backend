const express = require("express");

const {
  createProgram,
  getPrograms,
  getProgramById,
  updateProgram,
  deleteProgram,
} = require("../controllers/programController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Programs
 *     description: Program management
 */

/**
 * @openapi
 * /api/programs:
 *   post:
 *     tags:
 *       - Programs
 *     summary: Create program
 */
router.post("/", createProgram);

/**
 * @openapi
 * /api/programs:
 *   get:
 *     tags:
 *       - Programs
 *     summary: Get all programs
 */
router.get("/", getPrograms);

/**
 * @openapi
 * /api/programs/{id}:
 *   get:
 *     tags:
 *       - Programs
 *     summary: Get program by id
 */
router.get("/:id", getProgramById);

/**
 * @openapi
 * /api/programs/{id}:
 *   put:
 *     tags:
 *       - Programs
 *     summary: Update program
 */
router.put("/:id", updateProgram);

/**
 * @openapi
 * /api/programs/{id}:
 *   delete:
 *     tags:
 *       - Programs
 *     summary: Delete program
 */
router.delete("/:id", deleteProgram);

module.exports = router;
