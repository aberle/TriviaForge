#!/bin/bash
# Pushes new code live: pulls the latest commit on the deployed branch and rebuilds/restarts the
# containers. Runs entirely over SSM (no SSH key, no open port 22) -- run this from your own machine
# after `git push`ing, with the same profile Terraform used.
#
#   ./deploy/aws/redeploy.sh <profile> [region]
#
set -euo pipefail

PROFILE="${1:?Usage: redeploy.sh <aws-profile> [region]}"
REGION="${2:-us-west-2}"

cd "$(dirname "$0")/terraform"
INSTANCE_ID=$(terraform output -raw instance_id)
cd - > /dev/null

echo "Redeploying on instance $INSTANCE_ID..."

COMMAND_ID=$(aws ssm send-command \
  --profile "$PROFILE" --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "TriviaForge redeploy" \
  --parameters 'commands=["cd /opt/triviaforge && BRANCH=$(git rev-parse --abbrev-ref HEAD) && git fetch --depth 1 origin \"$BRANCH\" && git reset --hard FETCH_HEAD && docker compose -f docker-compose.yml -f deploy/aws/docker-compose.prod.yml up -d --build"]' \
  --query "Command.CommandId" --output text)

echo "Command ID: $COMMAND_ID (waiting for it to finish)"
aws ssm wait command-executed \
  --profile "$PROFILE" --region "$REGION" \
  --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" || true

aws ssm get-command-invocation \
  --profile "$PROFILE" --region "$REGION" \
  --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query "{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}" \
  --output text
