// DART 연동이 잘 되는지 브라우저 없이 터미널에서 바로 확인하는 진단 스크립트.
// 사용법: cd finance-reader && node scripts/test-dart.js 삼성전자
require("dotenv").config();
const { getCompanyReport } = require("../services/dart");

const companyName = process.argv[2] || "삼성전자";

(async () => {
  console.log(`\n[1/1] "${companyName}" DART 조회 시작...`);
  console.log(`DART_API_KEY 설정 여부: ${process.env.DART_API_KEY ? "있음 (길이 " + process.env.DART_API_KEY.trim().length + ")" : "❌ 없음"}\n`);

  try {
    const result = await getCompanyReport(companyName);
    console.log("결과:");
    console.log(JSON.stringify(result, null, 2));
    if (result.found) {
      console.log("\n✅ 성공: DART 조회가 정상 동작합니다. 앱에서도 정상적으로 나와야 해요.");
    } else {
      console.log("\n⚠️  회사를 찾지 못했습니다. corpCode 목록 다운로드/캐싱 자체는 됐다는 뜻이니,");
      console.log("   회사명을 다르게 입력해 다시 시도해보세요 (예: 정식 명칭, 또는 다른 계열사명).");
    }
  } catch (e) {
    console.error("\n❌ 실패:", e.message);
    console.error("\n위 에러 메시지가 원인이에요. 대표적인 경우:");
    console.error("  - DART_API_KEY가 .env 에 없음 -> .env 파일에 DART_API_KEY=발급받은키 추가");
    console.error("  - '등록되지 않은 키' -> opendart.fss.or.kr에서 키를 다시 확인/재발급");
    console.error("  - 타임아웃/네트워크 에러 -> 인터넷 연결 또는 방화벽 확인");
  }
  process.exit(0);
})();
