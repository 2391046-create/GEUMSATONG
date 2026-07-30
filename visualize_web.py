import pandas as pd
from pyvis.network import Network

def generate_interactive_graph():
    # 데이터 불러오기
    entities = pd.read_parquet("output/entities.parquet")
    relationships = pd.read_parquet("output/relationships.parquet")

    # PyVis 네트워크 객체 생성 (dark 테마 적용)
    net = Network(height="850px", width="100%", bgcolor="#1a1a1a", font_color="white", filter_menu=True)
    
    # 노드 색상 매핑 (Entity Type별 색상 구분)
    color_map = {
        "GOVERNMENT AGENCY": "#ff7f0e", # 주황
        "ORGANIZATION": "#1f77b4",      # 파랑
        "PERSON": "#2ca02c",            # 초록
        "EVENT": "#d62728",             # 빨강
        "LOCATION": "#9467bd",          # 보라
        "CONCEPT": "#e377c2"            # 분홍
    }

    # 1. 노드 추가
    for _, row in entities.iterrows():
        title = row["title"]
        e_type = row.get("type", "UNKNOWN")
        desc = row.get("description", "설명 없음")
        
        # 툴팁 HTML 구성
        tooltip = f"<b>[{e_type}] {title}</b><br><br>{desc[:200]}..."
        node_color = color_map.get(e_type, "#a7a7a7")
        
        net.add_node(title, label=title, title=tooltip, color=node_color, shape="dot", size=25)

    # 2. 관계(엣지) 추가
    for _, row in relationships.iterrows():
        source = row["source"]
        target = row["target"]
        desc = row.get("description", "")
        
        net.add_edge(source, target, title=desc, color="#555555", width=1.5)

    # 물리학 엔진 옵션 설정 (드래그 시 자연스럽게 튕기도록)
    net.force_atlas_2based(gravity=-50, central_gravity=0.01, spring_length=100, spring_strength=0.08)
    
    # HTML 저장
    output_filename = "graph_interactive.html"
    net.write_html(output_filename)
    print(f"프로젝트 폴더에 '{output_filename}' 파일이 생성되었습니다.")

if __name__ == "__main__":
    generate_interactive_graph()