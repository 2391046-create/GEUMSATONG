// test-search-debug.js
const axios = require("axios");
const fs = require("fs");

(async () => {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
  const url = "https://search.naver.com/search.naver?where=news&query=부동산";
  
  try {
    const { data: html, status } = await axios.get(url, {
      headers: { "User-Agent": UA, Referer: "https://search.naver.com/" },
      timeout: 8000,
    });
    console.log("HTTP 상태코드:", status);
    fs.writeFileSync("naver-debug.html", html);
    console.log("HTML 저장 완료 → naver-debug.html 파일을 열어서 news_wrap, bx 클래스가 있는지 확인하세요");
  } catch (e) {
    console.error("요청 자체 실패:", e.response?.status, e.message);
  }
})();