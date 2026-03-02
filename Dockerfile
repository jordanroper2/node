FROM nginx:alpine
COPY docs/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["/bin/sh", "-c", "sed -i \"s/__PORT__/${PORT:-3000}/g\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
