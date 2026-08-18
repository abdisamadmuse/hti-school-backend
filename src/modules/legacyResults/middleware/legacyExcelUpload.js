const path = require("path");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (![".xlsx", ".xls"].includes(extension)) {
      const error = new Error("Only .xlsx or .xls Excel files are allowed");
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

module.exports = (req, res, next) => upload.single("file")(req, res, (error) => {
  if (!error) return next();
  if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Excel file cannot exceed 10 MB" });
  return res.status(error.status || 400).json({ message: error.message });
});
