const { categorize, CATEGORIES } = require("./categories");

const LEVELS = [
  { min: 0, name: "금융 입문자" },
  { min: 25, name: "금융 초보 투자자" },
  { min: 50, name: "금융 탐색가" },
  { min: 75, name: "금융 고수" },
];

function levelFor(score) {
  let current = LEVELS[0];
  let index = 1;
  LEVELS.forEach((l, i) => {
    if (score >= l.min) {
      current = l;
      index = i + 1;
    }
  });
  const next = LEVELS[index]; // index는 1부터 시작하므로 배열상 다음 레벨
  return {
    index,
    name: current.name,
    pointsToNext: next ? next.min - score : 0,
    nextName: next ? next.name : null,
  };
}

// 오늘부터 거꾸로 날짜를 훑으며 하루도 안 거른 "연속 학습일수"를 센다.
function computeStreak(history) {
  const days = new Set(history.map((h) => h.readAt.slice(0, 10)));
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function computeLiteracy(history) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekly = history.filter((h) => now - new Date(h.readAt).getTime() < weekMs);
  const termsOf = (h) => h.terms || [];

  const weeklyArticles = weekly.length;
  const weeklyTerms = weekly.reduce((sum, h) => sum + termsOf(h).length, 0);
  const totalArticles = history.length;
  const totalTerms = history.reduce((sum, h) => sum + termsOf(h).length, 0);

  const score = Math.min(100, totalArticles * 5 + totalTerms * 2);
  const level = levelFor(score);

  const catCount = {};
  CATEGORIES.forEach((c) => (catCount[c] = 0));
  catCount["기타"] = 0;
  history.forEach((h) => termsOf(h).forEach((t) => { const c = categorize(t); catCount[c] = (catCount[c] || 0) + 1; }));

  const totalCatCount = Object.values(catCount).reduce((a, b) => a + b, 0) || 1;
  const categoryBreakdown = Object.entries(catCount)
    .filter(([, n]) => n > 0)
    .map(([category, n]) => ({ category, count: n, pct: Math.round((n / totalCatCount) * 100) }))
    .sort((a, b) => b.count - a.count);

  const weakCategory = categoryBreakdown.length ? categoryBreakdown[0].category : null;

  const recentTermsFlat = [];
  history.slice(0, 10).forEach((h) => termsOf(h).forEach((t) => recentTermsFlat.push(t)));
  const recentTerms = Array.from(new Set(recentTermsFlat)).slice(0, 12);

  return {
    score,
    level,
    weeklyArticles,
    weeklyTerms,
    totalArticles,
    totalTerms,
    weakCategory,
    categoryBreakdown,
    streak: computeStreak(history),
    recentTerms,
    hasData: totalArticles > 0,
    recent: history.slice(0, 10).map((h) => ({
      title: h.title,
      url: h.url,
      readAt: h.readAt,
      termCount: termsOf(h).length,
      terms: termsOf(h).slice(0, 6),
    })),
  };
}

module.exports = { computeLiteracy };
