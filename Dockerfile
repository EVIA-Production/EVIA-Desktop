# Stage 1: Build the application
FROM node:20-alpine as builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Define build arguments without defaults - these will be provided by Azure
ARG VITE_BACKEND_URL
ARG VITE_BACKEND_PORT

# Make environment variables available during build
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_BACKEND_PORT=$VITE_BACKEND_PORT

# Build the application
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:alpine

# Copy the build output to replace the default nginx contents
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]
