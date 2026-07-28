const fs = require("fs");
const path = require("path");

const USER_DATA_DIR = path.join(__dirname, "..", "data", "users");

function filePath(userId) {
  return path.join(USER_DATA_DIR, `${userId}.json`);
}

function defaultData() {
  return {
    profile: { level: null, interests: [], updatedAt: null },
    history: [],
    bookmarks: [],
    understoodTerms: {}, // { [articleUrl]: [term, ...] }
    scoreHistory: [],
  };
}

function load(userId) {
  const f = filePath(userId);
  if (!fs.existsSync(f)) return defaultData();
  try {
    return { ...defaultData(), ...JSON.parse(fs.readFileSync(f, "utf-8")) };
  } catch {
    return defaultData();
  }
}

function save(userId, data) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(userId), JSON.stringify(data, null, 2));
}

// ---- 읽기 이력 ----
function readAll(userId) {
  return load(userId).history;
}
function addEntry(userId, entry) {
  const data = load(userId);
  data.history.unshift({ ...entry, readAt: new Date().toISOString() });
  data.history = data.history.slice(0, 200);
  save(userId, data);
}

// ---- 온보딩 프로필 ----
function getProfile(userId) {
  return load(userId).profile;
}
function saveProfile(userId, profile) {
  const data = load(userId);
  data.profile = { ...data.profile, ...profile, updatedAt: new Date().toISOString() };
  save(userId, data);
}

// ---- 저장한 기사 (마이페이지 북마크) ----
function getSavedArticles(userId) {
  return load(userId).bookmarks;
}
function isSaved(userId, url) {
  return load(userId).bookmarks.some((a) => a.url === url);
}
function toggleSaved(userId, article) {
  const data = load(userId);
  const idx = data.bookmarks.findIndex((a) => a.url === article.url);
  if (idx >= 0) {
    data.bookmarks.splice(idx, 1);
    save(userId, data);
    return { saved: false };
  }
  data.bookmarks.unshift({ ...article, savedAt: new Date().toISOString() });
  data.bookmarks = data.bookmarks.slice(0, 100);
  save(userId, data);
  return { saved: true };
}

// ---- 용어별 "이해했어요" 체크 ----
function markUnderstood(userId, url, term) {
  const data = load(userId);
  const key = url || "pasted";
  data.understoodTerms[key] = Array.from(new Set([...(data.understoodTerms[key] || []), term]));
  save(userId, data);
}
function getUnderstoodFor(userId, url) {
  return load(userId).understoodTerms[url || "pasted"] || [];
}

// ---- 이해도 점수 히스토리 (학습현황 그래프용) ----
function appendScoreSnapshot(userId, score) {
  const data = load(userId);
  const today = new Date().toISOString().slice(0, 10);
  const last = data.scoreHistory[data.scoreHistory.length - 1];
  if (last && last.date === today) {
    last.score = score;
  } else {
    data.scoreHistory.push({ date: today, score });
  }
  data.scoreHistory = data.scoreHistory.slice(-60);
  save(userId, data);
}
function getScoreHistory(userId) {
  return load(userId).scoreHistory;
}

module.exports = {
  readAll,
  addEntry,
  getProfile,
  saveProfile,
  getSavedArticles,
  isSaved,
  toggleSaved,
  markUnderstood,
  getUnderstoodFor,
  appendScoreSnapshot,
  getScoreHistory,
};
