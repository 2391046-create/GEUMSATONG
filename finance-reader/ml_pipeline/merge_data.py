import os
import time
import pandas as pd
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# Groq API 클라이언트 초기화
groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("❌ GROQ_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.")

client = Groq(api_key=groq_api_key)

def analyze_news_sentiment(corp_name):
    """
    Groq API(Llama 3.3 70B)를 호출하여 특정 기업의 최근 뉴스 감성 점수(-1.0 ~ 1.0)를 산출하는 함수
    """
    prompt = f"""
    너는 금융 뉴스 감성 분석 전문가야.
    최근 '{corp_name}' 관련 주요 뉴스나 기업 상황을 종합적으로 판단해서
    해당 기업의 재무/경영 위험도에 대한 감성 점수를 -1.0(극도로 부정적/위험)에서 1.0(극도로 긍정적/안정) 사이의 숫자 하나로만 답해줘.
    
    [응답 규칙]
    다른 부연 설명이나 문장, 단어는 절대 포함하지 말고, 오직 소수점 수치 하나만 출력해. (예: -0.25 또는 0.6)
    """
    
    try:
        response = client.chat.completions.create(
            # 일일 제한이 많은 llama-3.1-8b-instant 또는 백그라운드 성능이 뛰어난 llama-3.3-70b-versatile 사용
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )
        
        result_text = response.choices[0].message.content.strip()
        score = float(result_text)
        # 점수 범위 제한 (-1.0 ~ 1.0)
        return max(-1.0, min(1.0, score))
        
    except Exception as e:
        print(f"  ⚠️ [{corp_name}] 감성 분석 중 오류 발생: {e} -> 기본값(0.0) 처리")
        return 0.0

def merge_dart_and_sentiment():
    # 1. DART 재무 데이터셋 로드
    financial_file = "dart_financial_data.csv"
    if not os.path.exists(financial_file):
        print(f"❌ '{financial_file}' 파일이 없습니다. 1단계(dart_prep.py)를 먼저 실행하세요.")
        return

    df_financial = pd.read_csv(financial_file)
    
    # 2. 고유 기업 목록 추출
    unique_corps = df_financial['corp_name'].unique()
    total_corps = len(unique_corps)
    
    print(f"🚀 총 {total_corps}개 기업에 대한 LLM 뉴스 감성 분석을 시작합니다.")
    print("⏳ Groq API 무료 제한(30 RPM)을 준수하기 위해 기업당 2초 간격을 두고 진행합니다...\n")

    # 3. 기업별 감성 점수 수집
    sentiment_map = {}
    for idx, corp in enumerate(unique_corps, start=1):
        print(f"[{idx}/{total_corps}] '{corp}' 감성 분석 진행 중...", end="")
        
        score = analyze_news_sentiment(corp)
        sentiment_map[corp] = score
        print(f" -> 점수: {score}")

        # 핵심: API Rate Limit 차단 방지를 위한 2초 대기
        time.sleep(2)

    # 4. 감성 점수를 재무 데이터셋에 매핑
    df_financial['sentiment_score'] = df_financial['corp_name'].map(sentiment_map)

    # 5. 최종 데이터셋 저장
    output_path = "final_dataset.csv"
    df_financial.to_csv(output_path, index=False, encoding='utf-8-sig')
    
    print("\n" + "="*60)
    print(f"✅ 데이터 병합 완료! 최종 데이터셋 저장됨: '{output_path}'")
    print(f"📊 총 레코드 수: {len(df_financial)}개 분기 데이터")
    print("="*60)

if __name__ == "__main__":
    merge_dart_and_sentiment()