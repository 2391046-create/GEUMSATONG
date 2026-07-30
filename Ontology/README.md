## Financial Knowledge Graph Construction (GraphRAG & Ontology)

금융 기사를 바탕으로 엔티티(Entity) 및 관계(Relationship)를 추출하고, 이를 기반으로 지식 그래프(Knowledge Graph) 구축 및 시각화를 수행하는 파이프라인입니다.

---

## 📁 프로젝트 구조 (Directory Structure)

Ontology/
├── input/                  # 원본 금융 텍스트 데이터 (.txt)
├── prompts/                # GraphRAG 추출 규칙 및 프롬프트 정의
├── lib/                    # 커스텀 모듈 및 유틸리티 래퍼
├── check_result.py         # 추출된 parquet 결과물(엔티티/관계) 확인용 스크립트
├── visualize_web.py        # PyVis 기반 인터랙티브 HTML 네트워크 그래프 생성
├── visualize_png.py        # NetworkX/Matplotlib 기반 정적 고화질 PNG 이미지 생성
├── export_graphml.py      # Gephi / Neo4j 용 GraphML 포맷 데이터 수출 스크립트
├── settings.yaml           # GraphRAG 파이프라인 및 LLM 설정 파일
└── README.md               # 프로젝트 매뉴얼

---

⚙️ 환경 구성 및 기술 스택 (Tech Stack)

1. Core Framework: Microsoft GraphRAG

2. Language & Package Manager: Python 3.12, uv

3. Visualization: PyVis, NetworkX, Matplotlib, Gephi (GraphML)

powershell -ExecutionPolicy ByPass -c "irm [https://astral.sh/uv/install.ps1](https://astral.sh/uv/install.ps1) | iex"


🚀 실행 가이드 (Execution Workflow)

1. GraphRAG 인덱싱 및 쿼리문서 기반 지식 그래프 인덱스를 생성하고 질의응답을 수행합니다.

# 로컬 질의 (Local Search: 특정 엔티티/관계 중심 탐색)

uvx --python 3.12 --with "litellm<1.92" graphrag query --root . --method local --query "주요 금융 기관 간의 연관 관계를 설명해줘."

# 글로벌 질의 (Global Search: 전체 문맥 요약)

uvx --python 3.12 --with "litellm<1.92" graphrag query --root . --method global --query "이 문서에서 다루는 주요 이슈를 요약해줘."

2. 추출 데이터 결과 확인

추출된 entities.parquet 및 relationships.parquet 데이터의 상위 항목을 터미널에서 빠르게 조회가 가능합니다.

uv run --with pandas --with pyarrow python check_result.py

📊 시각화 (Visualization Guide)

추출된 지식 그래프를 3가지 형태로 시각화하여 분석할 수 있습니다.

| 시각화 방식 | 생성 파일 | 실행 명령어 | 특징 |
| --- | --- | --- | --- |
| **인터랙티브 웹 그래프** | `graph_interactive.html` | `uv run --with pandas --with pyarrow --with pyvis python visualize_web.py` | 마우스 드래그, 줌, 노드 상세 툴팁 지원 |
| **정적 이미지 (PNG)** | `graph_network.png` | `uv run --with pandas --with pyarrow --with networkx --with matplotlib python visualize_png.py` | 보고서 및 발표 자료용 고화질 이미지 |
| **Gephi 연동 (GraphML)** | `ontology_graph.graphml` | `uv run --with pandas --with pyarrow --with networkx python export_graphml.py` | 전문 분석 툴(Gephi) 임포트용 포맷 |
