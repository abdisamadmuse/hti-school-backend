const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadRoot = path.join(__dirname, "../../../../uploads/students");

const fieldFolders = {
  photo: "photos",
  notaryDocument: "notary-documents",
  certificateDocument: "certificate-documents",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = fieldFolders[file.fieldname];
    const destination = path.join(uploadRoot, folder);

    fs.mkdirSync(destination, { recursive: true });
    cb(null, destination);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBaseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 40);

    cb(null, `${file.fieldname}-${Date.now()}-${safeBaseName}${ext}`);
  },
});

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const fileFilter = (req, file, cb) => {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new Error("Only image, PDF, DOC, and DOCX files are allowed"));
  }

  cb(null, true);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).fields([
  { name: "photo", maxCount: 1 },
  { name: "notaryDocument", maxCount: 1 },
  { name: "certificateDocument", maxCount: 1 },
]);
