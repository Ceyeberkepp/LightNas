FROM node:22-alpine
WORKDIR /opt/lightnas
COPY --chown=node:node demo/ /opt/lightnas/demo/
COPY --chown=node:node public/assets/lightnas-logo.png /opt/lightnas/public/assets/lightnas-logo.png
USER node
ENV NODE_ENV=production LIGHTNAS_DEMO_HOST=0.0.0.0 LIGHTNAS_DEMO_PORT=3081
EXPOSE 3081
CMD ["node", "demo/server.mjs"]
