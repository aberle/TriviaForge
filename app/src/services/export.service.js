/**
 * TriviaForge - Export Service
 *
 * Generates CSV exports for session results
 */

/**
 * Generate CSV content from session data
 * @param {Object} sessionData - Full session data with questions and players
 * @returns {string} CSV content
 */
export function generateCSV(sessionData) {
  const lines = [];

  // Header section
  lines.push('TriviaForge Session Export');
  lines.push(`Quiz: ${escapeCSV(sessionData.quizTitle)}`);
  lines.push(`Room Code: ${sessionData.roomCode}`);
  lines.push(`Status: ${sessionData.status}`);
  lines.push(`Date: ${formatDate(sessionData.createdAt)}`);
  if (sessionData.completedAt) {
    lines.push(`Completed: ${formatDate(sessionData.completedAt)}`);
  }
  lines.push('');

  // Player Results section
  lines.push('PLAYER RESULTS');
  lines.push('Rank,Name,Correct,Answered,Accuracy');

  // Sort players by correct answers (descending), then by accuracy
  const sortedPlayers = [...sessionData.playerResults].sort((a, b) => {
    if (b.correct !== a.correct) return b.correct - a.correct;
    const accA = a.answered > 0 ? a.correct / a.answered : 0;
    const accB = b.answered > 0 ? b.correct / b.answered : 0;
    return accB - accA;
  });

  sortedPlayers.forEach((player, index) => {
    const accuracy = player.answered > 0
      ? Math.round((player.correct / player.answered) * 100)
      : 0;
    lines.push(
      `${index + 1},${escapeCSV(player.name)},${player.correct},${player.answered},${accuracy}%`
    );
  });

  lines.push('');

  // Question Breakdown section
  // Sessions played in rounds get a Round column; others keep the original layout
  const rounds = sessionData.rounds || [];
  const hasRounds = rounds.length > 0;
  const roundLabel = (question) => {
    const round = rounds.find((r) => r.order === question.roundOrder);
    return round ? `${round.order}. ${round.title}` : '';
  };

  lines.push('QUESTION BREAKDOWN');
  lines.push(
    hasRounds
      ? '#,Round,Question,Correct Answer,Correct Count,Incorrect Count,Unanswered'
      : '#,Question,Correct Answer,Correct Count,Incorrect Count,Unanswered'
  );

  sessionData.questions.forEach((question, qIdx) => {
    const isShortAnswer = question.type === 'short_answer';
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    sessionData.playerResults.forEach((player) => {
      const answer = player.answers[qIdx];
      if (answer === undefined || answer === '') {
        unansweredCount++;
      } else if (isShortAnswer ? question.shortAnswerCorrectness?.[player.name] : answer === question.correctChoice) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const correctAnswerLabel = isShortAnswer
      ? (question.acceptedAnswers || []).map(a => a.answer_text).join(' / ')
      : `${String.fromCharCode(65 + question.correctChoice)}. ${question.choices[question.correctChoice] || ''}`;

    const roundCell = hasRounds ? `${escapeCSV(roundLabel(question))},` : '';
    lines.push(
      `${qIdx + 1},${roundCell}${escapeCSV(question.text)},${escapeCSV(correctAnswerLabel)},${correctCount},${incorrectCount},${unansweredCount}`
    );
  });

  return lines.join('\n');
}

/**
 * Escape special characters for CSV
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If contains comma, newline, or quote, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default {
  generateCSV,
};
