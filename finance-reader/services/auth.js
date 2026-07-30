const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getUsers() {
  return readJson(USERS_FILE, []);
}
function saveUsers(users) {
  writeJson(USERS_FILE, users);
}
function getSessions() {
  return readJson(SESSIONS_FILE, {});
}
function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt };
}

function signup({ username, password, displayName }) {
  const uname = (username || "").trim().toLowerCase();
  if (uname.length < 3) throw new Error("아이디는 3자 이상이어야 해요.");
  if (!/^[a-z0-9_]+$/.test(uname)) throw new Error("아이디는 영문 소문자/숫자/밑줄(_)만 사용할 수 있어요.");
  if (!password || password.length < 4) throw new Error("비밀번호는 4자 이상이어야 해요.");

  const users = getUsers();
  if (users.some((u) => u.username === uname)) {
    throw new Error("이미 사용 중인 아이디예요.");
  }

  const user = {
    id: crypto.randomBytes(8).toString("hex"),
    username: uname,
    passwordHash: bcrypt.hashSync(password, 10),
    displayName: (displayName || "").trim() || uname,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function login({ username, password }) {
  const uname = (username || "").trim().toLowerCase();
  const users = getUsers();
  const user = users.find((u) => u.username === uname);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않아요.");
  }
  return user;
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const sessions = getSessions();
  sessions[token] = { userId, createdAt: new Date().toISOString() };
  saveSessions(sessions);
  return token;
}

function destroySession(token) {
  const sessions = getSessions();
  delete sessions[token];
  saveSessions(sessions);
}

function getUserByToken(token) {
  if (!token) return null;
  const session = getSessions()[token];
  if (!session) return null;
  return getUsers().find((u) => u.id === session.userId) || null;
}

// Express 미들웨어: Authorization: Bearer <token> 헤더로 로그인 여부 확인
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: "로그인이 필요해요." });
  req.userId = user.id;
  req.user = user;
  next();
}

module.exports = {
  signup,
  login,
  createSession,
  destroySession,
  getUserByToken,
  publicUser,
  requireAuth,
  getUsers,
};
