FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY docs/ ./docs/
EXPOSE 3000
CMD ["sh", "-c", "npx serve docs -l ${PORT:-3000}"]
