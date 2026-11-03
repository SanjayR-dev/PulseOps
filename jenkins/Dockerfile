FROM jenkins/jenkins:lts-jdk17

# Switch to root to install packages and access the Docker socket
USER root

# Install dependencies, Docker CLI, and Node.js 18 + npm
RUN apt-get update && apt-get install -y --no-install-recommends \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get update && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Keep running as root to avoid docker.sock permission denied issues
USER root
