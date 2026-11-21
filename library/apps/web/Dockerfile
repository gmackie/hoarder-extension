FROM node:22.22.2-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY library/apps/web/package.json ./library/apps/web/package.json
RUN npm ci --workspace @hoarder/library-web
COPY library/apps/web ./library/apps/web
RUN npm run library:web:build

FROM nginx:1.29-alpine
COPY library/apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/library/apps/web/dist /usr/share/nginx/html
EXPOSE 80
