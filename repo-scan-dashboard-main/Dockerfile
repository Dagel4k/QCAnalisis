FROM node:18-alpine

# Install git
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build frontend
RUN npm run build

# Create directories for storage and work
RUN mkdir -p /app/storage /app/.work

# Expose ports
EXPOSE 8080 3001

# Start both frontend and backend
CMD ["npm", "run", "start"]
