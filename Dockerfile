FROM nginx:alpine
COPY docs/ /usr/share/nginx/html/
COPY start.sh /start.sh
RUN chmod +x /start.sh
EXPOSE 3000
CMD ["/start.sh"]
