FROM node:22-alpine AS development

WORKDIR /workspace

COPY package*.json ./
RUN npm install
RUN chown -R 1000:1000 /workspace/node_modules

COPY . .

EXPOSE 3000
CMD ["npm", "run", "api:dev"]
