import os
import json
import argparse
import pandas as pd
import numpy as np
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import GroupKFold
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, average_precision_score, confusion_matrix,
)
from lightgbm import LGBMClassifier
from xgboost import XGBClassifier
from sklearn.ensemble import RandomForestClassifier
from imblearn.over_sampling import SMOTE

# --------------------------------------------------------------------------
# 0. 설정
# --------------------------------------------------------------------------
DATA_PATH = "final_dataset.csv"
QUARTER_ORDER = {"11013": 1, "11012": 2, "11014": 3, "11011": 4}

FEATURE_COLS = [
    "debt_ratio", "op_margin", "sales_growth", "sentiment_score",
    "debt_ratio_diff", "op_margin_diff", "sentiment_ma2", "risk_interaction",
]

RANDOM_STATE = 42
N_SPLITS = 5

# EWS 특성에 맞춘 미세 Threshold 스윕 범위 (0.02 ~ 0.50, 0.02 간격)
FINE_THRESHOLDS = np.round(np.arange(0.02, 0.50 + 1e-9, 0.02), 2)


# --------------------------------------------------------------------------
# 1. 데이터 로드 및 파생변수 생성
# --------------------------------------------------------------------------
def load_and_engineer_features(path: str = DATA_PATH) -> pd.DataFrame:
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"❌ '{path}' 파일이 없습니다. dart_prep.py -> merge_data.py 순서로 먼저 실행하세요."
        )

    df = pd.read_csv(path)

    df["quarter_num"] = df["repr_code"].astype(str).map(QUARTER_ORDER)
    df = df.dropna(subset=["quarter_num"]).copy()
    df["quarter_num"] = df["quarter_num"].astype(int)
    df = df.sort_values(by=["corp_name", "year", "quarter_num"]).reset_index(drop=True)

    df["sales_growth"] = df.groupby("corp_name")["revenue"].pct_change() * 100
    df["debt_ratio_diff"] = df.groupby("corp_name")["debt_ratio"].diff()
    df["op_margin_diff"] = df.groupby("corp_name")["op_margin"].diff().fillna(0)
    df["sentiment_ma2"] = df.groupby("corp_name")["sentiment_score"].transform(
        lambda x: x.rolling(2, min_periods=1).mean()
    )
    df["risk_interaction"] = df["debt_ratio"] * (1.0 - df["sentiment_score"])

    if "risk_label" not in df.columns:
        df["risk_label"] = ((df["debt_ratio"] > 200) | (df["op_margin"] < 0)).astype(int)

    if "target_risk_next_q" in df.columns and df["target_risk_next_q"].notnull().sum() > 0:
        df["target_next_risk"] = df["target_risk_next_q"]
    else:
        df["target_next_risk"] = df.groupby("corp_name")["risk_label"].shift(-1)

    df_clean = df.dropna(subset=["target_next_risk"] + FEATURE_COLS).copy()
    df_clean["target_next_risk"] = df_clean["target_next_risk"].astype(int)
    return df_clean


def restrict_to_currently_safe(df_clean: pd.DataFrame) -> pd.DataFrame:
    if "risk_label" not in df_clean.columns:
        return df_clean
    return df_clean[df_clean["risk_label"] == 0].copy()


# --------------------------------------------------------------------------
# 2. 임계값(Threshold) 분석표
# --------------------------------------------------------------------------
def build_threshold_table(y_true: np.ndarray, probs: np.ndarray,
                           thresholds: np.ndarray = FINE_THRESHOLDS) -> pd.DataFrame:
    rows = []
    auc = roc_auc_score(y_true, probs) if len(np.unique(y_true)) > 1 else np.nan

    for t in thresholds:
        preds = (probs >= t).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, preds, labels=[0, 1]).ravel()

        precision = precision_score(y_true, preds, zero_division=0)
        recall = recall_score(y_true, preds, zero_division=0)
        f1 = f1_score(y_true, preds, zero_division=0)
        specificity = tn / (tn + fp) if (tn + fp) > 0 else np.nan

        rows.append({
            "Threshold": t,
            "Precision": round(precision, 4),
            "Recall": round(recall, 4),
            "F1-Score": round(f1, 4),
            "Specificity": round(specificity, 4),
            "ROC-AUC": round(auc, 4),
        })

    return pd.DataFrame(rows)


def recommend_thresholds(table: pd.DataFrame, min_recall: float = 0.80) -> dict:
    recommendations = {}

    best_f1_row = table.loc[table["F1-Score"].idxmax()]
    recommendations["best_f1"] = best_f1_row.to_dict()

    feasible = table[table["Recall"] >= min_recall]
    if not feasible.empty:
        best_recall_row = feasible.loc[feasible["Precision"].idxmax()]
        recommendations["min_recall"] = best_recall_row.to_dict()
    else:
        recommendations["min_recall"] = None

    return recommendations


# --------------------------------------------------------------------------
# 3. 변수 중요도 시각화
# --------------------------------------------------------------------------
def plot_feature_importance(model, feature_cols: list, out_path: str = "feature_importance.png"):
    importances = model.feature_importances_
    order = np.argsort(importances)
    sorted_features = [feature_cols[i] for i in order]
    sorted_importances = importances[order]

    import matplotlib.font_manager as fm
    candidates = ["Malgun Gothic", "AppleGothic", "NanumGothic", "Noto Sans CJK KR"]
    available = {f.name for f in fm.fontManager.ttflist}
    for name in candidates:
        if name in available:
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False

    plt.figure(figsize=(10, 6))
    sns.barplot(x=sorted_importances, y=sorted_features, color="steelblue", orient="h")
    plt.title("AI 재무 위험 예측 모델 - 변수 중요도 (Feature Importance)", fontsize=15)
    plt.xlabel("Importance Score")
    plt.ylabel("")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()
    print(f"✅ 변수 중요도 가로 바 차트 저장 완료 -> '{out_path}'")


# --------------------------------------------------------------------------
# 4. 학습 메인 로직
# --------------------------------------------------------------------------
def print_baseline(y: pd.Series) -> dict:
    baseline_preds = np.zeros_like(y)
    return {
        "acc": accuracy_score(y, baseline_preds),
        "prec": precision_score(y, baseline_preds, zero_division=0),
        "rec": recall_score(y, baseline_preds, zero_division=0),
        "f1": f1_score(y, baseline_preds, zero_division=0),
        "prevalence": y.mean(),
    }


def train_and_save_model(thresholds: np.ndarray = FINE_THRESHOLDS, min_recall: float = 0.80):
    df_clean = load_and_engineer_features()
    df_transition = restrict_to_currently_safe(df_clean)

    X = df_transition[FEATURE_COLS]
    y = df_transition["target_next_risk"]
    groups = df_transition["corp_name"]

    baseline = print_baseline(y)
    print("\n[베이스라인 (전부 정상 예측 시)]")
    print(f"  - Accuracy: {baseline['acc']:.4f} | 위험 비율(Prevalence): {baseline['prevalence']:.4f}")

    # 클래스 불균형 비율에 따른 scale_pos_weight 자동 계산 (~ 15.3배)
    pos_weight = (len(y) - y.sum()) / max(y.sum(), 1)
    print(f"\n Class Imbalance Weight (scale_pos_weight): {pos_weight:.2f}")

   # SMOTE를 적용할 것이므로 모델 자체 가중치(scale_pos_weight)는 중복 적용하지 않음!
    model_ctors = {
        "LightGBM": lambda: LGBMClassifier(
            n_estimators=100, max_depth=4, learning_rate=0.05,
            random_state=RANDOM_STATE, verbose=-1
        ),
        "XGBoost": lambda: XGBClassifier(
            n_estimators=100, max_depth=4, learning_rate=0.05,
            random_state=RANDOM_STATE, eval_metric="logloss"
        ),
        "Random Forest": lambda: RandomForestClassifier(
            n_estimators=100, max_depth=6, random_state=RANDOM_STATE
        ),
    }

    gkf = GroupKFold(n_splits=N_SPLITS)
    smote = SMOTE(random_state=RANDOM_STATE)

    results = {}
    oof_predictions = {name: np.zeros(len(X)) for name in model_ctors.keys()}

    print("\n[② SMOTE + scale_pos_weight 적용 교차검증 (종합 성능 평가)]")

    best_score = -1
    best_model_name = "LightGBM"

    for name, ctor in model_ctors.items():
        acc_l, prec_l, f1_l, rec_l, auc_l, pr_auc_l = [], [], [], [], [], []

        for train_idx, val_idx in gkf.split(X, y, groups):
            X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

            if y_val.nunique() < 2:
                continue

            try:
                X_train_sm, y_train_sm = smote.fit_resample(X_train, y_train)
            except ValueError:
                X_train_sm, y_train_sm = X_train, y_train

            model = ctor()
            model.fit(X_train_sm, y_train_sm)

            preds = model.predict(X_val)
            probs = model.predict_proba(X_val)[:, 1]

            oof_predictions[name][val_idx] = probs

            acc_l.append(accuracy_score(y_val, preds))
            prec_l.append(precision_score(y_val, preds, zero_division=0))
            f1_l.append(f1_score(y_val, preds, zero_division=0))
            rec_l.append(recall_score(y_val, preds, zero_division=0))
            auc_l.append(roc_auc_score(y_val, probs))
            pr_auc_l.append(average_precision_score(y_val, probs))

        avg = {
            "acc": np.mean(acc_l), "prec": np.mean(prec_l), "f1": np.mean(f1_l),
            "rec": np.mean(rec_l), "auc": np.mean(auc_l), "pr_auc": np.mean(pr_auc_l),
        }
        results[name] = avg

        print(f"\n[{name}]")
        print(f"  - Accuracy: {avg['acc']:.4f} | Precision: {avg['prec']:.4f} | "
              f"Recall: {avg['rec']:.4f} | F1: {avg['f1']:.4f} | ROC-AUC: {avg['auc']:.4f}")

        # OOF F1-Score와 ROC-AUC를 종합하여 최고의 모델 자동 선택
        score = (avg["f1"] * 0.5) + (avg["auc"] * 0.5)
        if score > best_score:
            best_score = score
            best_model_name = name

    print(f"\n👉 OOF 종합 성능(F1+AUC) 기준 최적 모델 자동 선정: [{best_model_name}]")

    best_model_ctor = model_ctors[best_model_name]

    # 전체 데이터 재학습
    print(f"\n전체 데이터 재학습 중 ({best_model_name})...")
    try:
        X_sm, y_sm = smote.fit_resample(X, y)
    except ValueError:
        X_sm, y_sm = X, y

    best_model = best_model_ctor()
    best_model.fit(X_sm, y_sm)

    # ③ OOF 기반 세밀한 임계값 분석표 생성
    oof_probs = oof_predictions[best_model_name]
    threshold_table = build_threshold_table(y.values, oof_probs, thresholds)

    print(f"\n[📊 Out-of-Fold 기반 세밀 임계값 분석표 ({best_model_name}): "
          f"{thresholds[0]:.2f} ~ {thresholds[-1]:.2f}]")
    print(threshold_table.to_string(index=False))
    threshold_table.to_csv("threshold_analysis.csv", index=False, encoding="utf-8-sig")
    print("\n✅ 임계값 분석표 저장 완료 -> 'threshold_analysis.csv'")

    # 📌 임계값 추천
    recs = recommend_thresholds(threshold_table, min_recall=min_recall)
    print("\n[🎯 임계값 추천 (검증 데이터 OOF 기준)]")
    r = recs["best_f1"]
    print(f"  - F1 최대 지점        : Threshold={r['Threshold']:.2f}  "
          f"(Precision={r['Precision']:.3f}, Recall={r['Recall']:.3f}, F1={r['F1-Score']:.3f})")
    if recs["min_recall"] is not None:
        r = recs["min_recall"]
        print(f"  - Recall≥{min_recall:.2f} 만족 중 Precision 최대: Threshold={r['Threshold']:.2f}  "
              f"(Precision={r['Precision']:.3f}, Recall={r['Recall']:.3f}, F1={r['F1-Score']:.3f})")
        first_alert_row = recs["min_recall"]
    else:
        print(f"  - Recall≥{min_recall:.2f}를 만족하는 임계값이 없습니다. 표에서 가장 낮은 임계값으로 대체합니다.")
        first_alert_row = threshold_table.iloc[threshold_table["Threshold"].idxmin()].to_dict()

    # 📌 투트랙(Two-Track) 이중 임계값 경보 시스템 설정 저장
    #    1차 주의 경보 = Recall 우선(넓은 안전망), 2차 고위험 경보 = F1 최대(정밀 알림)
    #    predict.py / app.js가 이 파일을 읽어서 그대로 사용 -> 재학습 시 임계값이 바뀌어도
    #    코드 수정 없이 자동 반영됨
    alert_config = {
        "model_name": best_model_name,
        "first_alert": {  # 1차 주의 경보 (넓은 안전망)
            "label": "1차 주의 경보",
            "threshold": round(float(first_alert_row["Threshold"]), 4),
            "precision": round(float(first_alert_row["Precision"]), 4),
            "recall": round(float(first_alert_row["Recall"]), 4),
            "f1": round(float(first_alert_row["F1-Score"]), 4),
        },
        "second_alert": {  # 2차 고위험 경보 (정밀 알림, F1 최대 지점)
            "label": "2차 고위험 경보",
            "threshold": round(float(recs["best_f1"]["Threshold"]), 4),
            "precision": round(float(recs["best_f1"]["Precision"]), 4),
            "recall": round(float(recs["best_f1"]["Recall"]), 4),
            "f1": round(float(recs["best_f1"]["F1-Score"]), 4),
            "specificity": round(float(recs["best_f1"]["Specificity"]), 4),
        },
    }
    with open("alert_thresholds.json", "w", encoding="utf-8") as f:
        json.dump(alert_config, f, ensure_ascii=False, indent=2)
    print("✅ 투트랙 경보 임계값 저장 완료 -> 'alert_thresholds.json'")

    # 모델 저장
    joblib.dump(best_model, "best_risk_model.pkl")
    print(f"\n✅ 최종 배포 모델 저장 완료: {best_model_name} -> 'best_risk_model.pkl'")

    # ④ 변수 중요도 시각화
    plot_feature_importance(best_model, FEATURE_COLS)

    return best_model, threshold_table, results


def parse_args():
    parser = argparse.ArgumentParser(description="DART EWS 모델 학습 (Class Weight & Optimal Threshold 적용)")
    parser.add_argument("--thresh-start", type=float, default=0.02, help="임계값 스윕 시작값 (기본 0.02)")
    parser.add_argument("--thresh-end", type=float, default=0.50, help="임계값 스윕 종료값 (기본 0.50)")
    parser.add_argument("--thresh-step", type=float, default=0.02, help="임계값 스윕 간격 (기본 0.02)")
    parser.add_argument("--min-recall", type=float, default=0.80,
                        help="추천 임계값 계산 시 최소 요구 Recall (기본 0.80)")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    thresholds = np.round(np.arange(args.thresh_start, args.thresh_end + 1e-9, args.thresh_step), 2)
    train_and_save_model(thresholds=thresholds, min_recall=args.min_recall)