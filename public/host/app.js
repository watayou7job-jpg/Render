const socket = io();

const stages = {
  lobby: document.getElementById('stage-lobby'),
  question: document.getElementById('stage-question'),
  ranking: document.getElementById('stage-ranking'),
};

function showStage(name) {
  Object.values(stages).forEach((s) => s.classList.add('hidden'));
  stages[name].classList.remove('hidden');
}

const openRegistrationBtn = document.getElementById('open-registration-btn');
const startQuizBtn = document.getElementById('start-quiz-btn');
const revealBtn = document.getElementById('reveal-btn');
const nextQuestionBtn = document.getElementById('next-question-btn');
const startRankingBtn = document.getElementById('start-ranking-btn');
const nextRankBtn = document.getElementById('next-rank-btn');
const rankProgress = document.getElementById('rank-progress');
const csvLink = document.getElementById('csv-link');

let currentQuestionInfo = null;
let rankRevealCount = 0;
let topTotal = 10;

const authGate = document.getElementById('auth-gate');
const appRoot = document.getElementById('app');
const authPasswordInput = document.getElementById('auth-password-input');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authError = document.getElementById('auth-error');

function attemptAuth() {
  const password = authPasswordInput.value;
  socket.emit('host:authenticate', password, (res) => {
    if (res && res.ok) {
      authGate.classList.add('hidden');
      appRoot.classList.remove('hidden');
      authError.textContent = '';
      socket.emit('join:role', 'host');
    } else {
      authError.textContent = 'パスワードが正しくありません。';
      authPasswordInput.value = '';
      authPasswordInput.focus();
    }
  });
}

authSubmitBtn.addEventListener('click', attemptAuth);
authPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptAuth();
});

socket.on('connect', () => {
  authGate.classList.remove('hidden');
  appRoot.classList.add('hidden');
  authPasswordInput.focus();
});

openRegistrationBtn.addEventListener('click', () => {
  socket.emit('host:openRegistration');
  openRegistrationBtn.disabled = true;
  startQuizBtn.disabled = false;
});

startQuizBtn.addEventListener('click', () => {
  socket.emit('host:startQuiz');
});

revealBtn.addEventListener('click', () => {
  socket.emit('host:revealAnswer');
});

nextQuestionBtn.addEventListener('click', () => {
  socket.emit('host:nextQuestion');
});

startRankingBtn.addEventListener('click', () => {
  showStage('ranking');
  socket.emit('host:startFinalRanking');
  rankRevealCount = 0;
  nextRankBtn.disabled = false;
  rankProgress.textContent = '';
  csvLink.classList.add('hidden');
});

nextRankBtn.addEventListener('click', () => {
  socket.emit('host:nextRankReveal');
});

document.getElementById('resume-backup-btn').addEventListener('click', () => {
  socket.emit('host:resumeBackup');
  document.getElementById('backup-banner').classList.add('hidden');
});

document.getElementById('discard-backup-btn').addEventListener('click', () => {
  socket.emit('host:discardBackup');
  document.getElementById('backup-banner').classList.add('hidden');
});

socket.on('host:state', (state) => {
  if (state.registrationOpen) {
    openRegistrationBtn.disabled = true;
    startQuizBtn.disabled = false;
  }
  if (state.quizStarted) {
    startQuizBtn.disabled = true;
  }
  if (state.finalRankingStarted) {
    showStage('ranking');
  } else if (state.quizStarted && state.currentQuestionIndex >= 0 && state.questionPhase !== 'idle') {
    showStage('question');
    currentQuestionInfo = { index: state.currentQuestionIndex, total: state.totalQuestions };
    if (state.questionPhase === 'reveal') {
      revealBtn.classList.add('hidden');
      if (state.currentQuestionIndex < state.totalQuestions - 1) {
        nextQuestionBtn.classList.remove('hidden');
      } else {
        startRankingBtn.classList.remove('hidden');
      }
    }
  }
});

socket.on('backup:status', (payload) => {
  if (payload.hasBackup) {
    document.getElementById('backup-text').textContent =
      `前回の途中データがあります(参加者${payload.preview.participantCount}人、第${payload.preview.currentQuestionIndex + 1}問目)。再開しますか?`;
    document.getElementById('backup-banner').classList.remove('hidden');
  }
});

socket.on('participants:update', (payload) => {
  document.getElementById('participant-total').textContent = payload.list.length;
  const listEl = document.getElementById('participant-list');
  listEl.innerHTML = '';
  payload.list.forEach((p) => {
    const li = document.createElement('li');
    const dot = p.connected ? 'online' : 'offline';
    li.innerHTML = `<span><span class="dot ${dot}"></span>${p.name} (${p.totalScore}点)</span>`;
    const kickBtn = document.createElement('button');
    kickBtn.className = 'kick-btn';
    kickBtn.textContent = '削除';
    kickBtn.addEventListener('click', () => socket.emit('host:kickParticipant', p.id));
    li.appendChild(kickBtn);
    listEl.appendChild(li);
  });
});

socket.on('question:show', (payload) => {
  currentQuestionInfo = payload;
  showStage('question');
  document.getElementById('host-q-index').textContent = `第${payload.index + 1}問 / 全${payload.total}問`;
  document.getElementById('host-q-text').textContent = payload.text;
  revealBtn.classList.remove('hidden');
  nextQuestionBtn.classList.add('hidden');
  startRankingBtn.classList.add('hidden');
});

socket.on('answerCount:update', (payload) => {
  document.getElementById('host-answer-count').textContent = `回答済み ${payload.answered}/${payload.total}人`;
});

socket.on('reveal:show', () => {
  revealBtn.classList.add('hidden');
  if (currentQuestionInfo && currentQuestionInfo.index < currentQuestionInfo.total - 1) {
    nextQuestionBtn.classList.remove('hidden');
  } else {
    startRankingBtn.classList.remove('hidden');
  }
});

socket.on('ranking:scrollData', (payload) => {
  topTotal = Math.min(10, payload.ranking.length);
});

socket.on('ranking:topReveal', (entry) => {
  rankRevealCount += 1;
  rankProgress.textContent = `発表済み: ${entry.rank}位 ${entry.name} (${rankRevealCount}/${topTotal})`;
  if (rankRevealCount >= topTotal) {
    nextRankBtn.disabled = true;
    csvLink.classList.remove('hidden');
  }
});
