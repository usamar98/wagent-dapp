FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY shared ./shared
COPY runner ./runner
COPY tsconfig.json ./
RUN npx tsc -p runner/tsconfig.json
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/runner ./dist
COPY package.json ./
ENV AGENT_CONFIG_PATH=/config/agent.json RUNNER_STATE_DIR=/data
ENTRYPOINT ["node", "dist/runner/index.js"]
