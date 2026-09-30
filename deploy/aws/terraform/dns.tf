# Registering the domain itself is a manual, one-time step (see ../README.md) -- it needs your real
# contact info and a ToS click-through, which shouldn't go through an automated script. Route 53
# auto-creates a hosted zone the moment the domain is registered, so this just references that
# existing zone rather than creating a competing one (which would produce a broken NS delegation).
data "aws_route53_zone" "this" {
  name = var.domain_name
}

resource "aws_route53_record" "apex" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}

resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
