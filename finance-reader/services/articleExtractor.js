const axios = require("axios");
const cheerio = require("cheerio");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

// Readability(브라우저 '읽기 모드'와 같은 범용 추출 알고리즘)로 1차 시도하고,
// 실패하거나 내용이 부족하면 사이트별 셀렉터로 폴백한다.
const CONTENT_SELECTORS = [
  "article",
  "#dic_area", // 네이버 뉴스
  "#articleBodyContents",
  ".article_body",
  ".news_end",
  ".article-body",
  ".art_txt",
  "#article-view-content-div",
  "main",
  "#content",
];

const BYLINE_SELECTORS = [
  ".media_end_head_journalist_name",
  ".byline",
  ".author",
  ".reporter",
  ".journalist",
  'span[class*="author"]',
];

const DATE_SELECTORS = [
  ".media_end_head_info_datestamp_time",
  "time",
  ".date",
  ".datestamp",
  'span[class*="date"]',
];

function firstMeta($, selectors) {
  for (const sel of selectors) {
    const val = $(sel).attr("content");
    if (val) return val.trim();
  }
  return null;
}

function firstText($, selectors, maxLen = 60) {
  for (const sel of selectors) {
    const t = $(sel).first().text().trim();
    if (t && t.length <= maxLen) return t;
  }
  return null;
}

function extractParagraphs($, container) {
  const pTags = container.find("p");
  if (pTags.length >= 2) {
    return pTags.map((_, p) => $(p).text().trim()).get().filter(Boolean);
  }
  let html = container.html() || "";
  html = html.replace(/<br\s*\/?>/gi, "\n");
  const plain = cheerio.load(`<div>${html}</div>`)("div").text();
  return plain.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

async function fetchHtml(url) {
  const { data: html } = await axios.get(url, {
    timeout: 10000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  return html;
}

async function extractArticle(url) {
  const html = await fetchHtml(url);
  const $meta = cheerio.load(html);

  let title = $meta('meta[property="og:title"]').attr("content") || $meta("title").first().text() || "";
  let mainImage = firstMeta($meta, ['meta[property="og:image"]']);
  let publishedAt =
    firstMeta($meta, ['meta[property="article:published_time"]', 'meta[name="article:published_time"]']) ||
    firstText($meta, DATE_SELECTORS, 40);
  let byline = firstText($meta, BYLINE_SELECTORS, 40);
  let paragraphs = [];

  // 1차: Readability로 범용 본문 추출 시도
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    if (parsed?.textContent && parsed.textContent.trim().length > 200) {
      if (parsed.title) title = parsed.title;
      if (parsed.byline) byline = parsed.byline;
      const $content = cheerio.load(parsed.content || "");
      paragraphs = $content("p").map((_, p) => $content(p).text().trim()).get().filter(Boolean);
      if (!paragraphs.length) {
        paragraphs = parsed.textContent.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      }
    }
  } catch (e) {
    console.error("[articleExtractor] Readability 추출 실패, 수동 셀렉터로 폴백:", e.message);
  }

  // 2차: Readability가 실패했거나 내용이 부족하면 사이트별 셀렉터로 폴백
  if (!paragraphs.length) {
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, iframe, noscript, aside").remove();
    for (const sel of CONTENT_SELECTORS) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 200) {
        paragraphs = extractParagraphs($, el);
        break;
      }
    }
    if (!paragraphs.length) {
      paragraphs = $("p").map((_, p) => $(p).text().trim()).get().filter(Boolean);
    }
  }

  const text = paragraphs.join("\n\n").trim();
  if (!text || text.length < 100) {
    throw new Error(
      "본문을 추출하지 못했습니다. 로그인/유료 구독이 필요한 기사이거나, 이 사이트 구조를 지원하지 않을 수 있어요."
    );
  }

  return { title: title.trim(), byline, publishedAt, mainImage, paragraphs, text, url };
}

// URL 없이 사용자가 직접 붙여넣은 기사 본문으로 같은 구조의 article 객체를 만든다.
function buildArticleFromText(rawText) {
  const paragraphs = rawText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const text = paragraphs.join("\n\n").trim();
  if (!text || text.length < 30) {
    throw new Error("붙여넣은 본문이 너무 짧아요. 기사 내용을 좀 더 붙여넣어 주세요.");
  }
  const firstLine = paragraphs[0] || "";
  const title = firstLine.length <= 60 ? firstLine : "붙여넣은 기사";
  return { title, byline: null, publishedAt: null, mainImage: null, paragraphs, text, url: null };
}

module.exports = { extractArticle, buildArticleFromText };
