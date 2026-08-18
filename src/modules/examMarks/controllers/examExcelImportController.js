const {
  inspectExcel,
  previewResponse,
  importExcel,
} = require("../services/examExcelImportService");

const requireFile = (req) => {
  if (!req.file?.buffer) {
    const error = new Error("Excel file is required in the file field");
    error.status = 400;
    throw error;
  }
};

const handleError = (res, error) => {
  if (error.details) {
    return res.status(error.status || 422).json({
      message: error.message,
      ...error.details,
    });
  }
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      message:
        "Marks already exist for one or more students. Preview the latest file and try again",
    });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({
      message: error.errors?.[0]?.message || error.message,
    });
  }
  return res.status(error.status || 500).json({ message: error.message });
};

exports.previewExcelImport = async (req, res) => {
  try {
    requireFile(req);
    const inspection = await inspectExcel(req.file.buffer);
    res.status(200).json(previewResponse(inspection));
  } catch (error) {
    handleError(res, error);
  }
};

exports.confirmExcelImport = async (req, res) => {
  try {
    requireFile(req);
    const inspection = await inspectExcel(req.file.buffer);
    const summary = await importExcel(
      inspection,
      req.file.originalname,
      req.user._id
    );
    res.status(201).json({
      message: "Exam marks imported successfully",
      summary,
    });
  } catch (error) {
    handleError(res, error);
  }
};
