FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY docs/ ./docs/
EXPOSE 3000
CMD ["npx", "serve", "docs", "-l", "3000"]
