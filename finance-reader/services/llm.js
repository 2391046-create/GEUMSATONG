const axios = require("axios");
const { CATEGORIES } = require("./categories");

// Groq는 무료 가입만으로 사용 가능한 OpenAI 호환 API입니다. (https://console.groq.com)
// 신용카드 등록 없이 API 키 발급 가능, 분당/일일 요청 한도 내에서 완전 무료.
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const BASE_URL = "https://api.groq.com/openai/v1";

function client() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY가 .env 에 설정되어 있지 않습니다. https://console.groq.com 에서 무료로 발급받으세요.");
  }
  return axios.create({
    baseURL: BASE_URL,
    timeout: 45000, // 45초 안에 응답 없으면 타임아웃 에러로 실패 처리 (3단계 설명이라 응답이 길어져 여유를 둠)
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
  });
}

// system 프롬프트만 다르게 주고 JSON 객체만 반환하도록 강제한 뒤 파싱
async function askForJson(system, userText, maxTokens = 2000) {
  let res;
  try {
    res = await client().post("/chat/completions", {
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.3,
      response_format: { type: "json_object" }, // Groq의 JSON 모드로 파싱 실패 확률을 낮춘다
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    });
  } catch (e) {
    // Groq API가 에러 응답을 준 경우 실제 이유를 터미널에 그대로 찍는다
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[llm.js] Groq API 호출 실패:", detail);
    throw new Error(`Groq API 호출 실패: ${detail}`);
  }

  const text = res.data.choices?.[0]?.message?.content?.trim() || "";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 모델이 JSON 앞뒤에 잡담을 붙였을 경우 첫 { 부터 마지막 } 까지만 추출
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    console.error("[llm.js] JSON 파싱 실패, 원문:", text.slice(0, 500));
    throw new Error("모델 응답을 JSON으로 해석하지 못했습니다.");
  }
}

const LEVEL_CONFIG = {
  beginner: {
    desc: "금융 지식이 거의 없는 완전 초보자. 전문 용어를 절대 쓰지 않고 일상적인 비유로 아주 쉽게 설명해야 함.",
    termGuide: `초급 독자는 아무 배경지식이 없다고 가정한다. 기사에 등장하는 금융/경제 용어는 아무리 기본적인 것(예: 금리, 주식, 배당, ETF, 환율, 코스피, 레버리지, 예탁금)이라도 전부 용어 설명 대상에 포함시켜라. 목표 개수: 8~14개.`,
    exampleExplanationStyle: "일상적인 비유(예: '적금 통장', '마트에서 물건 사고파는 것')를 반드시 넣어서 설명. 숫자나 %는 그 의미를 풀어서 설명.",
  },
  intermediate: {
    desc: "기본적인 경제/금융 상식은 있는 일반인. 핵심 개념은 알지만 심화 용어는 낯설어함.",
    termGuide: `중급 독자는 '주식/금리/환율/은행/펀드'처럼 뉴스에서 흔히 접하는 아주 기초적인 단어의 뜻은 이미 안다고 가정하고, 그런 단어는 용어 설명 대상에서 제외하라. 대신 한 단계 더 들어간 용어(예: 공매도, 배당수익률, PER/PBR, 유상증자, 콜옵션, ETF 레버리지 배율, 운용배수, 추적오차, 괴리율, 예탁금 제도)를 골라 설명하라. 목표 개수: 5~9개.`,
    exampleExplanationStyle: "정의 + 이 기사 맥락에서 왜 중요한지를 함께 설명. 비유는 필요할 때만.",
  },
  advanced: {
    desc: "금융업 종사자 수준. '이게 무엇인지'에 대한 정의보다는 해당 기사 맥락에서의 함의, 수치 해석, 시장 영향을 중심으로 간결하게 설명.",
    termGuide: `고급 독자도 ETF, 레버리지, 인버스, 공매도, PER, PBR, 코스피/코스닥, 기준금리, 선물/옵션이 "무엇인지"에 대한 기본 정의는 이미 알고 있다고 간주하고, 이런 개념 자체의 뜻풀이는 절대 포함하지 마라.
단, 다음에 해당하는 용어는 반드시 포함해라 (정의가 아니라 "이 맥락에서 왜 의미있는지" 중심으로 설명):
  (1) 운용배수, 추적오차, 괴리율, NAV, 유동성공급자(LP), 예탁금 규정처럼 구체적인 수치·비율·운영 규정에 관한 전문 용어 — 상품이 뭔지는 알아도 세부 수치/규정 변경의 의미는 전문가도 헷갈릴 수 있다.
  (2) 특정 법률/제도/회계기준의 정식 명칭(예: K-IFRS 17, 사업재편계획 승인 등)
  (3) 흔치 않은 파생상품·구조화상품 명칭
  (4) 기사 속 특정 수치·비율 변경이 시장이나 해당 상품/기업에 갖는 함의 해석이 필요한 경우
목표 개수: 3~8개.`,
    exampleExplanationStyle: "정의는 생략하고, 이 수치/제도 변경이 시장이나 투자자에게 갖는 실질적 함의를 1~2문장으로.",
  },
};

const LEVEL_DESC = Object.fromEntries(
  Object.entries(LEVEL_CONFIG).map(([k, v]) => [k, v.desc])
);

/**
 * 기사 본문을 분석해서
 *  1) 금융 용어 + 난이도별 설명
 *  2) 기사 속 인과관계 흐름도(노드/엣지)
 *  3) 기사에 언급된 회사명(DART 조회용)
 * 를 한번에 반환한다.
 */
async function analyzeArticle(articleText, level) {
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG.intermediate;
  const categoryList = CATEGORIES.join(" | ");
  const system = `너는 금융 기사를 독자 수준에 맞게 풀어주는 에디터야.
반드시 아래 JSON 스키마와 정확히 일치하는 JSON 객체 "하나만" 출력해. 설명, 마크다운 코드블록, 다른 텍스트는 절대 포함하지 마.
[중요] 아래 스키마의 필드 순서 그대로 출력해라 (companies, flow를 먼저, 용량이 큰 terms를 마지막에 — 응답이 길어져도 companies/flow가 잘리지 않도록).

{
  "category": "이 기사의 주제로 가장 가까운 것 하나: ${categoryList}",
  "companies": ["기사에 언급된 실제 기업명(정식 명칭에 가깝게, 없으면 빈 배열)"],
  "flow": {
    "nodes": [ { "id": "n1", "label": "짧은 사건/원인 요약(15자 내외)" } ],
    "edges": [ { "from": "n1", "to": "n2" } ]
  },
  "terms": [
    {
      "term": "기사 본문에 실제로 등장하는 정확한 표현",
      "explanations": {
        "beginner": "완전 초보자용 설명 (비유 포함, 2~3문장)",
        "intermediate": "일반인용 설명 (정의+맥락, 2~3문장)",
        "advanced": "업계 종사자용 설명 (정의 생략, 함의 중심, 1~2문장)"
      }
    }
  ]
}

지금 이 기사를 보여줄 독자 수준: ${cfg.desc}

[매우 중요] terms에 "어떤 용어를 포함시킬지"는 반드시 아래 기준(현재 독자 수준 기준)을 따라라 — explanations 3단계를 모두 채우더라도, 애초에 리스트에 넣을지 말지는 이 기준으로 정한다:
${cfg.termGuide}

[매우 중요] explanations는 하나를 고르는 게 아니라 beginner/intermediate/advanced 세 가지를 전부 채워야 한다. 각 설명 스타일:
- beginner: 일상적인 비유(예: '적금 통장', '마트에서 물건 사고파는 것')를 반드시 넣어서 아주 쉽게.
- intermediate: 정의 + 이 기사 맥락에서 왜 중요한지.
- advanced: 정의는 생략하고 수치/제도 변경이 시장·투자자에게 갖는 실질적 함의 중심.

그 외 규칙:
- companies: 상장/비상장 여부 상관없이 실명이 언급된 기업만. 없으면 [].
- flow: 기사에서 서술된 원인→결과 흐름을 3~7개 노드로 요약해. 실제로 기사에 인과관계가 드러날 때만 의미있게 구성하고, 단순 나열이면 시간순으로라도 구성해.
- terms: 본문에 실제로 등장하는 표현만 사용하고, 본문에 없는 단어를 지어내지 마라.`;

  return askForJson(system, articleText.slice(0, 10000), 6500);
}

/**
 * 최근 읽은 기사 제목/키워드 목록을 바탕으로 추천 기사를 생성.
 * (실시간 검색 기반이 아니라, 관심사 패턴을 분석해 '어떤 주제를 더 읽으면 좋을지' 추천)
 */
async function recommendTopics(history, level, interests = []) {
  const levelDesc = LEVEL_DESC[level] || LEVEL_DESC.intermediate;
  const categoryList = CATEGORIES.join(" | ");
  const system = `너는 사용자의 최근 금융 기사 열람 이력을 분석해서 다음에 읽으면 좋을 주제를 추천하는 어시스턴트야.
반드시 아래 JSON 스키마와 정확히 일치하는 JSON 객체 하나만 출력해.

{
  "pattern_summary": "최근 관심사 패턴을 1~2문장으로 요약",
  "recommendations": [
    {
      "title": "추천 기사/주제 제목",
      "reason": "왜 이 사용자에게 추천하는지 1문장",
      "search_query": "포털 뉴스 검색에 쓸 키워드",
      "category": "다음 중 정확히 하나: ${categoryList}"
    }
  ]
}
- 독자 수준: ${levelDesc}
- recommendations는 4~6개. 그 중 하나는 오늘 가장 추천하고 싶은 대표 주제가 되도록 배열의 첫번째에 둬.
- history가 비어 있으면${interests.length ? ` 사용자가 고른 관심분야(${interests.join(", ")})를 우선 반영해서` : " 초심자가 보기 좋은 기본 금융 주제로"} 채워.
- category는 반드시 위 목록 중 하나와 정확히 같은 문자열로.`;

  const userText = `최근 열람 이력(JSON): ${JSON.stringify(history).slice(0, 3000)}\n관심분야: ${JSON.stringify(interests)}`;
  return askForJson(system, userText, 1200);
}

module.exports = { analyzeArticle, recommendTopics };
