FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY docs/ ./docs/
EXPOSE 3000
CMD ["sh", "-c", "serve docs -l tcp://0.0.0.0:${PORT:-3000}"]
