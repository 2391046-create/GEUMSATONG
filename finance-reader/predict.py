import sys
import os
import json
import pandas as pd
import numpy as np
import joblib

# dart_prep.py의 repr_codes = ['11013','11012','11014','11011'] (1Q,2Q,3Q,4Q/사업보고서)
# 문자열 그대로 정렬하면 실제 시간 순서(1Q→2Q→3Q→4Q)와 어긋나므로 별도 순서를 부여해 정렬한다.
QUARTER_ORDER = {"11013": 1, "11012": 2, "11014": 3, "11011": 4}
QUARTER_LABEL = {"11013": "1분기", "11012": "2분기", "11014": "3분기", "11011": "4분기(사업보고서)"}

FEATURE_COLS = [
    'debt_ratio', 'op_margin', 'sales_growth', 'sentiment_score',
    'debt_ratio_diff', 'op_margin_diff', 'sentiment_ma2', 'risk_interaction'
]

TREND_EPS = 3.0  # 직전 분기 대비 위험확률(%)이 3%p 이상 변해야 상승/하락으로 표시

# ⚠️ 중요: node server.js를 어느 폴더에서 실행하든 항상 predict.py 옆에 있는
#    데이터/모델/설정 파일을 정확히 찾도록, 모든 파일 경로를 predict.py 기준
#    절대경로로 통일한다. (순수 상대경로("final_dataset.csv")는 Node의 현재
#    작업 디렉터리에 따라 못 찾을 수 있어 예측이 조용히 실패하는 원인이 됨)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# dart_prep.py / merge_data.py / train_model.py를 predict.py와 다른 하위 폴더
# (예: ml_pipeline/)에서 따로 돌리는 프로젝트 구조도 있어서, 아래 후보 폴더들을
# 순서대로 뒤져 파일을 찾는다. 매번 파일을 수동으로 복사할 필요가 없어진다.
CANDIDATE_DIRS = [
    BASE_DIR,
    os.path.join(BASE_DIR, "ml_pipeline"),
]


def here(filename):
    """CANDIDATE_DIRS를 순서대로 뒤져 filename이 실제로 존재하는 첫 경로를 반환.
    어디에도 없으면 BASE_DIR 기준 경로를 반환해 기존 에러 메시지가 그대로 나오게 한다."""
    for d in CANDIDATE_DIRS:
        candidate = os.path.join(d, filename)
        if os.path.exists(candidate):
            return candidate
    return os.path.join(BASE_DIR, filename)


# 투트랙(Two-Track) 이중 임계값 경보 시스템의 기본값.
# train_model.py가 매번 재학습 후 alert_thresholds.json을 새로 저장하므로,
# 파일이 있으면 그 값을 우선 사용하고, 없을 때만 이 기본값을 쓴다.
DEFAULT_ALERT_CONFIG = {
    "model_name": None,
    "first_alert": {"label": "1차 주의 경보", "threshold": 0.08, "precision": None, "recall": None, "f1": None},
    "second_alert": {"label": "2차 고위험 경보", "threshold": 0.46, "precision": None, "recall": None, "f1": None, "specificity": None},
}


def load_alert_config():
    path = here("alert_thresholds.json")
    if not os.path.exists(path):
        print("⚠️ 'alert_thresholds.json'이 없어 기본 임계값(0.08 / 0.46)을 사용합니다. "
              "train_model.py를 한 번 실행하면 자동 생성됩니다.", file=sys.stderr)
        return DEFAULT_ALERT_CONFIG
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ 'alert_thresholds.json' 로딩 실패({e}), 기본 임계값을 사용합니다.", file=sys.stderr)
        return DEFAULT_ALERT_CONFIG


def fail(message):
    """stderr에 이유를 남기고 stdout에는 null만 출력한다.
    (server.js의 runPrediction이 JSON.parse(stdout)을 하기 때문에,
     stdout에는 항상 유효한 JSON만 나가야 하고 실패 시에는 null이 가장 안전하다)"""
    print(message, file=sys.stderr)
    print("null")


def resolve_company_name(df, requested_name):
    """기사에서 뽑힌 기업명이 학습 데이터 정식 명칭과 정확히 안 맞을 수 있어 관대하게 매칭한다."""
    known = df['corp_name'].unique().tolist()
    if requested_name in known:
        return requested_name
    norm = lambda s: "".join(str(s).split()).lower()
    target = norm(requested_name)
    for name in known:
        if norm(name) == target:
            return name
    for name in known:
        n = norm(name)
        if target in n or n in target:
            return name
    return None


def predict_corporate_risk(corp_name):
    alert_config = load_alert_config()
    first_th = float(alert_config["first_alert"]["threshold"])   # 0~1 스케일
    second_th = float(alert_config["second_alert"]["threshold"])  # 0~1 스케일

    # 1. 모델 로드
    try:
        model = joblib.load(here("best_risk_model.pkl"))
    except FileNotFoundError:
        return fail(f"❌ 'best_risk_model.pkl' 파일이 없습니다 (찾은 경로: {here('best_risk_model.pkl')}). train_model.py를 먼저 실행하세요.")

    # 2. 데이터 로드
    try:
        df = pd.read_csv(here("final_dataset.csv"))
    except FileNotFoundError:
        return fail(f"❌ 'final_dataset.csv' 파일이 없습니다 (찾은 경로: {here('final_dataset.csv')}).")

    # 3. 기업명 매칭 (정확히 안 맞으면 유사 매칭)
    resolved_name = resolve_company_name(df, corp_name)
    if resolved_name is None:
        return fail(f"⚠️ '{corp_name}' 기업 데이터를 dataset에서 찾을 수 없습니다.")

    # 4. 시간순 정렬 (연도 + 진짜 분기 순서로)
    df['quarter_num'] = df['repr_code'].astype(str).map(QUARTER_ORDER)
    df = df.dropna(subset=['quarter_num'])
    df['quarter_num'] = df['quarter_num'].astype(int)
    df = df.sort_values(by=['corp_name', 'year', 'quarter_num']).reset_index(drop=True)

    # 5. 파생 변수 계산 (train_model.py와 동일한 정의)
    df['op_margin_diff'] = df.groupby('corp_name')['op_margin'].diff().fillna(0)
    df['debt_ratio_diff'] = df.groupby('corp_name')['debt_ratio'].diff().fillna(0)
    df['sentiment_ma2'] = df.groupby('corp_name')['sentiment_score'].transform(lambda x: x.rolling(2, min_periods=1).mean())
    df['risk_interaction'] = df['debt_ratio'] * (1.0 - df['sentiment_score'])

    # 6. 해당 기업 데이터 추출
    corp_data = df[df['corp_name'] == resolved_name].sort_values(by=['year', 'quarter_num']).reset_index(drop=True)
    if len(corp_data) == 0:
        return fail(f"⚠️ '{resolved_name}' 기업 데이터가 비어 있습니다.")

    latest_data = corp_data.iloc[-1:]
    X_target = latest_data[FEATURE_COLS]
    if X_target.isnull().any(axis=None):
        return fail(f"⚠️ '{resolved_name}' 최신 분기 지표에 결측치가 있습니다.")

    # 6-1. ⚠️ 학습 데이터 범위 확인: 이 모델은 "현재 안전한 기업"의 데이터로만
    #      학습됐다 (train_model.py에서 risk_label==1인 행을 제외하고 학습).
    #      이미 위험 상태인 기업을 그대로 모델에 넣으면 학습 때 본 적 없는
    #      입력 분포라 예측이 무의미하다. 그런 경우 모델을 거치지 않고
    #      "이미 위험 상태"라는 사실 자체를 바로 결과로 반환한다.
    currently_risky = (
        float(latest_data['debt_ratio'].values[0]) > 200
        or float(latest_data['op_margin'].values[0]) < 0
    )

    year_info = int(latest_data['year'].values[0]) if 'year' in latest_data else None
    repr_info = str(latest_data['repr_code'].values[0]) if 'repr_code' in latest_data else ""
    quarter_label = f"{year_info}년 {QUARTER_LABEL.get(repr_info, '')} 공시 기준" if year_info else ""

    debt_ratio = float(latest_data['debt_ratio'].values[0])
    debt_ratio_diff = float(latest_data['debt_ratio_diff'].values[0])
    op_margin = float(latest_data['op_margin'].values[0])
    op_margin_diff = float(latest_data['op_margin_diff'].values[0])
    sentiment = float(latest_data['sentiment_score'].values[0])

    def direction(v):
        if v > 0.05:
            return "up"
        if v < -0.05:
            return "down"
        return "flat"

    if currently_risky:
        # 모델을 거치지 않고 현재 상태 그대로 "위험"으로 확정 반환
        reason = "부채비율 200% 초과" if debt_ratio > 200 else "영업이익 적자"
        result_data = {
            "companyName": resolved_name,
            "quarterLabel": quarter_label,
            "probability": 100.0,
            "riskLevel": "high",
            "riskLabel": "위험 (확정)",
            "alertTrack": "confirmed",
            "firstThreshold": round(first_th * 100, 1),
            "secondThreshold": round(second_th * 100, 1),
            "trend": "flat",
            "factors": [
                {"label": "부채비율", "value": f"{debt_ratio:.0f}%", "direction": direction(debt_ratio_diff)},
                {"label": "영업이익률", "value": f"{op_margin:.1f}%", "direction": direction(op_margin_diff)},
                {"label": "최근 뉴스 어조", "value": f"{sentiment:+.2f}", "direction": direction(sentiment)},
            ],
            "summary": f"현재 이미 재무 위험 기준({reason})을 충족하고 있어 즉시 주의가 필요해요. "
                       f"(이 구간은 AI 예측 모델이 아닌 공시 수치 기준의 확정 판정이에요)",
        }
        print(json.dumps(result_data, ensure_ascii=False))
        return

    # 7. 다음 분기 위험 확률 예측 (최신 분기, "안전->위험 전환" 확률)
    risk_prob_raw = float(model.predict_proba(X_target)[0][1])  # 0~1 스케일 (임계값 비교용)
    risk_prob = risk_prob_raw * 100  # 0~100 스케일 (표시용)

    # 8. 직전 분기 대비 변화(trend) 계산 (직전 분기도 안전 상태였을 때만 비교)
    trend = "flat"
    if len(corp_data) >= 2:
        prev_data = corp_data.iloc[-2:-1]
        prev_was_safe = (
            float(prev_data['debt_ratio'].values[0]) <= 200
            and float(prev_data['op_margin'].values[0]) >= 0
        )
        X_prev = prev_data[FEATURE_COLS]
        if prev_was_safe and not X_prev.isnull().any(axis=None):
            prev_risk_prob = float(model.predict_proba(X_prev)[0][1]) * 100
            delta = risk_prob - prev_risk_prob
            if delta > TREND_EPS:
                trend = "up"
            elif delta < -TREND_EPS:
                trend = "down"

    # 9. 투트랙(Two-Track) 이중 임계값 경보 분류
    #    1차 주의 경보(threshold 낮음, Recall 우선 넓은 안전망)
    #    2차 고위험 경보(threshold 높음, F1 최대 정밀 알림)
    #    alert_thresholds.json에서 불러온 값을 그대로 사용 (하드코딩 금지 -> 재학습 시 자동 반영)
    if risk_prob_raw >= second_th:
        risk_level, risk_label, alert_track = "high", alert_config["second_alert"]["label"], "second"
        action_guide = "여러 지표가 동시에 나쁘게 나타난 신뢰도 높은 위험 신호예요. 선제적 재무 구조 점검이 필요해요."
    elif risk_prob_raw >= first_th:
        risk_level, risk_label, alert_track = "mid", alert_config["first_alert"]["label"], "first"
        action_guide = "초기 위험 신호가 감지됐어요. 아직 확정적이진 않지만, 다음 분기 실적과 관련 뉴스를 눈여겨보는 게 좋아요."
    else:
        risk_level, risk_label, alert_track = "low", "안전", None
        action_guide = "현재 특별한 위험 신호가 감지되지 않았어요."

    debt_word = "늘어" if debt_ratio_diff > 0.05 else ("줄어" if debt_ratio_diff < -0.05 else "비슷하게 유지되")
    margin_word = "개선되고" if op_margin_diff > 0.05 else ("악화되고" if op_margin_diff < -0.05 else "비슷한 수준을 보이고")
    sentiment_word = "긍정적" if sentiment > 0.15 else ("부정적" if sentiment < -0.15 else "중립적")
    summary = (
        f"최근 부채비율이 {debt_word} 있고, 영업이익률은 {margin_word} 있어요. "
        f"관련 뉴스 어조는 {sentiment_word}으로 나타나, 종합적으로 '{risk_label}' 단계로 분류됐어요. ({action_guide})"
    )

    # 10. app.js의 renderPredictionSection()이 그대로 읽는 필드 이름으로 출력
    result_data = {
        "companyName": resolved_name,
        "quarterLabel": quarter_label,
        "probability": round(risk_prob, 1),
        "riskLevel": risk_level,     # 'low' | 'mid' | 'high'
        "riskLabel": risk_label,     # '안전' | '1차 주의 경보' | '2차 고위험 경보'
        "alertTrack": alert_track,   # None | 'first' | 'second'
        "firstThreshold": round(first_th * 100, 1),   # 게이지에 그릴 1차 임계값 (0~100 스케일)
        "secondThreshold": round(second_th * 100, 1),  # 게이지에 그릴 2차 임계값 (0~100 스케일)
        "trend": trend,              # 'up' | 'down' | 'flat'
        "factors": [
            {"label": "부채비율", "value": f"{debt_ratio:.0f}%", "direction": direction(debt_ratio_diff)},
            {"label": "영업이익률", "value": f"{op_margin:.1f}%", "direction": direction(op_margin_diff)},
            {"label": "최근 뉴스 어조", "value": f"{sentiment:+.2f}", "direction": direction(sentiment)},
        ],
        "summary": summary,
    }

    print(json.dumps(result_data, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        fail("companyName 인자가 필요합니다. 예: python predict.py \"삼성전자\"")
    else:
        predict_corporate_risk(sys.argv[1].strip())