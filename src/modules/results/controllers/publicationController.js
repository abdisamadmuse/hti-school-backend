const { publishExam, unpublishExam } = require("../services/resultPublicationService");

const handleError = (res, error) =>
  res.status(error.status || 500).json({
    message: error.message,
    ...(error.details && { errors: error.details }),
  });

exports.publishExamResults = async (req, res) => {
  try {
    const summary = await publishExam(req.params.examId);
    res.status(200).json({ message: "Exam results published successfully", summary });
  } catch (error) { handleError(res, error); }
};

exports.unpublishExamResults = async (req, res) => {
  try {
    const exam = await unpublishExam(req.params.examId);
    res.status(200).json({ message: "Exam results unpublished successfully", data: exam.get({ plain: true }) });
  } catch (error) { handleError(res, error); }
};
