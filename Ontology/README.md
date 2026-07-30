# **Financial Knowledge Graph Construction (GraphRAG & Ontology)**


금융 기사를 바탕으로 엔티티(Entity) 및 관계(Relationship)를 추출하고, 이를 기반으로 지식 그래프(Knowledge Graph) 구축 및 시각화를 수행하는 파이프라인입니다.


---

## 📁 **프로젝트 구조 (Directory Structure)**


```text
Ontology/
├── input/                  # 원본 금융 텍스트 데이터 (.txt)
├── prompts/                # GraphRAG 추출 규칙 및 프롬프트 정의
├── lib/                    # 커스텀 모듈 및 유틸리티 래퍼
├── check_result.py         # 추출된 parquet 결과물(엔티티/관계) 확인용 스크립트
├── visualize_web.py        # PyVis 기반 인터랙티브 HTML 네트워크 그래프 생성
├── visualize_png.py        # NetworkX/Matplotlib 기반 정적 고화질 PNG 이미지 생성
├── export_graphml.py       # Gephi / Neo4j 용 GraphML 포맷 데이터 수출 스크립트
├── settings.yaml           # GraphRAG 파이프라인 및 LLM 설정 파일
└── README.md               # 프로젝트 매뉴얼
```

---


## ⚙️ **환경 구성 및 기술 스택 (Tech Stack)**


1. **Core Framework**: Microsoft GraphRAG

2. **Language & Package Manager**: Python 3.12, uv

3. **Visualization**: PyVis, NetworkX, Matplotlib, Gephi (GraphML)

```
# uv 설치 (Windows PowerShell 기준)
powershell -ExecutionPolicy ByPass -c "irm [https://astral.sh/uv/install.ps1](https://astral.sh/uv/install.ps1) | iex"
```


## 🛠️ **기술적 완성도 및 구현 가능성 (Architecture & Feasibility)**

본 모듈은 **기술 적정성, 개발 계획의 구체성, 기술 실현 가능성**을 검증하기 위해 다음과 같이 고도화된 파이프라인으로 설계 및 구현되었습니다.

### **1. 기술 적정성 (Technical Suitability)**

- **Microsoft GraphRAG 도입:** 단순 RAG의 한계인 단편적 정보 검색을 극복하고, 문서 전체의 엔티티 간 연결 고리를 파악할 수 있는 다층 그래프 구조 채택
  
- **표준화된 데이터 포맷:** 추출된 노드(Entity)와 엣지(Relationship)는 `Parquet` 포맷으로 관리되어 대용량 데이터 처리 속도와 확장성을 보장

### **2. 구현 완료 및 검증된 파이프라인 (Prototyping & Feasibility)**

- **자동화된 인덱싱:** `settings.yaml` 기반으로 LLM 추출 규칙을 표준화하여 데이터 입력 시 그래프 인덱스가 즉시 생성됨.
  
- **다중 시각화 지원:**
  
  - `PyVis`: 사용자 응답용 인터랙티브 웹 그래프 연동 (`graph_interactive.html`)
  - `NetworkX/Matplotlib`: 정적 고화질 그래픽 리포트 생성 (`graph_network.png`)
  - `Gephi (GraphML)`: 대규모 온톨로지 그래프 분석 및 가공 지원 (`ontology_graph.graphml`)

### **3. 확장 및 서비스 연동 계획 (Future Roadmap)**

- **도메인 특화 관계 확장**: Microsoft GraphRAG 프롬프트 레이어를 고도화하여 금융 기사 내 엔티티 간 관계를 is_defined_as(용어 정의), causes(사건 인과), measured_by(재무 근거), relates_to_product(상품 연관)의 4대 커스텀 Triple 구조로 정밀하게 분류 및 세분화할 예정

- **실시간 지식 그래프 병합**: 생성된 .parquet 및 .graphml 데이터를 그래프 DB(Neo4j) 및 벡터 DB와 연동하여, 신규 기사가 유입될 때마다 기존 온톨로지 그래프에 동적으로 노드와 엣지가 Merge되며 자율적으로 성장하는 파이프라인으로 확장 예정


## 🚀 **실행 가이드 (Execution Workflow)**


### **1. GraphRAG 인덱싱 및 쿼리**

문서 기반 지식 그래프 인덱스를 생성하고 질의응답을 수행합니다.

- **로컬 질의 (Local Search: 특정 엔티티/관계 중심 탐색)**
```
uvx --python 3.12 --with "litellm<1.92" graphrag query --root . --method local --query "주요 금융 기관 간의 연관 관계를 설명해줘."
```

- **글로벌 질의 (Global Search: 전체 문맥 요약)**
```
uvx --python 3.12 --with "litellm<1.92" graphrag query --root . --method global --query "이 문서에서 다루는 주요 이슈를 요약해줘."
```

### **2. 추출 데이터 결과 확인**

추출된 entities.parquet 및 relationships.parquet 데이터의 상위 항목을 터미널에서 빠르게 조회가 가능합니다.
```
uv run --with pandas --with pyarrow python check_result.py
```


## 📊 **시각화 (Visualization Guide)**


추출된 지식 그래프를 3가지 형태로 시각화하여 분석할 수 있습니다.

| 시각화 방식 | 생성 파일 | 실행 명령어 | 특징 |
| --- | --- | --- | --- |
| **인터랙티브 웹 그래프** | `graph_interactive.html` | `uv run --with pandas --with pyarrow --with pyvis python visualize_web.py` | 마우스 드래그, 줌, 노드 상세 툴팁 지원 |
| **정적 이미지 (PNG)** | `graph_network.png` | `uv run --with pandas --with pyarrow --with networkx --with matplotlib python visualize_png.py` | 보고서 및 발표 자료용 고화질 이미지 |
| **Gephi 연동 (GraphML)** | `ontology_graph.graphml` | `uv run --with pandas --with pyarrow --with networkx python export_graphml.py` | 전문 분석 툴(Gephi) 임포트용 포맷 |
