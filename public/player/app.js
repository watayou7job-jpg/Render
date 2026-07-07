const socket = io();

const views = {
  join: document.getElementById('view-join'),
  waiting: document.getElementById('view-waiting'),
  question: document.getElementById('view-question'),
  reveal: document.getElementById('view-reveal'),
  final: document.getElementById('view-final'),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const qIndex = document.getElementById('q-index');
const qTimer = document.getElementById('q-timer');
const qText = document.getElementById('q-text');
const choiceButtons = Array.from(document.querySelectorAll('.choice-btn'));
const answeredMsg = document.getElementById('answered-msg');

let hasAnsweredCurrent = false;
let timerInterval = null;

function startTimerDisplay(startedAt, timeLimitSec) {
  clearInterval(timerInterval);
  function tick() {
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, Math.ceil(timeLimitSec - elapsed));
    qTimer.textContent = `残り${remaining}秒`;
    if (remaining <= 0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 250);
}

function resetChoices() {
  choiceButtons.forEach((btn) => {
    btn.disabled = false;
  });
  answeredMsg.classList.add('hidden');
  hasAnsweredCurrent = false;
}

function join(name) {
  socket.emit('player:join', name, (res) => {
    if (res.error === 'registration_closed') {
      joinError.textContent = '受付は終了しました。';
      return;
    }
    if (res.error === 'invalid_name') {
      joinError.textContent = '名前を1〜20文字で入力してください。';
      return;
    }
    localStorage.setItem('quizParticipantId', res.participant.id);
    showView('waiting');
  });
}

joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = '名前を入力してください。';
    return;
  }
  join(name);
});

choiceButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (hasAnsweredCurrent) return;
    const idx = Number(btn.dataset.idx);
    socket.emit('player:answer', idx, (res) => {
      if (res && res.error) return;
      hasAnsweredCurrent = true;
      choiceButtons.forEach((b) => (b.disabled = true));
      answeredMsg.classList.remove('hidden');
    });
  });
});

socket.on('question:show', (payload) => {
  showView('question');
  resetChoices();
  qIndex.textContent = `第${payload.index + 1}問 / 全${payload.total}問`;
  qText.textContent = payload.text;
  payload.choices.forEach((choiceText, i) => {
    choiceButtons[i].textContent = choiceText;
  });
  startTimerDisplay(payload.startedAt, payload.timeLimitSec);
});

socket.on('question:locked', () => {
  clearInterval(timerInterval);
  qTimer.textContent = '受付終了';
  choiceButtons.forEach((b) => (b.disabled = true));
  if (!hasAnsweredCurrent) {
    answeredMsg.textContent = '受付終了しました。結果をお待ちください';
    answeredMsg.classList.remove('hidden');
  }
});

socket.on('reveal:show', (payload) => {
  showView('reveal');
  const resultEl = document.getElementById('reveal-result');
  const scoreGainedEl = document.getElementById('score-gained');
  const totalScoreEl = document.getElementById('total-score');
  if (payload.yourResult) {
    resultEl.textContent = payload.yourResult.correct ? '正解!' : '不正解...';
    scoreGainedEl.textContent = `${payload.yourResult.scoreGained}点`;
    totalScoreEl.textContent = `${payload.yourResult.totalScore}点`;
  }
});

socket.on('ranking:scrollData', () => {
  showView('final');
});

window.addEventListener('load', () => {
  const savedId = localStorage.getItem('quizParticipantId');
  if (!savedId) {
    showView('join');
    return;
  }
  socket.emit('player:rejoin', savedId, (res) => {
    if (res.error) {
      localStorage.removeItem('quizParticipantId');
      showView('join');
      return;
    }
    if (!res.quizStarted) {
      showView('waiting');
    } else if (res.questionPhase === 'idle') {
      showView('waiting');
    }
    // question:show / question:locked events (sent separately) will switch to the right view
  });
});
