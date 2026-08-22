import { jsonResponseError, readActiveQuestions, readExamState } from "../../../lib/database";

export async function GET() {
  try {
    const state = await readExamState();
    const questions = await readActiveQuestions(state);
    return Response.json({
      durationMinutes: state.durationMinutes,
      questionCount: questions.length,
      totalPoints: questions.reduce((sum, question) => sum + question.points, 0),
      partA: questions.filter((question) => question.part === "A").reduce((sum, question) => sum + question.points, 0),
      partB: questions.filter((question) => question.part === "B").reduce((sum, question) => sum + question.points, 0),
      partC: questions.filter((question) => question.part === "C").reduce((sum, question) => sum + question.points, 0),
      coverEyebrow: state.coverEyebrow,
      coverTitle: state.coverTitle,
      coverDescription: state.coverDescription,
      isTestMode: state.isTestMode,
    });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "시험 정보를 불러오지 못했습니다.", 500);
  }
}
