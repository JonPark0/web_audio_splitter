FROM node:24-alpine
WORKDIR /app
# Copy the manifests first so the install layer stays cached until dependencies
# change; `npm ci` installs exactly what package-lock.json pins.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
