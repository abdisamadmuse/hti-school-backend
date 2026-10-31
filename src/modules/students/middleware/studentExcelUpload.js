const path = require("path");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (path.extname(file.originalname || "").toLowerCase() !== ".xlsx") {
      const error = new Error("Only .xlsx Excel files are allowed"); error.status = 400; return callback(error);
    }
    callback(null, true);
  },
});

module.exports = (req, res, next) => upload.single("file")(req, res, (error) => {
  if (!error) return next();
  return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Excel file cannot exceed 10 MB" : error.message });
});
