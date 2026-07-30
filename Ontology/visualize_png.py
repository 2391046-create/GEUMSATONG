import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt

# 한글 폰트 설정 (Windows)
plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False

def generate_png_graph():
    entities = pd.read_parquet("output/entities.parquet")
    relationships = pd.read_parquet("output/relationships.parquet")

    G = nx.Graph()

    # 노드 및 엣지 생성
    for _, row in entities.iterrows():
        G.add_node(row["title"], type=row.get("type", "UNKNOWN"))

    for _, row in relationships.iterrows():
        G.add_edge(row["source"], row["target"])

    plt.figure(figsize=(16, 12))
    
    # 노드 배치 계산 (Spring layout)
    pos = nx.spring_layout(G, k=0.6, seed=42)

    # 노드 타입별 색상 매핑
    types = list(set(nx.get_node_attributes(G, 'type').values()))
    colors = plt.cm.Set3.colors  # 색상 팔레트
    type_color_dict = {t: colors[i % len(colors)] for i, t in enumerate(types)}

    # 노드 그리기
    for t in types:
        node_list = [node for node, attr in G.nodes(data=True) if attr.get('type') == t]
        nx.draw_networkx_nodes(G, pos, nodelist=node_list, node_color=[type_color_dict[t]], 
                               node_size=800, alpha=0.9, label=t)

    # 엣지 및 라벨 그리기
    nx.draw_networkx_edges(G, pos, alpha=0.3, edge_color='gray', width=1.2)
    nx.draw_networkx_labels(G, pos, font_size=9, font_family='Malgun Gothic', font_weight='bold')

    plt.title("GraphRAG 온톨로지 엔티티 관계망", fontsize=18, fontweight='bold', pad=20)
    plt.legend(scatterpoints=1, frameon=True, labelspacing=1, title="Entity Types")
    plt.axis('off')

    output_png = "graph_network.png"
    plt.savefig(output_png, bbox_inches='tight', dpi=300)
    print(f"'{output_png}' 고화질 이미지 파일이 생성되었습니다.")

if __name__ == "__main__":
    generate_png_graph()