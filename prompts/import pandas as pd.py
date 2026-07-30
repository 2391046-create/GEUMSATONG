import pandas as pd

# 추출된 엔티티 및 관계 파일 읽기
entities = pd.read_parquet("output/entities.parquet")
relationships = pd.read_parquet("output/relationships.parquet")

print("=== 추출된 엔티티 목록 ===")
print(entities[["title", "type", "description"]].head(10))

print("\n=== 추출된 관계(Ontology) 목록 ===")
# relationship_type 필드가 새로 잘 추가되었는지 확인
print(relationships[["source", "target", "description"]].head(10))