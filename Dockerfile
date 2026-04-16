FROM node:24-alpine AS build
WORKDIR /app
COPY myecom-app/package*.json ./
RUN npm ci
COPY myecom-app/ ./
RUN npx ng build --configuration=production

FROM nginx:alpine
COPY --from=build /app/dist/myecom-app/browser /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/keycloak-proxy.conf /etc/nginx/conf.d/keycloak-proxy.conf
EXPOSE 443
