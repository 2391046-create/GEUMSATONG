import pandas as pd

# 출력 화면이 잘리지 않도록 설정
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)

try:
    entities = pd.read_parquet("output/entities.parquet")
    relationships = pd.read_parquet("output/relationships.parquet")

    print("\n================ [ 추출된 엔티티 (Top 10) ] ================")
    print(entities[["title", "type", "description"]].head(10))

    print("\n================ [ 추출된 관계 (Top 10) ] ================")
    print(relationships[["source", "target", "description"]].head(10))

except Exception as e:
    print(f"파일을 읽는 중 에러가 발생했습니다: {e}")

# 화면이 바로 꺼지는 것을 방지
input("\n엔터(Enter) 키를 누르면 종료됩니다...")