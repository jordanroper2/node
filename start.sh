#!/bin/sh
cat > /etc/nginx/nginx.conf << EOF
events {}
http {
    include /etc/nginx/mime.types;
    server {
        listen ${PORT:-3000};
        root /usr/share/nginx/html;
        index index.html;
        location / {
            try_files \$uri \$uri/ /index.html;
        }
    }
}
EOF
exec nginx -g 'daemon off;'
