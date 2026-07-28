const { getUsers } = require("./auth");
const { readAll } = require("./userStore");
const { computeLiteracy } = require("./literacy");

// 서버에 실제로 가입된 모든 사용자를 대상으로 점수를 계산해 순위를 매긴다.
// (다른 실제 사용자 데이터가 없으면 이 목록에는 본인만 있을 수 있음 — 정직하게, 지어낸 사용자는 없음)
function buildLeaderboard(currentUserId) {
  const users = getUsers();
  const ranked = users
    .map((u) => {
      const history = readAll(u.id);
      const literacy = computeLiteracy(history);
      return {
        userId: u.id,
        displayName: u.displayName,
        score: literacy.score,
        level: literacy.level,
      };
    })
    .sort((a, b) => b.score - a.score);

  ranked.forEach((r, i) => (r.rank = i + 1));

  const total = ranked.length;
  const me = ranked.find((r) => r.userId === currentUserId) || null;
  const percentile = me ? Math.max(1, Math.round((me.rank / total) * 1000) / 10) : null;

  return {
    totalUsers: total,
    top: ranked.slice(0, 20).map((r) => ({
      rank: r.rank,
      displayName: r.displayName,
      score: r.score,
      levelName: r.level.name,
      isMe: r.userId === currentUserId,
    })),
    me: me
      ? { rank: me.rank, score: me.score, levelName: me.level.name, percentileFromTop: percentile }
      : null,
  };
}

module.exports = { buildLeaderboard };
