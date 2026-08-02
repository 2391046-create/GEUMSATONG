const axios = require("axios");
const cheerio = require("cheerio"); // 실제 기사 페이지에서 og:image 추출용
const xml2js = require("xml2js"); // 구글 RSS(XML) 파싱용. 없으면 터미널에서: npm install xml2js

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/**
 * 1차: 네이버 뉴스 검색 API (공식, NAVER Cloud Platform의 NAVER API HUB 경유)
 * 2026년부터 기존 개발자센터(openapi.naver.com) 방식이 NCP API HUB로 이관되었으므로
 * 이 엔드포인트/헤더 형식을 사용한다. https://www.ncloud.com 콘솔에서 API 키 발급 필요.
 * 하루 호출 한도 25,000회. HTML을 파싱하지 않고 JSON을 바로 받으므로
 * 네이버가 웹페이지 마크업을 바꿔도 영향받지 않는다.
 */
async function searchNaverNewsAPI(query, limit = 5, { recent = false } = {}) {
  const keyId = process.env.NAVER_API_KEY_ID;
  const key = process.env.NAVER_API_KEY;

  if (!keyId || !key) {
    console.warn("[newsFeed.js] NAVER_API_KEY_ID/NAVER_API_KEY가 .env에 없어 네이버 API를 건너뜁니다.");
    return [];
  }

  const params = new URLSearchParams({
    query,
    display: String(limit),
    start: "1",
    sort: recent ? "date" : "sim", // sim = 정확도순, date = 최신순
  });

  const url = `https://naverapihub.apigw.ntruss.com/search/v1/news?${params.toString()}`;

  try {
    const { data } = await axios.get(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": keyId,
        "X-NCP-APIGW-API-KEY": key,
      },
      timeout: 8000,
    });

    // 네이버 API는 title/description에 <b> 태그와 &quot; 같은 HTML 엔티티를 섞어서 반환하므로 정리한다.
    const stripHtml = (s = "") =>
      s
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();

    return (data.items || []).map((item) => ({
      title: stripHtml(item.title),
      url: item.originallink || item.link,
      press: "", // 네이버 뉴스 검색 API 응답에는 언론사명이 별도 필드로 없음
      thumbnail: null, // 이 API는 썸네일을 제공하지 않음
      description: stripHtml(item.description),
      pubDate: item.pubDate,
    }));
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[newsFeed.js] 네이버 뉴스 API 호출 실패:", detail);
    return [];
  }
}

/**
 * 2차 폴백: 구글 뉴스 RSS
 * 인증/등록이 필요 없고, RSS는 표준 XML 포맷이라 구조 변경 위험이 낮다.
 * 네이버 API 키가 없거나, 네이버 API가 실패하거나, 결과가 0건일 때 사용.
 */
async function searchGoogleNewsRSS(query, limit = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const { data: xml } = await axios.get(url, {
      headers: { "User-Agent": UA },
      timeout: 8000,
    });

    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const rawItems = parsed?.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    return items.slice(0, limit).map((item) => ({
      title: (item.title || "").trim(),
      url: item.link,
      press: item.source?._ || "",
      thumbnail: null,
      description: "",
      pubDate: item.pubDate,
    }));
  } catch (e) {
    console.error("[newsFeed.js] 구글 뉴스 RSS 호출 실패:", e.message);
    return [];
  }
}

/**
 * 기사 원문 페이지에 접속해서 og:image (소셜 공유용 대표 이미지) 메타태그를 가져온다.
 * 네이버/구글 검색 API 모두 썸네일을 제공하지 않으므로, 각 기사 링크에서 직접 가져오는 방식.
 * og:image는 대부분의 언론사가 소셜 공유를 위해 표준적으로 제공하는 태그라 비교적 안정적이다.
 * 실패하거나 타임아웃(4초)이 나면 조용히 null을 반환 — 리스트 전체가 느려지거나 깨지지 않도록.
 */
async function fetchOgImage(url) {
  try {
    const { data: html } = await axios.get(url, {
      headers: { "User-Agent": UA },
      timeout: 4000,
      maxContentLength: 2_000_000, // 이미지 태그는 보통 <head>에 있으므로 전체를 다 받을 필요 없음
    });
    const $ = cheerio.load(html);
    let img =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      null;
    if (img && img.startsWith("//")) img = "https:" + img;
    return img || null;
  } catch {
    return null; // 접속 실패/타임아웃/차단 등 어떤 이유든 그냥 이미지 없음으로 처리
  }
}

/**
 * 기사 목록 각각에 대해 og:image를 병렬로 조회해서 thumbnail 필드를 채운다.
 * 개별 기사 조회가 실패해도 다른 기사에 영향 없음. 전체 대기 시간은 가장 느린 1건 기준(최대 4초).
 */
async function enrichThumbnails(items) {
  const withThumbs = await Promise.all(
    items.map(async (item) => ({ ...item, thumbnail: await fetchOgImage(item.url) }))
  );
  return withThumbs;
}

/**
 * 외부에서 호출하는 메인 함수.
 * 1) 네이버 API 시도 → 결과 있으면 사용, 없으면 구글 RSS로 폴백
 * 2) 확보된 기사 목록에 대해 원문 페이지의 og:image로 썸네일 보강
 */
async function searchNaverNews(query, limit = 5, opts = {}) {
  let results = await searchNaverNewsAPI(query, limit, opts);
  if (results.length === 0) {
    console.warn(`[newsFeed.js] 네이버 API 결과 0건 → 구글 RSS로 폴백 (query: ${query})`);
    results = await searchGoogleNewsRSS(query, limit);
  }
  return enrichThumbnails(results);
}

module.exports = { searchNaverNews, searchNaverNewsAPI, searchGoogleNewsRSS, fetchOgImage };