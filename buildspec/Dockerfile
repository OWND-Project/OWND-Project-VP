FROM amazonlinux:latest
LABEL authors="sadamu.matsuoka"

WORKDIR /srv/
COPY . .

EXPOSE 3000
# initial setup
RUN dnf update -y
RUN dnf -y groupinstall "Development Tools"
RUN dnf install -y openssl-devel bzip2-devel libffi-devel zlib-devel libtiff-devel libjpeg-devel libzip-devel freetype-devel libwebp-devel libxml2-devel libxslt-devel libpq-devel  python3-virtualenv libffi-devel openssl-devel python3-devel  libicu-devel

# install node
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
# NVMのインストール

# NVM_DIRを環境変数として設定
ENV NVM_DIR=/root/.nvm

# Node.jsのインストール
RUN . "$NVM_DIR/nvm.sh" && nvm install 20

# 環境変数を設定
ENV NODE_VERSION=20
ENV NODE_PATH=$NVM_DIR/versions/node/v$NODE_VERSION/lib/node_modules
ENV PATH=$NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH
RUN . ~/.nvm/nvm.sh && npm install --g yarn

# setup
RUN cd /srv/
RUN . ~/.nvm/nvm.sh && yarn