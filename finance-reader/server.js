require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const { extractArticle, buildArticleFromText } = require("./services/articleExtractor");
const { analyzeArticle, recommendTopics } = require("./services/llm");
const { getCompanyReport } = require("./services/dart");
const { searchNaverNews } = require("./services/newsFeed");
const { computeLiteracy } = require("./services/literacy");
const { categorize, CATEGORIES } = require("./services/categories");
const { getProductsForCategory } = require("./services/bankProducts");
const auth = require("./services/auth");
const { buildLeaderboard } = require("./services/leaderboard");
const store = require("./services/userStore");

// LLM이 준 category가 우리 taxonomy와 다르면, 용어 목록에서 다수결로 대체 계산한다.
function resolveCategory(analysis) {
  if (analysis?.category && CATEGORIES.includes(analysis.category)) return analysis.category;
  const count = {};
  (analysis?.terms || []).forEach((t) => {
    const c = categorize(t.term || "");
    count[c] = (count[c] || 0) + 1;
  });
  const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : "기타";
}

async function handleRead(userId, article, level, res) {
  const analysis = await analyzeArticle(article.text, level || "intermediate");

  store.addEntry(userId, {
    url: article.url,
    title: article.title,
    level,
    companies: analysis.companies || [],
    terms: (analysis.terms || []).map((t) => t.term),
  });
  store.appendScoreSnapshot(userId, computeLiteracy(store.readAll(userId)).score);

  const category = resolveCategory(analysis);
  const understood = store.getUnderstoodFor(userId, article.url);
  res.json({
    article,
    analysis,
    category,
    bankProducts: getProductsForCategory(category),
    saved: article.url ? store.isSaved(userId, article.url) : false,
    understoodTerms: understood,
  });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// ==================== 인증 ====================
app.post("/api/auth/signup", (req, res) => {
  try {
    const user = auth.signup(req.body);
    const token = auth.createSession(user.id);
    res.json({ token, user: auth.publicUser(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    const user = auth.login(req.body);
    const token = auth.createSession(user.id);
    res.json({ token, user: auth.publicUser(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) auth.destroySession(token);
  res.json({ ok: true });
});

app.get("/api/auth/me", auth.requireAuth, (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

// ==================== 이 아래부터는 전부 로그인 필요 ====================
app.use("/api", (req, res, next) => {
  // 인증/공용(핫기사·DART) 라우트는 이미 위에서 처리됐거나 아래에서 별도 허용
  const PUBLIC_PATHS = ["/api/trending", "/api/dart"];
  if (PUBLIC_PATHS.includes(req.path) || req.path.startsWith("/api/auth/")) return next();
  return auth.requireAuth(req, res, next);
});

// ---- 온보딩: 평소 이해 수준 / 관심분야 저장·조회 ----
app.post("/api/profile", (req, res) => {
  try {
    const { readingHabit, interests, level } = req.body;
    store.saveProfile(req.userId, { readingHabit, interests: interests || [], level });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/profile", (req, res) => {
  res.json(store.getProfile(req.userId) || {});
});

// ---- 나의 금융 이해도 / 학습현황 (점수·레벨·연속학습일·카테고리분포·점수추이) ----
app.get("/api/literacy", (req, res) => {
  try {
    const history = store.readAll(req.userId);
    res.json({ ...computeLiteracy(history), scoreHistory: store.getScoreHistory(req.userId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 전국 순위 (실제 가입자 기준 실제 점수 랭킹) ----
app.get("/api/leaderboard", (req, res) => {
  try {
    res.json(buildLeaderboard(req.userId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 마이페이지: 저장한 기사 / 최근 조회 금융상품 ----
app.get("/api/mypage", (req, res) => {
  try {
    const profile = store.getProfile(req.userId) || {};
    const saved = store.getSavedArticles(req.userId);
    const history = store.readAll(req.userId);

    const seen = new Set();
    const recentProducts = [];
    for (const h of history) {
      const cat = categorize((h.terms || [])[0] || "");
      for (const p of getProductsForCategory(cat).items) {
        if (seen.has(p.name)) continue;
        seen.add(p.name);
        recentProducts.push(p);
        if (recentProducts.length >= 3) break;
      }
      if (recentProducts.length >= 3) break;
    }

    res.json({
      profile: { ...profile, username: req.user.username, displayName: req.user.displayName, joinedAt: req.user.createdAt },
      saved,
      recentProducts,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 기사 저장(북마크) 토글 ----
app.post("/api/save", (req, res) => {
  try {
    const { url, title, category } = req.body;
    if (!url) return res.status(400).json({ error: "url이 필요합니다." });
    res.json(store.toggleSaved(req.userId, { url, title, category }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 용어 "이해했어요" 체크 ----
app.post("/api/term-understood", (req, res) => {
  try {
    const { url, term } = req.body;
    if (!term) return res.status(400).json({ error: "term이 필요합니다." });
    store.markUnderstood(req.userId, url, term);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 오늘의 핫 기사 (공개, 로그인 불필요) ----
app.get("/api/trending", async (_req, res) => {
  try {
    const items = await searchNaverNews("금융", 8, { recent: true });
    if (items.length) return res.json({ items, source: "naver-news-search" });
    throw new Error("empty result");
  } catch (e) {
    console.error("[trending] 네이버 뉴스 스크레이핑 실패, 구글 RSS로 폴백:", e.message);
    try {
      const { data } = await axios.get(
        "https://news.google.com/rss/search?q=%EA%B8%88%EC%9C%B5%20when:1d&hl=ko&gl=KR&ceid=KR:ko",
        { timeout: 6000 }
      );
      const items = [...data.matchAll(/<item>([\s\S]*?)<\/item>/g)]
        .slice(0, 8)
        .map((m) => {
          const block = m[1];
          const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
          const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
          return {
            title: title.replace("<![CDATA[", "").replace("]]>", ""),
            url: link.trim(),
            thumbnail: null,
          };
        })
        .filter((i) => i.title && i.url);
      if (items.length) return res.json({ items, source: "google-news-rss" });
      throw new Error("empty feed");
    } catch (e2) {
      res.json({
        items: [
          { title: "(예시) 한국은행 기준금리 동결 결정", url: "" },
          { title: "(예시) 반도체 수출 증가세, 코스피 강세", url: "" },
          { title: "(예시) 원/달러 환율 변동성 확대", url: "" },
        ],
        source: "fallback-mock",
        note: "실시간 피드를 가져오지 못해 예시 데이터를 표시합니다.",
      });
    }
  }
});

// ---- 사용자 열람 이력 + 관심분야 기반 추천 ----
app.post("/api/recommend", async (req, res) => {
  const { level } = req.body;
  const history = store.readAll(req.userId);
  const profile = store.getProfile(req.userId);

  let result;
  try {
    result = await recommendTopics(history, level || "intermediate", profile?.interests || []);
  } catch (e) {
    console.error("[recommend] recommendTopics 실패:", e.message);
    return res.json({ pattern_summary: "", recommendations: [] });
  }

  const recommendations = [];
  for (const r of result.recommendations || []) {
    try {
      const [hit] = await searchNaverNews(r.search_query || r.title, 1);
      recommendations.push({ ...r, article: hit || null });
    } catch (e) {
      console.error("[recommend] 뉴스 매칭 실패:", e.message);
      recommendations.push({ ...r, article: null });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  res.json({ ...result, recommendations });
});

// ---- URL -> 기사 추출 + 난이도별 분석(용어/흐름도/회사명) ----
app.post("/api/read", async (req, res) => {
  try {
    const { url, level } = req.body;
    if (!url) return res.status(400).json({ error: "url이 필요합니다." });
    const article = await extractArticle(url);
    await handleRead(req.userId, article, level, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 기사 본문을 URL 없이 직접 붙여넣었을 때 ----
app.post("/api/read-text", async (req, res) => {
  try {
    const { text, level } = req.body;
    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: "붙여넣은 본문이 너무 짧아요." });
    }
    const article = buildArticleFromText(text);
    await handleRead(req.userId, article, level, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- DART 기업 정보 조회 (공개, 로그인 불필요) ----
app.post("/api/dart", async (req, res) => {
  try {
    const { companyName } = req.body;
    if (!companyName)
      return res.status(400).json({ error: "companyName이 필요합니다." });
    const report = await getCompanyReport(companyName);
    res.json(report);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n금사통 서버 실행 중: http://localhost:${PORT}\n`);
});
