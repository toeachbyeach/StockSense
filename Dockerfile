# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend & Puppeteer Setup
FROM node:20-slim
# Install Chromium, Puppeteer dependencies, build tools for sqlite3, and timezone data
ENV TZ=Australia/Sydney
RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y --no-install-recommends \
    gnupg wget python3 make g++ tzdata tini ca-certificates \
  && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && \
  wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
  sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
  apt-get update && \
  apt-get install -y --no-install-recommends \
    google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --build-from-source=sqlite3

# Copy Backend Source
COPY backend/ ./

# Copy Frontend Build to public directory
COPY --from=frontend-build /app/frontend/dist ./public

# Environment variables for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
