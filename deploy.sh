#!/usr/bin/env bash
# OpenLearnV2 生产部署脚本
# 自动检测项目路径、构建、配置 Nginx、启动 PM2
set -e

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 项目路径: $APP_ROOT"

# ── 1. 生成 nginx.conf（自动替换路径） ────────────────────────
cat > "$APP_ROOT/nginx.generated.conf" << 'NGINX'
# OpenLearnV2 — Production Nginx Configuration (auto-generated)
# 项目路径在 deploy.sh 中通过 sed 替换 $APP_ROOT 占位符

upstream openlearn_backend {
    server 127.0.0.1:9000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;

    root $APP_ROOT/dist;
    index index.html;

    gzip on;
    gzip_min_length 1024;
    gzip_comp_level 5;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml application/xml+rss text/javascript;
    gzip_vary on;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /uploads/ {
        alias $APP_ROOT/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
        access_log off;
    }

    location /api/ {
        proxy_pass http://openlearn_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    }

    location /socket.io/ {
        proxy_pass http://openlearn_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /runtime/ {
        proxy_pass http://openlearn_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|otf)$ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
        access_log off;
    }

    location /health {
        proxy_pass http://openlearn_backend/health;
        access_log off;
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
NGINX

# 替换占位符为实际路径
sed -i "s|\$APP_ROOT|$APP_ROOT|g" "$APP_ROOT/nginx.generated.conf"
echo "✅ nginx.generated.conf 已生成"

# ── 2. 构建 ──────────────────────────────────────────────
echo "⏳ 构建中..."
npm run build
echo "✅ 构建完成"

# ── 3. 配置 Nginx ────────────────────────────────────────
if command -v nginx &> /dev/null; then
    NGINX_CONF="$APP_ROOT/nginx.generated.conf"

    # 检查 nginx.conf 是否 include sites-enabled
    if ! grep -q "sites-enabled" /etc/nginx/nginx.conf 2>/dev/null; then
        echo "⚠ /etc/nginx/nginx.conf 未包含 sites-enabled，尝试添加..."
        # 不自动修改，给出提示
    fi

    # 替换 default site
    sudo rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/openlearnv2.conf
    sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/default

    # 验证配置
    echo "--- nginx -t ---"
    sudo nginx -t
    sudo nginx -s reload
    echo "✅ Nginx 已配置并重载"
else
    echo "⚠ Nginx 未安装，跳过"
fi

# ── 4. 环境变量 ──────────────────────────────────────────
# 生成 ENCRYPTION_KEY（用于 AI Provider API Key AES-256 加密）
if ! grep -q "^ENCRYPTION_KEY=." "$APP_ROOT/.env" 2>/dev/null; then
    ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> "$APP_ROOT/.env"
    echo "✅ ENCRYPTION_KEY 已写入 .env"
fi

# 从 .env 读取值写入 ecosystem.config.cjs（PM2 env 块优先级 > dotenv）
set -a; source "$APP_ROOT/.env" 2>/dev/null; set +a
for key in ENCRYPTION_KEY GEMINI_API_KEY ALLOWED_ORIGINS; do
    val="${!key}"
    if [ -n "$val" ]; then
        sed -i "s|${key}: ''|${key}: '${val}'|" "$APP_ROOT/ecosystem.config.cjs"
    fi
done
echo "✅ 环境变量已注入 ecosystem.config.cjs"

# ── 5. PM2 启动/重启 ────────────────────────────────────
if command -v pm2 &> /dev/null; then
    if ! pm2 restart openlearnv2 2>/dev/null; then
        pm2 delete openlearnv2 2>/dev/null
        pm2 start ecosystem.config.cjs
    fi
    pm2 save
    echo "✅ PM2 已启动"
else
    echo "⚠ PM2 未安装，跳过。可手动启动: node dist/server.cjs"
fi

echo ""
echo "🚀 部署完成！"
echo "   访问: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '服务器IP')"
echo "   健康: http://127.0.0.1:9000/health"
