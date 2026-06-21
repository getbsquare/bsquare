FROM node:20-alpine AS widget-builder
WORKDIR /build/packages/widget

# Install and build widget bundle from the monorepo package.
COPY packages/widget/package*.json ./
RUN npm ci
COPY packages/widget/ ./
RUN npm run build

FROM nginx:1.27-alpine

# Copy demo page
COPY examples/single-agent/web/index.html /usr/share/nginx/html/index.html

# Copy built widget bundle so window.BSquare is always available.
COPY --from=widget-builder /build/packages/widget/dist/bsquare-widget.global.js /usr/share/nginx/html/bsquare-widget.global.js

# Use a simple nginx config that routes to the backend API
COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    
    root /usr/share/nginx/html;
    index index.html;
    
    # SPA routing: all requests go to index.html unless they're static assets
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    
    # Cache static assets
    location ~* \.(?:js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
