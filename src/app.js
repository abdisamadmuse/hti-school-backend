const express = require("express");
const cors = require("cors");
const path = require("path");

const programRoutes = require("./modules/programs/routes/programRoutes");
const academicYearRoutes = require("./modules/academicYears/routes/academicYearRoutes");
const authRoutes = require("./modules/auth/routes/authRoutes");
const userRoutes = require("./modules/users/routes/userRoutes");
const departmentRoutes = require("./modules/departments/routes/departmentRoutes");
const classRoutes = require("./modules/classes/routes/classRoutes");
const termRoutes = require("./modules/terms/routes/termRoutes");
const subjectRoutes = require("./modules/subjects/routes/subjectRoutes");
const teacherRoutes = require("./modules/teachers/routes/teacherRoutes");
const studentRoutes = require("./modules/students/routes/studentRoutes");
const attendanceRoutes = require("./modules/attendance/routes/attendanceRoutes");
const mobileRoutes = require("./modules/mobile/routes/mobileRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Swagger UI
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/programs", programRoutes);
app.use("/api/academic-years", academicYearRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/terms", termRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/mobile", mobileRoutes);

app.get("/", (req, res) => {
  res.send("HTI School Management API Running...");
});

module.exports = app;
