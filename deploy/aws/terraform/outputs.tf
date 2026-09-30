output "public_ip" {
  value = aws_eip.app.public_ip
}

output "instance_id" {
  value = aws_instance.app.id
}

output "url" {
  value = "https://${var.domain_name}"
}

output "ssm_session_command" {
  description = "Reach the instance with no SSH key and no open port 22"
  value       = "aws ssm start-session --target ${aws_instance.app.id} --profile ${var.aws_profile} --region ${var.aws_region}"
}

output "admin_password" {
  value     = random_password.admin_password.result
  sensitive = true
}
