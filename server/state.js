const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { computeScore } = require('./scoring');

const BACKUP_PATH = path.join(__dirname, '..', 'data', 'backup.json');

class QuizState {
  constructor(questions, settings) {
    this.questions = questions;
    this.settings = settings;
    this.reset();
  }

  reset() {
    this.registrationOpen = false;
    this.quizStarted = false;
    this.participants = new Map();
    this.currentQuestionIndex = -1;
    this.questionPhase = 'idle';
    this.questionStartedAt = null;
    this.currentAnswers = new Map();
    this.lastReveal = null;
    this.finalRanking = null;
    this.rankingRevealCount = 0;
  }

  hasBackup() {
    return fs.existsSync(BACKUP_PATH);
  }

  loadBackupPreview() {
    if (!this.hasBackup()) return null;
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf-8'));
    return {
      participantCount: raw.participants.length,
      currentQuestionIndex: raw.currentQuestionIndex,
    };
  }

  restoreFromBackup() {
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf-8'));
    this.registrationOpen = false;
    this.quizStarted = true;
    this.participants = new Map(raw.participants.map((p) => [p.id, { ...p, connected: false }]));
    this.currentQuestionIndex = raw.currentQuestionIndex;
    this.questionPhase = 'idle';
    this.questionStartedAt = null;
    this.currentAnswers = new Map();
    this.finalRanking = null;
    this.rankingRevealCount = 0;
  }

  discardBackup() {
    if (this.hasBackup()) fs.unlinkSync(BACKUP_PATH);
  }

  saveBackup() {
    const data = {
      participants: Array.from(this.participants.values()).map((p) => ({
        id: p.id,
        name: p.name,
        totalScore: p.totalScore,
        totalElapsedMs: p.totalElapsedMs,
        answeredQuestions: p.answeredQuestions,
      })),
      currentQuestionIndex: this.currentQuestionIndex,
    };
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  openRegistration() {
    this.registrationOpen = true;
  }

  addParticipant(name) {
    if (!this.registrationOpen) return { error: 'registration_closed' };
    const trimmed = (name || '').trim();
    if (trimmed.length < 1 || trimmed.length > 20) return { error: 'invalid_name' };
    const id = uuidv4();
    const participant = {
      id,
      name: trimmed,
      connected: true,
      totalScore: 0,
      totalElapsedMs: 0,
      answeredQuestions: [],
    };
    this.participants.set(id, participant);
    return { participant };
  }

  rejoinParticipant(id) {
    const participant = this.participants.get(id);
    if (!participant) return { error: 'not_found' };
    participant.connected = true;
    return { participant };
  }

  setDisconnected(id) {
    const participant = this.participants.get(id);
    if (participant) participant.connected = false;
  }

  kickParticipant(id) {
    this.participants.delete(id);
  }

  getParticipantList() {
    return Array.from(this.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      totalScore: p.totalScore,
    }));
  }

  startQuiz() {
    this.registrationOpen = false;
    this.quizStarted = true;
    this.currentQuestionIndex = 0;
  }

  getCurrentQuestion() {
    return this.questions[this.currentQuestionIndex] || null;
  }

  openQuestion() {
    this.questionPhase = 'open';
    this.questionStartedAt = Date.now();
    this.currentAnswers = new Map();
    this.lastReveal = null;
  }

  submitAnswer(participantId, choiceIndex) {
    if (this.questionPhase !== 'open') return { error: 'not_open' };
    if (this.currentAnswers.has(participantId)) return { error: 'already_answered' };
    const participant = this.participants.get(participantId);
    if (!participant) return { error: 'not_found' };

    const question = this.getCurrentQuestion();
    const elapsedMs = Date.now() - this.questionStartedAt;
    const timeLimitMs = question.timeLimitSec * 1000;
    const correct = choiceIndex === question.correctIndex;
    const score = correct
      ? computeScore(question.points, elapsedMs, timeLimitMs, this.settings.minGuaranteeRatio)
      : 0;

    this.currentAnswers.set(participantId, { choiceIndex, elapsedMs, correct, score });
    return { answeredCount: this.currentAnswers.size, totalParticipants: this.participants.size };
  }

  lockQuestion() {
    this.questionPhase = 'locked';
  }

  revealAnswer() {
    this.questionPhase = 'reveal';
    const question = this.getCurrentQuestion();
    const counts = [0, 0, 0, 0];

    for (const [participantId, answer] of this.currentAnswers.entries()) {
      counts[answer.choiceIndex] = (counts[answer.choiceIndex] || 0) + 1;
      const participant = this.participants.get(participantId);
      if (!participant) continue;
      participant.totalScore += answer.score;
      participant.totalElapsedMs += answer.elapsedMs;
      participant.answeredQuestions.push({
        questionIndex: this.currentQuestionIndex,
        choiceIndex: answer.choiceIndex,
        correct: answer.correct,
        score: answer.score,
      });
    }

    this.lastReveal = { correctIndex: question.correctIndex, counts };
    return this.lastReveal;
  }

  hasNextQuestion() {
    return this.currentQuestionIndex < this.questions.length - 1;
  }

  nextQuestion() {
    this.currentQuestionIndex += 1;
    this.saveBackup();
  }

  computeFinalRanking() {
    const list = Array.from(this.participants.values()).sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.totalElapsedMs - b.totalElapsedMs;
    });

    let rank = 0;
    let prevKey = null;
    const ranking = list.map((p, idx) => {
      const key = `${p.totalScore}-${p.totalElapsedMs}`;
      if (key !== prevKey) {
        rank = idx + 1;
        prevKey = key;
      }
      return { rank, id: p.id, name: p.name, totalScore: p.totalScore };
    });

    this.finalRanking = ranking;
    return ranking;
  }
}

module.exports = { QuizState };
