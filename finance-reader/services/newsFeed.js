const axios = require("axios");
const cheerio = require("cheerio");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// 네이버 뉴스 통합검색 결과를 스크레이핑해서 (제목/링크/썸네일/언론사) 배열로 반환한다.
// 참고: 네이버가 마크업(class명)을 바꾸면 셀렉터를 손봐야 할 수 있다. 여러 후보 셀렉터를 순서대로 시도하고,
// 하나도 안 맞으면 빈 배열을 반환해 호출부에서 안전하게 폴백 처리하도록 한다.
async function searchNaverNews(query, limit = 5, { recent = false } = {}) {
  const params = new URLSearchParams({ where: "news", query });
  if (recent) params.set("sort", "1"); // 1 = 최신순
  const url = `https://search.naver.com/search.naver?${params.toString()}`;

  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://search.naver.com/",
    },
    timeout: 8000,
  });
  const $ = cheerio.load(html);

  const CARD_SELECTORS = ["div.news_wrap", "li.bx", "div.group_news .bx"];
  let $cards = $();
  for (const sel of CARD_SELECTORS) {
    $cards = $(sel);
    if ($cards.length) break;
  }

  const items = [];
  $cards.each((_, el) => {
    if (items.length >= limit) return;
    const $el = $(el);

    const titleEl = $el.find("a.news_tit").first();
    const title = (titleEl.attr("title") || titleEl.text() || "").trim();
    const link = titleEl.attr("href");
    if (!title || !link) return;

    const press =
      $el.find(".info.press").first().text().trim() ||
      $el.find("a.info.press").first().text().trim() ||
      "";

    let thumb =
      $el.find("img.thumb").first().attr("src") ||
      $el.find("a.dsc_thumb img").first().attr("src") ||
      null;
    if (!thumb) {
      const anyImg = $el.find("img").first();
      thumb = anyImg.attr("data-lazy-src") || anyImg.attr("data-src") || anyImg.attr("src") || null;
    }
    if (thumb && thumb.startsWith("//")) thumb = "https:" + thumb;

    items.push({ title, url: link, press, thumbnail: thumb });
  });

  return items;
}

module.exports = { searchNaverNews };
