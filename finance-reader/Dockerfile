FROM node:20-slim

# Python 3 및 pip 설치
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/python3 /usr/bin/python
WORKDIR /app

# Node.js 패키지 설치
COPY package*.json ./
RUN npm install

# Python 패키지 설치
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

# 프로젝트 전체 코드 복사
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]