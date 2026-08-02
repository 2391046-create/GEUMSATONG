require("dotenv").config();
const { searchNaverNews } = require("./services/newsFeed");

(async () => {
  const results = await searchNaverNews("부동산", 5);
  console.log(JSON.stringify(results, null, 2));
})();