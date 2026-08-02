import os
import pandas as pd
import OpenDartReader
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("DART_API_KEY")

if not api_key:
    raise ValueError("❌ DART_API_KEY가 설정되지 않았습니다. 같은 폴더에 .env 파일이 있는지 확인하세요.")

dart = OpenDartReader(api_key)

# 1. 대상 기업 대폭 확장 (우량주 기반)
target_corps_core = [
    "삼성전자", "SK하이닉스", "DB하이텍", "리노공업", "원익IPS", 
    "HPSP", "솔브레인", "원익QnC", "동진쎄미켐", "LX세미콘", "파인엠텍",
    "LG에너지솔루션", "POSCO홀딩스", "LG화학", "에코프로비엠", "엘앤에프", 
    "포스코퓨처엠", "한화솔루션", "코스모신소재", "CS풍력",
    "현대자동차", "기아", "현대모비스", "LIG넥스원", "한국항공우주", 
    "삼성바이오로직스", "셀트리온", "유한양행", "한미약품", "알테오젠", 
    "종근당", "대웅제약", "클래시스", "휴젤",
    "NAVER", "카카오", "하이브", "CJ제일제당", "아모레퍼시픽", 
    "이마트", "BGF리테일", "GS리테일", "엔씨소프트", "카카오게임즈", "JYP Ent.", 
    "에스엠", "스튜디오드래곤", "현대백화점",
    "심텍", "덕산네오룩스", "주성엔지니어링", "미래에셋증권", "KB금융", "한국금융지주", "메리츠금융지주",
    "HD현대중공업", "HD한국조선해양", "삼성중공업", "한화오션", "HMM", "팬오션", "대한해운",
    "DL이앤씨", "GS건설", "대우건설", "HDC현대산업개발", "태영건설", "동부건설", "신세계건설",
    "아시아나항공", "대한항공", "한국전력", "한국가스공사"
]

# 1-1. 📌 실제 재무위기/부실 이력이 있는 기업 추가 (양성(risk=1) 표본 밀도 강화)
#      - 조선/해운/건설/항공 등 경기민감 업종 중 2015~2025년 사이 실제 워크아웃, 법정관리,
#        대규모 적자·자본잠식이 있었던 기업 위주로 선정
#      - DART corp_code 마스터 기준으로 존재를 확인한 '현재 정식 명칭' 사용
#        (개명/합병 예: STX조선해양 -> 케이조선, 성동조선해양 -> 에이치에스지성동조선,
#         두산중공업 -> 두산에너빌리티)
target_corps_distressed = [
    # 조선/해운 (2015~2017 조선업 구조조정, 한진해운 파산 등)
    "한진해운", "케이조선", "에이치에스지성동조선", "SPP조선",
    "STX중공업", "STX엔진", "대한조선", "대선조선", "폴라리스쉬핑",
    "한진중공업홀딩스",
    # 중공업 (2020년 코로나+발전플랜트 수주절벽 유동성 위기)
    "두산건설", "두산에너빌리티",
    # 건설 (건설사 워크아웃/법정관리 다발 업종)
    "경남기업", "극동건설", "벽산건설", "남광토건", "우림건설",
    "성원건설", "풍림산업", "삼부토건", "진흥기업", "신동아건설", "삼환기업", "동양시멘트",
    # 항공 (이스타항공 2020년 파산)
    "이스타항공",
    # 자동차부품/타이어, 유통·지주 (유동성 위기 이력)
    "금호타이어", "금호산업", "대성산업", "대한전선",
    "이랜드리테일", "이랜드월드",
    # 철강 (업황 사이클 리스크)
    "동국제강",
    # 태양광 (웅진에너지 2019년 회생절차)
    "웅진에너지",
]

target_corps = target_corps_core + target_corps_distressed

# 2. 수집 기간 확장 (2015년~2025년)
years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
repr_codes = ['11013', '11012', '11014', '11011']

def get_financial_ratios(corp_name, year, repr_code):
    try:
        fs = dart.finstate(corp_name, year, repr_code)
        if fs is None or fs.empty:
            return None
        
        if 'fs_div' in fs.columns:
            fs_conn = fs[fs['fs_div'] == 'CFS']
            if not fs_conn.empty:
                fs = fs_conn

        def get_val(account_names):
            for name in account_names:
                sub = fs[fs['account_nm'].str.contains(name, na=False)]
                if not sub.empty:
                    val_str = str(sub.iloc[0]['thstrm_amount']).replace(',', '')
                    try:
                        return float(val_str)
                    except ValueError:
                        continue
            return None

        total_assets = get_val(['자산총계'])
        total_liab = get_val(['부채총계'])
        revenue = get_val(['매출액', '수익(매출액)'])
        op_income = get_val(['영업이익', '영업이익(손실)'])

        if not all([total_assets, total_liab, revenue, op_income]) or total_assets == 0 or revenue == 0:
            return None

        debt_ratio = (total_liab / (total_assets - total_liab)) * 100 if (total_assets - total_liab) > 0 else 500.0
        op_margin = (op_income / revenue) * 100

        return {
            'corp_name': corp_name,
            'year': year,
            'repr_code': repr_code,
            'debt_ratio': round(debt_ratio, 2),
            'op_margin': round(op_margin, 2),
            'revenue': revenue
        }
    except Exception:
        return None

def build_dart_dataset():
    total_tasks = len(target_corps) * len(years) * len(repr_codes)
    print(f"🚀 확장된 DART 데이터 수집을 시작합니다. (총 {len(target_corps)}개 기업, 약 {total_tasks}회 요청)")
    print(f"   - 우량주: {len(target_corps_core)}개 / 부실 이력 기업: {len(target_corps_distressed)}개")
    print("⏳ DART API 서버 응답에 따라 시간이 다소 소요될 수 있습니다...\n")

    checkpoint_path = "dart_financial_data_checkpoint.csv"
    all_data = []
    completed = 0

    for corp in target_corps:
        for yr in years:
            for code in repr_codes:
                res = get_financial_ratios(corp, yr, code)
                if res:
                    all_data.append(res)
                completed += 1
                if completed % 50 == 0:
                    print(f"📊 진행률: {completed}/{total_tasks} ({completed/total_tasks*100:.1f}%) 완료...")
                # 📌 요청 수가 많아진 만큼(4천회 이상), 중간에 끊겨도 데이터를 잃지 않도록
                #    500회마다 체크포인트 저장
                if completed % 500 == 0 and all_data:
                    pd.DataFrame(all_data).to_csv(checkpoint_path, index=False, encoding="utf-8-sig")
                    print(f"   💾 체크포인트 저장 -> '{checkpoint_path}' ({len(all_data)}건 확보)")

    df = pd.DataFrame(all_data)
    
    if df.empty:
        print("❌ 수집된 데이터가 없습니다.")
        return

    df = df.sort_values(by=['corp_name', 'year', 'repr_code']).reset_index(drop=True)
    df['sales_growth'] = df.groupby('corp_name')['revenue'].pct_change() * 100
    df['debt_ratio_diff'] = df.groupby('corp_name')['debt_ratio'].diff()
    df['risk_label'] = ((df['debt_ratio'] > 200) | (df['op_margin'] < 0)).astype(int)
    df['target_risk_next_q'] = df.groupby('corp_name')['risk_label'].shift(-1)

    df_clean = df.dropna(subset=['sales_growth', 'debt_ratio_diff', 'target_risk_next_q']).copy()
    df_clean['target_risk_next_q'] = df_clean['target_risk_next_q'].astype(int)

    output_path = "dart_financial_data.csv"
    df_clean.to_csv(output_path, index=False, encoding='utf-8-sig')
    print(f"\n✅ 고도화된 DART 데이터 수집 완료! 총 {len(df_clean)}개 분기 데이터 확보 -> '{output_path}' 저장됨")

if __name__ == "__main__":
    build_dart_dataset()