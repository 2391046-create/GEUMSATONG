import os
import json
import pandas as pd
from dotenv import load_dotenv, find_dotenv
from groq import Groq

# 1. .env 로드 및 Groq 클라이언트 초기화
load_dotenv(find_dotenv())
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    print("❌ 경고: .env 파일에서 GROQ_API_KEY를 찾을 수 없습니다.")
    exit()
else:
    print("✅ Groq API 키 로드 성공!")

client = Groq(api_key=GROQ_API_KEY)

# 2. Llama 3.3 70B 기반 감성 분석 함수
def analyze_news_sentiment(headline_text):
    """
    뉴스 헤드라인/본문을 입력받아 -1.0 ~ +1.0 사이의 감성 점수를 반환합니다.
    """
    prompt = f"""
    당신은 금융 리스크 분석 전문가입니다. 
    아래 기업 뉴스 기사를 분석하여 재무 및 경영 리스크 관점에서의 감성 점수를 -1.0 ~ +1.0 사이로 평가하세요.

    [평가 기준]
    - -1.0 ~ -0.5: 심각한 리스크 (횡령, 부도, 적자 전환, 법적 분쟁, 실적 쇼크)
    - -0.4 ~ +0.4: 중립 또는 단순 정보 (일상적인 경영 공시, 일반 동향)
    - +0.5 ~ +1.0: 긍정적 호재 (대규모 수주, 어닝 서프라이즈, 신기술 개발, 신시장에서의 호조)

    [출력 형식]
    반드시 순수한 JSON 형식으로만 응답하세요. 예시:
    {{"score": -0.8, "reason": "영업손실 증가 및 적자 폭 확대"}}

    분석할 뉴스: "{headline_text}"
    """

    try:
        response = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            response_format={"type": "json_object"},
            temperature=0.1
        )
        
        result = json.loads(response.choices[0].message.content)
        return result.get("score", 0.0), result.get("reason", "분석 완료")
        
    except Exception as e:
        print(f"API 분석 에러: {e}")
        return 0.0, "에러 발생"

# 3. 테스트 실행 (샘플 뉴스 데이터)
if __name__ == "__main__":
    sample_news = [
        {"corp": "SK하이닉스", "year": 2022, "quarter": "1Q", "headline": "SK하이닉스, 1분기 영업이익 전년비 116% 증가… 어닝 서프라이즈"},
        {"corp": "SK하이닉스", "year": 2022, "quarter": "4Q", "headline": "반도체 한파에 SK하이닉스 10년 만에 분기 적자 전환… 1.7조 손실"},
        {"corp": "현대자동차", "year": 2023, "quarter": "2Q", "headline": "현대차, 북미 전기차 판매 호조로 역대 최대 실적 경신"}
    ]
    
    print("\n" + "="*50)
    print("🤖 Groq (Llama 3.3 70B) 뉴스 감성 분석 테스트 진행 중...")
    print("="*50)
    
    results = []
    for item in sample_news:
        score, reason = analyze_news_sentiment(item["headline"])
        print(f"\n기업: {item['corp']} ({item['year']} {item['quarter']})")
        print(f"뉴스: {item['headline']}")
        print(f"👉 감성 점수: {score}점 | 사유: {reason}")
        
        item["sentiment_score"] = score
        item["reason"] = reason
        results.append(item)
        
    # 데이터프레임 변환 및 확인
    df_news = pd.DataFrame(results)
    df_news.to_csv("news_sentiment_sample.csv", index=False, encoding="utf-8-sig")
    print("\n✅ 뉴스 감성 분석 결과 저장 완료 (`news_sentiment_sample.csv`)")