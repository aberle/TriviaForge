variable "aws_profile" {
  description = "Named AWS CLI profile to use (see ../README.md for how to create it). Never 'default'."
  type        = string
}

variable "aws_region" {
  description = "Region for EC2/VPC resources. Route 53 and Route 53 Domains are global/us-east-1 regardless."
  type        = string
  default     = "us-west-2"
}

variable "domain_name" {
  description = "The apex domain, already registered in Route 53 (registration is a manual step -- see README)."
  type        = string
  default     = "geekswhostink.com"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "github_repo_url" {
  description = "Public HTTPS clone URL for the app's repo."
  type        = string
  default     = "https://github.com/aberle/TriviaForge.git"
}

variable "github_branch" {
  type    = string
  default = "multi-round-mode"
}

variable "root_volume_gb" {
  description = "gp3 root volume size. 30 GB is the free-tier EBS allowance."
  type        = number
  default     = 20
}

variable "timezone" {
  type    = string
  default = "America/Denver"
}

variable "guest_only_mode" {
  description = "Sets GUEST_ONLY_MODE in the deployed app's .env -- players only pick a display name, no accounts."
  type        = bool
  default     = true
}

variable "app_name" {
  description = "Sets APP_NAME in the deployed app's .env -- replaces \"TriviaForge\" throughout the UI."
  type        = string
  default     = "Geeks Who Stink"
}
