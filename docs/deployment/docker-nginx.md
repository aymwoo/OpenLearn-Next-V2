# Docker & Nginx 反向代理配置

配置支持 Socket.IO WebSocket 协议长连接的 Nginx 规则：

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
}
```
