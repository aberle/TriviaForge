#!/bin/bash
# Runs once, on first boot only. Logs go to /var/log/cloud-init-output.log if anything needs
# debugging (reachable via `aws ssm start-session`, since there's no SSH access to this box at all).
set -euxo pipefail

dnf update -y
dnf install -y docker git

# Amazon Linux 2023's docker package doesn't bundle the compose or buildx plugins; install both
# directly. `compose build` shells out to buildx (0.17+) even for a plain single-image build, so
# both are required, not just compose.
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# buildx's release assets embed the version in the filename (no fixed-name "latest" asset like
# compose has above), so resolve the actual latest tag from the redirect first.
BUILDX_VERSION=$(curl -sI https://github.com/docker/buildx/releases/latest | grep -i '^location:' | sed -E 's#.*/tag/(v[0-9.]+).*#\1#' | tr -d '\r')
curl -SL "https://github.com/docker/buildx/releases/download/$${BUILDX_VERSION}/buildx-$${BUILDX_VERSION}.linux-amd64" \
  -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx

systemctl enable --now docker
usermod -aG docker ec2-user

# t3.micro has 1 GB RAM; `npm install` + the Vite build can spike above that. A swapfile is free
# insurance against an OOM-killed build (this box doesn't need the extra memory once it's running).
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

mkdir -p /opt/triviaforge
git clone --branch "${github_branch}" --single-branch --depth 1 "${github_repo_url}" /opt/triviaforge
cd /opt/triviaforge

cat > .env <<ENVEOF
NODE_ENV=production
APP_PORT=3000
SERVER_URL=https://${domain_name}
ADMIN_PASSWORD=${admin_password}
CSRF_SECRET=${csrf_secret}
DB_PASSWORD=${db_password}
TZ=${timezone}
DOMAIN_NAME=${domain_name}
GUEST_ONLY_MODE=${guest_only_mode}
APP_NAME=${app_name}
LOGO_URL=${logo_url}
FAVICON_URL=${favicon_url}
ENVEOF
chmod 600 .env

docker compose -f docker-compose.yml -f deploy/aws/docker-compose.prod.yml up -d --build
