const fs = require('fs');
const path = require('path');

const QUESTIONS_PATH = path.join(__dirname, '..', 'data', 'questions.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

function loadQuestions() {
  return JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf-8'));
}

function saveQuestions(questions) {
  fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(questions, null, 2), 'utf-8');
}

function loadSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

module.exports = { loadQuestions, saveQuestions, loadSettings, saveSettings };
