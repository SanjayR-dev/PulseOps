pipeline {
    agent any

    triggers {
        pollSCM('H/2 * * * *')
    }

    environment {
        IMAGE = 'sanjayr8dev/uptime-monitor'
        CREDS = credentials('dockerhub-creds')
    }

    stages {
        stage('Checkout') {
            steps {
                echo "===> Stage 1: Checkout source code from SCM"
                checkout scm
            }
        }

        stage('Test') {
            steps {
                echo "===> Stage 2: Installing dependencies and running unit tests"
                sh 'cd app && npm ci && npm test'
            }
        }

        stage('Build image') {
            steps {
                echo "===> Stage 3: Building Docker image with Build #${BUILD_NUMBER}"
                sh 'docker build --build-arg BUILD_NUMBER=$BUILD_NUMBER -t $IMAGE:$BUILD_NUMBER -t $IMAGE:latest .'
            }
        }

        stage('Push image') {
            steps {
                echo "===> Stage 4: Authenticating and pushing images to Docker Hub"
                sh '''
                    echo "$CREDS_PSW" | docker login -u "$CREDS_USR" --password-stdin
                    docker push $IMAGE:$BUILD_NUMBER
                    docker push $IMAGE:latest
                    docker logout
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo "===> Stage 5: Deploying uptime-monitor sibling container to host port 3000"
                script {
                    def webhookEnv = ""
                    try {
                        withCredentials([string(credentialsId: 'alert-webhook-url', variable: 'HOOK_URL')]) {
                            if (HOOK_URL && HOOK_URL.trim() != '') {
                                webhookEnv = "-e ALERT_WEBHOOK_URL=\"${HOOK_URL}\""
                                echo "[INFO] Detected 'alert-webhook-url' credential. Alerting is ENABLED."
                            }
                        }
                    } catch (Exception e) {
                        echo "[INFO] 'alert-webhook-url' credential not configured. Deploying without external webhooks."
                    }

                    sh """
                        docker rm -f uptime-monitor devops-mini-app || true
                        docker run -d --name uptime-monitor -p 3000:3000 --restart unless-stopped ${webhookEnv} ${IMAGE}:latest
                    """
                }
            }
        }

        stage('Verify') {
            steps {
                echo "===> Stage 6: Verifying container health"
                sh '''
                    sleep 5
                    if curl -f http://host.docker.internal:3000/health; then
                        echo "\n[SUCCESS] Health check passed via host.docker.internal:3000/health"
                    else
                        echo "\n[INFO] host.docker.internal did not respond. Attempting fallback to host gateway (172.17.0.1)..."
                        curl -f http://172.17.0.1:3000/health
                        echo "\n[SUCCESS] Health check passed via fallback host IP (172.17.0.1:3000/health)"
                    fi
                '''
            }
        }
    }

    post {
        success {
            echo "======================================================="
            echo "Pipeline succeeded! Container 'uptime-monitor' is live."
            echo "Dashboard running at: http://localhost:3000"
            echo "======================================================="
        }
        failure {
            echo "======================================================="
            echo "Pipeline failed! Check stage error logs above."
            echo "======================================================="
        }
        always {
            echo "===> Cleaning up dangling Docker build cache and images"
            sh 'docker image prune -f || true'
        }
    }
}
