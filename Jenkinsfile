pipeline {
    agent any

    triggers {
        pollSCM('H/2 * * * *')
    }

    environment {
        IMAGE = 'DOCKERHUB_USER/devops-mini-app'
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
                echo "===> Stage 3: Building Docker image (${IMAGE}:${BUILD_NUMBER} and ${IMAGE}:latest)"
                sh 'docker build -t $IMAGE:$BUILD_NUMBER -t $IMAGE:latest .'
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
                echo "===> Stage 5: Deploying sibling container to host on port 3000"
                sh '''
                    docker rm -f devops-mini-app || true
                    docker run -d --name devops-mini-app -p 3000:3000 --restart unless-stopped $IMAGE:latest
                '''
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
            echo "Pipeline succeeded! Container 'devops-mini-app' is live."
            echo "Access application at: http://localhost:3000"
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
