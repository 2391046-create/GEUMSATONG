import pandas as pd
import networkx as nx

entities = pd.read_parquet("output/entities.parquet")
relationships = pd.read_parquet("output/relationships.parquet")

G = nx.Graph()

for _, row in entities.iterrows():
    G.add_node(str(row["title"]), type=str(row.get("type", "")), description=str(row.get("description", "")))

for _, row in relationships.iterrows():
    G.add_edge(str(row["source"]), str(row["target"]), description=str(row.get("description", "")))

nx.write_graphml(G, "ontology_graph.graphml")
print("'ontology_graph.graphml' 저장 완료! Gephi 프로그램에서 열 수 있습니다.")