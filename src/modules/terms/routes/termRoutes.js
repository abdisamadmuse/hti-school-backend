const express = require("express");

const {
  createTerm,
  getTerms,
  getTermById,
  updateTerm,
  deleteTerm,
} = require("../controllers/termController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Terms
 *     description: Term management
 */

/**
 * @openapi
 * /api/terms:
 *   post:
 *     tags:
 *       - Terms
 *     summary: Create term
 */
router.post("/", createTerm);

/**
 * @openapi
 * /api/terms:
 *   get:
 *     tags:
 *       - Terms
 *     summary: Get all terms
 */
router.get("/", getTerms);

/**
 * @openapi
 * /api/terms/{id}:
 *   get:
 *     tags:
 *       - Terms
 *     summary: Get term by id
 */
router.get("/:id", getTermById);

/**
 * @openapi
 * /api/terms/{id}:
 *   put:
 *     tags:
 *       - Terms
 *     summary: Update term
 */
router.put("/:id", updateTerm);

/**
 * @openapi
 * /api/terms/{id}:
 *   delete:
 *     tags:
 *       - Terms
 *     summary: Delete term
 */
router.delete("/:id", deleteTerm);

module.exports = router;
