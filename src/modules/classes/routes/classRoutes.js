const express = require("express");

const {
  createClass,
  getClasses,
  getClassById,
  updateClass,
  deleteClass,
} = require("../controllers/classController");

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Classes
 *     description: Class management
 */

/**
 * @openapi
 * /api/classes:
 *   post:
 *     tags:
 *       - Classes
 *     summary: Create class
 */
router.post("/", createClass);

/**
 * @openapi
 * /api/classes:
 *   get:
 *     tags:
 *       - Classes
 *     summary: Get all classes
 */
router.get("/", getClasses);

/**
 * @openapi
 * /api/classes/{id}:
 *   get:
 *     tags:
 *       - Classes
 *     summary: Get class by id
 */
router.get("/:id", getClassById);

/**
 * @openapi
 * /api/classes/{id}:
 *   put:
 *     tags:
 *       - Classes
 *     summary: Update class
 */
router.put("/:id", updateClass);

/**
 * @openapi
 * /api/classes/{id}:
 *   delete:
 *     tags:
 *       - Classes
 *     summary: Delete class
 */
router.delete("/:id", deleteClass);

module.exports = router;
