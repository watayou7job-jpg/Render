const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const { loadQuestions, saveQuestions, loadSettings, saveSettings } = require('./questions');
const { QuizState } = require('./state');
const { generateCsv, saveCsvToDisk } = require('./csv');

// 結婚式当日は誰もサーバーログを監視していない前提のため、想定外のエラーで
// プロセス全体が落ちて復旧不能になることを避け、ログに残して処理を続行する。
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});

const PORT = process.env.PORT || 3001;
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'wedding-dev-password';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('警告: ADMIN_PASSWORD が未設定のため、開発用のデフォルトパスワードを使用しています。本番環境では必ず環境変数を設定してください。');
}

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function getPlayerBaseUrl() {
  const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (publicUrl) return publicUrl.replace(/\/$/, '');
  return `http://${getLanIp()}:${PORT}`;
}

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  const decoded = scheme === 'Basic' && token ? Buffer.from(token, 'base64').toString() : '';
  const password = decoded.slice(decoded.indexOf(':') + 1);
  if (password === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Authentication required.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/shared', express.static(path.join(__dirname, '..', 'public', 'shared')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/player', express.static(path.join(__dirname, '..', 'public', 'player')));
app.use('/screen', express.static(path.join(__dirname, '..', 'public', 'screen')));
app.use('/host', express.static(path.join(__dirname, '..', 'public', 'host')));
app.use('/admin', requireAdminAuth, express.static(path.join(__dirname, '..', 'public', 'admin')));

app.get('/', (req, res) => res.redirect('/host'));

// ---- Image upload ----
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('unsupported_file_type'));
    cb(null, true);
  },
});

app.post('/api/upload', requireAdminAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// ---- Questions / settings CRUD ----
app.get('/api/questions', requireAdminAuth, (req, res) => {
  res.json(loadQuestions());
});

app.put('/api/questions', requireAdminAuth, (req, res) => {
  const questions = req.body;
  if (!Array.isArray(questions)) return res.status(400).json({ error: 'invalid_body' });
  saveQuestions(questions);
  quiz.questions = questions;
  res.json({ ok: true });
});

app.get('/api/settings', requireAdminAuth, (req, res) => {
  res.json(loadSettings());
});

app.put('/api/settings', requireAdminAuth, (req, res) => {
  const settings = req.body;
  saveSettings(settings);
  quiz.settings = settings;
  res.json({ ok: true });
});

app.get('/api/qr', async (req, res) => {
  const url = `${getPlayerBaseUrl()}/player`;
  const dataUrl = await QRCode.toDataURL(url, { width: 320 });
  res.json({ url, dataUrl });
});

app.get('/api/results/csv', requireAdminAuth, (req, res) => {
  if (!quiz.finalRanking) return res.status(400).json({ error: 'no_ranking' });
  saveCsvToDisk(quiz.finalRanking);
  const csv = generateCsv(quiz.finalRanking);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="result.csv"');
  res.send(csv);
});

app.get('/api/backup-status', (req, res) => {
  res.json({ hasBackup: quiz.hasBackup(), preview: quiz.loadBackupPreview() });
});

// ---- Quiz state ----
const quiz = new QuizState(loadQuestions(), loadSettings());
const socketIdToParticipantId = new Map();
const participantIdToSocketId = new Map();
let lockTimer = null;

function broadcastParticipants() {
  const payload = {
    list: quiz.getParticipantList(),
    registrationOpen: quiz.registrationOpen,
  };
  io.to('host').emit('participants:update', payload);
  io.to('screen').emit('participants:update', payload);
}

function broadcastQuestion() {
  const question = quiz.getCurrentQuestion();
  const total = quiz.questions.length;
  const basePayload = {
    index: quiz.currentQuestionIndex,
    total,
    text: question.text,
    choices: question.choices,
    timeLimitSec: question.timeLimitSec,
    startedAt: quiz.questionStartedAt,
  };
  io.to('player').emit('question:show', basePayload);
  io.to('screen').emit('question:show', {
    ...basePayload,
    imageUrl: question.imagePath || null,
  });
  io.to('host').emit('question:show', { ...basePayload, imageUrl: question.imagePath || null });
}

function emitCurrentQuestionState(socket, includeImage) {
  if (quiz.finalRanking) {
    socket.emit('ranking:scrollData', { ranking: quiz.finalRanking });
    const top10 = quiz.finalRanking.filter((r) => r.rank <= 10);
    for (let i = 0; i < quiz.rankingRevealCount; i += 1) {
      socket.emit('ranking:topReveal', top10[top10.length - 1 - i]);
    }
    return;
  }
  if (!(quiz.quizStarted && quiz.currentQuestionIndex >= 0 && quiz.questionPhase !== 'idle')) return;
  const question = quiz.getCurrentQuestion();
  const payload = {
    index: quiz.currentQuestionIndex,
    total: quiz.questions.length,
    text: question.text,
    choices: question.choices,
    timeLimitSec: question.timeLimitSec,
    startedAt: quiz.questionStartedAt,
  };
  if (includeImage) payload.imageUrl = question.imagePath || null;
  socket.emit('question:show', payload);
  if (quiz.questionPhase === 'locked' || quiz.questionPhase === 'reveal') {
    socket.emit('question:locked');
  }
  if (quiz.questionPhase === 'reveal' && quiz.lastReveal) {
    socket.emit('reveal:show', quiz.lastReveal);
  }
}

function openCurrentQuestion() {
  quiz.openQuestion();
  broadcastQuestion();
  io.to('screen').emit('answerCount:update', { answered: 0, total: quiz.participants.size });

  const question = quiz.getCurrentQuestion();
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    quiz.lockQuestion();
    io.to('screen').emit('question:locked');
    io.to('player').emit('question:locked');
    io.to('host').emit('question:locked');
  }, question.timeLimitSec * 1000);
}

function requireHostAuth(socket, handler) {
  return (...args) => {
    if (!socket.data.isHost) return;
    return handler(...args);
  };
}

io.on('connection', (socket) => {
  socket.on('host:authenticate', (password, ack) => {
    socket.data.isHost = password === ADMIN_PASSWORD;
    ack && ack({ ok: socket.data.isHost });
  });

  socket.on('join:role', (role) => {
    socket.join(role);
    if (role === 'host') {
      broadcastParticipants();
      socket.emit('backup:status', {
        hasBackup: quiz.hasBackup(),
        preview: quiz.loadBackupPreview(),
      });
      socket.emit('host:state', {
        registrationOpen: quiz.registrationOpen,
        quizStarted: quiz.quizStarted,
        currentQuestionIndex: quiz.currentQuestionIndex,
        questionPhase: quiz.questionPhase,
        totalQuestions: quiz.questions.length,
        finalRankingStarted: !!quiz.finalRanking,
      });
      emitCurrentQuestionState(socket, true);
    }

    if (role === 'screen') {
      socket.emit('participants:update', {
        list: quiz.getParticipantList(),
        registrationOpen: quiz.registrationOpen,
      });
      emitCurrentQuestionState(socket, true);
    }
  });

  socket.on('player:join', (name, ack) => {
    const result = quiz.addParticipant(name);
    if (result.error) return ack && ack({ error: result.error });
    socketIdToParticipantId.set(socket.id, result.participant.id);
    participantIdToSocketId.set(result.participant.id, socket.id);
    socket.join('player');
    broadcastParticipants();
    ack && ack({ participant: result.participant });
  });

  socket.on('player:rejoin', (id, ack) => {
    const result = quiz.rejoinParticipant(id);
    if (result.error) return ack && ack({ error: result.error });
    socketIdToParticipantId.set(socket.id, id);
    participantIdToSocketId.set(id, socket.id);
    socket.join('player');
    broadcastParticipants();
    ack && ack({
      participant: result.participant,
      quizStarted: quiz.quizStarted,
      questionPhase: quiz.questionPhase,
    });

    emitCurrentQuestionState(socket, false);
  });

  socket.on('player:answer', (choiceIndex, ack) => {
    const participantId = socketIdToParticipantId.get(socket.id);
    if (!participantId) return ack && ack({ error: 'not_joined' });
    const result = quiz.submitAnswer(participantId, choiceIndex);
    if (result.error) return ack && ack({ error: result.error });
    io.to('screen').emit('answerCount:update', {
      answered: result.answeredCount,
      total: result.totalParticipants,
    });
    ack && ack({ ok: true });
  });

  socket.on('host:openRegistration', requireHostAuth(socket, () => {
    quiz.openRegistration();
    broadcastParticipants();
  }));

  socket.on('host:startQuiz', requireHostAuth(socket, (ack) => {
    if (quiz.questions.length === 0) {
      ack && ack({ error: 'no_questions' });
      return;
    }
    quiz.startQuiz();
    openCurrentQuestion();
    ack && ack({ ok: true });
  }));

  socket.on('host:revealAnswer', requireHostAuth(socket, () => {
    clearTimeout(lockTimer);
    if (quiz.questionPhase === 'open') quiz.lockQuestion();
    const answersSnapshot = new Map(quiz.currentAnswers);
    const { correctIndex, counts } = quiz.revealAnswer();
    io.to('screen').emit('reveal:show', { correctIndex, counts });
    io.to('host').emit('reveal:show', { correctIndex, counts });

    for (const [participantId, answer] of answersSnapshot.entries()) {
      const participant = quiz.participants.get(participantId);
      const targetSocketId = participantIdToSocketId.get(participantId);
      if (!targetSocketId || !participant) continue;
      io.to(targetSocketId).emit('reveal:show', {
        correctIndex,
        counts,
        yourResult: {
          correct: answer.correct,
          scoreGained: answer.score,
          totalScore: participant.totalScore,
        },
      });
    }
    // notify players who did not answer at all
    for (const participant of quiz.participants.values()) {
      if (answersSnapshot.has(participant.id)) continue;
      const targetSocketId = participantIdToSocketId.get(participant.id);
      if (!targetSocketId) continue;
      io.to(targetSocketId).emit('reveal:show', {
        correctIndex,
        counts,
        yourResult: { correct: false, scoreGained: 0, totalScore: participant.totalScore },
      });
    }

    broadcastParticipants();
  }));

  socket.on('host:nextQuestion', requireHostAuth(socket, () => {
    if (!quiz.hasNextQuestion()) return;
    quiz.nextQuestion();
    openCurrentQuestion();
  }));

  socket.on('host:kickParticipant', requireHostAuth(socket, (id) => {
    quiz.kickParticipant(id);
    broadcastParticipants();
  }));

  socket.on('host:startFinalRanking', requireHostAuth(socket, () => {
    const ranking = quiz.computeFinalRanking();
    quiz.rankingRevealCount = 0;
    io.to('screen').emit('ranking:scrollData', { ranking });
    io.to('player').emit('ranking:scrollData', { ranking });
    io.to('host').emit('ranking:scrollData', { ranking });
  }));

  socket.on('host:nextRankReveal', requireHostAuth(socket, () => {
    if (!quiz.finalRanking) return;
    const top10 = quiz.finalRanking.filter((r) => r.rank <= 10);
    const idx = quiz.rankingRevealCount;
    if (idx >= top10.length) return;
    const entry = top10[top10.length - 1 - idx];
    quiz.rankingRevealCount += 1;
    io.to('screen').emit('ranking:topReveal', entry);
    io.to('host').emit('ranking:topReveal', entry);
  }));

  socket.on('host:resumeBackup', requireHostAuth(socket, () => {
    quiz.restoreFromBackup();
    broadcastParticipants();
  }));

  socket.on('host:discardBackup', requireHostAuth(socket, () => {
    quiz.discardBackup();
  }));

  socket.on('disconnect', () => {
    const participantId = socketIdToParticipantId.get(socket.id);
    if (participantId) {
      quiz.setDisconnected(participantId);
      socketIdToParticipantId.delete(socket.id);
      if (participantIdToSocketId.get(participantId) === socket.id) {
        participantIdToSocketId.delete(participantId);
      }
      broadcastParticipants();
    }
  });
});

server.listen(PORT, () => {
  const base = getPlayerBaseUrl();
  console.log('========================================');
  console.log('  結婚式クイズアプリ サーバー起動完了');
  console.log('========================================');
  console.log(`  司会操作画面: ${base}/host`);
  console.log(`  投影画面    : ${base}/screen`);
  console.log(`  管理画面    : ${base}/admin (要パスワード)`);
  console.log(`  参加者用URL : ${base}/player`);
  console.log('========================================');
});
