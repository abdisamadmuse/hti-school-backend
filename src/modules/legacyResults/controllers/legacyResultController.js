const service = require("../services/legacyResultService");

const sendError = (res, error) => res.status(error.status || 500).json({ message: error.message, ...(error.details || {}) });
exports.previewImport = async (req, res) => {
  try {
    if (!req.file?.buffer) throw Object.assign(new Error("Excel file is required in the file field"), { status: 400 });
    res.status(200).json(await service.buildPreview(req.file.buffer, req.file.originalname, req.body, req.user._id));
  } catch (error) { sendError(res, error); }
};
exports.commitImport = async (req, res) => {
  try {
    if (!req.body.importToken) throw Object.assign(new Error("importToken is required"), { status: 400 });
    res.status(201).json(await service.commit(req.body, req.user._id));
  } catch (error) { sendError(res, error); }
};
exports.publishBatch = async (req, res) => {
  try { res.status(200).json(await service.publish(req.params.batchId, req.user._id)); }
  catch (error) { sendError(res, error); }
};
exports.listBatches = async (req, res) => {
  try { res.status(200).json(await service.listBatches(req.query)); }
  catch (error) { sendError(res, error); }
};
exports.getBatch = async (req, res) => {
  try { res.status(200).json(await service.batchDetails(req.params.batchId)); }
  catch (error) { sendError(res, error); }
};
exports.getPublicResult = async (req, res) => {
  try { res.status(200).json(await service.publicResult(req.query)); }
  catch (error) { sendError(res, error); }
};
exports.correctMark = async (req, res) => {
  try { res.status(200).json(await service.correctMark(req.params.batchId, req.params.markId, req.body, req.user._id)); }
  catch (error) { sendError(res, error); }
};
exports.mergeStudentKeys = async (req, res) => {
  try { res.status(200).json(await service.mergeStudentKeys(req.body, req.user._id)); }
  catch (error) { sendError(res, error); }
};
