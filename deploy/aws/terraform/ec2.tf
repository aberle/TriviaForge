# Generated once and stored in local state (see versions.tf's note on gitignoring it). Restricted to
# a safe character set so they drop into a shell heredoc and a .env file without needing escaping.
resource "random_password" "admin_password" {
  length           = 20
  override_special = "-_"
}

resource "random_password" "csrf_secret" {
  length           = 48
  override_special = "-_"
}

resource "random_password" "db_password" {
  length           = 32
  override_special = "-_"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  # Re-running this only matters on first boot; redeploys of new code go through redeploy.sh instead
  # (see ../README.md), not through re-applying Terraform.
  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    github_repo_url = var.github_repo_url
    github_branch   = var.github_branch
    domain_name     = var.domain_name
    admin_password  = random_password.admin_password.result
    csrf_secret     = random_password.csrf_secret.result
    db_password     = random_password.db_password.result
    timezone        = var.timezone
    guest_only_mode = var.guest_only_mode
    app_name        = var.app_name
  })
  user_data_replace_on_change = false

  tags = {
    Name = "triviaforge-app"
  }
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags = {
    Name = "triviaforge-app"
  }
}
