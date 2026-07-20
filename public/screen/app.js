const socket = io();
socket.emit('join:role', 'screen');

const views = {
  waiting: document.getElementById('view-waiting'),
  question: document.getElementById('view-question'),
  reveal: document.getElementById('view-reveal'),
  rankingScroll: document.getElementById('view-ranking-scroll'),
  rankingTop: document.getElementById('view-ranking-top'),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

async function loadQr() {
  const res = await fetch('/api/qr');
  const data = await res.json();
  document.getElementById('qr-img').src = data.dataUrl;
  document.getElementById('qr-url').textContent = data.url;
}
loadQr();

socket.on('participants:update', (payload) => {
  document.getElementById('participant-count').textContent = payload.list.length;
});

const qIndex = document.getElementById('q-index');
const qTimer = document.getElementById('q-timer');
const answerCountEl = document.getElementById('answer-count');
const qText = document.getElementById('q-text');
const qImageWrap = document.getElementById('q-image-wrap');
const qImage = document.getElementById('q-image');
const choiceDisplays = Array.from(document.querySelectorAll('.choice-display'));
let timerInterval = null;

socket.on('question:show', (payload) => {
  showView('question');
  qIndex.textContent = `第${payload.index + 1}問 / 全${payload.total}問`;
  qText.textContent = payload.text;
  if (payload.imageUrl) {
    qImage.src = payload.imageUrl;
    qImageWrap.classList.remove('hidden');
  } else {
    qImageWrap.classList.add('hidden');
  }
  payload.choices.forEach((choiceText, i) => {
    choiceDisplays[i].textContent = choiceText;
    choiceDisplays[i].classList.remove('correct');
  });

  clearInterval(timerInterval);
  function tick() {
    const elapsed = (Date.now() - payload.startedAt) / 1000;
    const remaining = Math.max(0, Math.ceil(payload.timeLimitSec - elapsed));
    qTimer.textContent = `残り${remaining}秒`;
    if (remaining <= 0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 250);
});

socket.on('answerCount:update', (payload) => {
  answerCountEl.textContent = `回答済み ${payload.answered}/${payload.total}人`;
});

socket.on('question:locked', () => {
  clearInterval(timerInterval);
  qTimer.textContent = '集計中...';
});

socket.on('reveal:show', (payload) => {
  showView('reveal');
  const container = document.getElementById('reveal-choices');
  container.innerHTML = '';
  const currentChoices = choiceDisplays.map((el) => el.textContent);
  currentChoices.forEach((text, i) => {
    const div = document.createElement('div');
    div.className = `choice-display choice-${i}`;
    if (i === payload.correctIndex) div.classList.add('correct');
    div.innerHTML = `${text}<span class="choice-count">${payload.counts[i] || 0}人</span>`;
    container.appendChild(div);
  });
});

let rankingScrollTimeout = null;

socket.on('ranking:scrollData', (payload) => {
  clearTimeout(rankingScrollTimeout);
  showView('rankingScroll');
  const ranking = payload.ranking;
  const lowerList = ranking.filter((r) => r.rank > 10);
  const listEl = document.getElementById('scroll-list');
  listEl.innerHTML = '';
  listEl.style.transition = 'none';
  listEl.style.transform = 'translateY(0)';

  lowerList.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `<span class="rank-num">${entry.rank}位</span><span>${entry.name}</span><span>${entry.totalScore}点</span>`;
    listEl.appendChild(row);
  });

  requestAnimationFrame(() => {
    const viewportHeight = document.getElementById('scroll-viewport').clientHeight;
    const listHeight = listEl.scrollHeight;
    const startOffset = Math.max(0, listHeight - viewportHeight);
    listEl.style.transform = `translateY(-${startOffset}px)`;
    requestAnimationFrame(() => {
      listEl.style.transition = 'transform 8s linear';
      listEl.style.transform = 'translateY(0)';
    });
    rankingScrollTimeout = setTimeout(() => {
      showView('rankingTop');
    }, 8500);
  });
});

socket.on('ranking:topReveal', (entry) => {
  showView('rankingTop');
  const topListEl = document.getElementById('top-list');
  const row = document.createElement('div');
  row.className = `top-row rank-${entry.rank}`;
  row.innerHTML = `<span class="rank-num">${entry.rank}位</span><span>${entry.name}</span><span>${entry.totalScore}点</span>`;
  topListEl.appendChild(row);
});

socket.on('quiz:reset', () => {
  clearInterval(timerInterval);
  clearTimeout(rankingScrollTimeout);
  document.getElementById('scroll-list').innerHTML = '';
  document.getElementById('top-list').innerHTML = '';
  choiceDisplays.forEach((el) => {
    el.textContent = '';
    el.classList.remove('correct');
  });
  showView('waiting');
});
