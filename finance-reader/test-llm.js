// test-llm.js
require("dotenv").config(); // .env에서 GROQ_API_KEY 읽기
const { recommendTopics } = require("./services/llm");

(async () => {
  const fakeHistory = []; // 신규 가입자 상황 재현
  const fakeInterests = ["부동산", "금리·대출"]; // 실제 온보딩에서 고른 값과 동일하게

  console.log("=== 사용 모델:", process.env.GROQ_MODEL || "llama-3.3-70b-versatile", "===");
  const result = await recommendTopics(fakeHistory, "beginner", fakeInterests);
  console.log(JSON.stringify(result, null, 2));
})();