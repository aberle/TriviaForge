terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state on purpose: this is a single-person deploy with no team to coordinate state with.
  # State (terraform.tfstate) contains the generated secrets below in plaintext, so it's gitignored --
  # never commit it. Back it up somewhere private if you want to survive a lost laptop.
}

provider "aws" {
  # Uses the named CLI profile you configured yourself (see ../README.md) -- never the default
  # profile, and never a hardcoded key in this repo.
  profile = var.aws_profile
  region  = var.aws_region

  default_tags {
    tags = {
      Project   = "TriviaForge"
      ManagedBy = "terraform"
    }
  }
}
