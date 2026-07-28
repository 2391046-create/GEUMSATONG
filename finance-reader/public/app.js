const LEVEL_LABEL = { beginner: "초급", intermediate: "중급", advanced: "고급" };

const state = {
  token: localStorage.getItem("financeReaderToken") || null,
  user: null,
  level: localStorage.getItem("financeReaderLevel") || null,
  interests: [],
  currentAnalysis: null,
  currentArticle: null,
  currentCategory: null,
  currentCompanies: [],
  understoodTerms: new Set(),
  activeTermIdx: -1,
  activeTabLevel: null,
  saved: false,
  recommendCache: null, // { hero, secArea } 렌더된 HTML 캐시 — 홈 재방문마다 Groq 재호출 방지
  recommendCacheAt: 0,
  trendingCache: null,
  trendingCacheAt: 0,
};
const RECOMMEND_CACHE_MS = 15 * 60 * 1000; // 15분간은 홈에 다시 와도 재호출하지 않음

async function fetchJSON(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`서버 응답을 해석하지 못했어요 (status ${res.status})`);
    }
    if (res.status === 401) {
      logout();
      throw new Error("로그인이 만료됐어요. 다시 로그인해주세요.");
    }
    if (!res.ok && !data.error) data.error = `요청 실패 (status ${res.status})`;
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("응답이 너무 오래 걸려 중단했어요. 서버 터미널 로그를 확인해보세요.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(str) { return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, "&quot;"); }

const $ = (sel) => document.querySelector(sel);
const pages = {
  auth: $("#view-auth"),
  level: $("#view-level"),
  home: $("#view-home"),
  mypage: $("#view-mypage"),
  dashboard: $("#view-dashboard"),
  article: $("#view-article"),
};

function showPage(name) {
  Object.entries(pages).forEach(([k, el]) => {
    if (k === "level" || k === "auth") return;
    el.classList.remove("active");
  });
  $("#app-topbar").hidden = name === "level" || name === "auth";
  pages.level.style.display = name === "level" ? "flex" : "none";
  pages.auth.style.display = name === "auth" ? "flex" : "none";
  if (name !== "level" && name !== "auth") pages[name].classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });
  updateBackButton();
}

// 페이지별로 화면 전환 + 필요한 데이터 로딩까지 한 번에 처리하고, 브라우저 히스토리에 기록한다.
// (뒤로가기/앞으로가기 버튼과 상단의 자체 뒤로가기 버튼이 이 함수 하나로 동작한다)
const PAGE_LOADERS = {
  home: loadHomeData,
  mypage: loadMypage,
  dashboard: loadDashboard,
};
function navigateTo(name, { push = true } = {}) {
  showPage(name);
  if (name === "article") {
    // 기사 화면은 새로 불러올 데이터가 없으면(뒤로가기 등으로 진입) 홈으로 대체한다.
    if (!state.currentArticle) {
      navigateTo("home", { push: false });
      return;
    }
  } else if (PAGE_LOADERS[name]) {
    PAGE_LOADERS[name]();
  }
  if (push) history.pushState({ page: name }, "", `#${name}`);
}
window.addEventListener("popstate", (e) => {
  const name = e.state?.page || "home";
  if (!state.token) { showPage("auth"); return; }
  navigateTo(name, { push: false });
});
function updateBackButton() {
  const btn = $("#topbar-back");
  if (!btn) return;
  btn.disabled = history.state?.page === "home" || !history.state;
}
$("#topbar-back")?.addEventListener("click", () => history.back());

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("financeReaderToken");
  localStorage.removeItem("financeReaderLevel");
  showPage("auth");
}

function showLoading(text) { $("#loading-text").textContent = text || "분석 중…"; $("#loading-overlay").hidden = false; }
function hideLoading() { $("#loading-overlay").hidden = true; }

// ==================== 상단바 / 네비게이션 ====================
function updateAvatar() {
  if (!state.level) return;
  $("#avatar-btn").textContent = LEVEL_LABEL[state.level][0];
  $("#avatar-btn").title = `난이도: ${LEVEL_LABEL[state.level]}`;
  if (state.user) {
    $("#avatar-menu-user").textContent = `${state.user.displayName} 님 (@${state.user.username})`;
  }
}
$("#avatar-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#avatar-menu").hidden = !$("#avatar-menu").hidden;
});
document.addEventListener("click", () => { $("#avatar-menu").hidden = true; });
$("#avatar-menu").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-nav]");
  if (!btn) return;
  const nav = btn.dataset.nav;
  if (nav === "level") { showPage("level"); return; }
  if (nav === "home") { navigateTo("home"); }
  if (nav === "mypage") { navigateTo("mypage"); }
  if (nav === "dashboard") { navigateTo("dashboard"); }
  if (nav === "logout") {
    fetchJSON("/api/auth/logout", { method: "POST" }).catch(() => {});
    logout();
  }
});

// ==================== 로그인 / 회원가입 ====================
let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  $("#auth-tab-login").classList.toggle("active", mode === "login");
  $("#auth-tab-signup").classList.toggle("active", mode === "signup");
  $("#auth-displayname-field").hidden = mode !== "signup";
  $("#auth-submit").textContent = mode === "signup" ? "가입하고 시작하기 →" : "로그인 →";
  $("#auth-hint").textContent = "";
}
$("#auth-tab-login").addEventListener("click", () => setAuthMode("login"));
$("#auth-tab-signup").addEventListener("click", () => setAuthMode("signup"));

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  const displayName = $("#auth-displayname").value.trim();
  const hint = $("#auth-hint");
  hint.textContent = "";
  hint.style.color = "";

  const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  const body = authMode === "signup" ? { username, password, displayName } : { username, password };

  try {
    const data = await fetchJSON(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (data.error) throw new Error(data.error);
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("financeReaderToken", state.token);
    await afterLogin();
  } catch (err) {
    hint.textContent = err.message;
  }
});

// 로그인 성공 직후: 프로필이 이미 있으면 홈으로, 없으면(신규 가입) 온보딩으로
async function afterLogin() {
  try {
    const profile = await fetchJSON("/api/profile");
    if (profile && profile.level) {
      state.level = profile.level;
      state.interests = profile.interests || [];
      localStorage.setItem("financeReaderLevel", state.level);
      updateAvatar();
      showPage("home");
      history.replaceState({ page: "home" }, "", "#home");
      loadHomeData();
      return;
    }
  } catch { /* 무시 */ }
  showPage("level");
}

// ==================== 온보딩 ====================
let selectedHabitLevel = null;
document.querySelectorAll(".radio-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".radio-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedHabitLevel = card.dataset.level;
    $("#onboard-submit").disabled = false;
  });
});
$("#tag-more-btn").addEventListener("click", () => {
  document.querySelectorAll(".tag-pill.more-hidden").forEach((el) => (el.hidden = false));
  $("#tag-more-btn").hidden = true;
});
document.querySelectorAll(".tag-pill").forEach((tag) => {
  tag.addEventListener("click", () => {
    tag.classList.toggle("selected");
    const t = tag.dataset.tag;
    if (tag.classList.contains("selected")) state.interests.push(t);
    else state.interests = state.interests.filter((x) => x !== t);
  });
});
$("#ob-login").addEventListener("click", () => {
  setAuthMode("login");
  showPage("auth");
});
$("#onboard-submit").addEventListener("click", async () => {
  if (!selectedHabitLevel) return;
  state.level = selectedHabitLevel;
  localStorage.setItem("financeReaderLevel", state.level);
  updateAvatar();
  try {
    await fetchJSON("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: state.level, interests: state.interests }),
    });
  } catch { /* 저장 실패해도 계속 진행 */ }
  showPage("home");
  history.replaceState({ page: "home" }, "", "#home");
  loadHomeData();
});

// ==================== 홈 ====================
async function loadHomeData() {
  loadRecommendations();
  loadLiteracy();
}

async function loadRecommendations(force = false) {
  const heroArea = $("#hero-area");
  const secArea = $("#secondary-area");

  // 캐시가 신선하면(기본 15분) 홈에 다시 왔다고 Groq를 재호출하지 않고 그대로 다시 그린다.
  const fresh = !force && state.recommendCache && Date.now() - state.recommendCacheAt < RECOMMEND_CACHE_MS;
  if (fresh) {
    heroArea.innerHTML = state.recommendCache.heroHTML;
    secArea.innerHTML = state.recommendCache.secHTML;
    return;
  }

  heroArea.innerHTML = `<p class="skeleton">오늘의 핫뉴스를 불러오는 중…</p>`;
  secArea.innerHTML = `<p class="skeleton">관심분야 기반 추천 기사를 불러오는 중…</p>`;

  // 오늘의 핫뉴스: 개인화 없이 오늘의 금융 트렌딩 기사 중 1건 (Groq 미사용, 그래도 캐시해서 요청 수 절약)
  try {
    let hero;
    if (!force && state.trendingCache && Date.now() - state.trendingCacheAt < RECOMMEND_CACHE_MS) {
      hero = state.trendingCache;
    } else {
      const trending = await fetchJSON("/api/trending");
      hero = (trending.items || []).find((it) => it.url) || null;
      state.trendingCache = hero;
      state.trendingCacheAt = Date.now();
    }
    heroArea.innerHTML = hero
      ? renderHeroCard({ category: "오늘의 핫뉴스", article: hero })
      : `<p class="skeleton">오늘의 핫뉴스를 찾지 못했어요.</p>`;
  } catch (e) {
    heroArea.innerHTML = `<p class="skeleton">오늘의 핫뉴스를 불러오지 못했어요.</p>`;
  }

  // 추천 기사: 관심분야 + 읽은 이력 기반 개인화 추천 (Groq 사용 — 여기만 실제 토큰이 든다)
  try {
    const data = await fetchJSON(
      "/api/recommend",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: state.level }) },
      30000
    );
    if (data.error) throw new Error(data.error);
    const recs = (data.recommendations || []).filter((r) => r.article).slice(0, 3);
    secArea.innerHTML = recs.length
      ? `<div class="secondary-grid">${recs.map(renderSecondaryCard).join("")}</div>`
      : `<p class="skeleton">관심분야에 맞는 추천을 찾지 못했어요.</p>`;
  } catch (e) {
    secArea.innerHTML = `<p class="skeleton">추천을 불러오지 못했어요 (${escapeHtml(e.message)})</p>`;
  }

  // 다음 홈 방문 때 재사용할 수 있도록 렌더 결과를 캐시해둔다.
  state.recommendCache = { heroHTML: heroArea.innerHTML, secHTML: secArea.innerHTML };
  state.recommendCacheAt = Date.now();
}
$("#refresh-recommend").addEventListener("click", () => loadRecommendations(true));

// 오늘의 핫 뉴스 / 추천 기사는 용어 분석 없이, 눌렀을 때 실제 기사로 바로 이동한다.
function renderHeroCard(r) {
  const a = r.article;
  return `<a href="${escapeAttr(a.url)}" target="_blank" rel="noopener" class="hero-card">
    <span class="hero-tag">${escapeHtml(r.category || "오늘의 추천")}</span>
    <h3 class="hero-title">${escapeHtml(a.title)}</h3>
    ${r.reason ? `<p class="hero-desc">${escapeHtml(r.reason)}</p>` : ""}
    <span class="hero-meta">${escapeHtml(a.press || "")}</span>
  </a>`;
}
function renderSecondaryCard(r) {
  const a = r.article;
  return `<a href="${escapeAttr(a.url)}" target="_blank" rel="noopener" class="secondary-card">
    <span class="card-tag">${escapeHtml(r.category || "기타")}</span>
    <span class="card-title">${escapeHtml(a.title)}</span>
    <span class="card-tags-row"><span>${escapeHtml(r.category || "기타")}</span></span>
  </a>`;
}
function bindNewsCardClicks(container) {
  container.querySelectorAll(".use-url").forEach((el) =>
    el.addEventListener("click", () => { $("#url-input").value = el.dataset.url; $("#url-form").requestSubmit(); })
  );
}

// ---- 원형 게이지 (SVG stroke-dasharray) ----
function ringSVG(pct, size, stroke, color) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#E3E0D6" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
  </svg>`;
}

async function loadLiteracy() {
  const panel = $("#literacy-panel");
  panel.innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  try {
    const data = await fetchJSON("/api/literacy");
    if (data.error) throw new Error(data.error);
    renderLiteracyPanel(data);
  } catch {
    panel.innerHTML = `<p class="skeleton">불러오지 못했어요.</p>`;
  }
}
function renderLiteracyPanel(data) {
  $("#literacy-panel").innerHTML = `
    <div class="literacy-top">
      <div class="ring-wrap">${ringSVG(data.score, 62, 7, "#E8663D")}<div class="ring-num">${data.score}</div></div>
      <div>
        <div class="literacy-level-label">현재 레벨</div>
        <div class="literacy-level-name">Level ${data.level.index} · ${escapeHtml(data.level.name)}</div>
      </div>
    </div>
    <div class="literacy-stats">
      <div class="literacy-stat"><span class="k">이번 주 읽은 기사</span><span class="v">${data.weeklyArticles}개</span></div>
      <div class="literacy-stat"><span class="k">새롭게 이해한 용어</span><span class="v">${data.weeklyTerms}개</span></div>
      <div class="literacy-stat"><span class="k">관심/취약 분야</span><span class="v">${data.weakCategory ? escapeHtml(data.weakCategory) : "-"}</span></div>
    </div>
    <button class="literacy-detail-btn" id="literacy-detail-btn">내 금융 이해도 자세히 보기</button>
  `;
  $("#literacy-detail-btn").addEventListener("click", () => navigateTo("dashboard"));
}

// ---- URL 입력 / 본문 붙여넣기 ----
$("#toggle-paste").addEventListener("click", () => { $("#paste-box").hidden = !$("#paste-box").hidden; });

$("#url-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#url-input").value.trim();
  if (!url) return;
  $("#url-hint").textContent = "";
  showLoading("기사를 불러오고 난이도에 맞춰 분석하는 중…");
  try {
    const data = await fetchJSON(
      "/api/read",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, level: state.level }) },
      60000
    );
    if (data.error) throw new Error(data.error);
    renderArticle(data);
    navigateTo("article");
  } catch (err) {
    $("#url-hint").textContent = `불러오지 못했어요: ${err.message}`;
  } finally {
    hideLoading();
  }
});

$("#paste-submit").addEventListener("click", async () => {
  const text = $("#paste-textarea").value.trim();
  if (text.length < 30) { $("#url-hint").textContent = "본문을 조금 더 붙여넣어 주세요."; return; }
  $("#url-hint").textContent = "";
  showLoading("붙여넣은 본문을 난이도에 맞춰 분석하는 중…");
  try {
    const data = await fetchJSON(
      "/api/read-text",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, level: state.level }) },
      60000
    );
    if (data.error) throw new Error(data.error);
    renderArticle(data);
    navigateTo("article");
  } catch (err) {
    $("#url-hint").textContent = `분석하지 못했어요: ${err.message}`;
  } finally {
    hideLoading();
  }
});

$("#back-to-home").addEventListener("click", () => navigateTo("home"));

// ==================== 마이페이지 ====================
let mypageSaved = [];
let mypageFilter = "전체";

async function loadMypage() {
  $("#mypage-profile").innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  $("#saved-grid").innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  $("#mypage-products").innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  try {
    const [mypage, literacy] = await Promise.all([fetchJSON("/api/mypage"), fetchJSON("/api/literacy")]);
    renderMypageProfile(mypage.profile, literacy);
    mypageSaved = mypage.saved || [];
    renderSavedFilters();
    renderSavedGrid();
    renderMypageProducts(mypage.recentProducts || []);
  } catch (e) {
    $("#mypage-profile").innerHTML = `<p class="skeleton">불러오지 못했어요.</p>`;
  }
}
function renderMypageProfile(profile, literacy) {
  const joined = profile?.joinedAt ? new Date(profile.joinedAt).toLocaleDateString("ko-KR") : "-";
  const interests = (profile?.interests || []).slice(0, 3);
  $("#mypage-profile").innerHTML = `
    <div class="profile-avatar"></div>
    <div>
      <div class="profile-name">나의 계정</div>
      <div class="profile-joined">가입일 ${joined}</div>
    </div>
    <div class="profile-tags">
      <span>금융 이해도 · ${LEVEL_LABEL[profile?.level] || "-"}</span>
      ${interests.map((i) => `<span>${escapeHtml(i)}</span>`).join("")}
    </div>
    <div class="profile-divider"></div>
    <div class="profile-stat-row"><span class="k">저장한 기사</span><span class="v">${mypageSaved.length}개</span></div>
    <div class="profile-stat-row"><span class="k">누적 이해 용어</span><span class="v">${literacy.totalTerms}개</span></div>
  `;
}
function renderSavedFilters() {
  const cats = Array.from(new Set(mypageSaved.map((a) => a.category).filter(Boolean)));
  const all = ["전체", ...cats];
  $("#saved-filters").innerHTML = all
    .map((c) => `<button class="filter-pill ${c === mypageFilter ? "active" : ""}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`)
    .join("");
  $("#saved-filters").querySelectorAll(".filter-pill").forEach((b) =>
    b.addEventListener("click", () => { mypageFilter = b.dataset.cat; renderSavedFilters(); renderSavedGrid(); })
  );
}
function renderSavedGrid() {
  const grid = $("#saved-grid");
  const list = mypageFilter === "전체" ? mypageSaved : mypageSaved.filter((a) => a.category === mypageFilter);
  if (!list.length) {
    grid.innerHTML = `<div class="empty-note" style="grid-column:1/-1">아직 저장한 기사가 없어요. 기사 화면에서 "☆ 저장"을 눌러보세요.</div>`;
    return;
  }
  grid.innerHTML = list
    .map(
      (a) => `<button type="button" class="saved-card use-url" data-url="${escapeAttr(a.url)}">
        <span class="status-chip learning">학습 중</span>
        <span class="saved-title">${escapeHtml(a.title || "제목 없음")}</span>
        <span class="saved-cat">${escapeHtml(a.category || "기타")}</span>
      </button>`
    )
    .join("");
  bindNewsCardClicks(grid);
}
function renderMypageProducts(products) {
  const grid = $("#mypage-products");
  if (!products.length) {
    grid.innerHTML = `<div class="empty-note" style="grid-column:1/-1">기사를 몇 개 읽으면 관련 상품이 여기 표시돼요.</div>`;
    return;
  }
  grid.innerHTML = products
    .map(
      (p) => `<a class="product-card" href="${escapeAttr(p.url)}" target="_blank" rel="noopener">
        <span class="bank-chip bank-${escapeAttr(p.bank || "imbank")}">${escapeHtml(p.bankLabel || "iM뱅크")}</span>
        <span class="product-name">${escapeHtml(p.name)}</span>
        <span class="product-desc">${escapeHtml(p.desc)}</span>
      </a>`
    )
    .join("");
}

// ==================== 내 학습현황 ====================
async function loadDashboard() {
  $("#dash-profile").innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  $("#dash-top3").innerHTML = "";
  $("#score-chart").innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  $("#vocab-bars").innerHTML = "";
  $("#recent-term-tags").innerHTML = "";
  $("#leaderboard-box").innerHTML = `<p class="skeleton">불러오는 중…</p>`;
  try {
    const [data, profile] = await Promise.all([fetchJSON("/api/literacy"), fetchJSON("/api/profile")]);
    if (data.error) throw new Error(data.error);
    renderDashProfile(data, profile);
    renderDashTop3(data);
    renderScoreChart(data.scoreHistory || []);
    renderVocabBars(data.categoryBreakdown || []);
    $("#recent-term-tags").innerHTML = data.recentTerms.length
      ? data.recentTerms.map((t) => `<span>${escapeHtml(t)}</span>`).join("")
      : `<p class="skeleton">아직 학습한 용어가 없어요.</p>`;
  } catch (e) {
    $("#dash-profile").innerHTML = `<p class="skeleton">불러오지 못했어요.</p>`;
  }
  loadLeaderboard();
}

async function loadLeaderboard() {
  const box = $("#leaderboard-box");
  try {
    const data = await fetchJSON("/api/leaderboard");
    if (data.error) throw new Error(data.error);
    renderLeaderboard(data);
  } catch (e) {
    box.innerHTML = `<p class="skeleton">순위를 불러오지 못했어요.</p>`;
  }
}

function renderLeaderboard(data) {
  const box = $("#leaderboard-box");
  if (!data.totalUsers || data.totalUsers < 2) {
    box.innerHTML = `
      <p class="panel-sub">지금 이 서버에 가입된 사용자는 총 ${data.totalUsers}명이에요. 다른 사람이 가입해서 기사를 읽기 시작하면 여기 실제 순위가 쌓여요.</p>
      ${data.me ? `<div class="stat-box" style="max-width:200px; margin-top:12px;"><b>${data.me.score}점</b><span>내 점수 (현재 1위)</span></div>` : ""}
    `;
    return;
  }
  const rows = data.top
    .map(
      (r) => `<li class="${r.isMe ? "leaderboard-me" : ""}">
        <span class="lb-rank">${r.rank}</span>
        <span class="lb-name">${escapeHtml(r.displayName)}${r.isMe ? " (나)" : ""}</span>
        <span class="lb-level">${escapeHtml(r.levelName)}</span>
        <span class="lb-score">${r.score}점</span>
      </li>`
    )
    .join("");
  box.innerHTML = `
    ${data.me ? `<p class="panel-sub">전체 가입자 ${data.totalUsers}명 중 <b>${data.me.rank}위</b> (상위 ${data.me.percentileFromTop}%)</p>` : ""}
    <ul class="leaderboard-list">${rows}</ul>
  `;
}
function renderDashProfile(data, profile) {
  const pct = data.level.pointsToNext ? Math.round((data.score / (data.score + data.level.pointsToNext)) * 100) : 100;
  $("#dash-profile").innerHTML = `
    <div class="level-ring-big">${ringSVG(pct, 96, 8, "#1B2044")}<div class="ring-num"><b>${data.score}</b><span>POINT</span></div></div>
    <div style="text-align:center; margin-top:10px;">
      <div class="literacy-level-name">Level ${data.level.index} · ${escapeHtml(data.level.name)}</div>
    </div>
    ${data.level.nextName ? `
    <div class="progress-to-next">
      <div class="pt-label"><span>${escapeHtml(data.level.nextName)}까지</span><span>${data.level.pointsToNext} 포인트</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${100 - Math.min(100, data.level.pointsToNext)}%"></div></div>
    </div>` : ""}
    <div class="stat-grid-2">
      <div class="stat-box"><b>${data.streak}일</b><span>연속 학습</span></div>
      <div class="stat-box"><b>${data.totalArticles}개</b><span>읽은 기사</span></div>
    </div>
    <div class="profile-divider"></div>
    <div class="profile-tags">
      <span>관심분야 ${(profile?.interests || []).length}개</span>
    </div>
  `;
}
function renderDashTop3(data) {
  $("#dash-top3").innerHTML = `
    <div class="dashboard-card dash-stat-card"><b>${data.totalTerms}</b><span>누적 학습 용어</span></div>
    <div class="dashboard-card dash-stat-card"><b>Level ${data.level.index}</b><span>${escapeHtml(data.level.name)}</span></div>
    <div class="dashboard-card dash-stat-card"><b>${data.weeklyTerms}</b><span>이번 주 신규 이해</span></div>
  `;
}
function renderScoreChart(history) {
  const box = $("#score-chart");
  if (history.length < 2) {
    box.innerHTML = `<p class="skeleton">기사를 며칠에 걸쳐 읽으면 여기에 추이 그래프가 나와요.</p>`;
    return;
  }
  const w = 480, h = 180, pad = 24;
  const max = Math.max(100, ...history.map((pt) => pt.score));
  const stepX = history.length > 1 ? (w - pad * 2) / (history.length - 1) : 0;
  const innerH = h - pad * 2;

  const coords = history.map((pt, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - pt.score / max) * innerH,
  }));

  const path = coords.map((p) => `${p.x},${p.y}`).join(" ");
  const dots = coords.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="#6B7280" stroke-width="2"/>`).join("");
  const firstDate = history[0].date, lastDate = history[history.length - 1].date;
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">
    <polyline points="${path}" fill="none" stroke="#6B7280" stroke-width="2"/>
    ${dots}
  </svg>
  <div style="display:flex; justify-content:space-between; font-family:var(--mono); font-size:11px; color:var(--slate); max-width:${w}px;">
    <span>${firstDate}</span><span>${lastDate}</span>
  </div>`;
}
function renderVocabBars(breakdown) {
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
  const box = $("#vocab-bars");
  if (!breakdown.length) { box.innerHTML = `<p class="skeleton">아직 데이터가 없어요.</p>`; return; }
  box.innerHTML = breakdown
    .slice(0, 6)
    .map(
      (b, i) => `<div class="vocab-bar-row">
        <span class="vocab-bar-label"><i style="background:${colors[i % colors.length]}"></i>${escapeHtml(b.category)}</span>
        <span class="vocab-bar-track"><span class="vocab-bar-fill" style="width:${b.pct}%; background:${colors[i % colors.length]}"></span></span>
        <span class="vocab-bar-pct">${b.pct}%</span>
      </div>`
    )
    .join("");
}

// ==================== 기사 리더 ====================
function renderArticle(data) {
  const { article, analysis, category, bankProducts, saved, understoodTerms } = data;
  state.currentAnalysis = analysis;
  state.currentArticle = article;
  state.currentCategory = category;
  state.currentCompanies = analysis.companies || [];
  state.understoodTerms = new Set(understoodTerms || []);
  state.activeTermIdx = -1;
  state.saved = !!saved;
  state.activeTabLevel = state.level;

  $("#article-category").textContent = category || "";
  $("#article-title").textContent = article.title || "제목 없음";
  const metaParts = [];
  if (article.byline) metaParts.push(article.byline);
  if (article.publishedAt) metaParts.push(formatDate(article.publishedAt));
  $("#article-meta").textContent = metaParts.join(" · ");

  const imgEl = $("#article-image");
  if (article.mainImage) { imgEl.src = article.mainImage; imgEl.hidden = false; } else imgEl.hidden = true;

  updateSaveButton();
  $("#btn-original").onclick = () => { if (article.url) window.open(article.url, "_blank", "noopener"); };

  const container = $("#article-text");
  container.innerHTML = "";
  const usedTerms = new Set();
  const paras = article.paragraphs?.length ? article.paragraphs : [article.text];
  paras.forEach((para) => {
    const p = document.createElement("p");
    p.innerHTML = highlightTerms(para, analysis.terms || [], usedTerms);
    container.appendChild(p);
  });

  renderInterpreterList();
  $("#interpreter-active").hidden = true;
  $("#interpreter-empty").hidden = false;

  const dartWrap = $("#dart-buttons");
  if (state.currentCompanies.length) {
    dartWrap.innerHTML = state.currentCompanies
      .map((c) => `<button class="dart-btn" data-company="${escapeAttr(c)}">🏛 ${escapeHtml(c)} DART</button>`)
      .join("");
    dartWrap.querySelectorAll(".dart-btn").forEach((b) => b.addEventListener("click", () => openDartFor(b.dataset.company)));
  } else {
    dartWrap.innerHTML = `<span class="dart-empty">기사에서 특정 기업명을 찾지 못했어요.</span>`;
  }

  const productSection = $("#product-section");
  if (bankProducts?.items?.length) {
    productSection.hidden = false;
    productSection.innerHTML = `
      <p class="bank-section-title">이 기사와 연결된 금융상품</p>
      <p class="bank-section-intro">${escapeHtml(bankProducts.intro || "")}</p>
      <div class="bank-product-grid">
        ${bankProducts.items
          .map(
            (p) => `<a class="bank-product-card" href="${escapeAttr(p.url)}" target="_blank" rel="noopener">
          <span class="bank-badge bank-${escapeAttr(p.bank)}">${escapeHtml(p.bankLabel)}</span>
          <span class="bank-product-name">${escapeHtml(p.name)}</span>
          <span class="bank-product-desc">${escapeHtml(p.desc)}</span>
          <span class="bank-cta">${escapeHtml(p.bankLabel)} 영업점 상담하기 →</span>
        </a>`
          )
          .join("")}
      </div>
      <p class="bank-disclaimer">위 정보는 상품 유형 소개를 위한 참고용이며, 특정 상품 가입을 권유하지 않아요. 세부 조건은 각 사 영업점 및 상품설명서를 확인해주세요.</p>`;
  } else {
    productSection.hidden = true;
  }
}

function updateSaveButton() {
  const btn = $("#btn-save");
  btn.textContent = state.saved ? "★ 저장됨" : "☆ 저장";
  btn.classList.toggle("active", state.saved);
}
$("#btn-save").addEventListener("click", async () => {
  if (!state.currentArticle?.url) {
    $("#url-hint").textContent = "";
    return;
  }
  try {
    const res = await fetchJSON("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.currentArticle.url, title: state.currentArticle.title, category: state.currentCategory }),
    });
    state.saved = res.saved;
    updateSaveButton();
  } catch { /* 무시 */ }
});

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// 본문 안 용어를 <span class="term">으로 감싼다. 같은 용어는 기사 전체에서 처음 등장할 때 한 번만.
function highlightTerms(text, terms, usedTerms) {
  const matches = [];
  terms.forEach((t, idx) => {
    if (!t.term || usedTerms.has(t.term)) return;
    const start = text.indexOf(t.term);
    if (start === -1) return;
    matches.push({ start, end: start + t.term.length, term: t.term, idx });
    usedTerms.add(t.term);
  });
  matches.sort((a, b) => a.start - b.start);
  let html = "";
  let cursor = 0;
  matches.forEach((m) => {
    html += escapeHtml(text.slice(cursor, m.start));
    const explain = termExplainFor(m.idx, state.level);
    html += `<span class="term" data-idx="${m.idx}" data-term="${escapeAttr(m.term)}" data-explain="${escapeAttr(explain)}">${escapeHtml(m.term)}</span>`;
    cursor = m.end;
  });
  html += escapeHtml(text.slice(cursor));
  return html;
}
function termExplainFor(idx, level) {
  const t = state.currentAnalysis?.terms?.[idx];
  if (!t) return "";
  if (t.explanations) return t.explanations[level] || t.explanations.intermediate || "";
  return t.explanation || "";
}

// 호버 툴팁 (기존 기능 유지)
const tooltip = $("#tooltip");
document.addEventListener("mouseover", (e) => {
  const term = e.target.closest(".term");
  if (!term) return;
  $("#tooltip-term").textContent = term.dataset.term;
  $("#tooltip-explain").textContent = term.dataset.explain;
  tooltip.hidden = false;
  positionTooltip(e);
});
document.addEventListener("mousemove", (e) => { if (!tooltip.hidden) positionTooltip(e); });
document.addEventListener("mouseout", (e) => { if (e.target.closest(".term") && !e.relatedTarget?.closest(".term")) tooltip.hidden = true; });
function positionTooltip(e) {
  const pad = 16;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + 300 > window.innerWidth) x = e.clientX - 300 - pad;
  if (y + 100 > window.innerHeight) y = e.clientY - 100 - pad;
  tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
}
// 클릭 시 오른쪽 "스마트 통역가" 패널 활성화
document.addEventListener("click", (e) => {
  const term = e.target.closest(".term");
  if (!term) return;
  setActiveTerm(Number(term.dataset.idx));
});

// ---- 스마트 통역가 패널 ----
function renderInterpreterList() {
  const terms = state.currentAnalysis?.terms || [];
  const list = $("#interpreter-list");
  if (!terms.length) { list.innerHTML = ""; return; }
  list.innerHTML = terms
    .map(
      (t, i) => `<div class="interpreter-list-item ${i === state.activeTermIdx ? "active" : ""}" data-idx="${i}">
        <span>${escapeHtml(t.term)}</span>
        ${state.understoodTerms.has(t.term) ? '<span class="chk">✓</span>' : ""}
      </div>`
    )
    .join("");
  list.querySelectorAll(".interpreter-list-item").forEach((el) =>
    el.addEventListener("click", () => setActiveTerm(Number(el.dataset.idx)))
  );
}
function setActiveTerm(idx) {
  const t = state.currentAnalysis?.terms?.[idx];
  if (!t) return;
  state.activeTermIdx = idx;
  state.activeTabLevel = state.level;
  $("#interpreter-empty").hidden = true;
  $("#interpreter-active").hidden = false;
  $("#interpreter-term").textContent = t.term;
  renderInterpreterTabs();
  renderInterpreterExplain();
  renderInterpreterList();
  document.querySelectorAll(".term").forEach((el) => el.classList.toggle("active-term", Number(el.dataset.idx) === idx));
}
function renderInterpreterTabs() {
  document.querySelectorAll("#interpreter-tabs .level-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.level === state.activeTabLevel);
  });
}
document.querySelectorAll("#interpreter-tabs .level-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.activeTabLevel = btn.dataset.level;
    renderInterpreterTabs();
    renderInterpreterExplain();
  });
});
function renderInterpreterExplain() {
  const t = state.currentAnalysis?.terms?.[state.activeTermIdx];
  if (!t) return;
  const text = t.explanations ? t.explanations[state.activeTabLevel] : t.explanation;
  $("#interpreter-explain").textContent = text || "이 난이도의 설명이 아직 없어요.";
  const understood = state.understoodTerms.has(t.term);
  const btn = $("#understood-btn");
  btn.textContent = understood ? "✓ 이해 완료" : "✓ 이해했어요";
  btn.classList.toggle("done", understood);
}
$("#understood-btn").addEventListener("click", async () => {
  const t = state.currentAnalysis?.terms?.[state.activeTermIdx];
  if (!t) return;
  state.understoodTerms.add(t.term);
  renderInterpreterExplain();
  renderInterpreterList();
  try {
    await fetchJSON("/api/term-understood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.currentArticle?.url, term: t.term }),
    });
  } catch { /* 무시 */ }
});

// ==================== 모달 공통 ====================
const modalBackdrop = $("#modal-backdrop");
function openModal(title) { $("#modal-title").textContent = title; $("#modal-body").innerHTML = ""; modalBackdrop.hidden = false; }
$("#modal-close").addEventListener("click", () => (modalBackdrop.hidden = true));
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) modalBackdrop.hidden = true; });

// ==================== 기사 흐름도 ====================
$("#btn-flow").addEventListener("click", () => {
  const flow = state.currentAnalysis?.flow;
  if (!flow || !flow.nodes?.length) {
    openModal("기사 흐름");
    $("#modal-body").innerHTML = `<p>이 기사에서는 뚜렷한 인과 흐름을 찾지 못했어요.</p>`;
    return;
  }
  openModal("기사 속 인과관계 흐름");
  $("#modal-body").innerHTML = renderFlowSVG(flow);
});
function renderFlowSVG(flow) {
  const { nodes, edges } = flow;
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => incoming.set(e.to, (incoming.get(e.to) || 0) + 1));
  const roots = nodes.filter((n) => (incoming.get(n.id) || 0) === 0).map((n) => n.id);
  const level = new Map();
  const queue = roots.length ? [...roots] : [nodes[0].id];
  queue.forEach((id) => level.set(id, 0));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => adj.get(e.from)?.push(e.to));
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    (adj.get(cur) || []).forEach((next) => {
      const nl = (level.get(cur) || 0) + 1;
      if (!level.has(next) || nl > level.get(next)) { level.set(next, nl); queue.push(next); }
    });
  }
  nodes.forEach((n, i) => { if (!level.has(n.id)) level.set(n.id, Math.floor(i / 2)); });
  const byLevel = {};
  nodes.forEach((n) => { const l = level.get(n.id); (byLevel[l] = byLevel[l] || []).push(n); });
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  const colW = 260, rowH = 120, nodeW = 210, nodeH = 76, padX = 30, padY = 30;
  const maxRows = Math.max(...levels.map((l) => byLevel[l].length));
  const width = padX * 2 + levels.length * colW;
  const height = padY * 2 + maxRows * rowH;
  const pos = new Map();
  levels.forEach((l, colIdx) => {
    const rows = byLevel[l];
    rows.forEach((n, rowIdx) => {
      const x = padX + colIdx * colW;
      const y = padY + rowIdx * rowH + (maxRows - rows.length) * rowH / 2;
      pos.set(n.id, { x, y });
    });
  });
  let svg = `<div style="overflow-x:auto;"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#1B2044"/></marker></defs>`;
  edges.forEach((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return;
    const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2, midX = (x1 + x2) / 2;
    svg += `<path d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" fill="none" stroke="#1B2044" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.8"/>`;
  });
  nodes.forEach((n) => {
    const p = pos.get(n.id);
    if (!p) return;
    svg += `<g class="flow-node"><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="4"/>${wrapSvgText(n.label, p.x + nodeW / 2, p.y + nodeH / 2, nodeW - 20)}</g>`;
  });
  svg += `</svg></div>`;
  return svg;
}
function wrapSvgText(text, cx, cy, maxWidth) {
  const chars = String(text).split("");
  const charsPerLine = Math.floor(maxWidth / 17);
  const lines = [];
  let cur = "";
  chars.forEach((ch) => { cur += ch; if (cur.length >= charsPerLine) { lines.push(cur); cur = ""; } });
  if (cur) lines.push(cur);
  const lineH = 20;
  const startY = cy - ((lines.length - 1) * lineH) / 2;
  return lines.map((l, i) => `<text x="${cx}" y="${startY + i * lineH}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(l)}</text>`).join("");
}

// ==================== DART 기업 정보 ====================
async function openDartFor(companyName) {
  openModal(`DART 공시 정보 · ${companyName}`);
  $("#modal-body").innerHTML = `<p class="panel-sub">전자공시시스템에서 불러오는 중… (처음 조회 시 최대 1분 정도 걸릴 수 있어요)</p>`;
  try {
    const data = await fetchJSON(
      "/api/dart",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName }) },
      75000
    );
    if (data.error) throw new Error(data.error);
    if (!data.found) { renderDartNotFound(companyName); return; }
    renderDartModal(data);
  } catch (e) {
    $("#modal-body").innerHTML = `<p>불러오지 못했어요: ${escapeHtml(e.message)}</p>`;
  }
}
function renderDartNotFound(companyName) {
  $("#modal-body").innerHTML = `
    <p>DART에서 "${escapeHtml(companyName)}" 기업 정보를 찾지 못했어요. 정식 명칭으로 다시 시도해보세요.</p>
    <div class="dart-retry">
      <input type="text" id="dart-retry-input" placeholder="예: 삼성전자, SK하이닉스" value="${escapeAttr(companyName)}" />
      <button type="button" class="cta-btn-sm" id="dart-retry-btn">다시 조회</button>
    </div>`;
  $("#dart-retry-btn").addEventListener("click", () => {
    const v = $("#dart-retry-input").value.trim();
    if (v) openDartFor(v);
  });
}
function renderDartModal(data) {
  $("#modal-body").innerHTML = `
    <div class="dart-summary">
      <div class="dart-stat"><div class="k">종목코드</div><div class="v">${data.stockCode || "비상장"}</div></div>
      <div class="dart-stat"><div class="k">기준 사업연도</div><div class="v">${data.reportYear || "-"}</div></div>
    </div>
    <div id="dart-chart"></div>
    <h3 style="font-size:15px; margin-top:28px;">최근 3개월 공시</h3>
    <ul class="disclosure-list" id="dart-disclosures"></ul>
  `;
  const list = $("#dart-disclosures");
  list.innerHTML = data.disclosures?.length
    ? data.disclosures.map((d) => `<li><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.title)}</a><span class="date">${d.date}</span></li>`).join("")
    : `<li class="static">최근 공시 내역이 없어요.</li>`;
  $("#dart-chart").innerHTML = renderDartBarChart(data.chartData, data.reportYear);
}
function renderDartBarChart(chartData, reportYear) {
  const hasAny = chartData.some((c) => c.thisYear != null || c.prevYear != null);
  if (!hasAny) return `<p class="panel-sub">이 기업의 재무제표 수치를 찾지 못했어요.</p>`;
  const fmt = (v) => (v == null ? "-" : (v / 1e8).toFixed(0) + "억");
  const maxVal = Math.max(1, ...chartData.flatMap((c) => [c.thisYear || 0, c.prevYear || 0]));
  const rowH = 64, barH = 20, gap = 6, labelW = 90, chartW = 480;
  const height = chartData.length * rowH + 30;
  let svg = `<svg viewBox="0 0 ${labelW + chartW + 20} ${height}" width="100%" style="max-width:600px" xmlns="http://www.w3.org/2000/svg">`;
  chartData.forEach((c, i) => {
    const y = i * rowH + 10;
    const wThis = maxVal ? ((c.thisYear || 0) / maxVal) * chartW : 0;
    const wPrev = maxVal ? ((c.prevYear || 0) / maxVal) * chartW : 0;
    svg += `<text x="0" y="${y + barH / 2 + 4}" font-size="13" font-weight="600" fill="#1F2430">${escapeHtml(c.label)}</text>`;
    svg += `<rect x="${labelW}" y="${y}" width="${wThis}" height="${barH}" rx="3" fill="#1B2044"/>`;
    svg += `<text x="${labelW + wThis + 8}" y="${y + barH / 2 + 4}" font-size="11" fill="#1B2044">${fmt(c.thisYear)}</text>`;
    const y2 = y + barH + gap;
    svg += `<rect x="${labelW}" y="${y2}" width="${wPrev}" height="${barH}" rx="3" fill="#E8A33D"/>`;
    svg += `<text x="${labelW + wPrev + 8}" y="${y2 + barH / 2 + 4}" font-size="11" fill="#8A5A16">${fmt(c.prevYear)}</text>`;
  });
  svg += `</svg>`;
  return `<div class="dart-chart-legend"><span><i style="background:#1B2044"></i>${reportYear || "당기"}년</span><span><i style="background:#E8A33D"></i>전년</span></div>${svg}`;
}

// ==================== 초기화 ====================
(async function init() {
  if (!state.token) {
    showPage("auth");
    return;
  }
  try {
    const me = await fetchJSON("/api/auth/me");
    if (me.error || !me.user) throw new Error("세션 만료");
    state.user = me.user;
  } catch {
    logout();
    return;
  }
  await afterLogin();
})();
