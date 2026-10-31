const fs = require("fs");
const path = require("path");
const multer = require("multer");
const root = path.join(__dirname, "../../../../uploads/teacher-schemes");
const storage = multer.diskStorage({ destination: (_req, _file, cb) => { fs.mkdirSync(root, { recursive: true }); cb(null, root); }, filename: (_req, file, cb) => { const ext = path.extname(file.originalname); const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50); cb(null, `scheme-${Date.now()}-${base}${ext}`); } });
const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
module.exports = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, cb) => allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Only PDF, DOC, and DOCX files are allowed")) }).single("schemeOfWork");
