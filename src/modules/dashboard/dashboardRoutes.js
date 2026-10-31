const router = require("express").Router();
const service = require("./dashboardService");

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Student totals, department breakdown and daily attendance dashboard
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: academicYearId, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: departmentId, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *       - { in: query, name: weekStart, description: Saturday starting the five-day school week, schema: { type: string, format: date } }
 *       - { in: query, name: session, schema: { type: string, enum: [BeforeBreak, AfterBreak], default: BeforeBreak } }
 *       - { in: query, name: trendSession, schema: { type: string, enum: [BeforeBreak, AfterBreak] } }
 *     responses:
 *       200: { description: Dashboard summary in the data property; see DASHBOARD_API.md }
 *       400: { description: Invalid filter }
 *       401: { description: Authentication required }
 *       403: { description: Dashboard or department access denied }
 */
router.get("/", async (req, res) => {
  try {
    res.json({ data: await service.summary(req.user, req.query) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

module.exports = router;
