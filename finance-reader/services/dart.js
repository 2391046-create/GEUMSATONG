const axios = require("axios");
const AdmZip = require("adm-zip");
const xml2js = require("xml2js");
const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "..", "data", "corpCode.json");
let memCache = null;

// DART Open API 공통 상태 코드 (https://opendart.fss.or.kr/guide/main.do?apiGrpCd=DS001)
const DART_STATUS_MSG = {
  "000": "정상",
  "010": "등록되지 않은 키입니다. (키를 다시 확인해주세요)",
  "011": "사용할 수 없는 키입니다. (일시 정지, 폐기 등)",
  "012": "접근할 수 없는 IP입니다.",
  "013": "조회된 데이터가 없습니다.",
  "014": "파일이 존재하지 않습니다.",
  "020": "요청 제한을 초과하였습니다. (일일 한도 등)",
  "021": "조회 가능한 회사 개수가 초과하였습니다.",
  "100": "필드의 부적절한 값입니다.",
  "101": "부적절한 접근입니다.",
  "800": "시스템 점검 중입니다.",
  "900": "정의되지 않은 오류가 발생하였습니다.",
  "901": "사용자 계정의 개인정보 보유기간이 만료되어 사용할 수 없는 키입니다.",
};

function key() {
  const k = process.env.DART_API_KEY;
  if (!k || !k.trim()) {
    throw new Error("DART_API_KEY가 .env 에 설정되어 있지 않습니다.");
  }
  // .env에 키를 복사하면서 앞뒤 공백/줄바꿈이 섞여 들어가는 경우가 흔해서 항상 trim한다.
  return k.trim();
}

function explainStatus(status) {
  return DART_STATUS_MSG[status] || `알 수 없는 상태 코드(${status})`;
}

// DART는 전체 상장/비상장 기업의 고유번호(corp_code) 목록을 zip(xml)로만 제공한다.
// 최초 1회 다운로드해서 로컬(data/corpCode.json)에 캐싱해두고 재사용한다.
async function loadCorpCodeList() {
  if (memCache) return memCache;
  if (fs.existsSync(CACHE_PATH)) {
    memCache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    return memCache;
  }

  let res;
  try {
    res = await axios.get("https://opendart.fss.or.kr/api/corpCode.xml", {
      params: { crtfc_key: key() },
      responseType: "arraybuffer",
      timeout: 60000, // 최초 1회는 전체 기업 목록(수십MB)을 받아오므로 여유있게 잡는다
    });
  } catch (e) {
    const detail = e.response?.data
      ? Buffer.from(e.response.data).toString("utf-8").slice(0, 300)
      : e.message;
    console.error("[dart.js] corpCode 다운로드 실패:", detail);
    throw new Error(`DART corpCode 목록을 받아오지 못했습니다: ${detail}`);
  }

  let zip;
  try {
    zip = new AdmZip(res.data);
  } catch (e) {
    // 키 오류 등으로 zip 대신 XML/JSON 에러 메시지가 올 때가 있다
    const asText = Buffer.from(res.data).toString("utf-8").slice(0, 300);
    console.error("[dart.js] corpCode 압축 해제 실패, 응답 원문:", asText);
    throw new Error(
      `DART API 키가 올바르지 않거나 아직 승인 대기 중일 수 있습니다: ${asText}`
    );
  }

  const xmlEntry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".xml"));
  if (!xmlEntry) throw new Error("DART corpCode.xml 압축 해제에 실패했습니다.");

  const xml = zip.readAsText(xmlEntry);
  const parsed = await xml2js.parseStringPromise(xml);
  const list = (parsed.result.list || []).map((item) => ({
    corp_code: item.corp_code?.[0],
    corp_name: item.corp_name?.[0],
    stock_code: (item.stock_code?.[0] || "").trim(),
  }));

  if (!list.length) throw new Error("DART corpCode 목록이 비어있습니다.");

  fs.writeFileSync(CACHE_PATH, JSON.stringify(list));
  memCache = list;
  console.log(`[dart.js] corpCode ${list.length}건 캐싱 완료 (data/corpCode.json)`);
  return list;
}

function normalizeName(s) {
  return String(s || "")
    .replace(/\(주\)|주식회사|㈜/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// 기사에서 뽑아낸 회사명으로 corp_code를 찾는다 (완전일치 -> 부분일치 순, 공백/괄호 등은 무시)
async function findCompany(name) {
  const list = await loadCorpCodeList();
  const target = normalizeName(name);
  if (!target) return null;

  let hit = list.find((c) => normalizeName(c.corp_name) === target);
  if (!hit) {
    // 상장사(stock_code 존재)를 우선해서 양방향 부분일치 검색
    const candidates = list
      .filter((c) => {
        const n = normalizeName(c.corp_name);
        return n.includes(target) || target.includes(n);
      })
      .sort((a, b) => (b.stock_code ? 1 : 0) - (a.stock_code ? 1 : 0));
    hit = candidates[0];
  }
  return hit || null;
}

// 최근 사업연도 단일회사 주요계정(매출액/영업이익/당기순이익 등) 조회.
// 사업보고서(연간)가 아직 안 나왔을 수 있으니 반기/분기 보고서까지 순서대로 시도한다.
async function getFinancials(corpCode) {
  const now = new Date().getFullYear();
  const REPRT_CODES = ["11011", "11012", "11014", "11013"]; // 사업보고서, 반기, 3분기, 1분기
  let lastStatus = null;

  for (const year of [now, now - 1, now - 2, now - 3]) {
    for (const reprt_code of REPRT_CODES) {
      try {
        const res = await axios.get(
          "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json",
          {
            params: { crtfc_key: key(), corp_code: corpCode, bsns_year: year, reprt_code },
            timeout: 15000,
          }
        );
        lastStatus = res.data.status;
        if (res.data.status === "000" && res.data.list?.length) {
          return { year, accounts: res.data.list };
        }
      } catch (e) {
        console.error(`[dart.js] 재무제표 조회 실패 (${year}/${reprt_code}):`, e.message);
      }
    }
  }
  if (lastStatus && lastStatus !== "013") {
    console.error(`[dart.js] 재무제표를 찾지 못함, 마지막 상태코드: ${lastStatus} (${explainStatus(lastStatus)})`);
  }
  return { year: null, accounts: [] };
}

// 최근 공시 목록 (최근 3개월, 최대 10건). 실패해도 기업 정보 자체는 보여줘야 하므로
// 여기서 나는 에러는 절대 위로 던지지 않고 빈 배열로 처리한다.
async function getRecentDisclosures(corpCode) {
  try {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

    const res = await axios.get("https://opendart.fss.or.kr/api/list.json", {
      params: {
        crtfc_key: key(),
        corp_code: corpCode,
        bgn_de: fmt(start),
        end_de: fmt(end),
        page_count: 10,
      },
      timeout: 15000,
    });
    if (res.data.status !== "000") {
      if (res.data.status !== "013") {
        console.error(`[dart.js] 공시 목록 조회 실패: ${res.data.status} (${explainStatus(res.data.status)})`);
      }
      return [];
    }
    return (res.data.list || []).map((d) => ({
      title: d.report_nm,
      date: d.rcept_dt,
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`,
    }));
  } catch (e) {
    console.error("[dart.js] 공시 목록 조회 중 예외:", e.message);
    return [];
  }
}

async function getCompanyReport(companyName) {
  const company = await findCompany(companyName);
  if (!company) return { found: false, companyName };

  const [financials, disclosures] = await Promise.all([
    getFinancials(company.corp_code),
    getRecentDisclosures(company.corp_code),
  ]);

  // 핵심 계정만 추려서 프론트에서 그래프로 그리기 쉽게 정리
  const KEY_ACCOUNTS = ["매출액", "영업이익", "당기순이익"];
  const chartData = KEY_ACCOUNTS.map((label) => {
    const row =
      financials.accounts.find((a) => a.account_nm === label && a.fs_div === "CFS") ||
      financials.accounts.find((a) => a.account_nm === label);
    return {
      label,
      thisYear: row ? Number(row.thstrm_amount?.replace(/,/g, "") || 0) : null,
      prevYear: row ? Number(row.frmtrm_amount?.replace(/,/g, "") || 0) : null,
    };
  });

  return {
    found: true,
    companyName: company.corp_name,
    stockCode: company.stock_code || null,
    reportYear: financials.year,
    chartData,
    disclosures,
  };
}

module.exports = { getCompanyReport, findCompany, loadCorpCodeList };
