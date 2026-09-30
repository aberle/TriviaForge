# Deploying TriviaForge to AWS

One EC2 instance running the same `docker-compose.yml` you already use locally, plus Caddy in front
for automatic HTTPS, on a domain registered through Route 53. No load balancer, no RDS, no ECS —
the cheapest, simplest thing that actually holds WebSocket connections open reliably.

```
Internet ──▶ Route 53 (DNS) ──▶ Elastic IP ──▶ EC2 (t3.micro)
                                                  ├─ Caddy    :80/:443  (TLS, reverse proxy, WS passthrough)
                                                  ├─ app      :3000    (this repo, built from source)
                                                  └─ db       :5432    (Postgres, not published to the host)
```

Reachability is over **SSM Session Manager**, not SSH — there's no port 22 open at all, and no SSH
key to lose or rotate.

## What this costs

| Item | Cost |
|---|---|
| Domain registration (`.com`) | ~$13, once a year — **not** free-tier eligible, this is real money |
| Route 53 hosted zone | $0.50/month (created automatically when the domain registers) |
| EC2 t3.micro | Free for 750 hrs/month for 12 months on a new/eligible account; otherwise ~$7.50/month |
| Elastic IP | Free while attached to a running instance |
| EBS (20 GB gp3) | Within the 30 GB/month free-tier allowance |
| Data transfer | Free tier covers 100 GB/month out — far more than a trivia night needs |

Nothing here is billed per-request, so an idle server between game nights costs the same as one being
used. See **Turning it off** at the bottom if you want to stop paying between uses.

## Step 1 — Create a dedicated IAM user (do this yourself, in the AWS Console)

This keeps your root account out of day-to-day use (AWS's own top recommendation) and keeps the
credentials Claude/Terraform uses scoped to only what deployment needs — never `AdministratorAccess`,
never your root keys, and never typed into this chat.

1. Sign in to the AWS Console for **your personal account** (not one of your existing `~/.aws`
   profiles) as the root user. If root doesn't have MFA yet, add it now — IAM → Security credentials
   → Assign MFA device. This is worth doing once regardless of the rest of this deploy.
2. Enable an IAM cost/billing alert while you're there (Billing → Budgets → Create budget, e.g. $20/mo)
   so a misconfiguration can't run up a silent bill.
3. IAM → Users → **Create user**. Name it `triviaforge-deploy`. Do **not** give it console access
   (it only needs programmatic/API access).
4. On the permissions step, choose **Attach policies directly** → **Create policy** → **JSON** tab,
   and paste the contents of [`iam-policy.json`](./iam-policy.json) (open it in this repo). This is a
   least-privilege policy: it can create/manage exactly the EC2 instance, security group, IAM role,
   Elastic IP, DNS records and domain registration this deploy needs, and nothing else on your
   account (no S3, no other EC2 instances, no billing access, no ability to touch other IAM users).
   Name the policy `triviaforge-deploy-policy`, create it, then attach it to the user.
5. Open the new user → **Security credentials** tab → **Create access key** → choose
   "Command Line Interface (CLI)" → acknowledge the warning → create it. You'll see an Access Key ID
   and a Secret Access Key **once**.

## Step 2 — Configure the CLI profile yourself

In your own terminal (not through Claude — the secret key should never appear in this chat or its
logs):

```bash
aws configure --profile triviaforge
# AWS Access Key ID: <paste it>
# AWS Secret Access Key: <paste it>
# Default region name: us-west-2   (where the server itself lives; Route 53 Domains commands below
#                                    still explicitly pass --region us-east-1 regardless of this)
# Default output format: json
```

This writes to `~/.aws/credentials` under a new `[triviaforge]` profile — it does not touch
`default` or your other profiles. Once this is done, tell Claude the profile name (`triviaforge`) and
everything from here on uses `--profile triviaforge` explicitly; it never reads the profile's raw
key material, only calls the AWS CLI/Terraform with `--profile`.

Verify it (safe to run/share — this doesn't print any secret):

```bash
aws sts get-caller-identity --profile triviaforge
```

## Step 3 — Register the domain (also run by you, not Claude)

Registering a domain needs your real contact info and a Terms of Service acceptance, so this is a
CLI command **you** run and review, not something scripted on your behalf. It must target
`us-east-1` (Route 53 Domains is only available there, regardless of where the server itself lives).

```bash
aws route53domains check-domain-availability \
  --profile triviaforge --region us-east-1 \
  --domain-name geekswhostink.com
```

If it's available, register it (fill in your real details — this is what will appear in WHOIS,
though AWS enables free privacy protection by default for most TLDs):

```bash
aws route53domains register-domain \
  --profile triviaforge --region us-east-1 \
  --domain-name geekswhostink.com \
  --duration-in-years 1 \
  --auto-renew \
  --admin-contact file://contact.json \
  --registrant-contact file://contact.json \
  --tech-contact file://contact.json
```

where `contact.json` (don't commit this) looks like:

```json
{
  "FirstName": "Nick",
  "LastName": "Aberle",
  "ContactType": "PERSON",
  "OrganizationName": "",
  "AddressLine1": "...",
  "City": "...",
  "State": "...",
  "CountryCode": "US",
  "ZipCode": "...",
  "PhoneNumber": "+1.5555555555",
  "Email": "you@example.com"
}
```

This takes anywhere from a few minutes to a few hours (AWS emails you when it's done — watch for a
confirmation-of-registrant-email step some TLDs require). Route 53 automatically creates a hosted
zone for the domain the moment it registers; Terraform below references that zone rather than
creating a second one.

Check on it with:

```bash
aws route53domains list-operations --profile triviaforge --region us-east-1
```

## Step 4 — Provision the infrastructure

Once the domain shows as registered (`aws route53domains list-domains --profile triviaforge --region us-east-1`),
tell Claude and it will run:

```bash
cd deploy/aws/terraform
terraform init
terraform plan  -var="aws_profile=triviaforge" -var="domain_name=geekswhostink.com"
terraform apply -var="aws_profile=triviaforge" -var="domain_name=geekswhostink.com"
```

`terraform plan` is shown to you before anything is created — review it. `apply` then:
creates the security group (only 80/443 inbound, no SSH), an IAM role scoped to SSM only, the EC2
instance (which builds and starts the app via Docker Compose on first boot — takes 3-5 minutes
after the instance itself is up), an Elastic IP, and the DNS `A` records.

`terraform output` afterward shows the public IP, the SSM command to reach the box without SSH, and
(with `terraform output admin_password`) the generated admin password — the admin **username** is
always `admin` (that part isn't configurable in the app itself).

DNS propagation and Caddy's first Let's Encrypt certificate issuance can take a few extra minutes
after `apply` finishes — a `525`/`526`-style TLS error right after stack creation is expected and
should clear on its own.

## Step 5 — Verify everything actually works

```bash
curl -sI https://geekswhostink.com/api/config          # 200, and check the response is JSON not an error page
```

Then, from a browser: load the site, scan a QR code from a **second device on cellular data** (not
your dev machine's network) to confirm `SERVER_URL` and the QR code both resolve to the public
domain, not an internal IP. Log into `/admin` with the generated password and confirm you can still
create a quiz and add a question (this exercises the CSRF-cookie fix from earlier — this is the
first time it's been tested against a *real* HTTPS origin instead of `localhost`, which is exactly
the gap that hid the original bug).

For the WebSocket/E2E check, point the existing test harness at the live domain:

```bash
cd app
TEST_BASE_URL=https://geekswhostink.com \
TEST_ADMIN_PASSWORD="$(cd ../deploy/aws/terraform && terraform output -raw admin_password)" \
node testing/e2e/round-countdown.e2e.js   # or any single suite first
```

Do **not** run the full `npm run test:e2e` suite against the live deploy by default — it creates and
deletes real quizzes/rooms against a live public server and is slower over the internet than
localhost; a couple of representative suites (one that opens a real room and keeps a socket open
for a while, like `round-countdown` or `presenter-display-flow`, plus `csrf-cookie-security`) are
enough to confirm sockets stay connected and CSRF works end-to-end. Ask first if you want the full
suite run against production.

## Redeploying after you push new code

```bash
./deploy/aws/redeploy.sh triviaforge
```

Pulls the latest commit on whatever branch was deployed and rebuilds/restarts the containers, over
SSM — no SSH.

## Reaching the box directly (debugging)

```bash
aws ssm start-session --target "$(cd deploy/aws/terraform && terraform output -raw instance_id)" --profile triviaforge --region us-west-2
# then, on the box:
cd /opt/triviaforge && docker compose -f docker-compose.yml -f deploy/aws/docker-compose.prod.yml logs -f
```

## Turning it off (to stop paying between uses)

Stopping the instance (keeps the disk, drops compute charges, the Elastic IP starts costing ~$3.60/month while unattached to a running instance unless you also release it):

```bash
aws ec2 stop-instances --instance-ids "$(cd deploy/aws/terraform && terraform output -raw instance_id)" --profile triviaforge --region us-west-2
```

Tearing everything down completely (instance, EIP, security group, IAM role — **not** the domain
registration or DNS zone, which `terraform destroy` deliberately doesn't touch since domain
ownership shouldn't be an accidental `terraform destroy` away):

```bash
cd deploy/aws/terraform
terraform destroy -var="aws_profile=triviaforge" -var="domain_name=geekswhostink.com"
```
