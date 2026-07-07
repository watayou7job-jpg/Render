let questions = [];
let settings = { minGuaranteeRatio: 0.5, defaultTimeLimitSec: 15, defaultPoints: 1000 };

const listEl = document.getElementById('question-list');
const template = document.getElementById('question-template');

async function loadAll() {
  const [qRes, sRes] = await Promise.all([fetch('/api/questions'), fetch('/api/settings')]);
  questions = await qRes.json();
  settings = await sRes.json();
  renderSettings();
  renderQuestions();
}

function renderSettings() {
  document.getElementById('min-guarantee').value = settings.minGuaranteeRatio;
  document.getElementById('default-time').value = settings.defaultTimeLimitSec;
  document.getElementById('default-points').value = settings.defaultPoints;
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  settings = {
    minGuaranteeRatio: Number(document.getElementById('min-guarantee').value),
    defaultTimeLimitSec: Number(document.getElementById('default-time').value),
    defaultPoints: Number(document.getElementById('default-points').value),
  };
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  flashSaved(document.getElementById('settings-saved-msg'));
});

function flashSaved(el) {
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1500);
}

async function persistQuestions() {
  await fetch('/api/questions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(questions),
  });
}

function renderQuestions() {
  document.getElementById('question-count').textContent = questions.length;
  listEl.innerHTML = '';
  questions.forEach((q, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.question-card');
    card.querySelector('.q-num').textContent = `第${index + 1}問`;
    card.querySelector('.q-text-input').value = q.text || '';
    card.querySelectorAll('.q-choice-input').forEach((input) => {
      const idx = Number(input.dataset.idx);
      input.value = (q.choices && q.choices[idx]) || '';
    });
    const radioName = `correct-${index}`;
    card.querySelectorAll('.q-correct-radio').forEach((radio) => {
      radio.name = radioName;
      const idx = Number(radio.dataset.idx);
      radio.checked = q.correctIndex === idx;
    });
    card.querySelector('.q-time-input').value = q.timeLimitSec ?? settings.defaultTimeLimitSec;
    card.querySelector('.q-points-input').value = q.points ?? settings.defaultPoints;

    const preview = card.querySelector('.q-image-preview');
    if (q.imagePath) {
      preview.src = q.imagePath;
      preview.classList.remove('hidden');
    }

    card.querySelector('.q-image-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        alert('画像のアップロードに失敗しました(jpg/png、5MBまで)');
        return;
      }
      const data = await res.json();
      questions[index].imagePath = data.path;
      preview.src = data.path;
      preview.classList.remove('hidden');
    });

    card.querySelector('.move-up-btn').addEventListener('click', () => {
      if (index === 0) return;
      [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]];
      persistQuestions();
      renderQuestions();
    });

    card.querySelector('.move-down-btn').addEventListener('click', () => {
      if (index === questions.length - 1) return;
      [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]];
      persistQuestions();
      renderQuestions();
    });

    card.querySelector('.delete-btn').addEventListener('click', () => {
      if (!confirm('この問題を削除しますか?')) return;
      questions.splice(index, 1);
      persistQuestions();
      renderQuestions();
    });

    card.querySelector('.save-question-btn').addEventListener('click', async () => {
      const text = card.querySelector('.q-text-input').value.trim();
      const choices = Array.from(card.querySelectorAll('.q-choice-input')).map((i) => i.value.trim());
      const correctRadio = card.querySelector('.q-correct-radio:checked');
      const timeLimitSec = Number(card.querySelector('.q-time-input').value);
      const points = Number(card.querySelector('.q-points-input').value);

      if (!text || choices.some((c) => !c) || !correctRadio) {
        alert('問題文・4つの選択肢・正解を全て入力してください');
        return;
      }

      questions[index] = {
        ...questions[index],
        text,
        choices,
        correctIndex: Number(correctRadio.dataset.idx),
        timeLimitSec,
        points,
      };
      await persistQuestions();
      flashSaved(card.querySelector('.saved-msg'));
    });

    listEl.appendChild(node);
  });
}

function questionsToTsv() {
  return questions
    .map((q) => [
      q.text || '',
      ...(q.choices || ['', '', '', '']),
      (q.correctIndex ?? 0) + 1,
      q.timeLimitSec ?? '',
      q.points ?? '',
    ].join('\t'))
    .join('\n');
}

function parseTsvToQuestions(tsv) {
  const lines = tsv.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const parsed = [];
  const errors = [];

  lines.forEach((line, i) => {
    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length < 6) {
      errors.push(`${i + 1}行目: 列数が足りません(問題文・選択肢4つ・正解の6列以上が必要)`);
      return;
    }
    const [text, c1, c2, c3, c4, correctStr, timeStr, pointsStr] = cols;
    const correctNum = Number(correctStr);
    if (!text || !c1 || !c2 || !c3 || !c4) {
      errors.push(`${i + 1}行目: 問題文または選択肢が空です`);
      return;
    }
    if (!Number.isInteger(correctNum) || correctNum < 1 || correctNum > 4) {
      errors.push(`${i + 1}行目: 正解は1〜4の数字で入力してください`);
      return;
    }
    parsed.push({
      text,
      imagePath: null,
      choices: [c1, c2, c3, c4],
      correctIndex: correctNum - 1,
      timeLimitSec: timeStr ? Number(timeStr) : settings.defaultTimeLimitSec,
      points: pointsStr ? Number(pointsStr) : settings.defaultPoints,
    });
  });

  return { parsed, errors };
}

document.getElementById('bulk-export-btn').addEventListener('click', () => {
  document.getElementById('bulk-textarea').value = questionsToTsv();
});

document.getElementById('bulk-import-btn').addEventListener('click', async () => {
  const bulkMessage = document.getElementById('bulk-message');
  const raw = document.getElementById('bulk-textarea').value;
  const { parsed, errors } = parseTsvToQuestions(raw);

  if (errors.length > 0) {
    bulkMessage.textContent = `取り込めませんでした: ${errors.join(' / ')}`;
    bulkMessage.classList.remove('hidden');
    return;
  }
  if (parsed.length === 0) {
    bulkMessage.textContent = '登録する問題がありません。';
    bulkMessage.classList.remove('hidden');
    return;
  }

  questions = [...questions, ...parsed];
  await persistQuestions();
  renderQuestions();
  bulkMessage.textContent = `${parsed.length}問を追加登録しました。`;
  bulkMessage.classList.remove('hidden');
  setTimeout(() => bulkMessage.classList.add('hidden'), 3000);
});

document.getElementById('add-question-btn').addEventListener('click', () => {
  questions.push({
    text: '',
    imagePath: null,
    choices: ['', '', '', ''],
    correctIndex: null,
    timeLimitSec: settings.defaultTimeLimitSec,
    points: settings.defaultPoints,
  });
  persistQuestions();
  renderQuestions();
});

loadAll();
