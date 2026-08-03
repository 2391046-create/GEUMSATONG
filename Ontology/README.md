# **Financial Knowledge Graph Construction (GraphRAG & Ontology)**


금융 기사를 바탕으로 엔티티(Entity) 및 관계(Relationship)를 추출하고, 이를 기반으로 지식 그래프(Knowledge Graph) 구축 및 시각화를 수행하는 파이프라인입니다.


---
### 💡 이 프로젝트에서 '온톨로지'란 무엇인가요?

일반적인 AI는 "금융사기"나 "DART 공시"라는 단어가 나오면 단어 자체의 사전적 의미만 검색합니다. 하지만 본 프로젝트의 온톨로지는 **개념과 개념 사이의 관계(Relationship)성**을 네트워크 구조(Node & Edge)로 정의합니다.

* **노드 (Node):** 금융 기관, 기업, 재무 지표, 사기 수법, 전문 금융 용어 등
* **엣지 (Edge):** `[금리 인상] --(causes)--> [대출 이자 부담 증가]`,  `[기업 영업이익] --(measured_by)--> [DART 공시 재무제표]`
---

### ⚙️ 온톨로지가 해결하는 핵심 역할

#### 1. 파편화된 금융·공시 데이터의 맥락 연결 (Context Integration)
> *"흩어진 기사, DART 재무제표, 금융 이슈를 하나의 거대한 지식망으로 묶습니다."*

* **숨겨진 인과관계 추적 (Multi-hop Reasoning):** 단일 문장이나 개별 기사에서는 파악하기 힘든 '금리 변동 ➔ 기업 실적 ➔ 연관 금융 상품' 간의 복합적인 파급 효과를 지식 그래프 연결망을 통해 한눈에 추적합니다.
* **4가지 관계 규격화:** `is_defined_as`, `causes`, `measured_by`, `relates_to_product`와 같은 구조화된 관계(Edge)를 통해 단순 키워드 매칭이 아닌 정밀한 금융 맥락을 제공합니다.

#### 2. LLM 환각(Hallucination) 방지 및 검증 가능성 확보 (Fact-grounded RAG)
> *"LLM이 임의로 추측해 답변하지 않도록, 검증된 사실(Fact) 지도를 제시합니다."*

* **구조화된 지식 기반 생성:** 자유로운 텍스트 탐색 방식의 기존 RAG와 달리, 정밀하게 추출된 노드와 엣지 데이터만을 바탕으로 LLM 답변을 구성하므로 신뢰도가 대폭 향상됩니다.
* **DART 수치 십자 검증:** 정성적 기사 텍스트를 DART 재무제표의 정량적 지표(`measured_by`)와 그래프 상에서 직접 연결해 주므로, 뉴스 속 과장·왜곡 서술을 팩트체크할 수 있는 근거를 제공합니다.

#### 3. 입체적 분석을 위한 거시-미시 탐색 지원 (Dual Query Mode)
> *"필요에 따라 사건의 세부 원인도, 전체 이슈의 종합 요약도 즉시 추출합니다."*

* **Local Search (미시적 탐색):** 특정 금융 기업이나 용어를 중심으로 연결된 직접적 인과관계와 세부 위험 요인을 정밀 탐색합니다.
* **Global Search (거시적 탐색):** 전체 금융 지식 그래프의 커뮤니티(Community) 구조를 분석하여, 복잡한 시장 동향이나 사기 수법의 전체적인 흐름을 요약·제공합니다.

---

### 3. 🔗 4가지 Edge의 Triple 구조 (Subject - Relationship - Object)

금융 기사를 효과적으로 통역하고 분석하기 위해, 엔티티 간의 관계성을 아래 **4가지 핵심 관계 유형(Edge)**으로 분류하여 자동 추출합니다.

| 관계 유형 (Edge) | 설명 | Triple Structure 예시 |
| :--- | :--- | :--- |
| **`is_defined_as`** | 금융 용어 및 개념의 정의 | `(기준금리)` - [`is_defined_as`] -> `(중앙은행이 정하는 정책금리)` |
| **`causes`** | 사건 간 인과 관계 및 파급 효과 | `(금리 인상)` - [`causes`] -> `(대출 이자 부담 증가)` |
| **`measured_by`** | 정량적 재무 지표 및 실적 근거 | `(기업 영업이익)` - [`measured_by`] -> `(DART 공시 재무제표)` |
| **`relates_to_product`** | 관련 금융 상품 및 서비스 연관성 | `(고금리 기조)` - [`relates_to_product`] -> `(파킹통장/예금)` |

---

### 4. 📐 기술 파이프라인 및 데이터 흐름 (Architecture)

```text
[금융 기사 (.txt)]
       │
       ▼
[Microsoft GraphRAG 파이프라인] ── (settings.yaml & 커스텀 프롬프트)
       │
       ├─► [Entity & Relationship 추출] (4가지 Edge의 Triple 구조로 분류)
       │
       ▼
[Parquet 표준 데이터베이스] (.parquet)
       │
       ├─► ① Local / Global Query Engine (속도/비용 최적화 쿼리)
       └─► ② 3-Way 시각화 엔진 (PyVis / NetworkX / Gephi)
```

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
uvx --python 3.12 --with "litellm<1.92" graphrag query --root . --method local "주요 금융 기관 간의 연관 관계를 설명해줘."
```

- **글로벌 질의 (Global Search: 전체 문맥 요약)**
```
uvx --python 3.12 --with "litellm<1.92" graphrag query --root . --method global "이 문서에서 다루는 주요 이슈를 요약해줘."
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
